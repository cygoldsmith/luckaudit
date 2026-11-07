import {
  adjustPValues,
  exactTail,
  oddsMultiplier,
  poissonBinomial,
  seededRandom,
} from "./statistical-core";
import {
  benjaminiHochberg,
  empiricalP,
  flowScore,
  scoreAtHour,
  type HourlySeries,
} from "./integrity/core";
import { SETTINGS } from "./integrity/settings";
export interface ValidationResult {
  generatedAt: string;
  parameters: {
    replicates: number;
    nullWallets: number;
    injectedPerCell: number;
    alpha: number;
    seed: number;
  };
  checks: { name: string; passed: boolean; detail: string }[];
  allNull: {
    replicatesWithFlags: number;
    rate: number;
    interval: [number, number];
    histogram: number[];
  };
  mixture: { meanFdp: number; standardError: number; meanFlags: number; prefiltered: number };
  marketTest: {
    markets: number;
    tests: number;
    nullShare: number;
    power: { multiple: number; switched: number; markets: number; power: number }[];
  };
  power: {
    positions: number;
    oddsRatio: number;
    detected: number;
    total: number;
    recall: number;
  }[];
  scope: string;
  notRun: string[];
}
export function runValidation(): ValidationResult {
  const reference = [0.08, 0.12, 0.1, 0.15, 0.3, 0.45, 0.2, 0.1, 0.25, 0.12],
    referencePmf = poissonBinomial(reference),
    p = exactTail(referencePmf, 8),
    odds = oddsMultiplier(reference, 8)!;
  const binomial = poissonBinomial([0.5, 0.5, 0.5]),
    bh = adjustPValues([0.001, 0.02, 0.04, 0.8]),
    example2 = benjaminiHochberg([0.0014, 0.003, 0.011, 0.04, 0.09, 0.2, 0.31, 0.45, 0.62, 0.8]);
  const checks = [
    {
      name: "Poisson-binomial worked example",
      passed: Math.abs(p - 0.000019267416) < 1e-14,
      detail: `Exact P(S ≥ 8) = ${p.toExponential(8)}`,
    },
    {
      name: "Odds-multiplier fit",
      passed: Math.abs(odds - 22.74535376354) < 1e-8,
      detail: `Fitted common odds multiplier ${odds.toFixed(5)}`,
    },
    {
      name: "Analytical binomial distribution",
      passed: binomial.every(
        (value, i) => Math.abs(value - [0.125, 0.375, 0.375, 0.125][i]) < 1e-12,
      ),
      detail:
        "Three independent fair Bernoulli observations match the analytical distribution.",
    },
    {
      name: "BH adjustment reference",
      passed: bh.every(
        (value, i) =>
          Math.abs(value - [0.004, 0.04, 0.0533333333333, 0.8][i]) < 1e-10,
      ),
      detail: "Adjusted values match a fixed, hand-checkable reference family.",
    },
    {
      name: "Method Example 1: cushion score and market p-value",
      passed:
        Math.abs(flowScore(18000, 2000, 4000) - 2 / 3) < 1e-12 &&
        Math.abs(empiricalP(2 / 3, [...new Array(706).fill(0.1), 0.7, 0.8, 0.67]).p - 4 / 710) < 1e-12,
      detail: "Score (18,000 − 2,000) ÷ 24,000 = 0.67; p = (1 + 3) ÷ (1 + 709) = 0.0056.",
    },
    {
      name: "Method Example 2: BH across ten markets",
      passed:
        example2.k === 3 &&
        Math.abs(example2.threshold - 0.015) < 1e-12 &&
        Math.abs(example2.q[2] - 0.011 * 10 / 3) < 1e-12 &&
        Math.abs(example2.q[3] - 0.1) < 1e-12,
      detail: "Three markets flagged; rank-3 q = 0.037; the p = 0.040 market is not flagged in a group of ten.",
    },
  ];
  const parameters = {
    replicates: 30,
    nullWallets: 1000,
    injectedPerCell: 200,
    alpha: 0.05,
    seed: 42,
  };
  const random = seededRandom(parameters.seed),
    histogram = new Array(10).fill(0);
  let allNullFlags = 0,
    totalFlags = 0;
  const fdps: number[] = [];
  const sizes = [5, 10, 20, 50],
    profiles = new Map(
      sizes.map((n) => [
        n,
        Array.from({ length: n }, (_, i) => reference[i % reference.length]),
      ]),
    ),
    pmfs = new Map(sizes.map((n) => [n, poissonBinomial(profiles.get(n)!)])),
    allWinChance = new Map(sizes.map((n) => [n, profiles.get(n)!.reduce((a, b) => a * b, 1)]));
  let prefiltered = 0;
  const power = sizes.flatMap((n) =>
    [2, 4].map((oddsRatio) => ({
      positions: n,
      oddsRatio,
      detected: 0,
      total: 0,
      recall: 0,
    })),
  );
  function draw(q: number[], or = 1) {
    return q.reduce(
      (sum, p) => sum + (random() < (or * p) / (1 - p + or * p) ? 1 : 0),
      0,
    );
  }
  for (let replicate = 0; replicate < parameters.replicates; replicate++) {
    const nullP: number[] = [];
    for (let i = 0; i < parameters.nullWallets; i++) {
      const n = sizes[i % sizes.length],
        pmf = pmfs.get(n)!,
        wins = draw(profiles.get(n)!),
        upper = exactTail(pmf, wins);
      nullP.push(upper);
      const randomized = upper - pmf[wins] + random() * pmf[wins];
      histogram[Math.min(9, Math.max(0, Math.floor(randomized * 10)))]++;
    }
    if (adjustPValues(nullP).some((q) => q <= parameters.alpha)) allNullFlags++;
    const values = [...nullP],
      cellIndices: number[] = [];
    for (let cell = 0; cell < power.length; cell++) {
      const { positions: n, oddsRatio } = power[cell];
      for (let i = 0; i < parameters.injectedPerCell; i++) {
        values.push(exactTail(pmfs.get(n)!, draw(profiles.get(n)!, oddsRatio)));
        cellIndices.push(cell);
        power[cell].total++;
      }
    }
    // Method pre-filter: drop wallets whose win-every-bet chance exceeds α/m.
    const allWin = [
        ...Array.from({ length: parameters.nullWallets }, (_, i) => allWinChance.get(sizes[i % sizes.length])!),
        ...cellIndices.map((cell) => allWinChance.get(power[cell].positions)!),
      ],
      bar = parameters.alpha / values.length,
      kept = values.map((_, i) => i).filter((i) => allWin[i] <= bar);
    prefiltered += values.length - kept.length;
    const keptAdjusted = kept.length ? adjustPValues(kept.map((i) => values[i])) : [],
      adjusted = new Array<number>(values.length).fill(1);
    kept.forEach((i, k) => (adjusted[i] = keptAdjusted[k]));
    let flags = 0,
      falseFlags = 0;
    for (let i = 0; i < adjusted.length; i++)
      if (adjusted[i] <= parameters.alpha) {
        flags++;
        if (i < parameters.nullWallets) falseFlags++;
        else power[cellIndices[i - parameters.nullWallets]].detected++;
      }
    totalFlags += flags;
    fdps.push(flags ? falseFlags / flags : 0);
  }
  for (const row of power) row.recall = row.detected / row.total;
  const meanFdp = fdps.reduce((a, b) => a + b, 0) / fdps.length,
    variance =
      fdps.reduce((s, v) => s + (v - meanFdp) ** 2, 0) / (fdps.length - 1),
    rate = allNullFlags / parameters.replicates,
    n = parameters.replicates,
    z = 1.96,
    denom = 1 + (z * z) / n,
    center = (rate + (z * z) / (2 * n)) / denom,
    half =
      (z * Math.sqrt((rate * (1 - rate)) / n + (z * z) / (4 * n * n))) / denom;
  return {
    generatedAt: new Date().toISOString(),
    parameters,
    checks,
    allNull: {
      replicatesWithFlags: allNullFlags,
      rate,
      interval: [Math.max(0, center - half), Math.min(1, center + half)],
      histogram,
    },
    mixture: {
      meanFdp,
      standardError: Math.sqrt(variance / fdps.length),
      meanFlags: totalFlags / fdps.length,
      prefiltered: prefiltered / parameters.replicates,
    },
    marketTest: marketBenchmark(parameters.seed),
    power,
    scope:
      "Synthetic benchmarks with known labels. They check that the exact wallet test with the method's pre-filter and BH, and the market pre-move test, behave as designed on data where the truth is known. Real-market false-alarm rates come from the placebo tests on the reference library (Integrity search → Method check).",
    notRun: [
      "Random-time placebo on real library markets (runs on the Integrity search method-check screen once the library is built)",
      "Fake-wallet placebo on real library bets (same screen)",
      "Planted-buying power on real library markets (same screen)",
      "Dependence between related events in the same category beyond what the placebos capture",
    ],
  };
}

