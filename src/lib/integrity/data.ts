import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { gamma } from "../market-data";
import { DataError, fetchFills } from "../polymarket";
import { numeric, object } from "../market-normalize";
import type { Trade } from "../domain";
import {
  buildHourly,
  calibrate,
  dropFirstHour,
  excessRate,
  fakeWalletPlacebo,
  indexBets,
  listWallets,
  marketBets,
  marketTest,
  multiMarket,
  percentile,
  plantedBuying,
  randomTimePlacebo,
  walletCheck,
  walletRecord,
  type Bet,
  type Fill,
  type HourlySeries,
  type LibraryMarket,
  type MarketTest,
  type Resolution,
  type WalletCheck,
} from "./core";
import { seededRandom } from "../statistical-core";
import { LIMITS, METHOD_ID, SETTINGS, type CategoryId } from "./settings";

const root = path.join(process.cwd(), ".luckaudit-cache", "integrity"),
  libDir = path.join(root, "library");

/* ------------------------------------------------------------- metadata */

export interface IntegrityMarketMeta {
  condition: string;
  title: string;
  slug: string;
  event: string;
  eventSlug: string;
  eventTitle: string;
  category: CategoryId | null;
  tagSlugs: string[];
  tokens: [string, string];
  outcomes: [string, string];
  closedTime: string | null;
  /** Lifetime Gamma volume, USD. */
  volumeUsd: number | null;
  resolution: Resolution;
}

/** Whether a market clears the library's volume floor (setting #1). */
export const meetsVolumeFloor = (volumeUsd: number | null | undefined) =>
  typeof volumeUsd === "number" && volumeUsd >= SETTINGS.library.minVolumeUsd;

