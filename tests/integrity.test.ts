import assert from "node:assert/strict";
import test from "node:test";
import {
  benjaminiHochberg,
  buildHourly,
  calibrate,
  empiricalP,
  excessRate,
  fairChance,
  findBigMove,
  flowScore,
  marketBets,
  marketTest,
  multiMarket,
  randomTimePlacebo,
  scoreRecord,
  walletCheck,
  type Fill,
  type MarketTest,
} from "../src/lib/integrity/core";

const close = (a: number, b: number, tol: number) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("Example 1 arithmetic: cushion score and empirical p", () => {
  close(flowScore(18000, 2000, 4000), 0.6667, 1e-4);
  close(flowScore(50, 0, 4000), 0.0123, 1e-3);
  const comparison = [...new Array(706).fill(0.1), 0.7, 0.8, 0.67];
  const { atLeast, p } = empiricalP(16000 / 24000, comparison);
  assert.equal(atLeast, 3);
  close(p, 4 / 710, 1e-12);
});

const example1Bets = [0.08, 0.12, 0.1, 0.15, 0.3, 0.45, 0.2, 0.1, 0.25, 0.12].map((fair, i) => ({
  wallet: "w",
  condition: `c${i}`,
  event: `e${i}`,
  outcome: 0 as const,
  price: fair,
  cost: 20,
  won: i !== 5 && i !== 8,
  fair,
}));

test("Example 1 wallet: expected 1.87, exact p 0.000019, luck ratio 4.3", () => {
  const r = scoreRecord("w", example1Bets);
  assert.equal(r.wins, 8);
  close(r.expected, 1.87, 1e-9);
  close(r.p!, 0.000019267416, 1e-9);
  close(r.luckRatio!, 4.28, 0.01);
});

test("wallet check: pre-filter, BH flag, fragility survives removing the 8¢ win", () => {
  const filler = (name: string) => ({
    wallet: name,
    netUsd: 500,
    record: scoreRecord(
      name,
      Array.from({ length: 6 }, (_, i) => ({ ...example1Bets[0], wallet: name, event: `${name}${i}`, fair: 0.4, won: i < 2 })),
    ),
  });
  const short = {
    wallet: "short",
    netUsd: 400,
    record: scoreRecord("short", Array.from({ length: 5 }, (_, i) => ({ ...example1Bets[0], wallet: "short", event: `s${i}`, fair: 0.5, won: true }))),
  };
  const tooFew = { wallet: "few", netUsd: 300, record: scoreRecord("few", example1Bets.slice(0, 3)) };
  const check = walletCheck([
    { wallet: "w", netUsd: 1000, record: scoreRecord("w", example1Bets) },
    ...Array.from({ length: 8 }, (_, i) => filler(`f${i}`)),
    short,
    tooFew,
  ]);
  assert.equal(check.m, 10);
  close(check.prefilterBar!, 0.005, 1e-12);
  const byWallet = Object.fromEntries(check.rows.map((r) => [r.wallet, r]));
  assert.equal(byWallet.short.label, "record-too-short");
  assert.equal(byWallet.few.label, "too-few-bets");
  assert.equal(byWallet.w.label, "unusual-record");
  assert.equal(check.tested, 9);
  close(check.threshold, 0.05 / 9, 1e-12);
  assert.equal(byWallet.w.fragile, false);
  close(byWallet.w.fragileP!, 0.00016, 0.00002);
});

test("Example 2: BH flags three of ten markets with the stated q-values", () => {
  const p = [0.0014, 0.003, 0.011, 0.04, 0.09, 0.2, 0.31, 0.45, 0.62, 0.8];
  const bh = benjaminiHochberg(p);
  assert.equal(bh.k, 3);
  close(bh.threshold, 0.015, 1e-12);
  assert.deepEqual(bh.rejected, [true, true, true, false, false, false, false, false, false, false]);
  const expected = [0.014, 0.015, 0.0367, 0.1, 0.18, 0.333, 0.443, 0.5625, 0.689, 0.8];
  bh.q.forEach((q, i) => close(q, expected[i], 0.001));
});

