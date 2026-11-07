import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzePopulation,
  buildPositions,
  calibrationCurve,
  collapseBets,
  detectJumps,
  fisherExact,
  indexByWallet,
  nullProbability,
  participationTest,
  placeboA,
  recordP,
  taroneFilter,
  type SpecBet,
  type SpecMarket,
  type SpecPosition,
  type TapeFill,
} from "../src/lib/integrity/wallet-spec";
import { oddsMultiplier } from "../src/lib/statistical-core";

const close = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const pos = (w: string, o: 0 | 1, p: number, extra: Partial<SpecPosition> = {}): SpecPosition => ({
  w,
  o,
  t: 1000,
  p,
  v: p,
  s: 100,
  c: 100 * p + 20,
  win: 0,
  z: 0,
  ...extra,
});
const market = (i: number, positions: SpecPosition[], extra: Partial<SpecMarket> = {}): SpecMarket => ({
  condition: `m${i}`,
  event: `e${i}`,
  title: `Market ${i}`,
  negRisk: false,
  yesWon: true,
  group: "study",
  positions,
  timing: [
    [10, 1],
    [10, 1],
  ],
  ...extra,
});

test("Advanced spec worked example: E = 1.87, p = 1.9e-5, odds ≈ 23, clears BH at m = 2,000", () => {
  const q = [0.08, 0.12, 0.1, 0.15, 0.3, 0.45, 0.2, 0.1, 0.25, 0.12],
    bets = q.map((x, i) => ({ q: x, won: i !== 5 && i !== 8 }));
  close(q.reduce((a, b) => a + b, 0), 1.87, 1e-9);
  const p = recordP(bets);
  close(p, 0.000019267416, 1e-11);
  close(oddsMultiplier(q, 8)!, 22.74535, 1e-4);
  assert.ok(p <= 0.05 / 2000);
});

test("Tarone filter drops wallets that could never pass and iterates until m is stable", () => {
  const items = [0.0001, 0.001, 0.02, 0.03, 0.2].map((best, i) => ({ id: i, best }));
  const r = taroneFilter(items, (x) => x.best, 0.05);
  // m=5: bar 0.01 keeps 2; m=2: bar 0.025 keeps 2 → stable at 2.
  assert.equal(r.m, 2);
  assert.deepEqual(r.kept.map((x) => x.id), [0, 1]);
});

test("calibration: one observation per market and token, isotonic fit, raw price below 30 markets", () => {
  const markets: SpecMarket[] = [];
  for (let i = 0; i < 40; i++)
    markets.push(market(i, [pos(`a${i}`, 0, 0.12), pos(`b${i}`, 0, 0.13)], { yesWon: i < 8 }));
  for (let i = 40; i < 45; i++) markets.push(market(i, [pos(`c${i}`, 0, 0.62)], { yesWon: true }));
  const curve = calibrationCurve(markets),
    bin = curve.find((b) => b.low === 0.1)!;
  assert.equal(bin.markets, 40);
  close(bin.winRate!, 0.2, 1e-12);
  assert.equal(bin.usesFit, true);
  close(nullProbability(0.12, curve), 0.2, 1e-12);
  // 5 markets only: falls back to the price itself.
  close(nullProbability(0.62, curve), 0.62, 1e-12);
});

test("event collapse: largest bet per event; neg-risk Yes legs merge into one bet", () => {
  const markets = [
    market(1, [pos("w", 0, 0.1, { c: 50 })], { event: "E", negRisk: true, yesWon: false }),
    market(2, [pos("w", 0, 0.2, { c: 30 })], { event: "E", negRisk: true, yesWon: true }),
    market(3, [pos("w", 0, 0.3, { c: 10 }), pos("x", 1, 0.4, { c: 80 })], { event: "F" }),
    market(4, [pos("x", 1, 0.5, { c: 90 })], { event: "F" }),
  ];
  const bets = collapseBets(markets, null);
  const w = bets.filter((b) => b.wallet === "w"),
    x = bets.filter((b) => b.wallet === "x");
  assert.equal(w.length, 2);
  const basket = w.find((b) => b.event === "E")!;
  close(basket.p, 0.3, 1e-12);
  assert.equal(basket.won, true);
  assert.deepEqual(basket.markets.sort(), ["m1", "m2"]);
  assert.equal(x.length, 1);
  assert.equal(x[0].markets[0], "m4");
});

