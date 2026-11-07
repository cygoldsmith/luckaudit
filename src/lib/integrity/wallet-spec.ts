/**
 * "Luck Auditor — Statistical Method Spec" (Advanced spec): the wallet method.
 * Pure functions, no I/O. Steps 2–8 of the spec plus the market verdict built
 * from flagged participants.
 */
import { adjustPValues, exactTail, oddsMultiplier, poissonBinomial, seededRandom } from "../statistical-core";
import { benjaminiHochberg } from "./core";
import { WALLET_SETTINGS as S } from "./settings";

/* ------------------------------------------------------------------ data */

/** One position per wallet × market × token with net shares held at the cutoff. */
export interface SpecPosition {
  /** wallet */
  w: string;
  /** 0 = Yes token, 1 = No token */
  o: 0 | 1;
  /** first-buy timestamp (s) */
  t: number;
  /** first-buy price = entry price p */
  p: number;
  /** volume-weighted buy price */
  v: number;
  /** net shares held */
  s: number;
  /** cost = net shares × vwap */
  c: number;
  /** first entry fell in a pre-jump window (any wallet's jump) */
  win: 0 | 1;
  /** z: in a pre-jump window and not ≥20% of that jump's volume */
  z: 0 | 1;
}

export interface SpecMarket {
  condition: string;
  event: string;
  title: string;
  negRisk: boolean;
  yesWon: boolean;
  group: "study" | "control";
  positions: SpecPosition[];
  /** per token: [all buyers' first entries, those inside a pre-jump window] */
  timing: [[number, number], [number, number]];
}

/** One scored bet: one per wallet per event (Advanced spec event collapse). */
export interface SpecBet {
  wallet: string;
  event: string;
  markets: string[];
  title: string;
  group: "study" | "control";
  p: number;
  q: number;
  won: boolean;
  t: number;
  cost: number;
  profit: number;
  z: 0 | 1;
  r: number;
}

/* ----------------------------------------------------------- calibration */

export interface CalibrationBin {
  low: number;
  high: number;
  markets: number;
  meanPrice: number | null;
  winRate: number | null;
  fitted: number | null;
  usesFit: boolean;
}

/** Binned win rates (one observation per market × token), isotonic fit, c(p). */
export function calibrationCurve(markets: SpecMarket[]): CalibrationBin[] {
  const edges = S.calibrationEdges,
    bins = edges.slice(0, -1).map((low, i) => ({ low, high: edges[i + 1], obs: new Map<string, { won: number; prices: number[] }>() }));
  const binOf = (p: number) => {
    for (let i = 0; i < bins.length; i++) if (p >= bins[i].low && (p < bins[i].high || (i === bins.length - 1 && p <= bins[i].high))) return i;
    return -1;
  };
  for (const m of markets)
    for (const pos of m.positions) {
      if (!eligible(pos)) continue;
      const k = binOf(pos.p);
      if (k < 0) continue;
      const key = `${m.condition}:${pos.o}`,
        cell = bins[k].obs.get(key) ?? { won: (pos.o === 0) === m.yesWon ? 1 : 0, prices: [] };
      cell.prices.push(pos.p);
      bins[k].obs.set(key, cell);
    }
  const raw = bins.map((b) => {
    const cells = [...b.obs.values()];
    return {
      low: b.low,
      high: b.high,
      markets: cells.length,
      meanPrice: cells.length ? cells.reduce((s, c) => s + c.prices.reduce((a, x) => a + x, 0) / c.prices.length, 0) / cells.length : null,
      winRate: cells.length ? cells.reduce((s, c) => s + c.won, 0) / cells.length : null,
    };
  });
  // Pool-adjacent-violators: monotone non-decreasing fit weighted by markets per bin.
  const blocks: { value: number; weight: number; members: number[] }[] = [];
  raw.forEach((b, i) => {
    if (b.winRate === null || !b.markets) return;
    blocks.push({ value: b.winRate, weight: b.markets, members: [i] });
    while (blocks.length > 1 && blocks[blocks.length - 2].value > blocks[blocks.length - 1].value) {
      const top = blocks.pop()!,
        prev = blocks.pop()!,
        weight = prev.weight + top.weight;
      blocks.push({ value: (prev.value * prev.weight + top.value * top.weight) / weight, weight, members: [...prev.members, ...top.members] });
    }
  });
  const fitted = new Array<number | null>(raw.length).fill(null);
  for (const b of blocks) for (const i of b.members) fitted[i] = b.value;
  return raw.map((b, i) => ({ ...b, fitted: fitted[i], usesFit: b.markets >= S.minMarketsPerBin && fitted[i] !== null }));
}