const list = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string")
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {}
  return [];
};
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function parseTime(v: unknown): number | null {
  const s = str(v).trim();
  if (!s) return null;
  const iso = s.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

export function categoryOf(tagSlugs: string[]): CategoryId | null {
  const tags = new Set(tagSlugs.map((t) => t.toLowerCase()));
  for (const c of SETTINGS.library.categories)
    if (c.tagSlugs.some((t) => tags.has(t))) return c.id;
  return null;
}

/** Normalize a raw Gamma market (+ parent event) into the integrity metadata. */
export function metaFromGamma(rawMarket: unknown, rawEvent?: unknown): IntegrityMarketMeta | null {
  const m = object(rawMarket),
    e = object(rawEvent ?? list(m.events)[0]),
    condition = str(m.conditionId).toLowerCase(),
    tokens = list(m.clobTokenIds).map(str),
    outcomes = list(m.outcomes).map(str),
    prices = list(m.outcomePrices).map((p) => numeric(p));
  if (!/^0x[\da-f]{64}$/.test(condition) || tokens.length !== 2 || outcomes.length !== 2) return null;
  const tagSlugs = list(e.tags)
    .map((t) => str(object(t).slug))
    .filter(Boolean);
  const closed = m.closed === true,
    settled =
      prices[0] !== null && prices[1] !== null && ((prices[0] >= 0.99 && prices[1] <= 0.01) || (prices[0] <= 0.01 && prices[1] >= 0.99)),
    resolved = closed && settled && str(m.umaResolutionStatus || "resolved") === "resolved",
    closedTime = str(m.closedTime) || null;
  return {
    condition,
    title: str(m.question) || condition,
    slug: str(m.slug),
    event: String(e.id ?? str(e.slug) ?? ""),
    eventSlug: str(e.slug),
    eventTitle: str(e.title),
    category: categoryOf(tagSlugs),
    tagSlugs,
    tokens: [tokens[0], tokens[1]],
    outcomes: [outcomes[0], outcomes[1]],
    closedTime,
    volumeUsd: numeric(m.volumeNum ?? m.volume),
    resolution: {
      resolved,
      yesWon: resolved ? prices[0]! >= 0.99 : null,
      cutoff: resolved ? parseTime(closedTime) ?? parseTime(m.endDate) : null,
    },
  };
}

async function marketMeta(condition: string): Promise<IntegrityMarketMeta> {
  const find = (raw: unknown) =>
    Array.isArray(raw) ? raw.find((x) => str(object(x).conditionId).toLowerCase() === condition) : null;
  // Gamma omits closed markets unless closed=true is passed.
  const m =
    find(await gamma("markets", { condition_ids: condition, closed: "true" })) ??
    find(await gamma("markets", { condition_ids: condition }));
  if (!m) throw new DataError("No market metadata was found for this condition.", 404);
  let event = list(object(m).events)[0];
  const slug = str(object(event).slug);
  if (slug) {
    const ev = await gamma("events", { slug }).catch(() => null);
    if (Array.isArray(ev) && ev[0]) event = ev[0];
  }
  const meta = metaFromGamma(m, event);
  if (!meta) throw new DataError("Only binary markets with two outcome tokens are supported.", 422);
  return meta;
}

/* ---------------------------------------------------------------- fills */

function toFills(rows: Trade[], tokens: [string, string]): Fill[] {
  const out: Fill[] = [];
  for (const t of rows) {
    const o = t.token_id === tokens[0] ? 0 : t.token_id === tokens[1] ? 1 : null;
    if (o === null || (t.side !== "BUY" && t.side !== "SELL")) continue;
    if (!(t.price > 0 && t.price < 1 && t.size > 0 && t.timestamp > 0)) continue;
    out.push({ wallet: t.proxy_wallet.toLowerCase(), side: t.side, outcome: o, price: t.price, size: t.size, timestamp: t.timestamp });
  }
  return out;
}

export interface LoadedMarket {
  meta: IntegrityMarketMeta;
  taker: Fill[];
  allSides: Fill[];
  series: HourlySeries | null;
  coverage: { takerComplete: boolean; allSidesComplete: boolean; warnings: string[] };
}

const loaded = new Map<string, { at: number; value: LoadedMarket }>();

export async function loadMarket(condition: string, known?: IntegrityMarketMeta): Promise<LoadedMarket> {
  condition = condition.toLowerCase();
  if (!/^0x[\da-f]{64}$/.test(condition)) throw new DataError("Invalid market condition ID.", 400);
  const hit = loaded.get(condition);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.value;
  const meta = known ?? (await marketMeta(condition));
  if (!meta.resolution.resolved)
    // Live markets are never labeled, so their fills are not needed.
    return {
      meta,
      taker: [],
      allSides: [],
      series: null,
      coverage: { takerComplete: true, allSidesComplete: true, warnings: [] },
    };
  const [taker, all] = await Promise.all([
    fetchFills(condition, true, LIMITS.takerPages),
    fetchFills(condition, false, LIMITS.allSidesPages),
  ]);
  const warnings: string[] = [];
  const takerFills = toFills(taker.rows, meta.tokens);
  let series = buildHourly(takerFills, meta.resolution.cutoff);
  if (!taker.complete) {
    warnings.push(
      `Taker tape truncated at ${taker.rows.length.toLocaleString()} fills (newest kept). Comparison windows start at the first complete retrieved hour.`,
    );
    if (series) series = dropFirstHour(series);
  }
  if (!all.complete)
    warnings.push(`All-sides tape truncated at ${all.rows.length.toLocaleString()} rows; wallet net positions use the retrieved period only.`);
  const value: LoadedMarket = {
    meta,
    taker: takerFills,
    allSides: toFills(all.rows, meta.tokens),
    series,
    coverage: { takerComplete: taker.complete, allSidesComplete: all.complete, warnings },
  };
  if (loaded.size > 30) loaded.delete(loaded.keys().next().value!);
  loaded.set(condition, { at: Date.now(), value });
  return value;
}

/* -------------------------------------------------------------- library */

export interface LibraryRecord extends LibraryMarket {
  method: string;
  closedTime: string | null;
  volumeUsd: number | null;
  bets: Bet[];
  warnings: string[];
  builtAt: string;
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, file);
}
async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(/* turbopackIgnore: true */ file, "utf8")) as T;
  } catch {
    return null;
  }
}

