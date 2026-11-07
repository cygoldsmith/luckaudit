import assert from "node:assert/strict";
import test from "node:test";
import {
  benjaminiHochberg,
  buildHourly,
  empiricalP,
  findBigMove,
  flowScore,
  marketTest,
  randomTimePlacebo,
  scoreRecord,
  type Fill,
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

test("Example 2: BH flags three of ten markets with the stated q-values", () => {
  const p = [0.0014, 0.003, 0.011, 0.04, 0.09, 0.2, 0.31, 0.45, 0.62, 0.8];
  const bh = benjaminiHochberg(p);
  assert.equal(bh.k, 3);
  close(bh.threshold, 0.015, 1e-12);
  assert.deepEqual(bh.rejected, [true, true, true, false, false, false, false, false, false, false]);
  const expected = [0.014, 0.015, 0.0367, 0.1, 0.18, 0.333, 0.443, 0.5625, 0.689, 0.8];
  bh.q.forEach((q, i) => close(q, expected[i], 0.001));
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

test("library volume floor: Gamma volume is read and $10k is the cutoff", async () => {
  const { metaFromGamma, meetsVolumeFloor } = await import("../src/lib/integrity/data");
  const base = {
    conditionId: "0x" + "1".repeat(64),
    clobTokenIds: '["1","2"]',
    outcomes: '["Yes","No"]',
    outcomePrices: '["1","0"]',
    closed: true,
    closedTime: "2026-10-01 12:00:00+00",
  };
  const meta = metaFromGamma({ ...base, volumeNum: 12500.5 }, { id: 7, slug: "e", tags: [{ slug: "awards" }] })!;
  assert.equal(meta.volumeUsd, 12500.5);
  assert.equal(meta.category, "awards");
  assert.equal(meta.resolution.yesWon, true);
  assert.equal(meetsVolumeFloor(meta.volumeUsd), true);
  assert.equal(meetsVolumeFloor(9999.99), false);
  assert.equal(meetsVolumeFloor(null), false);
});