test("Example 2 pre-filter: 14 testable drop to 10 at 20×M windows", () => {
  const mk = (p: number, n: number): MarketTest => ({
    verdict: p <= 0.05 ? "unusual" : "nothing-unusual",
    reason: "",
    scoreType: "aggressor-flow",
    move: null,
    rejectedMoves: [],
    comparisonWindows: n,
    cushion: 100,
    preScore: 0,
    backing: 0,
    against: 0,
    atLeastAsHigh: 0,
    p,
    comparisonScores: [],
  });
  const ps = [0.0014, 0.003, 0.011, 0.04, 0.09, 0.2, 0.31, 0.45, 0.62, 0.8];
  const items = [
    ...ps.map((p, i) => ({ condition: `m${i}`, test: mk(p, 300) })),
    ...[0.001, 0.002, 0.3, 0.5].map((p, i) => ({ condition: `s${i}`, test: mk(p, 150) })),
    { condition: "nt", test: { ...mk(1, 0), verdict: "not-testable" as const, p: null } },
  ];
  const r = multiMarket(items);
  assert.deepEqual(r.mSteps, [14, 10]);
  assert.equal(r.M, 10);
  assert.equal(r.rows.filter((x) => x.flagged).length, 3);
  assert.equal(r.rows.filter((x) => x.status === "history-too-short").length, 4);
  assert.equal(r.rows.find((x) => x.condition === "m3")!.flagged, false);
});

test("calibration counts each market once per bucket; fair = max(price, rate)", () => {
  const bets = [
    { wallet: "a", condition: "m1", event: "e1", outcome: 0 as const, price: 0.05, cost: 10, won: true },
    { wallet: "b", condition: "m1", event: "e1", outcome: 0 as const, price: 0.06, cost: 10, won: true },
    { wallet: "c", condition: "m2", event: "e2", outcome: 0 as const, price: 0.05, cost: 10, won: false },
  ];
  const cal = calibrate(bets);
  assert.equal(cal.buckets[0].markets, 2);
  close(cal.buckets[0].winRate!, 0.5, 1e-12);
  close(fairChance(0.05, cal), 0.5, 1e-12);
  close(fairChance(0.35, cal), 0.35, 1e-12);
});

test("excess rate margin matches the illustrative award example", () => {
  const r = excessRate(39, 300, 0.042)!;
  close(r.observedRate, 0.13, 1e-12);
  close(r.excess, 0.088, 1e-9);
  close(r.high - r.excess, 0.038, 0.001);
  assert.equal(r.evidence, true);
});

/* Synthetic market: quiet balanced trading, then one-sided pre-move buying and a jump. */
function syntheticMarket(hours: number, preBuying: boolean): Fill[] {
  const t0 = 1_700_000_000 - (1_700_000_000 % 3600),
    fills: Fill[] = [];
  for (let h = 0; h < hours; h++) {
    const at = t0 + h * 3600 + 60,
      price = h <= hours - 3 ? 0.22 : 0.61,
      w = (k: number) => `0x${String(k).padStart(40, "0")}`;
    if (h === hours - 2) {
      for (let k = 0; k < 8; k++) fills.push({ wallet: w(100 + k), side: "BUY", outcome: 0, price: 0.61, size: 200, timestamp: at });
      continue;
    }
    fills.push({ wallet: w(h % 7), side: "BUY", outcome: 0, price, size: 100, timestamp: at });
    fills.push({ wallet: w((h + 3) % 7), side: "SELL", outcome: 0, price, size: 100, timestamp: at + 60 });
    if (preBuying && h >= hours - 8 && h < hours - 2)
      fills.push({ wallet: w(50), side: "BUY", outcome: 0, price, size: 3000, timestamp: at + 120 });
  }
  return fills;
}

test("Part A end to end: one-sided pre-move window is unusual; balanced is not", () => {
  const resolution = { resolved: true, yesWon: true, cutoff: null };
  for (const [pre, verdict] of [
    [true, "unusual"],
    [false, "nothing-unusual"],
  ] as const) {
    const fills = syntheticMarket(200, pre),
      series = buildHourly(fills, null),
      t = marketTest(series, fills, resolution);
    assert.equal(t.verdict, verdict, t.reason);
    assert.equal(t.move!.favored, 0);
    assert.equal(t.comparisonWindows, t.move!.hour - 11);
  }
});