const round = (a: number[], d: number) => a.map((v) => Math.round(v * 10 ** d) / 10 ** d);

function winnerHoldings(fills: Fill[], resolution: Resolution) {
  const win: 0 | 1 = resolution.yesWon ? 0 : 1,
    net = new Map<string, number>();
  for (const f of fills) {
    if (f.outcome !== win || (resolution.cutoff !== null && f.timestamp >= resolution.cutoff)) continue;
    net.set(f.wallet, (net.get(f.wallet) || 0) + (f.side === "BUY" ? f.size : -f.size));
  }
  return new Map([...net].filter(([, v]) => v > 0.01));
}

/** Part A + wallet listing + bets for one market. */
export function analyze(m: LoadedMarket) {
  const test = marketTest(m.series, m.taker, m.meta.resolution);
  // Net holdings need every fill since the market opened; a truncated tape would
  // miss early buys, so its bets are left out of the library rather than guessed.
  const bets = m.coverage.allSidesComplete
    ? marketBets(m.allSides, m.meta.condition, m.meta.event, m.meta.resolution)
    : [];
  const earliest = m.allSides.reduce((t, f) => Math.min(t, f.timestamp), Infinity),
    preStart = test.move ? test.move.startTime - SETTINGS.windowHours * 3600 : null,
    allSidesCoverWindow = m.coverage.allSidesComplete || (preStart !== null && earliest <= preStart);
  const listingFills = test.move && !allSidesCoverWindow ? m.taker : m.allSides,
    listingSource: "all-sides" | "taker-only" = listingFills === m.taker ? "taker-only" : "all-sides";
  const listed = m.meta.resolution.resolved
    ? listWallets(listingFills, test.move, null, winnerHoldings(m.allSides, m.meta.resolution))
    : [];
  return { test, bets, listed, listingSource };
}

export function toRecord(m: LoadedMarket): LibraryRecord {
  const { test, bets, listed } = analyze(m),
    s = m.series;
  return {
    method: METHOD_ID,
    condition: m.meta.condition,
    event: m.meta.event,
    title: m.meta.title,
    category: m.meta.category,
    closedTime: m.meta.closedTime,
    volumeUsd: m.meta.volumeUsd,
    series: s && {
      firstHour: s.firstHour,
      yes: round(s.yes, 4),
      buyYes: round(s.buyYes, 2),
      sellYes: round(s.sellYes, 2),
      buyNo: round(s.buyNo, 2),
      sellNo: round(s.sellNo, 2),
    },
    test: { ...test, comparisonScores: [] },
    listed,
    bets,
    warnings: m.coverage.warnings,
    builtAt: new Date().toISOString(),
  };
}

interface LibraryIndex {
  discoveredAt: string | null;
  candidates: (IntegrityMarketMeta & { title: string })[];
  failed: Record<string, string>;
}

let libraryCache: { at: number; records: LibraryRecord[] } | null = null;

export async function readLibrary(): Promise<LibraryRecord[]> {
  if (libraryCache && Date.now() - libraryCache.at < 30_000) return libraryCache.records;
  let files: string[] = [];
  try {
    files = (await readdir(/* turbopackIgnore: true */ libDir)).filter((f) => f.endsWith(".json"));
  } catch {}
  const records = (await Promise.all(files.map((f) => readJson<LibraryRecord>(path.join(libDir, f))))).filter(
    (r): r is LibraryRecord => !!r && r.method === METHOD_ID && meetsVolumeFloor(r.volumeUsd),
  );
  libraryCache = { at: Date.now(), records };
  return records;
}

const indexFile = () => path.join(root, "library-index.json");

