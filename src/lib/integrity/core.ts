/**
 * Market Integrity Search — pure statistics. No I/O. Every function here is
 * deterministic given its inputs (placebos take an explicit seed).
 */
import { exactTail, poissonBinomial, seededRandom } from "../statistical-core";
import {
  CALIBRATION_LIMIT,
  PRICE_BUCKETS,
  SETTINGS,
  type CategoryId,
  type ScoreType,
} from "./settings";

const HOUR = 3600;
const W = SETTINGS.windowHours;

/* ------------------------------------------------------------------ types */

export interface Fill {
  wallet: string;
  side: "BUY" | "SELL";
  /** 0 = Yes token, 1 = No token. */
  outcome: 0 | 1;
  price: number;
  size: number;
  timestamp: number;
}

/** Hourly taker-flow series for one market. Dollars, index 0 = firstHour. */
export interface HourlySeries {
  firstHour: number;
  /** Yes price at each clock hour (last trade, carried forward). */
  yes: number[];
  buyYes: number[];
  sellYes: number[];
  buyNo: number[];
  sellNo: number[];
}

export interface BigMove {
  hour: number;
  startTime: number;
  favored: 0 | 1;
  from: number;
  to: number;
  change: number;
  maxWalletShare: number;
  persistedBy: "price" | "resolution";
}

export type MarketVerdict = "unusual" | "nothing-unusual" | "not-testable";

export interface MarketTest {
  verdict: MarketVerdict;
  reason: string;
  scoreType: ScoreType;
  move: BigMove | null;
  rejectedMoves: { hour: number; change: number; reason: string }[];
  comparisonWindows: number;
  cushion: number | null;
  preScore: number | null;
  backing: number | null;
  against: number | null;
  atLeastAsHigh: number | null;
  p: number | null;
  /** Comparison-window scores, for the distribution chart. */
  comparisonScores: number[];
}

export interface Resolution {
  resolved: boolean;
  yesWon: boolean | null;
  /** Epoch seconds; trades at or after this are excluded. */
  cutoff: number | null;
}

/* ------------------------------------------------------------ hourly data */

const yesPrice = (f: Fill) => (f.outcome === 0 ? f.price : 1 - f.price);

export function buildHourly(takerFills: Fill[], cutoff: number | null): HourlySeries | null {
  const fills = takerFills
    .filter((f) => cutoff === null || f.timestamp < cutoff)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (!fills.length) return null;
  const firstHour = Math.floor(fills[0].timestamp / HOUR),
    lastHour = Math.floor(fills.at(-1)!.timestamp / HOUR),
    n = lastHour - firstHour + 1,
    zero = () => new Array<number>(n).fill(0),
    yes = new Array<number>(n).fill(NaN),
    s: HourlySeries = { firstHour, yes, buyYes: zero(), sellYes: zero(), buyNo: zero(), sellNo: zero() };
  for (const f of fills) {
    const i = Math.floor(f.timestamp / HOUR) - firstHour,
      usd = f.price * f.size;
    yes[i] = yesPrice(f);
    if (f.outcome === 0) (f.side === "BUY" ? s.buyYes : s.sellYes)[i] += usd;
    else (f.side === "BUY" ? s.buyNo : s.sellNo)[i] += usd;
  }
  for (let i = 1; i < n; i++) if (Number.isNaN(yes[i])) yes[i] = yes[i - 1];
  return s;
}

/** Drop leading hours so the series starts at the first complete hour (truncated tapes). */
export function dropFirstHour(s: HourlySeries): HourlySeries {
  const cut = <T,>(a: T[]) => a.slice(1);
  return {
    firstHour: s.firstHour + 1,
    yes: cut(s.yes),
    buyYes: cut(s.buyYes),
    sellYes: cut(s.sellYes),
    buyNo: cut(s.buyNo),
    sellNo: cut(s.sellNo),
  };
}

/* --------------------------------------------------------------- big move */