export function calibrated(p: number, curve: CalibrationBin[] | null) {
  if (!curve) return p;
  const bin = curve.find((b, i) => p >= b.low && (p < b.high || (i === curve.length - 1 && p <= b.high)));
  return bin && bin.usesFit ? bin.fitted! : p;
}

/** q = max(p, c(p)), kept strictly inside (0, 1). */
export const nullProbability = (p: number, curve: CalibrationBin[] | null) =>
  Math.min(0.999, Math.max(p, calibrated(p, curve)));

const eligible = (pos: SpecPosition) => pos.c >= S.minCost && pos.p >= S.priceRange[0] && pos.p <= S.priceRange[1];

/* ------------------------------------------------------- event collapse */

/** Build one bet per wallet per event, with neg-risk Yes positions merged. */
export function collapseBets(markets: SpecMarket[], curve: CalibrationBin[] | null): SpecBet[] {
  type Held = { m: SpecMarket; pos: SpecPosition };
  const groups = new Map<string, Held[]>();
  for (const m of markets)
    for (const pos of m.positions) {
      if (!eligible(pos)) continue;
      const key = `${pos.w}|${m.event}`,
        list = groups.get(key);
      if (list) list.push({ m, pos });
      else groups.set(key, [{ m, pos }]);
    }
  const rate = (h: Held) => {
    const [n, inWin] = h.m.timing[h.pos.o],
      others = n - 1,
      r = others > 0 ? (inWin - h.pos.win) / others : 0;
    return Math.min(S.rateClamp[1], Math.max(S.rateClamp[0], r));
  };
  const won = (h: Held) => (h.pos.o === 0) === h.m.yesWon;
  const single = (h: Held): SpecBet => ({
    wallet: h.pos.w,
    event: h.m.event,
    markets: [h.m.condition],
    title: h.m.title,
    group: h.m.group,
    p: h.pos.p,
    q: nullProbability(h.pos.p, curve),
    won: won(h),
    t: h.pos.t,
    cost: h.pos.c,
    profit: (won(h) ? h.pos.s : 0) - h.pos.c,
    z: h.pos.z,
    r: rate(h),
  });
  const bets: SpecBet[] = [];
  for (const held of groups.values()) {
    const negRisk = held[0].m.negRisk;
    const largest = (list: Held[]) => list.reduce((a, b) => (b.pos.c > a.pos.c ? b : a));
    if (!negRisk || held.length === 1) {
      bets.push(single(largest(held)));
      continue;
    }
    const yes = held.filter((h) => h.pos.o === 0);
    if (!yes.length) {
      bets.push(single(largest(held)));
      continue;
    }
    // Neg-risk Yes basket: wins if any leg wins; null = sum of entry prices.
    const p = yes.reduce((s, h) => s + h.pos.p, 0);
    if (p > S.priceRange[1]) continue;
    const first = yes.reduce((a, b) => (b.pos.t < a.pos.t ? b : a)),
      anyWon = yes.some(won);
    bets.push({
      wallet: first.pos.w,
      event: first.m.event,
      markets: yes.map((h) => h.m.condition),
      title: first.m.title,
      group: first.m.group,
      p,
      q: nullProbability(p, curve),
      won: anyWon,
      t: first.pos.t,
      cost: yes.reduce((s, h) => s + h.pos.c, 0),
      profit: yes.reduce((s, h) => s + (won(h) ? h.pos.s : 0) - h.pos.c, 0),
      z: yes.some((h) => h.pos.z) ? 1 : 0,
      r: rate(first),
    });
  }
  return bets;
}

export function indexByWallet(bets: SpecBet[]) {
  const index = new Map<string, SpecBet[]>();
  for (const b of bets) {
    const list = index.get(b.wallet);
    if (list) list.push(b);
    else index.set(b.wallet, [b]);
  }
  return index;
}

/* ----------------------------------------------------------- the tests */

const product = (xs: number[]) => xs.reduce((a, b) => a * b, 1);