export async function libraryStatus() {
  const index = (await readJson<LibraryIndex>(indexFile())) ?? { discoveredAt: null, candidates: [], failed: {} };
  const records = await readLibrary();
  const byCategory: Record<string, { markets: number; testable: number }> = {};
  for (const r of records) {
    const c = r.category ?? "uncategorized";
    byCategory[c] ||= { markets: 0, testable: 0 };
    byCategory[c].markets++;
    if (r.test.verdict !== "not-testable") byCategory[c].testable++;
  }
  return {
    discoveredAt: index.discoveredAt,
    candidates: index.candidates.length,
    built: records.length,
    failed: Object.keys(index.failed).length,
    bets: records.reduce((s, r) => s + r.bets.length, 0),
    byCategory,
  };
}

/** Step 0: find resolved markets in the setting #1 categories from the last 180 days. */
export async function discoverLibrary() {
  const now = Date.now(),
    seen = new Map<string, LibraryIndex["candidates"][number]>();
  // Gamma rejects offsets beyond ~2,000, so the 180 days are walked in 15-day slices.
  const sliceDays = 15,
    slices = Math.ceil(SETTINGS.library.days / sliceDays);
  for (const cat of SETTINGS.library.categories)
    for (const tag of cat.tagSlugs)
      for (let k = 0; k < slices; k++) {
        const from = new Date(now - (k + 1) * sliceDays * 86400_000).toISOString(),
          to = new Date(now - k * sliceDays * 86400_000).toISOString();
        for (let page = 0; page < 20; page++) {
          let raw: unknown;
          try {
            raw = await gamma("events", {
              tag_slug: tag,
              closed: "true",
              end_date_min: from,
              end_date_max: to,
              order: "id",
              ascending: "true",
              limit: "100",
              offset: String(page * 100),
            });
          } catch {
            break;
          }
          const events = Array.isArray(raw) ? raw : [];
          for (const e of events)
            for (const rm of list(object(e).markets)) {
              const meta = metaFromGamma(rm, e);
              if (!meta || !meta.resolution.resolved || !meetsVolumeFloor(meta.volumeUsd) || seen.has(meta.condition)) continue;
              const closedAt = parseTime(meta.closedTime);
              if (closedAt === null || closedAt * 1000 < now - SETTINGS.library.days * 86400_000) continue;
              seen.set(meta.condition, meta);
            }
          if (events.length < 100) break;
        }
      }
  const candidates = sampleLibrary([...seen.values()]);
  const previous = await readJson<LibraryIndex>(indexFile());
  await writeJson(indexFile(), { discoveredAt: new Date().toISOString(), candidates, failed: previous?.failed ?? {} });
  return libraryStatus();
}

/**
 * Outcome-blind, seeded sample spanning the whole 180 days. Each category gets
 * an equal share of the cap; unused share passes to the others. Order is
 * shuffled so a partially built library is still a random sample.
 */
export function sampleLibrary<T extends { condition: string; category: CategoryId | null }>(all: T[], seed = 20261107) {
  const rng = seededRandom(seed),
    shuffle = (a: T[]) => {
      const out = [...a].sort((x, y) => x.condition.localeCompare(y.condition));
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    };
  const pools = SETTINGS.library.categories.map((c) => shuffle(all.filter((m) => m.category === c.id)));
  const take = pools.map(() => 0);
  let left = LIMITS.libraryMaxMarkets;
  for (let open = pools.filter((p) => p.length).length; left > 0 && open > 0; open = pools.filter((p, i) => take[i] < p.length).length) {
    const share = Math.max(1, Math.floor(left / open));
    pools.forEach((p, i) => {
      const add = Math.min(share, p.length - take[i], left);
      take[i] += add;
      left -= add;
    });
  }
  const chosen = pools.map((p, i) => p.slice(0, take[i]));
  const out: T[] = [];
  for (let i = 0; chosen.some((c) => i < c.length); i++) for (const c of chosen) if (i < c.length) out.push(c[i]);
  return out;
}

