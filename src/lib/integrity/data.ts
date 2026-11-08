import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { gamma } from "../market-data";
import { DataError, fetchFills, fetchHolders } from "../polymarket";
import { numeric, object } from "../market-normalize";
import type { Trade } from "../domain";
import {
  benjaminiHochberg,
  buildHourly,
  dropFirstHour,
  marketTest,
  randomTimePlacebo,
  scoreAtHour,
  type Fill,
  type HourlySeries,
  type LibraryMarket,
  type MarketTest,
  type Resolution,
} from "./core";
import {
  analyzePopulation,
  buildPositions,
  calibrationCurve,
  collapseBets,
  indexByWallet,
  negativeControl,
  nullProbability,
  participationTest,
  placeboA,
  placeboB,
  positiveControl,
  recordP,
  timingPlacebo,
  type CalibrationBin,
  type ParticipationVerdict,
  type PopulationResult,
  type SpecBet,
  type SpecMarket,
  type Tier,
  type WalletResult,
} from "./wallet-spec";
import { seededRandom } from "../statistical-core";
import { LIMITS, METHOD_ID, SETTINGS, WALLET_METHOD_ID, WALLET_SETTINGS, type CategoryId } from "./settings";

const root = path.join(process.cwd(), ".luckaudit-cache", "integrity"),
  libDir = path.join(root, "library-v2");
const RECORD_VERSION = `${METHOD_ID}+${WALLET_METHOD_ID}`;

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
  /** Scheduled end (Gamma endDate), epoch seconds. */
  endTime: number | null;
  negRisk: boolean;
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

const groupOf = (category: CategoryId | null): "study" | "control" => (category === "control" ? "control" : "study");

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
    endTime: parseTime(m.endDate),
    negRisk: m.negRisk === true || e.negRisk === true,
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
  // Live markets are fetched too: their participants' records come from other,
  // resolved markets. The pre-move timing test still only runs once resolved.
  const [taker, all] = await Promise.all([
    fetchFills(condition, true, LIMITS.takerPages),
    fetchFills(condition, false, LIMITS.allSidesPages),
  ]);
  const warnings: string[] = [];
  const takerFills = toFills(taker.rows, meta.tokens);
  let series = meta.resolution.resolved ? buildHourly(takerFills, meta.resolution.cutoff) : null;
  if (!taker.complete) {
    warnings.push(
      `Taker tape truncated at ${taker.rows.length.toLocaleString()} fills (newest kept). Comparison windows start at the first complete retrieved hour.`,
    );
    if (series) series = dropFirstHour(series);
  }
  if (!all.complete)
    warnings.push(`All-sides tape truncated at ${all.rows.length.toLocaleString()} rows; participants and positions cover the retrieved period only.`);
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

/** Participants ranked by their share of the market's (all-sides) trading volume. */
export function participants(fills: Fill[], limit: number = WALLET_SETTINGS.market.maxParticipants) {
  const volume = new Map<string, number>();
  let total = 0;
  for (const f of fills) {
    const usd = f.price * f.size;
    total += usd;
    volume.set(f.wallet, (volume.get(f.wallet) || 0) + usd);
  }
  return {
    total,
    wallets: [...volume]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([wallet, usd]) => ({ wallet, usd: Math.round(usd * 100) / 100 })),
  };
}

/* -------------------------------------------------------------- library */

export interface LibraryRecord extends LibraryMarket {
  method: string;
  closedTime: string | null;
  volumeUsd: number | null;
  /** Advanced spec inputs for this market (positions empty if the tape was truncated). */
  spec: SpecMarket;
  /** Top participants by volume, for market verdicts on library markets. */
  participants: { wallet: string; usd: number }[];
  participantVolume: number;
  warnings: string[];
  builtAt: string;
}

async function writeFileAtomic(file: string, data: string | Buffer) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, data);
  // OneDrive and antivirus can briefly lock files on Windows; retry the swap.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 8 || !["EPERM", "EBUSY", "EACCES"].includes(code ?? "")) throw e;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
}
const writeJson = (file: string, value: unknown) =>
  writeFileAtomic(file, file.endsWith(".gz") ? gzipSync(JSON.stringify(value)) : JSON.stringify(value));
