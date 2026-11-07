/**
 * Market Integrity Search — pure statistics. No I/O. Every function here is
 * deterministic given its inputs (placebos take an explicit seed).
 */
import { exactTail, poissonBinomial, seededRandom } from "../statistical-core";
import {
  CALIBRATION_LIMIT,
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

/* -------------------------------------------------------- record score */

/** One resolved bet in a record: did it win, and its null (fair) win chance. */
export interface RecordBet {
  wallet?: string;
  condition: string;
  event: string;
  outcome?: 0 | 1;
  price: number;
  cost: number;
  won: boolean;
  fair: number;
}

export interface WalletRecord {
  wallet: string;
  bets: RecordBet[];
  wins: number;
  expected: number;
  luckRatio: number | null;
  p: number | null;
  allWinChance: number | null;
}

/** Exact Poisson-binomial score of a record against its fair chances. */
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