/** Pull and score the next `count` unbuilt library markets. Resumable. */
export async function buildLibraryStep(count = 3) {
  const index = await readJson<LibraryIndex>(indexFile());
  if (!index) throw new DataError("Discover the library first.", 409);
  const built = new Set((await readLibrary()).map((r) => r.condition));
  const todo = index.candidates.filter((c) => !built.has(c.condition) && !index.failed[c.condition]).slice(0, count);
  const done: string[] = [];
  for (const c of todo) {
    try {
      const m = await loadMarket(c.condition, c);
      await writeJson(path.join(libDir, `${c.condition}.json`), toRecord(m));
      loaded.delete(c.condition);
      done.push(c.condition);
    } catch (e) {
      index.failed[c.condition] = e instanceof Error ? e.message : "failed";
    }
  }
  await writeJson(indexFile(), index);
  libraryCache = null;
  return { processed: done.length, remaining: index.candidates.length - built.size - done.length - Object.keys(index.failed).length, status: await libraryStatus() };
}

/* --------------------------------------------------------- method check */

export async function methodCheck(refresh = false) {
  const file = path.join(root, "method-check.json"),
    records = await readLibrary();
  const cached = await readJson<ReturnType<typeof computeMethodCheck> & { libraryMarkets: number }>(file);
  if (!refresh && cached && cached.libraryMarkets === records.length) return cached;
  const result = { ...computeMethodCheck(records), libraryMarkets: records.length };
  await writeJson(file, result);
  return result;
}

function computeMethodCheck(records: LibraryRecord[]) {
  const bets = records.flatMap((r) => r.bets),
    cal = calibrate(bets);
  const p1 = randomTimePlacebo(records),
    p2 = fakeWalletPlacebo(records, bets, cal),
    power = plantedBuying(records);
  const testable = records.filter((r) => r.test.verdict !== "not-testable");
  const excess = Object.fromEntries(
    SETTINGS.library.categories.map((c) => {
      const inCat = testable.filter((r) => r.category === c.id),
        hits = inCat.filter((r) => (r.test.p ?? 1) <= SETTINGS.alpha).length,
        placebo = p1.categories[c.id]?.rate ?? null;
      return [c.id, placebo === null ? null : { markets: inCat.length, ...excessRate(hits, inCat.length, placebo) }];
    }),
  );
  return {
    computedAt: new Date().toISOString(),
    calibration: cal,
    randomTime: p1,
    fakeWallet: p2,
    plantedBuying: power,
    excess,
  };
}

/* --------------------------------------------------------------- report */

export interface WalletCheckResult extends WalletCheck {
  falseFlagRate: number | null;
  libraryBets: number;
}

function runWalletCheck(
  listed: { wallet: string; netUsd: number | null }[],
  excludeEvents: Set<string>,
  records: LibraryRecord[],
  correction: "BH" | "Bonferroni",
  falseFlagRate: number | null,
): WalletCheckResult {
  const bets = records.flatMap((r) => r.bets),
    cal = bets.length ? calibrate(bets) : null,
    index = indexBets(bets);
  const check = walletCheck(
    listed.map((l) => ({ ...l, record: walletRecord(l.wallet, index, excludeEvents, cal) })),
    correction,
  );
  return { ...check, falseFlagRate, libraryBets: bets.length };
}