export function findBigMove(
  s: HourlySeries,
  takerFills: Fill[],
  resolution: Resolution,
): { move: BigMove | null; rejected: MarketTest["rejectedMoves"] } {
  const { minChange, persistHours, persistFraction, maxSingleWalletShare } = SETTINGS.bigMove;
  const candidates: { hour: number; change: number }[] = [];
  for (let h = 1; h < s.yes.length; h++) {
    const change = s.yes[h] - s.yes[h - 1];
    if (Math.abs(change) >= minChange - 1e-9) candidates.push({ hour: h, change });
  }
  candidates.sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.hour - b.hour);
  const rejected: MarketTest["rejectedMoves"] = [];
  for (const { hour, change } of candidates) {
    const dir = Math.sign(change),
      later = hour + persistHours;
    let persistedBy: BigMove["persistedBy"];
    if (later < s.yes.length) {
      if ((s.yes[later] - s.yes[hour - 1]) * dir < Math.abs(change) * persistFraction - 1e-9) {
        rejected.push({ hour, change, reason: "did not keep half its size 2 hours later" });
        continue;
      }
      persistedBy = "price";
    } else {
      if (resolution.yesWon === null || resolution.yesWon !== dir > 0) {
        rejected.push({ hour, change, reason: "no 2-hour follow-up and the market did not resolve that way" });
        continue;
      }
      persistedBy = "resolution";
    }
    const start = (s.firstHour + hour) * HOUR,
      byWallet = new Map<string, number>();
    let total = 0;
    for (const f of takerFills)
      if (f.timestamp >= start && f.timestamp < start + HOUR) {
        const usd = f.price * f.size;
        total += usd;
        byWallet.set(f.wallet, (byWallet.get(f.wallet) || 0) + usd);
      }
    const maxWalletShare = total ? Math.max(...byWallet.values()) / total : 1;
    if (maxWalletShare > maxSingleWalletShare + 1e-12) {
      rejected.push({ hour, change, reason: `one wallet made ${(maxWalletShare * 100).toFixed(0)}% of the hour's dollars` });
      continue;
    }
    return {
      move: {
        hour,
        startTime: start,
        favored: dir > 0 ? 0 : 1,
        from: s.yes[hour - 1],
        to: s.yes[hour],
        change,
        maxWalletShare,
        persistedBy,
      },
      rejected,
    };
  }
  return { move: null, rejected };
}

/* ------------------------------------------------------- windows & scores */

export interface WindowFlow {
  backing: number[];
  against: number[];
  volume: number[];
  /** Favored-side price change over each window, cents. */
  drift: number[];
}

/** Flow for every 6-hour window starting on hour index s (window = hours s..s+5). */
export function windowFlows(s: HourlySeries, favored: 0 | 1): WindowFlow {
  const n = s.yes.length,
    pre = (a: number[]) => {
      const out = new Array<number>(n + 1).fill(0);
      for (let i = 0; i < n; i++) out[i + 1] = out[i] + a[i];
      return out;
    };
  const back = s.yes.map((_, i) => (favored === 0 ? s.buyYes[i] + s.sellNo[i] : s.buyNo[i] + s.sellYes[i])),
    agst = s.yes.map((_, i) => (favored === 0 ? s.sellYes[i] + s.buyNo[i] : s.sellNo[i] + s.buyYes[i])),
    pb = pre(back),
    pa = pre(agst);
  const fav = (p: number) => (favored === 0 ? p : 1 - p);
  const out: WindowFlow = { backing: [], against: [], volume: [], drift: [] };
  for (let start = 0; start + W <= n; start++) {
    const b = pb[start + W] - pb[start],
      a = pa[start + W] - pa[start];
    out.backing.push(b);
    out.against.push(a);
    out.volume.push(b + a);
    const open = start === 0 ? s.yes[0] : s.yes[start - 1];
    out.drift.push((fav(s.yes[start + W - 1]) - fav(open)) * 100);
  }
  return out;
}

export function median(values: number[]) {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b),
    m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export const flowScore = (backing: number, against: number, cushion: number) =>
  (backing - against) / (backing + against + cushion);

/** Empirical p-value: (1 + comparisons at least as high) / (1 + comparisons). */
export function empiricalP(pre: number, comparison: number[]) {
  const atLeast = comparison.filter((c) => c >= pre - 1e-12).length;
  return { atLeast, p: (1 + atLeast) / (1 + comparison.length) };
}

/**
 * Part A steps 3–5 for a given move hour (real or placebo). `extraBacking`
 * plants buying into the pre-move window for the power test.
 */