test("Part A: unresolved markets and short histories are not testable", () => {
  const fills = syntheticMarket(40, true);
  assert.equal(marketTest(buildHourly(fills, null), fills, { resolved: false, yesWon: null, cutoff: null }).verdict, "not-testable");
  const t = marketTest(buildHourly(fills, null), fills, { resolved: true, yesWon: true, cutoff: null });
  assert.equal(t.verdict, "not-testable");
  assert.match(t.reason, /too little history/);
});

test("big move: a jump caused by one wallet is skipped", () => {
  const t0 = 1_700_006_400,
    fills: Fill[] = [];
  for (let h = 0; h < 80; h++) {
    const price = h < 70 ? 0.3 : 0.6;
    fills.push({ wallet: h === 70 ? "0xwhale" : `0x${h % 5}`, side: "BUY", outcome: 0, price, size: 100, timestamp: t0 + h * 3600 + 30 });
  }
  const { move, rejected } = findBigMove(buildHourly(fills, null)!, fills, { resolved: true, yesWon: true, cutoff: null });
  assert.equal(move, null);
  assert.match(rejected[0].reason, /one wallet/);
});

test("wallet bets: net held, cost/price rules, both-sides skipped, cutoff respected", () => {
  const f = (wallet: string, side: "BUY" | "SELL", outcome: 0 | 1, price: number, size: number, timestamp = 10): Fill => ({ wallet, side, outcome, price, size, timestamp });
  const bets = marketBets(
    [
      f("keep", "BUY", 0, 0.2, 100),
      f("keep", "SELL", 0, 0.3, 20),
      f("cheap", "BUY", 0, 0.2, 10),
      f("pricey", "BUY", 1, 0.8, 100),
      f("both", "BUY", 0, 0.2, 100),
      f("both", "BUY", 1, 0.8, 100),
      f("late", "BUY", 0, 0.2, 100, 999),
    ],
    "m",
    "e",
    { resolved: true, yesWon: true, cutoff: 500 },
  );
  assert.deepEqual(bets.map((b) => b.wallet), ["keep"]);
  close(bets[0].cost, 16, 1e-9);
  assert.equal(bets[0].won, true);
});

test("random-time placebo on null data rarely passes the 5% bar", () => {
  const markets = Array.from({ length: 30 }, (_, i) => {
    const fills = syntheticMarket(300 + i * 7, false),
      series = buildHourly(fills, null),
      t = marketTest(series, fills, { resolved: true, yesWon: true, cutoff: null });
    return { condition: `m${i}`, event: `e${i}`, title: "", category: "awards" as const, series, test: t, listed: [] };
  });
  const r = randomTimePlacebo(markets, 20, 7);
  assert.equal(r.markets, 30);
  assert.ok(r.share !== null && r.share <= 0.1, `share ${r.share}`);
});

test("participant scan corrects the scanned wallets as one group", async () => {
  const { correctGroup } = await import("../src/lib/participant-scan");
  const row = (address: string, p: number, allWinChance: number, observations = 10) => ({
    address,
    label: "nothing-unusual" as const,
    observations,
    wins: 0,
    expected: 0,
    luckRatio: null,
    p,
    allWinChance,
    q: null,
    reason: "",
  });
  const out = correctGroup([
    row("a", 0.012, 1e-6),
    row("b", 0.06, 1e-6), // would not pass alone either
    row("c", 0.5, 0.03), // win-every-bet chance above 0.05/3 → too short
    row("d", 0.01, 1e-6, 3), // fewer than 5 bets → not in the family
  ]);
  const by = Object.fromEntries(out.map((r) => [r.address, r]));
  assert.equal(by.c.label, "record-too-short");
  assert.equal(by.a.label, "unusual-record");
  assert.equal(by.b.label, "nothing-unusual");
  close(by.a.q!, 0.024, 1e-9);
  assert.equal(by.d.q, null);
});