export async function integrityReport(condition: string) {
  const m = await loadMarket(condition),
    { test, listed, listingSource } = analyze(m),
    records = (await readLibrary()).filter((r) => r.condition !== m.meta.condition),
    check = records.length ? await methodCheck() : null;
  const categoryCalibration = m.meta.category ? check?.randomTime.categories[m.meta.category] : undefined;
  const calibrated = categoryCalibration?.calibrated ?? null;
  const comparable = records
    .filter(
      (r) =>
        r.category === m.meta.category &&
        r.test.verdict !== "not-testable" &&
        r.test.scoreType === test.scoreType &&
        r.test.preScore !== null,
    )
    .map((r) => r.test.preScore!);
  // A market below the floor has no comparable set: the library only holds larger markets.
  const belowFloor = !meetsVolumeFloor(m.meta.volumeUsd);
  const pct =
    test.preScore !== null && m.meta.category && !belowFloor
      ? percentile(test.preScore, comparable)
      : { percentile: null, compared: 0 };
  const wallets = runWalletCheck(
    listed,
    new Set([m.meta.event]),
    records,
    check?.fakeWallet.correction ?? "BH",
    check?.fakeWallet.falseFlagRate ?? null,
  );
  const s = m.series;
  const chart =
    s && test.move
      ? {
          firstHour: s.firstHour,
          yes: s.yes,
          moveHour: test.move.hour,
        }
      : s
        ? { firstHour: s.firstHour, yes: s.yes, moveHour: null }
        : null;
  return {
    method: METHOD_ID,
    generatedAt: new Date().toISOString(),
    market: {
      condition: m.meta.condition,
      title: m.meta.title,
      eventTitle: m.meta.eventTitle,
      eventSlug: m.meta.eventSlug,
      category: m.meta.category,
      outcomes: m.meta.outcomes,
      resolution: m.meta.resolution,
      closedTime: m.meta.closedTime,
      volumeUsd: m.meta.volumeUsd,
    },
    test,
    calibrated,
    categoryFalseAlarmRate: categoryCalibration?.rate ?? null,
    comparison: { ...pct, belowFloor },
    wallets,
    chart,
    coverage: {
      ...m.coverage,
      listingSource,
      warnings: [
        ...m.coverage.warnings,
        ...(listingSource === "taker-only"
          ? ["The all-sides tape does not reach the pre-move window, so wallets are listed by aggressive (taker) flow only; maker fills are missing from their net dollars."]
          : []),
      ],
    },
    library: { markets: records.length },
    headline: headline(test, calibrated, pct.percentile, pct.compared, wallets, belowFloor),
  };
}

function headline(
  test: MarketTest,
  calibrated: boolean | null,
  pct: number | null,
  compared: number,
  wallets: WalletCheckResult,
  belowFloor = false,
) {
  const parts: string[] = [];
  if (test.verdict === "not-testable") parts.push(test.reason);
  else if (calibrated === false) parts.push("Market test not calibrated for this category; only the comparison and wallet check are shown.");
  else parts.push(test.verdict === "unusual" ? `Unusual pre-move buying (p = ${test.p!.toFixed(3)}).` : `Nothing unusual detected (p = ${test.p!.toFixed(3)}).`);
  if (pct !== null) parts.push(`More one-sided than ${Math.round(pct * 100)}% of ${compared} comparable markets.`);
  else if (belowFloor && test.preScore !== null)
    parts.push(`Below the library's $${SETTINGS.library.minVolumeUsd.toLocaleString()} volume floor, so there is no comparable set.`);
  const flagged = wallets.rows.filter((r) => r.label === "unusual-record").length;
  if (wallets.rows.length) parts.push(`${flagged} of ${wallets.rows.length} top pre-move buyers ${flagged === 1 ? "has" : "have"} an unusual record elsewhere.`);
  parts.push("This is an anomaly screen, not an accusation.");
  return parts.join(" ");
}

/* --------------------------------------------------------- multi-market */