export function scoreAtHour(
  s: HourlySeries,
  moveHour: number,
  favored: 0 | 1,
  scoreType: ScoreType,
  extra: { backing?: number; driftCents?: number } = {},
) {
  const flows = windowFlows(s, favored),
    preStart = moveHour - W,
    lastComparison = moveHour - 2 * W,
    n = Math.max(0, lastComparison + 1);
  if (preStart < 0 || n < 1) return null;
  const idx = Array.from({ length: n }, (_, i) => i);
  let cushion: number | null = null,
    preScore: number,
    comparisonScores: number[];
  const backing = flows.backing[preStart] + (extra.backing || 0),
    against = flows.against[preStart];
  if (scoreType === "aggressor-flow") {
    cushion = Math.max(SETTINGS.score.cushionFloor, median(idx.map((i) => flows.volume[i])));
    preScore = flowScore(backing, against, cushion);
    comparisonScores = idx.map((i) => flowScore(flows.backing[i], flows.against[i], cushion!));
  } else {
    preScore = flows.drift[preStart] + (extra.driftCents || 0);
    comparisonScores = idx.map((i) => flows.drift[i]);
  }
  const { atLeast, p } = empiricalP(preScore, comparisonScores);
  return { n, cushion, preScore, backing, against, atLeast, p, comparisonScores };
}

/** Part A, steps 1–6. */
export function marketTest(
  s: HourlySeries | null,
  takerFills: Fill[],
  resolution: Resolution,
  scoreType: ScoreType = SETTINGS.score.type,
): MarketTest {
  const base: MarketTest = {
    verdict: "not-testable",
    reason: "",
    scoreType,
    move: null,
    rejectedMoves: [],
    comparisonWindows: 0,
    cushion: null,
    preScore: null,
    backing: null,
    against: null,
    atLeastAsHigh: null,
    p: null,
    comparisonScores: [],
  };
  if (!resolution.resolved || resolution.yesWon === null)
    return { ...base, reason: "Not testable: the market is not resolved. Live markets are never labeled." };
  if (!s) return { ...base, reason: "Not testable: no trades before resolution." };
  const { move, rejected } = findBigMove(s, takerFills, resolution);
  base.rejectedMoves = rejected;
  if (!move)
    return { ...base, reason: "Not testable: no sudden move. The information arrived gradually or the largest jumps failed the rules." };
  base.move = move;
  const r = scoreAtHour(s, move.hour, move.favored, scoreType);
  const n = r?.n ?? 0;
  if (!r || n < SETTINGS.minComparisonWindows)
    return {
      ...base,
      comparisonWindows: n,
      reason: `Not testable: too little history (${n} comparison windows; at least ${SETTINGS.minComparisonWindows} are required).`,
    };
  const unusual = r.p <= SETTINGS.alpha + 1e-12;
  return {
    ...base,
    verdict: unusual ? "unusual" : "nothing-unusual",
    reason: unusual
      ? `Unusual pre-move buying (p = ${r.p.toPrecision(2)}).`
      : `Nothing unusual detected (p = ${r.p.toPrecision(2)}). This is not proof the market was clean.`,
    comparisonWindows: n,
    cushion: r.cushion,
    preScore: r.preScore,
    backing: r.backing,
    against: r.against,
    atLeastAsHigh: r.atLeast,
    p: r.p,
    comparisonScores: r.comparisonScores,
  };
}

/* ------------------------------------------------------ multiple testing */

export interface BHResult {
  rejected: boolean[];
  q: number[];
  /** Largest passing rank k (0 if none) and its bar k·α/m. */
  k: number;
  threshold: number;
}

export function benjaminiHochberg(p: number[], alpha: number = SETTINGS.alpha): BHResult {
  const m = p.length,
    order = p.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i),
    q = new Array<number>(m),
    rejected = new Array<boolean>(m).fill(false);
  let k = 0;
  order.forEach(({ v }, r) => {
    if (v <= ((r + 1) * alpha) / m + 1e-12) k = r + 1;
  });
  let running = 1;
  for (let r = m - 1; r >= 0; r--) {
    running = Math.min(running, (order[r].v * m) / (r + 1));
    q[order[r].i] = Math.min(1, running);
  }
  for (let r = 0; r < k; r++) rejected[order[r].i] = true;
  return { rejected, q, k, threshold: m ? (k * alpha) / m : 0 };
}

/* ------------------------------------------------------------ wallet bets */