export function recordP(bets: { q: number; won: boolean }[]) {
  if (!bets.length) return 1;
  return exactTail(poissonBinomial(bets.map((b) => b.q)), bets.filter((b) => b.won).length);
}

/** Tarone / independent filtering: drop wallets whose best reachable p exceeds α/m, until m is stable. */
export function taroneFilter<T>(items: T[], best: (t: T) => number, alpha: number = S.alpha) {
  let kept = items,
    m = items.length;
  for (;;) {
    const next = kept.filter((t) => best(t) <= alpha / Math.max(1, m) + 1e-300);
    if (next.length === kept.length) return { kept, m: kept.length };
    kept = next;
    m = kept.length;
  }
}

export interface FamilyResult {
  m: number;
  flagged: Set<string>;
  q: Map<string, number>;
  p: Map<string, number>;
  /**
   * The rejection bar the k-th smallest p-value had to clear: k·α/m for BH,
   * k·α/(m·H_m) for BY (0 when nothing is flagged). LOEO and per-market
   * re-tests compare against this bar; comparing against the flagged p itself
   * would make a single flagged wallet fail LOEO by construction.
   */
  cutoff: number;
  byRobust: Set<string>;
}

/** Filter, then BH (and BY badges) across one family of wallet p-values. */
export function runFamily(
  wallets: { id: string; p: number; best: number }[],
  alpha: number = S.alpha,
  primary: "BH" | "BY" = "BH",
): FamilyResult {
  const { kept, m } = taroneFilter(wallets, (w) => w.best, alpha);
  const ps = kept.map((w) => w.p),
    bh = benjaminiHochberg(ps, alpha),
    by = ps.length ? adjustPValues(ps, "BY") : [];
  const flagged = new Set<string>(),
    q = new Map<string, number>(),
    p = new Map<string, number>(),
    byRobust = new Set<string>();
  kept.forEach((w, i) => {
    p.set(w.id, w.p);
    q.set(w.id, primary === "BY" ? by[i] : bh.q[i]);
    const isFlag = primary === "BY" ? by[i] <= alpha : bh.rejected[i];
    if (isFlag) flagged.add(w.id);
    if (by[i] <= alpha) byRobust.add(w.id);
  });
  const k = flagged.size,
    harmonic = primary === "BY" ? Array.from({ length: m }, (_, i) => 1 / (i + 1)).reduce((a, b) => a + b, 0) : 1,
    cutoff = k && m ? (k * alpha) / (m * harmonic) : 0;
  return { m, flagged, q, p, cutoff, byRobust };
}

export type Tier = 1 | 2 | 3 | 0;
export const TIER_LABELS: Record<Tier, string> = {
  1: "Strong anomaly",
  2: "Anomaly",
  3: "Weak anomaly",
  0: "Not flagged",
};
export type EdgeProfile = "high-volume" | "concentrated-longshot" | "mixed";
export const EDGE_LABELS: Record<EdgeProfile, string> = {
  "high-volume": "High-volume edge",
  "concentrated-longshot": "Concentrated longshot edge",
  mixed: "Mixed",
};

export interface WalletResult {
  wallet: string;
  n: number;
  O: number;
  E: number;
  p1: number;
  q1: number | null;
  odds: number | null;
  byRobust: boolean;
  K: number;
  EK: number;
  p2: number;
  q2: number | null;
  test1: boolean;
  test2: boolean;
  tested1: boolean;
  tested2: boolean;
  loeo: boolean | null;
  loeoP: number | null;
  tier: Tier;
  edge: EdgeProfile;
  cost: number;
  profit: number;
  studyShare: number;
  group: "study" | "control";
  top: { title: string; p: number; q: number; won: boolean; t: number }[];
}

export function edgeProfile(n: number, odds: number | null, bets: SpecBet[]): EdgeProfile {
  const e = S.edge,
    sorted = bets.map((b) => b.p).sort((a, b) => a - b),
    median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 1;
  if (n >= e.highVolumeN && odds !== null && odds < e.highVolumeMaxOdds) return "high-volume";
  if (n < e.longshotMaxN && odds !== null && odds >= e.longshotMinOdds && median < e.longshotMaxMedianPrice) return "concentrated-longshot";
  return "mixed";
}

export interface PopulationResult {
  wallets: Map<string, WalletResult>;
  family1: { m: number; cutoff: number; flagged: number };
  family2: { m: number; cutoff: number; flagged: number };
  primary: "BH" | "BY";
  tested: number;
  /** Share of Test-1-tested wallets in tier 1 or 2 (base rate for the market verdict). */
  baseRate: number;
}