/** Synthetic null markets: balanced random taker flow, so pre-move windows are exchangeable with earlier ones. */
function marketBenchmark(seed: number): ValidationResult["marketTest"] {
  const random = seededRandom(seed + 7),
    markets: HourlySeries[] = [];
  for (let m = 0; m < 120; m++) {
    const hours = 200 + Math.floor(random() * 600),
      flow = () => (random() < 0.3 ? 0 : -Math.log(1 - random()) * 400),
      s: HourlySeries = { firstHour: 0, yes: [], buyYes: [], sellYes: [], buyNo: [], sellNo: [] };
    for (let h = 0; h < hours; h++) {
      s.yes.push(0.3);
      s.buyYes.push(flow());
      s.sellYes.push(flow());
      s.buyNo.push(flow());
      s.sellNo.push(flow());
    }
    markets.push(s);
  }
  const minHour = 2 * SETTINGS.windowHours + SETTINGS.minComparisonWindows - 1;
  let tests = 0,
    hits = 0;
  const moves: { s: HourlySeries; hour: number }[] = [];
  for (const s of markets)
    for (let r = 0; r < SETTINGS.placeboRuns; r++) {
      const hour = minHour + Math.floor(random() * (s.yes.length - minHour));
      const result = scoreAtHour(s, hour, 0, "aggressor-flow");
      if (!result) continue;
      tests++;
      if (result.p <= SETTINGS.alpha) hits++;
      else if (r === 0) moves.push({ s, hour });
    }
  const power = [1, 3].map((multiple) => {
    let switched = 0;
    for (const { s, hour } of moves) {
      const base = scoreAtHour(s, hour, 0, "aggressor-flow")!;
      const planted = scoreAtHour(s, hour, 0, "aggressor-flow", { backing: multiple * (base.cushion ?? 0) })!;
      if (planted.p <= SETTINGS.alpha) switched++;
    }
    return { multiple, switched, markets: moves.length, power: moves.length ? switched / moves.length : 0 };
  });
  return { markets: markets.length, tests, nullShare: tests ? hits / tests : 0, power };
}