export interface Bet {
  wallet: string;
  condition: string;
  event: string;
  outcome: 0 | 1;
  price: number;
  cost: number;
  won: boolean;
}

/**
 * Step 0 wallet bets for one market: net shares = bought − sold before the
 * resolution cutoff; keep positive holdings with cost ≥ $10 and average price
 * 3¢–50¢; skip wallets holding both Yes and No. Event dedup happens later.
 */
export function marketBets(
  allSideFills: Fill[],
  condition: string,
  event: string,
  resolution: Resolution,
): Bet[] {
  if (!resolution.resolved || resolution.yesWon === null) return [];
  const rule = SETTINGS.walletRecord;
  const book = new Map<string, { shares: [number, number]; buyShares: [number, number]; buyUsd: [number, number] }>();
  for (const f of allSideFills) {
    if (resolution.cutoff !== null && f.timestamp >= resolution.cutoff) continue;
    let b = book.get(f.wallet);
    if (!b) book.set(f.wallet, (b = { shares: [0, 0], buyShares: [0, 0], buyUsd: [0, 0] }));
    const o = f.outcome;
    if (f.side === "BUY") {
      b.shares[o] += f.size;
      b.buyShares[o] += f.size;
      b.buyUsd[o] += f.size * f.price;
    } else b.shares[o] -= f.size;
  }
  const bets: Bet[] = [];
  for (const [wallet, b] of book) {
    const held = ([0, 1] as const).filter((o) => b.shares[o] > 0.01);
    if (held.length !== 1) continue;
    const o = held[0],
      price = b.buyShares[o] ? b.buyUsd[o] / b.buyShares[o] : 0,
      cost = price * b.shares[o];
    if (cost < rule.minCost || price < rule.minPrice || price > rule.maxPrice) continue;
    bets.push({ wallet, condition, event, outcome: o, price, cost, won: (o === 0) === resolution.yesWon });
  }
  return bets;
}

/* ------------------------------------------------------------ calibration */

export interface Calibration {
  buckets: { low: number; high: number; markets: number; winRate: number | null }[];
}

const bucketOf = (price: number) =>
  PRICE_BUCKETS.findIndex(([lo, hi], i) => price >= lo && (price < hi || (i === PRICE_BUCKETS.length - 1 && price <= hi)));

/** Each market counts at most once per bucket (its bets in that bucket are averaged). */
export function calibrate(bets: Bet[]): Calibration {
  const perMarket = PRICE_BUCKETS.map(() => new Map<string, { wins: number; n: number }>());
  for (const b of bets) {
    const k = bucketOf(b.price);
    if (k < 0) continue;
    const m = perMarket[k].get(b.condition) || { wins: 0, n: 0 };
    m.n++;
    if (b.won) m.wins++;
    perMarket[k].set(b.condition, m);
  }
  return {
    buckets: PRICE_BUCKETS.map(([low, high], k) => {
      const rows = [...perMarket[k].values()];
      return {
        low,
        high,
        markets: rows.length,
        winRate: rows.length ? rows.reduce((s, r) => s + r.wins / r.n, 0) / rows.length : null,
      };
    }),
  };
}

export function fairChance(price: number, cal: Calibration | null) {
  const k = bucketOf(price),
    rate = cal && k >= 0 ? cal.buckets[k].winRate : null;
  return Math.min(0.999, Math.max(price, rate ?? 0));
}

/* -------------------------------------------------------- wallet records */

export interface WalletRecord {
  wallet: string;
  bets: (Bet & { fair: number })[];
  wins: number;
  expected: number;
  luckRatio: number | null;
  p: number | null;
  allWinChance: number | null;
}

/** One bet per event (the largest by cost), excluding the given events. */
export function walletRecord(
  wallet: string,
  index: Map<string, Bet[]>,
  excludeEvents: Set<string>,
  cal: Calibration | null,
): WalletRecord {
  const byEvent = new Map<string, Bet>();
  for (const b of index.get(wallet) ?? [])
    if (!excludeEvents.has(b.event)) {
      const prev = byEvent.get(b.event);
      if (!prev || b.cost > prev.cost) byEvent.set(b.event, b);
    }
  const bets = [...byEvent.values()].map((b) => ({ ...b, fair: fairChance(b.price, cal) }));
  return scoreRecord(wallet, bets);
}