/** Steps 4–7: Test 1, Test 2, LOEO, tiers, edge profile across the whole population. */
export function analyzePopulation(index: Map<string, SpecBet[]>, primary: "BH" | "BY" = "BH"): PopulationResult {
  const rows = [...index].filter(([, bets]) => bets.length >= S.minPositions);
  const f1 = runFamily(
    rows.map(([id, bets]) => ({ id, p: recordP(bets), best: product(bets.map((b) => b.q)) })),
    S.alpha,
    primary,
  );
  const f2 = runFamily(
    rows.map(([id, bets]) => ({
      id,
      p: recordP(bets.map((b) => ({ q: b.r, won: b.z === 1 }))),
      best: product(bets.map((b) => b.r)),
    })),
    S.alpha,
    primary,
  );
  const wallets = new Map<string, WalletResult>();
  for (const [id, bets] of rows) {
    const O = bets.filter((b) => b.won).length,
      E = bets.reduce((s, b) => s + b.q, 0),
      K = bets.filter((b) => b.z).length,
      EK = bets.reduce((s, b) => s + b.r, 0),
      test1 = f1.flagged.has(id),
      test2 = f2.flagged.has(id);
    let loeo: boolean | null = null,
      loeoP: number | null = null;
    if (test1) {
      const wins = bets.filter((b) => b.won),
        drop = wins.reduce((a, b) => (b.q < a.q ? b : a));
      loeoP = recordP(bets.filter((b) => b !== drop));
      loeo = loeoP <= f1.cutoff + 1e-300;
    }
    const tier: Tier = test1 && loeo && test2 ? 1 : test1 && loeo ? 2 : test1 || test2 ? 3 : 0;
    const odds = oddsMultiplier(bets.map((b) => b.q), O),
      study = bets.filter((b) => b.group === "study").length;
    wallets.set(id, {
      wallet: id,
      n: bets.length,
      O,
      E,
      p1: f1.p.get(id) ?? recordP(bets),
      q1: f1.q.get(id) ?? null,
      odds,
      byRobust: f1.byRobust.has(id),
      K,
      EK,
      p2: f2.p.get(id) ?? 1,
      q2: f2.q.get(id) ?? null,
      test1,
      test2,
      tested1: f1.p.has(id),
      tested2: f2.p.has(id),
      loeo,
      loeoP,
      tier,
      edge: edgeProfile(bets.length, odds, bets),
      cost: bets.reduce((s, b) => s + b.cost, 0),
      profit: bets.reduce((s, b) => s + b.profit, 0),
      studyShare: study / bets.length,
      group: study * 2 >= bets.length ? "study" : "control",
      top: [...bets]
        .sort((a, b) => (Number(b.won) - b.q) - (Number(a.won) - a.q))
        .slice(0, 5)
        .map((b) => ({ title: b.title, p: b.p, q: b.q, won: b.won, t: b.t })),
    });
  }
  const tested = [...wallets.values()].filter((w) => w.tested1);
  return {
    wallets,
    family1: { m: f1.m, cutoff: f1.cutoff, flagged: f1.flagged.size },
    family2: { m: f2.m, cutoff: f2.cutoff, flagged: f2.flagged.size },
    primary,
    tested: tested.length,
    baseRate: tested.length ? tested.filter((w) => w.tier === 1 || w.tier === 2).length / tested.length : 0,
  };
}

/* ---------------------------------------------------------- validation */

function flagCount(index: Map<string, SpecBet[]>, primary: "BH" | "BY") {
  const rows = [...index].filter(([, b]) => b.length >= S.minPositions);
  return runFamily(
    rows.map(([id, bets]) => ({ id, p: recordP(bets), best: product(bets.map((b) => b.q)) })),
    S.alpha,
    primary,
  ).flagged;
}