async function readJson<T>(file: string): Promise<T | null> {
  try {
    const buf = await readFile(/* turbopackIgnore: true */ file);
    return JSON.parse((file.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8")) as T;
  } catch {
    return null;
  }
}

const round = (a: number[], d: number) => a.map((v) => Math.round(v * 10 ** d) / 10 ** d);

/** Market Integrity Search Part A (kept as timing context). */
export function analyze(m: LoadedMarket) {
  return { test: marketTest(m.series, m.taker, m.meta.resolution) };
}

/** Advanced spec inputs for one market. Trades after the scheduled end (or resolution) are dropped. */
export function specMarket(m: LoadedMarket): SpecMarket {
  const cutoff = Math.min(
    m.meta.endTime ?? Infinity,
    m.meta.resolution.cutoff ?? Infinity,
    m.meta.resolution.resolved ? Infinity : Math.floor(Date.now() / 1000),
  );
  const built = buildPositions(m.allSides, m.taker, cutoff);
  return {
    condition: m.meta.condition,
    event: m.meta.event,
    title: m.meta.title,
    negRisk: m.meta.negRisk,
    yesWon: m.meta.resolution.yesWon === true,
    group: groupOf(m.meta.category),
    // Net holdings need every fill since the market opened; a truncated tape
    // would miss early buys, so its positions are left out rather than guessed.
    positions: m.coverage.allSidesComplete && m.meta.resolution.resolved ? built.positions : [],
    timing: built.timing,
  };
}

export function toRecord(m: LoadedMarket): LibraryRecord {
  const { test } = analyze(m),
    s = m.series,
    parts = participants(m.allSides);
  return {
    method: RECORD_VERSION,
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
    listed: [],
    spec: specMarket(m),
    participants: parts.wallets,
    participantVolume: parts.total,
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

async function libraryFiles() {
  try {
    return (await readdir(/* turbopackIgnore: true */ libDir)).filter((f) => f.endsWith(".json.gz"));
  } catch {
    return [];
  }
}

export async function readLibrary(): Promise<LibraryRecord[]> {
  if (libraryCache && Date.now() - libraryCache.at < 60_000) return libraryCache.records;
  const files = await libraryFiles();
  const records: LibraryRecord[] = [];
  for (let i = 0; i < files.length; i += 64) {
    const chunk = await Promise.all(files.slice(i, i + 64).map((f) => readJson<LibraryRecord>(path.join(libDir, f))));
    for (const r of chunk) if (r && r.method === RECORD_VERSION && meetsVolumeFloor(r.volumeUsd)) records.push(r);
  }
  libraryCache = { at: Date.now(), records };
  return records;
}

const indexFile = () => path.join(root, "library-index-v2.json");

export async function libraryStatus() {
  const index = (await readJson<LibraryIndex>(indexFile())) ?? { discoveredAt: null, candidates: [], failed: {} };
  const markets = [...(await walletPopulation()).markets.values()];
  const byCategory: Record<string, { markets: number; testable: number }> = {};
  for (const r of markets) {
    const c = r.category ?? "uncategorized";
    byCategory[c] ||= { markets: 0, testable: 0 };
    byCategory[c].markets++;
    if (r.test.verdict !== "not-testable") byCategory[c].testable++;
  }
  return {
    discoveredAt: index.discoveredAt,
    candidates: index.candidates.length,
    built: markets.length,
    failed: Object.keys(index.failed).length,
    bets: markets.reduce((s, r) => s + r.positions, 0),
    byCategory,
  };
}

/** Step 0: find resolved markets in the study and control categories from the last 180 days. */
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
  // Count built markets from file names: re-reading every record each step
  // would make a large build quadratic.
  const built = new Set((await libraryFiles()).map((f) => f.slice(0, -".json.gz".length)));
  const todo = index.candidates.filter((c) => !built.has(c.condition) && !index.failed[c.condition]).slice(0, count);
  const done: string[] = [];
  for (const c of todo) {
    try {
      const m = await loadMarket(c.condition, c);
      await writeJson(path.join(libDir, `${c.condition}.json.gz`), toRecord(m));
      loaded.delete(c.condition);
      done.push(c.condition);
    } catch (e) {
      // Rate limits and outages are transient: stop this step and retry the
      // market later instead of dropping it from the library.
      if (e instanceof DataError && [429, 503].includes(e.status)) {
        await writeJson(indexFile(), index);
        throw e;
      }
      index.failed[c.condition] = e instanceof Error ? e.message : "failed";
    }
  }
  await writeJson(indexFile(), index);
  const candidates = new Set(index.candidates.map((c) => c.condition)),
    builtCandidates = [...built].filter((c) => candidates.has(c)).length + done.length,
    failed = Object.keys(index.failed).length;
  return {
    processed: done.length,
    remaining: index.candidates.length - builtCandidates - failed,
    status: { candidates: index.candidates.length, built: builtCandidates, failed },
  };
}

/* ------------------------------------------------- wallet population */

/** What the server keeps per library market after the population is computed. */
export interface SlimMarket {
  condition: string;
  event: string;
  title: string;
  category: CategoryId | null;
  closedTime: string | null;
  test: MarketTest;
  participants: { wallet: string; usd: number }[];
  /** Participants examined (the stored list may keep only wallets with a card). */
  examined: number;
  participantVolume: number;
  positions: number;
}

export interface Population {
  records: number;
  markets: Map<string, SlimMarket>;
  curve: CalibrationBin[];
  index: Map<string, SpecBet[]>;
  result: PopulationResult;
  placeboA: ReturnType<typeof placeboA>;
  /**
   * Flagged / tested participants pooled over library markets of each category,
   * plus each library market's own contribution (left out when it is checked).
   */
  categoryRates: {
    byCategory: Record<string, { tested: number; flagged: number }>;
    byMarket: Map<string, { category: string; tested: number; flagged: number }>;
  };
}

let populationCache: { records: number; at: number; value: Population } | null = null;

/** The Advanced spec pipeline over every wallet in the library (Steps 3–7 + Placebo A). */
const populationFile = () => path.join(root, "population-v2.json.gz");

type PopulationSnapshot = {
  records: number;
  markets: SlimMarket[];
  curve: CalibrationBin[];
  index: [string, SpecBet[]][];
  result: Omit<PopulationResult, "wallets"> & { wallets: WalletResult[] };
  placeboA: Population["placeboA"];
  categoryRates: { byCategory: Population["categoryRates"]["byCategory"]; byMarket: [string, { category: string; tested: number; flagged: number }][] };
};

/**
 * Only what verdicts need: bets for tier 1-2 wallets (re-scored without the
 * checked market) and, per market, the participants that have a wallet card.
 */
function toSnapshot(p: Population): PopulationSnapshot {
  const flagged = (w: string) => {
    const t = p.result.wallets.get(w)?.tier;
    return t === 1 || t === 2;
  };
  return {
    records: p.records,
    markets: [...p.markets.values()].map((m) => ({ ...m, participants: m.participants.filter((x) => p.result.wallets.has(x.wallet)) })),
    curve: p.curve,
    index: [...p.index].filter(([w]) => flagged(w)),
    result: { ...p.result, wallets: [...p.result.wallets.values()] },
    placeboA: p.placeboA,
    categoryRates: { byCategory: p.categoryRates.byCategory, byMarket: [...p.categoryRates.byMarket] },
  };
}

function fromSnapshot(s: PopulationSnapshot): Population {
  return {
    records: s.records,
    markets: new Map(s.markets.map((m) => [m.condition, m])),
    curve: s.curve,
    index: new Map(s.index),
    // JSON turns an infinite odds multiplier ("all n won") into null.
    result: { ...s.result, wallets: new Map(s.result.wallets.map((w) => [w.wallet, { ...w, odds: w.odds === null && w.O === w.n ? Infinity : w.odds }])) },
    placeboA: s.placeboA,
    categoryRates: { byCategory: s.categoryRates.byCategory, byMarket: new Map(s.categoryRates.byMarket) },
  };
}

/**
 * The population, from (1) memory, (2) the saved snapshot if it matches the
 * library, or (3) a full recompute that then refreshes the snapshot. The
 * standalone build writes the snapshot, so the app server never has to load
 * every full record.
 */
export async function walletPopulation(): Promise<Population> {
  const count = (await libraryFiles()).length;
  if (populationCache && populationCache.records === count) return populationCache.value;
  const saved = await readJson<PopulationSnapshot>(populationFile());
  if (saved && saved.records === count) {
    const value = fromSnapshot(saved);
    populationCache = { records: count, at: Date.now(), value };
    return value;
  }
  const value = await computePopulation();
  await writeJson(populationFile(), toSnapshot(value));
  return value;
}

async function computePopulation(): Promise<Population> {
  const records = await readLibrary();
  const markets = records.map((r) => r.spec),
    curve = calibrationCurve(markets),
    index = indexByWallet(collapseBets(markets, curve));
  let result = analyzePopulation(index, "BH");
  // Placebo A decides the primary rule: BY if the measured FDR exceeds 10%.
  const a = placeboA(index, result.family1.flagged);
  if (a.primary === "BY") result = analyzePopulation(index, "BY");
  const slim = new Map<string, SlimMarket>(
    records.map((r) => [
      r.condition,
      {
        condition: r.condition,
        event: r.event,
        title: r.title,
        category: r.category,
        closedTime: r.closedTime,
        test: r.test,
        participants: r.participants,
        examined: r.participants.length,
        participantVolume: r.participantVolume,
        positions: r.spec.positions.length,
      },
    ]),
  );
  const partial = { records: records.length, markets: slim, curve, index, result, placeboA: a };
  const byCategory: Population["categoryRates"]["byCategory"] = {},
    byMarket: Population["categoryRates"]["byMarket"] = new Map();
  for (const r of records) {
    const cat = r.category ?? "uncategorized";
    let tested = 0,
      flagged = 0;
    for (const { wallet } of r.participants) {
      const c = classify(partial, wallet, r.event);
      if (c.tested) tested++;
      if (c.flagged) flagged++;
    }
    byCategory[cat] ||= { tested: 0, flagged: 0 };
    byCategory[cat].tested += tested;
    byCategory[cat].flagged += flagged;
    byMarket.set(r.condition, { category: cat, tested, flagged });
  }
  const value: Population = { ...partial, categoryRates: { byCategory, byMarket } };
  populationCache = { records: records.length, at: Date.now(), value };
  libraryCache = null; // full records (positions, series) are no longer needed in memory
  return value;
}

/** Null probability for one entry price under the current library calibration. */
export async function libraryQ() {
  const pop = await walletPopulation().catch(() => null);
  return (p: number) => nullProbability(p, pop?.curve ?? null);
}

/** Library wallet card for one address, if the wallet is in the population. */
export async function walletCard(address: string) {
  const pop = await walletPopulation();
  const w = pop.result.wallets.get(address.toLowerCase());
  return {
    card: w ?? null,
    primary: pop.result.primary,
    tested: pop.result.tested,
    empiricalFdr: pop.placeboA.fdr,
    family1: pop.result.family1,
  };
}

/* --------------------------------------------------------- method check */

export async function methodCheck(refresh = false) {
  const file = path.join(root, "method-check-v2.json"),
    count = (await libraryFiles()).length;
  const cached = await readJson<Awaited<ReturnType<typeof computeMethodCheck>> & { libraryMarkets: number }>(file);
  if (!refresh && cached && cached.libraryMarkets === count) return cached;
  const records = await readLibrary();
  const result = { ...(await computeMethodCheck(records)), libraryMarkets: records.length };
  await writeJson(file, result);
  return result;
}

async function computeMethodCheck(records: LibraryRecord[]) {
  const pop = await walletPopulation();
  const real = pop.result.family1.flagged,
    real2 = pop.result.family2.flagged;
  return {
    computedAt: new Date().toISOString(),
    calibration: pop.curve,
    population: {
      wallets: pop.index.size,
      tested: pop.result.tested,
      family1: pop.result.family1,
      family2: pop.result.family2,
      primary: pop.result.primary,
      baseRate: pop.result.baseRate,
      categoryRates: pop.categoryRates.byCategory,
      tiers: ([1, 2, 3] as Tier[]).map((t) => ({
        tier: t,
        count: [...pop.result.wallets.values()].filter((w) => w.tier === t).length,
      })),
    },
    placeboA: pop.placeboA,
    placeboB: placeboB(pop.index, real),
    positiveControl: positiveControl(pop.index),
    negativeControl: negativeControl(pop.result),
    timingPlacebo: timingPlacebo(pop.index, real2),
    // Market Integrity Search random-time placebo for the pre-move context test.
    randomTime: randomTimePlacebo(records),
  };
}

/* --------------------------------------------------------------- report */

export interface ParticipantRow {
  wallet: string;
  usd: number;
  share: number;
  card: WalletResult | null;
  /** Test 1 p-value with this market's event removed from the record. */
  pExcluding: number | null;
  flagged: boolean;
  weak: boolean;
}

/**
 * One participant in one market: tested if it has a Test 1 record; flagged if
 * tier 1-2 and the record still clears the main run's bar without this market's
 * event (same rule as LOEO), so a wallet is never flagged by the market itself.
 */
function classify(pop: Pick<Population, "result" | "index">, wallet: string, event: string) {
  const card = pop.result.wallets.get(wallet) ?? null;
  if (!card?.tested1) return { card, tested: false, flagged: false, pExcluding: null as number | null };
  let pExcluding: number | null = null,
    flagged = false;
  if (card.tier === 1 || card.tier === 2) {
    const bets = (pop.index.get(wallet) ?? []).filter((b) => b.event !== event);
    pExcluding = bets.length ? recordP(bets) : null;
    flagged = pExcluding !== null && pop.result.family1.cutoff > 0 && pExcluding <= pop.result.family1.cutoff + 1e-300;
  }
  return { card, tested: true, flagged, pExcluding };
}

/**
 * The comparison rate for a market: flagged / tested participants across the
 * other library markets of the same category. Skilled high-frequency traders
 * cluster in some categories (the crypto control most of all), so a pooled rate
 * would mark whole categories as "elevated"; this asks whether a market has more
 * anomalous wallets than usual for its kind of market.
 */
function categoryRate(pop: Population, category: string | null, condition: string) {
  const cat = category ?? "uncategorized",
    total = pop.categoryRates.byCategory[cat],
    own = pop.categoryRates.byMarket.get(condition),
    mine = own && own.category === cat;
  const tested = (total?.tested ?? 0) - (mine ? own.tested : 0),
    flagged = (total?.flagged ?? 0) - (mine ? own.flagged : 0);
  return tested >= 50
    ? { rate: flagged / tested, basis: cat, tested }
    : { rate: pop.result.baseRate, basis: "population", tested: pop.result.tested };
}

/** Look up a market's participants in the population and count flagged wallets. */
function participation(
  pop: Population,
  people: { wallet: string; usd: number }[],
  totalUsd: number,
  event: string,
  category: string | null,
  condition: string,
  examined?: number,
) {
  const rows: ParticipantRow[] = people.map(({ wallet, usd }) => {
    const c = classify(pop, wallet, event);
    return {
      wallet,
      usd,
      share: totalUsd ? usd / totalUsd : 0,
      card: c.card,
      pExcluding: c.pExcluding,
      flagged: c.flagged,
      weak: !c.flagged && !!c.card && c.card.tier !== 0,
    };
  });
  const tested = rows.filter((r) => r.card?.tested1),
    flagged = rows.filter((r) => r.flagged),
    rate = categoryRate(pop, category, condition);
  const test = participationTest(tested.length, flagged.length, rate.rate);
  return {
    rows,
    examined: examined ?? rows.length,
    inPopulation: rows.filter((r) => r.card).length,
    tested: tested.length,
    flagged: flagged.length,
    weak: rows.filter((r) => r.weak).length,
    flaggedVolumeShare: flagged.reduce((s, r) => s + r.share, 0),
    baseRate: rate.rate,
    rateBasis: rate.basis,
    rateTested: rate.tested,
    expected: test.expected,
    p: test.p,
    verdict: test.verdict as ParticipationVerdict,
  };
}

let indexCache: { at: number; byCondition: Map<string, LibraryIndex["candidates"][number]> } | null = null;
async function libraryMeta(condition: string) {
  if (!indexCache || Date.now() - indexCache.at > 10 * 60_000) {
    const index = await readJson<LibraryIndex>(indexFile());
    indexCache = { at: Date.now(), byCondition: new Map((index?.candidates ?? []).map((c) => [c.condition, c])) };
  }
  return indexCache.byCondition.get(condition) ?? null;
}

/**
 * Library markets are reported from their stored record (participants, series
 * and pre-move test), so they load instantly and need no live Polymarket fetch.
 * Other markets, including live ones, are fetched.
 */
async function reportInputs(condition: string) {
  condition = condition.toLowerCase();
  const record = /^0x[\da-f]{64}$/.test(condition)
      ? await readJson<LibraryRecord>(path.join(libDir, `${condition}.json.gz`))
      : null,
    meta = record && record.method === RECORD_VERSION ? await libraryMeta(condition) : null;
  if (record && meta) {
    let test = record.test;
    if (record.series && test.move && test.verdict !== "not-testable") {
      const r = scoreAtHour(record.series, test.move.hour, test.move.favored, test.scoreType);
      if (r) test = { ...test, comparisonScores: r.comparisonScores };
    }
    return {
      meta,
      test,
      series: record.series,
      people: { wallets: record.participants, total: record.participantVolume },
      coverage: { takerComplete: true, allSidesComplete: record.spec.positions.length > 0, warnings: record.warnings },
      source: "library" as const,
    };
  }
  const m = await loadMarket(condition);
  return {
    meta: m.meta,
    test: analyze(m).test,
    series: m.series,
    people: participants(m.allSides),
    coverage: m.coverage,
    source: "live" as const,
  };
}

/** Participation p-values for every library market in a category (cached per population). */
const categoryPCache = new WeakMap<Population, Map<string, Map<string, number>>>();
function categoryPValues(pop: Population, category: string) {
  let byCat = categoryPCache.get(pop);
  if (!byCat) categoryPCache.set(pop, (byCat = new Map()));
  let ps = byCat.get(category);
  if (!ps) {
    ps = new Map();
    for (const r of pop.markets.values()) {
      if ((r.category ?? "uncategorized") !== category) continue;
      const p = participation(pop, r.participants, r.participantVolume, r.event, r.category, r.condition, r.examined).p;
      if (p !== null) ps.set(r.condition, p);
    }
    byCat.set(category, ps);
  }
  return ps;
}

/**
 * This market's result when every library market in its category is checked
 * together (Benjamini–Hochberg): does it still stand out?
 */
function categoryCheck(pop: Population, category: string | null, condition: string, p: number | null) {
  if (p === null || !category) return null;
  const others = categoryPValues(pop, category);
  const entries = [...others].filter(([c]) => c !== condition).map(([, v]) => v);
  entries.push(p);
  const bh = benjaminiHochberg(entries);
  const i = entries.length - 1;
  return { markets: entries.length, q: bh.q[i], flagged: bh.rejected[i] };
}

export async function integrityReport(condition: string) {
  const input = await reportInputs(condition),
    m = { meta: input.meta, coverage: input.coverage },
    test = input.test,
    pop = await walletPopulation(),
    check = pop.records ? await methodCheck() : null,
    people = input.people;
  const part = participation(pop, people.wallets, people.total, m.meta.event, m.meta.category, m.meta.condition);
  const s = input.series;
  const chart = s ? { firstHour: s.firstHour, yes: s.yes, moveHour: test.move ? test.move.hour : null } : null;
  const categoryCalibration = m.meta.category ? check?.randomTime.categories[m.meta.category] : undefined;
  return {
    method: WALLET_METHOD_ID,
    categoryCheck: categoryCheck(pop, m.meta.category, m.meta.condition, part.p),
    contextMethod: METHOD_ID,
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
    participation: part,
    population: {
      markets: pop.records,
      wallets: check?.population.wallets ?? pop.index.size,
      tested: pop.result.tested,
      m: pop.result.family1.m,
      cutoff: pop.result.family1.cutoff,
      primary: pop.result.primary,
      empiricalFdr: pop.placeboA.fdr,
    },
    // Pre-move buying test (Market Integrity Search), shown as context only.
    test,
    categoryFalseAlarmRate: categoryCalibration?.rate ?? null,
    chart,
    coverage: m.coverage,
    source: input.source,
    headline: headline(part, pop),
  };
}

function headline(part: ReturnType<typeof participation>, pop: Population) {
  const fdr = pop.placeboA.fdr;
  const parts = [
    part.verdict === "not-testable"
      ? `Only ${part.tested} of the ${part.examined} largest participants have testable records (at least ${WALLET_SETTINGS.market.minTestedParticipants} needed).`
      : `${part.flagged} of ${part.tested} tested participants have anomalous records elsewhere, against ${part.expected.toFixed(1)} expected from the ${part.rateBasis === "population" ? "population" : "category"} rate (p = ${part.p!.toPrecision(2)}).`,
  ];
  if (part.flagged) parts.push(`They traded ${(part.flaggedVolumeShare * 100).toFixed(1)}% of the market's volume.`);
  if (fdr !== null) parts.push(`Measured false-flag rate ${(fdr * 100).toFixed(1)}%.`);
  parts.push("Statistical anomaly under market odds; consistent with skill, speed, or information. Not an accusation.");
  return parts.join(" ");
}

/* --------------------------------------------------------- multi-market */

/**
 * Open (unresolved) markets in a category, straight from Polymarket. They are
 * not in the library, so their participants are the current top holders,
 * valued at today's price.
 */
async function openCategoryTargets(category: CategoryId, limit = 20) {
  const cat = SETTINGS.library.categories.find((c) => c.id === category);
  if (!cat) throw new DataError("Unknown category.", 400);
  const found = new Map<string, { meta: IntegrityMarketMeta; prices: [number, number] }>();
  for (const tag of cat.tagSlugs) {
    let raw: unknown;
    try {
      raw = await gamma("events", { tag_slug: tag, active: "true", closed: "false", order: "volume24hr", ascending: "false", limit: "50" });
    } catch {
      continue;
    }
    for (const e of Array.isArray(raw) ? raw : [])
      for (const rm of list(object(e).markets)) {
        const meta = metaFromGamma(rm, e);
        if (!meta || object(rm).closed === true || found.has(meta.condition) || !meetsVolumeFloor(meta.volumeUsd)) continue;
        const p = list(object(rm).outcomePrices).map((x) => numeric(x) ?? 0);
        found.set(meta.condition, { meta, prices: [p[0] ?? 0, p[1] ?? 0] });
      }
  }
  const picked = [...found.values()].sort((a, b) => (b.meta.volumeUsd ?? 0) - (a.meta.volumeUsd ?? 0)).slice(0, limit);
  const notTestable = marketTest(null, [], { resolved: false, yesWon: null, cutoff: null });
  const out: { condition: string; title: string; event: string; category: CategoryId | null; test: MarketTest; people: { wallet: string; usd: number }[]; total: number; examined?: number }[] = [];
  for (let i = 0; i < picked.length; i += 4) {
    const batch = await Promise.all(
      picked.slice(i, i + 4).map(async ({ meta, prices }) => {
        let holders: Awaited<ReturnType<typeof fetchHolders>> = [];
        try {
          holders = await fetchHolders(meta.condition);
        } catch {
          return null;
        }
        const byWallet = new Map<string, number>();
        for (const h of holders) {
          const w = h.proxy_wallet.toLowerCase();
          byWallet.set(w, (byWallet.get(w) ?? 0) + h.amount * (prices[h.outcome_index] ?? 0));
        }
        const people = [...byWallet].map(([wallet, usd]) => ({ wallet, usd })).sort((a, b) => b.usd - a.usd);
        return {
          condition: meta.condition,
          title: meta.title,
          event: meta.event,
          category,
          test: notTestable,
          people,
          total: people.reduce((t, p) => t + p.usd, 0),
          examined: people.length,
        };
      }),
    );
    for (const b of batch) if (b && b.people.length) out.push(b);
  }
  return out;
}

export async function multiReport(input: { conditions?: string[]; category?: CategoryId; state?: "open" | "closed"; from?: string; to?: string }) {
  const pop = await walletPopulation(),
    library = [...pop.markets.values()];
  type Target = { condition: string; title: string; event: string; category: CategoryId | null; test: MarketTest; people: { wallet: string; usd: number }[]; total: number; examined?: number };
  let targets: Target[] = [];
  if (input.conditions?.length) {
    for (const c of input.conditions.map((x) => x.toLowerCase())) {
      const rec = library.find((r) => r.condition === c);
      if (rec) {
        targets.push({ condition: c, title: rec.title, event: rec.event, category: rec.category, test: rec.test, people: rec.participants, total: rec.participantVolume, examined: rec.examined });
        continue;
      }
      const m = await loadMarket(c),
        people = participants(m.allSides);
      targets.push({ condition: c, title: m.meta.title, event: m.meta.event, category: m.meta.category, test: analyze(m).test, people: people.wallets, total: people.total });
    }
  } else if (input.category && input.state === "open") {
    targets = await openCategoryTargets(input.category);
  } else if (input.category) {
    const from = input.from ? Date.parse(input.from) / 1000 : -Infinity,
      to = input.to ? Date.parse(input.to) / 1000 + 86400 : Infinity;
    targets = library
      .filter((r) => r.category === input.category)
      .filter((r) => {
        const t = parseTime(r.closedTime) ?? 0;
        return t >= from && t < to;
      })
      .map((r) => ({ condition: r.condition, title: r.title, event: r.event, category: r.category, test: r.test, people: r.participants, total: r.participantVolume, examined: r.examined }));
  }
  if (!targets.length) throw new DataError("No markets matched this search.", 404);
  const rows = targets.map((t) => ({ t, part: participation(pop, t.people, t.total, t.event, t.category, t.condition, t.examined) }));
  // BH across the testable markets' participation p-values.
  const testable = rows.filter((r) => r.part.p !== null),
    bh = benjaminiHochberg(testable.map((r) => r.part.p!));
  const q = new Map<string, { q: number; flagged: boolean }>();
  testable.forEach((r, i) => q.set(r.t.condition, { q: bh.q[i], flagged: bh.rejected[i] }));
  return {
    method: WALLET_METHOD_ID,
    generatedAt: new Date().toISOString(),
    M: testable.length,
    threshold: bh.threshold,
    baseRate: pop.result.baseRate,
    empiricalFdr: pop.placeboA.fdr,
    categoryRates: pop.categoryRates.byCategory,
    rows: rows
      .map(({ t, part }) => {
        const corrected = q.get(t.condition);
        return {
          condition: t.condition,
          title: t.title,
          category: t.category,
          verdict: (part.p === null ? "not-testable" : corrected?.flagged ? "elevated" : "typical") as ParticipationVerdict,
          examined: part.examined,
          tested: part.tested,
          flagged: part.flagged,
          weak: part.weak,
          expected: part.expected,
          flaggedVolumeShare: part.flaggedVolumeShare,
          p: part.p,
          q: corrected?.q ?? null,
          preMoveP: t.test.p,
        };
      })
      .sort((a, b) => (a.q ?? 2) - (b.q ?? 2)),
  };
}

export type IntegrityReport = Awaited<ReturnType<typeof integrityReport>>;

/* ------------------------------------------- parallel build primitives */

/** Candidates not yet built or failed, in library order. */
export async function libraryTodo() {
  const index = await readJson<LibraryIndex>(indexFile());
  if (!index) throw new DataError("Discover the library first.", 409);
  const built = new Set((await libraryFiles()).map((f) => f.slice(0, -".json.gz".length)));
  return {
    candidates: index.candidates.length,
    built: index.candidates.filter((c) => built.has(c.condition)).length,
    failed: Object.keys(index.failed).length,
    todo: index.candidates.filter((c) => !built.has(c.condition) && !index.failed[c.condition]),
  };
}

/** Build and save one library market. Throws on failure; the caller decides retry vs fail. */
export async function buildLibraryMarket(c: IntegrityMarketMeta) {
  const m = await loadMarket(c.condition, c);
  try {
    await writeJson(path.join(libDir, `${c.condition}.json.gz`), toRecord(m));
  } finally {
    loaded.delete(c.condition);
  }
}

/** Record permanent failures (single writer). */
export async function recordLibraryFailures(failures: Record<string, string>) {
  if (!Object.keys(failures).length) return;
  const index = await readJson<LibraryIndex>(indexFile());
  if (!index) return;
  Object.assign(index.failed, failures);
  await writeJson(indexFile(), index);
}

/* ------------------------------------------------- library-wide summary */

/** Per-category verdict counts across the whole library, for the Method page. */
export async function librarySummary() {
  const pop = await walletPopulation();
  const categories = SETTINGS.library.categories.map((c) => {
    const ps = [...categoryPValues(pop, c.id).values()],
      bh = benjaminiHochberg(ps),
      markets = [...pop.markets.values()].filter((m) => m.category === c.id).length,
      rate = pop.categoryRates.byCategory[c.id];
    return {
      id: c.id,
      label: c.label,
      markets,
      testable: ps.length,
      elevatedAlone: ps.filter((p) => p <= SETTINGS.alpha).length,
      elevatedCorrected: bh.k,
      flaggedRate: rate && rate.tested ? rate.flagged / rate.tested : null,
    };
  });
  const tiers = { 1: 0, 2: 0, 3: 0 } as Record<1 | 2 | 3, number>;
  for (const w of pop.result.wallets.values()) if (w.tier) tiers[w.tier as 1 | 2 | 3]++;
  // The snapshot keeps bets only for flagged wallets; the full count lives in the method check.
  const check = await methodCheck();
  return {
    markets: pop.records,
    wallets: check.population.wallets,
    tested: pop.result.tested,
    tiers,
    categories,
  };
}