export function indexBets(bets: Bet[]) {
  const index = new Map<string, Bet[]>();
  for (const b of bets) {
    const list = index.get(b.wallet);
    if (list) list.push(b);
    else index.set(b.wallet, [b]);
  }
  return index;
}

export function scoreRecord(wallet: string, bets: WalletRecord["bets"]): WalletRecord {
  const q = bets.map((b) => b.fair),
    wins = bets.filter((b) => b.won).length,
    expected = q.reduce((a, b) => a + b, 0);
  if (!bets.length) return { wallet, bets, wins, expected, luckRatio: null, p: null, allWinChance: null };
  return {
    wallet,
    bets,
    wins,
    expected,
    luckRatio: expected ? wins / expected : null,
    p: exactTail(poissonBinomial(q), wins),
    allWinChance: q.reduce((a, b) => a * b, 1),
  };
}

export type WalletLabel =
  | "unusual-record"
  | "nothing-unusual"
  | "too-few-bets"
  | "record-too-short";

export interface WalletCheckRow {
  wallet: string;
  netUsd: number | null;
  record: WalletRecord;
  label: WalletLabel;
  q: number | null;
  fragile: boolean | null;
  fragileP: number | null;
}

export interface WalletCheck {
  rows: WalletCheckRow[];
  m: number;
  prefilterBar: number | null;
  tested: number;
  threshold: number;
  correction: "BH" | "Bonferroni";
}

/** Part B steps 3–6 (record scoring, pre-filter, BH or Bonferroni, fragility). */
export function walletCheck(
  listed: { wallet: string; netUsd: number | null; record: WalletRecord }[],
  correction: "BH" | "Bonferroni" = "BH",
): WalletCheck {
  const alpha = SETTINGS.alpha,
    min = SETTINGS.walletRecord.minBets,
    eligible = listed.filter((l) => l.record.bets.length >= min),
    m = eligible.length,
    bar = m ? alpha / m : null;
  const rows: WalletCheckRow[] = listed.map((l) => ({
    wallet: l.wallet,
    netUsd: l.netUsd,
    record: l.record,
    label: l.record.bets.length < min ? "too-few-bets" : "nothing-unusual",
    q: null,
    fragile: null,
    fragileP: null,
  }));
  const tested = rows.filter((r) => {
    if (r.label === "too-few-bets") return false;
    if (bar !== null && (r.record.allWinChance ?? 1) > bar + 1e-15) {
      r.label = "record-too-short";
      return false;
    }
    return true;
  });
  let threshold = 0;
  if (tested.length) {
    const ps = tested.map((r) => r.record.p!);
    if (correction === "BH") {
      const bh = benjaminiHochberg(ps, alpha);
      threshold = bh.threshold;
      tested.forEach((r, i) => {
        r.q = bh.q[i];
        if (bh.rejected[i]) r.label = "unusual-record";
      });
    } else {
      threshold = alpha / tested.length;
      tested.forEach((r) => {
        r.q = Math.min(1, r.record.p! * tested.length);
        if (r.record.p! <= threshold + 1e-15) r.label = "unusual-record";
      });
    }
    for (const r of tested.filter((r) => r.label === "unusual-record")) {
      const wins = r.record.bets.filter((b) => b.won);
      const surprising = wins.reduce((a, b) => (b.fair < a.fair ? b : a));
      const rest = scoreRecord(r.wallet, r.record.bets.filter((b) => b !== surprising));
      r.fragileP = rest.p;
      r.fragile = rest.p === null || rest.p > threshold + 1e-15;
    }
  }
  return { rows, m, prefilterBar: bar, tested: tested.length, threshold, correction };
}

/* ------------------------------------------------------------- listing */

/** Net dollars behind the favored side in [from, to): favored buys + other sells − reverse. */
export function netBehind(allSideFills: Fill[], favored: 0 | 1, from: number, to: number) {
  const net = new Map<string, number>();
  for (const f of allSideFills) {
    if (f.timestamp < from || f.timestamp >= to) continue;
    const usd = f.price * f.size,
      backs = (f.outcome === favored) === (f.side === "BUY");
    net.set(f.wallet, (net.get(f.wallet) || 0) + (backs ? usd : -usd));
  }
  return net;
}