test("population: a lucky longshot wallet is flagged, passes LOEO, and gets a tier", () => {
  const index = new Map<string, SpecBet[]>();
  const mk = (wallet: string, i: number, q: number, won: boolean): SpecBet => ({
    wallet,
    event: `${wallet}-${i}`,
    markets: [`${wallet}-${i}`],
    title: "t",
    group: "study",
    p: q,
    q,
    won,
    t: 0,
    cost: 20,
    profit: 0,
    z: 0,
    r: 0.1,
  });
  index.set("lucky", Array.from({ length: 12 }, (_, i) => mk("lucky", i, 0.1, i < 9)));
  for (let k = 0; k < 30; k++) index.set(`n${k}`, Array.from({ length: 8 }, (_, i) => mk(`n${k}`, i, 0.5, i % 2 === 0)));
  const pop = analyzePopulation(index);
  const lucky = pop.wallets.get("lucky")!;
  assert.equal(lucky.test1, true);
  assert.equal(lucky.loeo, true);
  assert.equal(lucky.tier, 2);
  assert.equal(pop.wallets.get("n0")!.tier, 0);
  // Coin-flip wallets can never reach significance, so the pre-filter removes them.
  assert.equal(pop.wallets.get("n0")!.tested1, false);
  assert.equal(pop.family1.m, 1);
  const a = placeboA(index, pop.family1.flagged, 5, 3);
  assert.equal(a.runs, 5);
});

test("market verdict: exact binomial against the population rate", () => {
  assert.equal(participationTest(3, 2, 0.01).verdict, "not-testable");
  const typical = participationTest(40, 1, 0.02);
  assert.equal(typical.verdict, "typical");
  const elevated = participationTest(40, 5, 0.02);
  assert.equal(elevated.verdict, "elevated");
  close(elevated.expected, 0.8, 1e-12);
  assert.ok(elevated.p! < 0.01);
});

test("Fisher exact test matches a hand-checked 2×2 table", () => {
  // [[3,1],[1,3]]: two-sided p = 0.4857
  close(fisherExact(3, 1, 1, 3), 0.4857, 1e-3);
});

test("jumps: +10 points within an hour that holds; self-impact wallets recorded; reversals rejected", () => {
  const f = (t: number, price: number, wallet = "m", size = 100): TapeFill => ({ wallet, side: "BUY", outcome: 0, price, size, timestamp: t });
  const tape = [f(0, 0.3), f(600, 0.32), f(1200, 0.45, "whale", 10000), f(3000, 0.44), f(9000, 0.43)];
  const jumps = detectJumps(tape, 0, 1e9);
  assert.equal(jumps.length, 1);
  assert.equal(jumps[0].start, 0);
  assert.deepEqual(jumps[0].heavy, ["whale"]);
  const reverting = [f(0, 0.3), f(1200, 0.45), f(2000, 0.33)];
  assert.equal(detectJumps(reverting, 0, 1e9).length, 0);
});

test("positions: net held shares, first-buy entry price, both-token holders dropped, z excludes self-impact", () => {
  const f = (wallet: string, side: "BUY" | "SELL", outcome: 0 | 1, price: number, size: number, timestamp: number): TapeFill => ({ wallet, side, outcome, price, size, timestamp });
  const fills = [
    f("early", "BUY", 0, 0.28, 100, 3600),
    f("early", "BUY", 0, 0.32, 100, 4000),
    f("hedger", "BUY", 0, 0.3, 50, 7200),
    f("hedger", "BUY", 1, 0.7, 50, 7300),
    f("seller", "BUY", 0, 0.3, 50, 7400),
    f("seller", "SELL", 0, 0.31, 50, 8000),
    f("m", "BUY", 0, 0.3, 10, 10000),
    f("whale", "BUY", 0, 0.45, 10000, 10800),
    f("m", "BUY", 0, 0.46, 10, 20000),
  ];
  const { positions, timing, jumps } = buildPositions(fills, fills, 1e9);
  assert.equal(jumps[0].length, 1);
  assert.deepEqual(jumps[0][0].heavy, ["whale"]);
  const early = positions.find((p) => p.w === "early")!;
  assert.equal(early.p, 0.28);
  close(early.v, 0.3, 1e-9);
  assert.equal(early.s, 200);
  assert.equal(early.z, 1);
  assert.ok(!positions.some((p) => p.w === "hedger" || p.w === "seller"));
  assert.ok(timing[0][0] >= 4);
  assert.equal(positions.find((p) => p.w === "whale")?.z ?? 0, 0);
});

test("index groups bets by wallet", () => {
  const bets = collapseBets([market(1, [pos("a", 0, 0.2), pos("b", 1, 0.3)])], null);
  assert.deepEqual([...indexByWallet(bets).keys()].sort(), ["a", "b"]);
});