/** Placebo A: matched synthetic twins (same n; borrowed positions ±1¢/±2¢, other wallet, other event, same group). */
export function placeboA(index: Map<string, SpecBet[]>, realFlags: number, runs: number = S.placeboRuns, seed = 11) {
  const rng = seededRandom(seed),
    pool = new Map<string, SpecBet[]>();
  for (const bets of index.values())
    for (const b of bets) {
      const list = pool.get(b.group);
      if (list) list.push(b);
      else pool.set(b.group, [b]);
    }
  for (const list of pool.values()) list.sort((a, b) => a.p - b.p);
  const lower = (list: SpecBet[], x: number) => {
    let lo = 0,
      hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].p < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const borrow = (b: SpecBet) => {
    const list = pool.get(b.group) ?? [];
    for (const tol of S.placeboMatch) {
      const start = lower(list, b.p - tol),
        end = lower(list, b.p + tol + 1e-9),
        span = end - start;
      for (let attempt = 0; attempt < 12 && span > 0; attempt++) {
        const pick = list[start + Math.floor(rng() * span)];
        if (pick.wallet !== b.wallet && pick.event !== b.event) return pick;
      }
    }
    return null;
  };
  const tested = [...index].filter(([, b]) => b.length >= S.minPositions);
  let total = 0;
  for (let run = 0; run < runs; run++) {
    const synthetic = new Map<string, SpecBet[]>();
    for (const [id, bets] of tested) {
      const twin = bets.map((b) => borrow(b)).filter((x): x is SpecBet => x !== null);
      if (twin.length === bets.length) synthetic.set(`twin:${id}`, twin);
    }
    total += flagCount(synthetic, "BH").size;
  }
  const mean = runs ? total / runs : 0;
  const fdr = realFlags ? mean / realFlags : null;
  return { runs, meanFlags: mean, realFlags, fdr, primary: (fdr !== null && fdr > S.byFallbackFdr ? "BY" : "BH") as "BH" | "BY" };
}

/** Placebo B: outcomes redrawn from Bernoulli(q); mid-p histogram should be flat. */
export function placeboB(index: Map<string, SpecBet[]>, realFlags: number, seed = 12) {
  const rng = seededRandom(seed),
    histogram = new Array(10).fill(0),
    simulated = new Map<string, SpecBet[]>();
  for (const [id, bets] of index) {
    if (bets.length < S.minPositions) continue;
    const draw = bets.map((b) => ({ ...b, won: rng() < b.q }));
    simulated.set(id, draw);
    const pmf = poissonBinomial(draw.map((b) => b.q)),
      O = draw.filter((b) => b.won).length,
      mid = exactTail(pmf, O) - pmf[O] / 2;
    histogram[Math.min(9, Math.max(0, Math.floor(mid * 10)))]++;
  }
  const flags = flagCount(simulated, "BH").size;
  return { histogram, flags, realFlags, ok: flags <= S.alpha * Math.max(1, realFlags) + 1 };
}

const expit = (x: number) => 1 / (1 + Math.exp(-x)),
  logit = (p: number) => Math.log(p / (1 - p));

/** Positive control: injected wallets copying real price profiles, odds ×2 and ×4. */
export function positiveControl(index: Map<string, SpecBet[]>, seed = 13) {
  const rng = seededRandom(seed),
    real = [...index.values()].filter((b) => b.length >= S.minPositions),
    cells = S.injectedSizes.flatMap((n) => S.injectedOdds.map((or) => ({ n, or, injected: 0, flagged: 0 }))),
    perCell = Math.max(1, Math.round(S.injectedWallets / cells.length)),
    combined = new Map(index),
    owner = new Map<string, number>();
  cells.forEach((cell, c) => {
    const donors = real.filter((b) => b.length >= cell.n);
    if (!donors.length) return;
    for (let i = 0; i < perCell; i++) {
      const donor = donors[Math.floor(rng() * donors.length)].slice(0, cell.n),
        id = `inject:${cell.n}:${cell.or}:${i}`;
      combined.set(
        id,
        donor.map((b) => ({ ...b, wallet: id, won: rng() < expit(logit(b.q) + Math.log(cell.or)) })),
      );
      owner.set(id, c);
      cell.injected++;
    }
  });
  for (const id of flagCount(combined, "BH")) {
    const c = owner.get(id);
    if (c !== undefined) cells[c].flagged++;
  }
  return cells.map((c) => ({ ...c, recall: c.injected ? c.flagged / c.injected : null }));
}