export function listWallets(
  allSideFills: Fill[],
  move: BigMove | null,
  winners: Bet[] | null,
  winningHoldings?: Map<string, number>,
) {
  const { count, minNetUsd } = SETTINGS.walletList;
  if (move) {
    const net = netBehind(allSideFills, move.favored, move.startTime - W * HOUR, move.startTime);
    return [...net]
      .filter(([, v]) => v >= minNetUsd)
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([wallet, netUsd]) => ({ wallet, netUsd }));
  }
  const holdings = winningHoldings ?? new Map((winners ?? []).map((b) => [b.wallet, b.cost]));
  return [...holdings]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([wallet]) => ({ wallet, netUsd: null as number | null }));
}

/* ------------------------------------------------------------ percentile */

export function percentile(score: number, comparable: number[]) {
  if (!comparable.length) return { percentile: null, compared: 0 };
  return {
    percentile: comparable.filter((c) => c < score).length / comparable.length,
    compared: comparable.length,
  };
}

/* ------------------------------------------------------- multi-market */

export interface MultiRow {
  condition: string;
  test: MarketTest;
  status: "tested" | "not-testable" | "history-too-short";
  q: number | null;
  flagged: boolean;
}

/** Multi-market steps 2–4: set aside not testable, iterative pre-filter, BH. */
export function multiMarket(items: { condition: string; test: MarketTest }[]) {
  const rows: MultiRow[] = items.map((i) => ({
    condition: i.condition,
    test: i.test,
    status: i.test.verdict === "not-testable" ? "not-testable" : "tested",
    q: null,
    flagged: false,
  }));
  const steps: number[] = [];
  for (;;) {
    const live = rows.filter((r) => r.status === "tested"),
      M = live.length;
    steps.push(M);
    const drop = live.filter((r) => r.test.comparisonWindows < 20 * M);
    if (!drop.length || !M) break;
    for (const r of drop) r.status = "history-too-short";
  }
  const live = rows.filter((r) => r.status === "tested"),
    bh = benjaminiHochberg(live.map((r) => r.test.p!));
  live.forEach((r, i) => {
    r.q = bh.q[i];
    r.flagged = bh.rejected[i];
  });
  rows.sort((a, b) => (a.q ?? 2) - (b.q ?? 2));
  return { rows, M: live.length, mSteps: steps, threshold: bh.threshold, k: bh.k };
}

/* ------------------------------------------------------- excess rate */

export function excessRate(observedHits: number, markets: number, placeboRate: number) {
  if (!markets) return null;
  const rate = observedHits / markets,
    margin = 1.96 * Math.sqrt((rate * (1 - rate)) / markets),
    excess = rate - placeboRate;
  return {
    observedRate: rate,
    placeboRate,
    excess,
    low: excess - margin,
    high: excess + margin,
    evidence: excess - margin > 0,
  };
}

/* ------------------------------------------------------------- placebos */

export interface LibraryMarket {
  condition: string;
  event: string;
  title: string;
  category: CategoryId | null;
  series: HourlySeries | null;
  test: MarketTest;
  listed: { wallet: string; netUsd: number | null }[];
}

/** Placebo 1: random fake move hours, real favored side, Part A steps 3–5. */
export function randomTimePlacebo(markets: LibraryMarket[], runs: number = SETTINGS.placeboRuns, seed = 1) {
  const rng = seededRandom(seed),
    usable = markets.filter((m) => m.series && m.test.move && m.test.verdict !== "not-testable"),
    minHour = 2 * W + SETTINGS.minComparisonWindows - 1;
  const perRun: { share: number; tested: number; flaggedByCategory: Record<string, number> }[] = [];
  const byCategory: Record<string, { hits: number; tests: number }> = {};
  for (let run = 0; run < runs; run++) {
    let hits = 0,
      tests = 0;
    const cat: Record<string, number[]> = {};
    for (const m of usable) {
      const maxHour = m.test.move!.hour - W;
      if (maxHour < minHour) continue;
      const fake = minHour + Math.floor(rng() * (maxHour - minHour + 1));
      const r = scoreAtHour(m.series!, fake, m.test.move!.favored, m.test.scoreType);
      if (!r) continue;
      tests++;
      const hit = r.p <= SETTINGS.alpha + 1e-12;
      if (hit) hits++;
      const c = m.category ?? "uncategorized";
      (cat[c] ||= []).push(r.p);
      byCategory[c] ||= { hits: 0, tests: 0 };
      byCategory[c].tests++;
      if (hit) byCategory[c].hits++;
    }
    const flaggedByCategory: Record<string, number> = {};
    for (const [c, ps] of Object.entries(cat)) flaggedByCategory[c] = benjaminiHochberg(ps).k;
    perRun.push({ share: tests ? hits / tests : 0, tested: tests, flaggedByCategory });
  }
  const share = perRun.length ? perRun.reduce((s, r) => s + r.share, 0) / perRun.length : null;
  const categories = Object.fromEntries(
    Object.entries(byCategory).map(([c, v]) => {
      const rate = v.tests ? v.hits / v.tests : null;
      return [c, { rate, tests: v.tests, calibrated: rate === null ? null : rate <= CALIBRATION_LIMIT }];
    }),
  );
  return {
    runs,
    seed,
    markets: usable.length,
    share,
    meanMultiFlags:
      perRun.length
        ? perRun.reduce((s, r) => s + Object.values(r.flaggedByCategory).reduce((a, b) => a + b, 0), 0) / perRun.length
        : null,
    categories,
  };
}