export async function multiReport(input: { conditions?: string[]; category?: CategoryId; from?: string; to?: string }) {
  const library = await readLibrary();
  let targets: { condition: string; test: MarketTest; event: string; title: string; listed: { wallet: string; netUsd: number | null }[]; category: CategoryId | null; volumeUsd: number | null }[] = [];
  if (input.conditions?.length) {
    for (const c of input.conditions.map((x) => x.toLowerCase())) {
      const rec = library.find((r) => r.condition === c);
      if (rec) {
        targets.push({ condition: c, test: rec.test, event: rec.event, title: rec.title, listed: rec.listed, category: rec.category, volumeUsd: rec.volumeUsd });
        continue;
      }
      const m = await loadMarket(c),
        a = analyze(m);
      targets.push({ condition: c, test: a.test, event: m.meta.event, title: m.meta.title, listed: a.listed, category: m.meta.category, volumeUsd: m.meta.volumeUsd });
    }
  } else if (input.category) {
    const from = input.from ? Date.parse(input.from) / 1000 : -Infinity,
      to = input.to ? Date.parse(input.to) / 1000 + 86400 : Infinity;
    targets = library
      .filter((r) => r.category === input.category)
      .filter((r) => {
        const t = parseTime(r.closedTime) ?? 0;
        return t >= from && t < to;
      })
      .map((r) => ({ condition: r.condition, test: r.test, event: r.event, title: r.title, listed: r.listed, category: r.category, volumeUsd: r.volumeUsd }));
  }
  if (!targets.length) throw new DataError("No markets matched this search.", 404);
  const check = library.length ? await methodCheck() : null;
  const multi = multiMarket(targets.map((t) => ({ condition: t.condition, test: t.test })));
  const excluded = new Set(targets.map((t) => t.event));
  const wallets = new Map<string, { wallet: string; netUsd: number | null; markets: string[] }>();
  for (const t of targets)
    for (const l of t.listed) {
      const w = wallets.get(l.wallet);
      if (w) {
        w.markets.push(t.condition);
        w.netUsd = (w.netUsd ?? 0) + (l.netUsd ?? 0);
      } else wallets.set(l.wallet, { ...l, markets: [t.condition] });
    }
  const others = library.filter((r) => !targets.some((t) => t.condition === r.condition));
  const walletGroup = runWalletCheck(
    [...wallets.values()],
    excluded,
    others,
    check?.fakeWallet.correction ?? "BH",
    check?.fakeWallet.falseFlagRate ?? null,
  );
  const flaggedByMarket = new Map<string, number>();
  for (const r of walletGroup.rows)
    if (r.label === "unusual-record")
      for (const c of wallets.get(r.wallet)!.markets) flaggedByMarket.set(c, (flaggedByMarket.get(c) || 0) + 1);
  const byCondition = new Map(targets.map((t) => [t.condition, t]));
  return {
    method: METHOD_ID,
    generatedAt: new Date().toISOString(),
    M: multi.M,
    mSteps: multi.mSteps,
    threshold: multi.threshold,
    rows: multi.rows.map((r) => {
      const t = byCondition.get(r.condition)!,
        comparable = library
          .filter((x) => x.condition !== r.condition && x.category === t.category && x.test.verdict !== "not-testable" && x.test.scoreType === r.test.scoreType)
          .map((x) => x.test.preScore!);
      const belowFloor = !meetsVolumeFloor(t.volumeUsd);
      const pct =
        r.test.preScore !== null && t.category && !belowFloor
          ? percentile(r.test.preScore, comparable)
          : { percentile: null, compared: 0 };
      return {
        condition: r.condition,
        title: t.title,
        category: t.category,
        status: r.status,
        verdict:
          r.status === "not-testable"
            ? "not-testable"
            : r.status === "history-too-short"
              ? "history-too-short"
              : r.flagged
                ? "unusual"
                : "nothing-unusual",
        reason: r.status === "history-too-short" ? "History too short for a group this size." : r.test.reason,
        p: r.test.p,
        q: r.q,
        comparisonWindows: r.test.comparisonWindows,
        percentile: pct.percentile,
        compared: pct.compared,
        flaggedWallets: flaggedByMarket.get(r.condition) || 0,
        belowFloor,
      };
    }),
    wallets: { ...walletGroup, rows: walletGroup.rows.map((r) => ({ ...r, markets: wallets.get(r.wallet)!.markets })) },
  };
}

/** Price-bucket calibration from the library, or null before any library bets exist. */
export async function libraryCalibration() {
  const bets = (await readLibrary()).flatMap((r) => r.bets);
  return bets.length ? calibrate(bets) : null;
}

export type IntegrityReport = Awaited<ReturnType<typeof integrityReport>>;