function logFactorial(n: number) {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}
/** Two-sided Fisher exact test on a 2×2 table [[a, b], [c, d]]. */
export function fisherExact(a: number, b: number, c: number, d: number) {
  const n = a + b + c + d,
    row1 = a + b,
    col1 = a + c,
    base = logFactorial(row1) + logFactorial(n - row1) + logFactorial(col1) + logFactorial(n - col1) - logFactorial(n);
  const prob = (x: number) =>
    Math.exp(base - logFactorial(x) - logFactorial(row1 - x) - logFactorial(col1 - x) - logFactorial(n - row1 - col1 + x));
  const observed = prob(a),
    lo = Math.max(0, row1 + col1 - n),
    hi = Math.min(row1, col1);
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    const px = prob(x);
    if (px <= observed * (1 + 1e-9)) p += px;
  }
  return Math.min(1, p);
}

/** Negative control: flags per 1,000 tested wallets, control vs study (descriptive). */
export function negativeControl(pop: PopulationResult) {
  const tested = [...pop.wallets.values()].filter((w) => w.tested1);
  const count = (g: "study" | "control") => {
    const set = tested.filter((w) => w.group === g);
    return { tested: set.length, flagged: set.filter((w) => w.test1).length };
  };
  const study = count("study"),
    control = count("control");
  return {
    study: { ...study, per1000: study.tested ? (1000 * study.flagged) / study.tested : null },
    control: { ...control, per1000: control.tested ? (1000 * control.flagged) / control.tested : null },
    fisherP:
      study.tested && control.tested
        ? fisherExact(study.flagged, study.tested - study.flagged, control.flagged, control.tested - control.flagged)
        : null,
  };
}

/** Timing placebo: each first entry replaced by a random other wallet's, i.e. z ~ Bernoulli(r). */
export function timingPlacebo(index: Map<string, SpecBet[]>, realFlags: number, runs: number = S.placeboRuns, seed = 14) {
  const rng = seededRandom(seed),
    rows = [...index].filter(([, b]) => b.length >= S.minPositions);
  let total = 0;
  for (let run = 0; run < runs; run++) {
    const family = runFamily(
      rows.map(([id, bets]) => ({
        id,
        p: recordP(bets.map((b) => ({ q: b.r, won: rng() < b.r }))),
        best: product(bets.map((b) => b.r)),
      })),
    );
    total += family.flagged.size;
  }
  const mean = runs ? total / runs : 0;
  return { runs, meanFlags: mean, realFlags, ok: mean <= S.alpha * Math.max(1, realFlags) + 1 };
}

/* ------------------------------------------------------- market verdict */

export type ParticipationVerdict = "elevated" | "typical" | "not-testable";
export const PARTICIPATION_LABELS: Record<ParticipationVerdict, string> = {
  elevated: "Elevated participation by anomalous wallets",
  typical: "Typical participation",
  "not-testable": "Not enough testable wallets",
};

/**
 * Exact binomial tail: is the number of flagged wallets among this market's
 * tested participants higher than the population base rate predicts?
 */
export function participationTest(tested: number, flagged: number, baseRate: number) {
  if (tested < S.market.minTestedParticipants)
    return { verdict: "not-testable" as ParticipationVerdict, p: null, expected: tested * baseRate };
  const rate = Math.min(0.999, Math.max(1e-6, baseRate)),
    p = exactTail(poissonBinomial(new Array(tested).fill(rate)), flagged);
  return {
    verdict: (p <= S.alpha + 1e-12 ? "elevated" : "typical") as ParticipationVerdict,
    p,
    expected: tested * baseRate,
  };
}

/* ------------------------------------------- tape → positions and jumps */

export interface TapeFill {
  wallet: string;
  side: "BUY" | "SELL";
  outcome: 0 | 1;
  price: number;
  size: number;
  timestamp: number;
}

export interface Jump {
  start: number;
  end: number;
  from: number;
  to: number;
  /** Wallets with ≥ 20% of the volume traded during the rise (self-impact). */
  heavy: string[];
}

/**
 * Favorable jumps for one token: price rises ≥ J within D minutes, keeps at
 * least half of the rise for H hours. Prices come from the tape (each fill once;
 * trades in the other token count as 1 − price).
 */