/** Placebo 2: fake-wallet twins built from other wallets' bets at prices within 1¢. */
export function fakeWalletPlacebo(
  markets: LibraryMarket[],
  library: Bet[],
  cal: Calibration | null,
  runs: number = SETTINGS.placeboRuns,
  seed = 2,
) {
  const rng = seededRandom(seed),
    index = indexBets(library),
    sorted = [...library].sort((a, b) => a.price - b.price);
  const near = (b: Bet) => {
    let lo = 0,
      hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid].price < b.price - 0.01) lo = mid + 1;
      else hi = mid;
    }
    const out: Bet[] = [];
    for (let i = lo; i < sorted.length && sorted[i].price <= b.price + 0.01; i++)
      if (sorted[i].wallet !== b.wallet && sorted[i].event !== b.event) out.push(sorted[i]);
    return out;
  };
  let realFlags = 0;
  const realChecks = markets.map((m) => {
    const exclude = new Set([m.event]);
    const records = m.listed.map((l) => ({ ...l, record: walletRecord(l.wallet, index, exclude, cal) }));
    const check = walletCheck(records);
    realFlags += check.rows.filter((r) => r.label === "unusual-record").length;
    return records;
  });
  let fakeTotal = 0;
  for (let run = 0; run < runs; run++)
    for (const records of realChecks) {
      const fakes = records.map((r) => {
        const bets = r.record.bets.map((b) => {
          const pool = near(b);
          const pick = pool.length ? pool[Math.floor(rng() * pool.length)] : b;
          return { ...pick, fair: fairChance(pick.price, cal) };
        });
        return { wallet: `fake:${r.wallet}`, netUsd: r.netUsd, record: scoreRecord(`fake:${r.wallet}`, bets) };
      });
      fakeTotal += walletCheck(fakes).rows.filter((r) => r.label === "unusual-record").length;
    }
  const meanFake = runs ? fakeTotal / runs : 0;
  const rate = realFlags ? meanFake / realFlags : null;
  return {
    runs,
    seed,
    realFlags,
    meanFakeFlags: meanFake,
    falseFlagRate: rate,
    correction: (rate !== null && rate > CALIBRATION_LIMIT ? "Bonferroni" : "BH") as "BH" | "Bonferroni",
  };
}

/** Optional power test: plant 1× and 3× cushion of backing (or +3¢/+10¢ drift). */
export function plantedBuying(markets: LibraryMarket[]) {
  const clean = markets.filter((m) => m.series && m.test.verdict === "nothing-unusual" && m.test.move);
  const levels = [1, 3].map((mult) => {
    let switched = 0;
    for (const m of clean) {
      const t = m.test,
        extra =
          t.scoreType === "aggressor-flow"
            ? { backing: mult * (t.cushion ?? 0) }
            : { driftCents: mult === 1 ? 3 : 10 };
      const r = scoreAtHour(m.series!, t.move!.hour, t.move!.favored, t.scoreType, extra);
      if (r && r.p <= SETTINGS.alpha + 1e-12) switched++;
    }
    return { multiple: mult, markets: clean.length, switched, power: clean.length ? switched / clean.length : null };
  });
  return levels;
}