export function detectJumps(takerFills: TapeFill[], token: 0 | 1, cutoff: number): Jump[] {
  const J = S.jump,
    pts = takerFills
      .filter((f) => f.timestamp < cutoff)
      .map((f) => ({ t: f.timestamp, p: f.outcome === token ? f.price : 1 - f.price, w: f.wallet, usd: f.price * f.size }))
      .sort((a, b) => a.t - b.t);
  const jumps: Jump[] = [];
  let blockedUntil = -Infinity;
  for (let i = 0; i < pts.length && jumps.length < 200; i++) {
    if (pts[i].t < blockedUntil) continue;
    let end = -1;
    for (let j = i + 1; j < pts.length && pts[j].t - pts[i].t <= J.withinMinutes * 60; j++)
      if (pts[j].p - pts[i].p >= J.size - 1e-9) {
        end = j;
        break;
      }
    if (end < 0) continue;
    const rise = pts[end].p - pts[i].p,
      floor = pts[i].p + rise * J.persistFraction,
      until = pts[end].t + J.persistHours * 3600;
    // Held unless a later price inside the H-hour window falls below half the
    // rise. A rise that runs into the cutoff (resolution) without reversing holds.
    let held = true;
    for (let k = end + 1; k < pts.length && pts[k].t < until; k++)
      if (pts[k].p < floor - 1e-9) {
        held = false;
        break;
      }
    if (!held) continue;
    const byWallet = new Map<string, number>();
    let total = 0;
    for (let k = i; k <= end; k++) {
      total += pts[k].usd;
      byWallet.set(pts[k].w, (byWallet.get(pts[k].w) || 0) + pts[k].usd);
    }
    jumps.push({
      start: pts[i].t,
      end: pts[end].t,
      from: pts[i].p,
      to: pts[end].p,
      heavy: [...byWallet].filter(([, v]) => total > 0 && v / total >= J.selfImpactShare).map(([w]) => w),
    });
    blockedUntil = until;
  }
  return jumps;
}

/**
 * Advanced spec "Building positions": net shares per wallet × token from trades
 * before the cutoff; keep net > 0, drop wallets holding both tokens, entry price
 * = first buy price. Also returns per-token first-entry counts for Test 2.
 */
export function buildPositions(allSides: TapeFill[], takerFills: TapeFill[], cutoff: number) {
  const book = new Map<string, { first: [number, number]; firstPrice: [number, number]; buyS: [number, number]; buyU: [number, number]; net: [number, number] }>();
  for (const f of allSides) {
    if (f.timestamp >= cutoff) continue;
    let b = book.get(f.wallet);
    if (!b) book.set(f.wallet, (b = { first: [Infinity, Infinity], firstPrice: [0, 0], buyS: [0, 0], buyU: [0, 0], net: [0, 0] }));
    const o = f.outcome;
    if (f.side === "BUY") {
      if (f.timestamp < b.first[o]) {
        b.first[o] = f.timestamp;
        b.firstPrice[o] = f.price;
      }
      b.buyS[o] += f.size;
      b.buyU[o] += f.size * f.price;
      b.net[o] += f.size;
    } else b.net[o] -= f.size;
  }
  const jumps: [Jump[], Jump[]] = [detectJumps(takerFills, 0, cutoff), detectJumps(takerFills, 1, cutoff)];
  const W = S.preJumpHours * 3600;
  const inWindow = (o: 0 | 1, t: number) => jumps[o].find((j) => t >= j.start - W && t < j.start);
  const timing: [[number, number], [number, number]] = [
    [0, 0],
    [0, 0],
  ];
  const positions: SpecPosition[] = [];
  for (const [w, b] of book) {
    for (const o of [0, 1] as const)
      if (Number.isFinite(b.first[o])) {
        timing[o][0]++;
        if (inWindow(o, b.first[o])) timing[o][1]++;
      }
    const held = ([0, 1] as const).filter((o) => b.net[o] > 0.01);
    if (held.length !== 1) continue;
    const o = held[0];
    if (!Number.isFinite(b.first[o])) continue;
    const vwap = b.buyS[o] ? b.buyU[o] / b.buyS[o] : 0,
      jump = inWindow(o, b.first[o]);
    positions.push({
      w,
      o,
      t: b.first[o],
      p: Math.round(b.firstPrice[o] * 10000) / 10000,
      v: Math.round(vwap * 10000) / 10000,
      s: Math.round(b.net[o] * 100) / 100,
      c: Math.round(b.net[o] * vwap * 100) / 100,
      win: jump ? 1 : 0,
      z: jump && !jump.heavy.includes(w) ? 1 : 0,
    });
  }
  return { positions, timing, jumps };
}
