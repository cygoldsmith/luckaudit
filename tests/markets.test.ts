import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMarket, primaryMarkets } from "../src/lib/market-analysis";
import {
  normalizeMarket,
  parseMarketQuery,
  numeric,
} from "../src/lib/market-normalize";
import {
  adjustPValues,
  exactTail,
  oddsMultiplier,
  poissonBinomial,
} from "../src/lib/statistical-core";
import { runValidation } from "../src/lib/validation";
import type { MarketBundle, MarketInfo } from "../src/lib/market-types";
import type { Trade, WalletBundle } from "../src/lib/domain";
const condition = "0x" + "a".repeat(64),
  wallet = "0x" + "b".repeat(40),
  other = "0x" + "c".repeat(40),
  start = 1700000000;
const market: MarketInfo = {
  id: "1",
  condition,
  title: "Fixture market",
  slug: "fixture",
  eventSlug: "fixture-event",
  eventTitle: "Fixture event",
  tags: [],
  description: "",
  active: true,
  closed: false,
  endTime: null,
  volumeUsd: null,
  liquidityUsd: null,
  outcomes: [
    { label: "Yes", token: "yes", price: null },
    { label: "No", token: "no", price: null },
  ],
  metadataAvailable: true,
};
function trade(at: number, price: number, owner = other, size = 10): Trade {
  return {
    proxy_wallet: owner,
    side: "BUY",
    token_id: "yes",
    condition_id: condition,
    size,
    price,
    timestamp: start + at,
    title: "Fixture market",
    slug: "fixture",
    event_slug: "fixture-event",
    outcome: "Yes",
    outcome_index: 0,
    name: "",
    transaction_hash: "0x" + "d".repeat(64),
  };
}
function fixture(): MarketBundle {
  const trades = [
    trade(-3600, 0.5, wallet),
    trade(0, 0.3),
    trade(1800, 0.42),
    ...[3000, 4200, 5400, 6600, 7800, 9000].map((at) => trade(at, 0.4)),
  ];
  return {
    market: structuredClone(market),
    tape: {
      trades: [...trades].reverse(),
      positions: [],
      resolutions: [],
      coverage: {
        trades: true,
        holdings: true,
        resolutions: true,
        warnings: [],
      },
    },
    provenance: { origin: "live", fetchedAt: "2026-11-07T00:00:00Z" },
  };
}
test("market parsing accepts links and rejects external destinations", () => {
  assert.deepEqual(
    parseMarketQuery(
      "https://polymarket.com/event/event-name/market-name?ref=x",
    ),
    { kind: "event", slug: "event-name", child: "market-name" },
  );
  assert.deepEqual(parseMarketQuery(condition), {
    kind: "condition",
    condition,
  });
  assert.throws(() => parseMarketQuery("https://example.com/event/abc"));
  assert.throws(() =>
    parseMarketQuery("https://polymarket.com/profile/wallet"),
  );
  assert.throws(() => parseMarketQuery("a".repeat(301)));
});
test("Gamma normalization keeps missing numbers unavailable", () => {
  const raw = {
    id: "1",
    conditionId: condition,
    question: "Question",
    outcomes: '["Yes","No"]',
    outcomePrices: '["0.4",null]',
    clobTokenIds: '["yes","no"]',
    volume: "",
    active: true,
    closed: false,
  };
  const m = normalizeMarket(raw);
  assert.equal(m?.volumeUsd, null);
  assert.equal(m?.outcomes[1].price, null);
  assert.equal(m?.outcomes[0].price, 0.4);
  assert.equal(numeric(false), null);
  assert.equal(
    normalizeMarket({ ...raw, outcomes: '["one","two","three"]' }),
    null,
  );
});
test("market activity conserves observed turnover and participant shares", () => {
  const b = fixture(),
    a = analyzeMarket(b);
  assert.equal(a.summary.fills, b.tape.trades.length);
  assert.ok(
    Math.abs(
      a.summary.observedNotional -
        b.tape.trades.reduce((s, t) => s + t.price * t.size, 0),
    ) < 1e-8,
  );
  assert.ok(
    Math.abs(a.participants.reduce((s, p) => s + p.turnoverShare, 0) - 1) <
      1e-12,
  );
  assert.equal(a.summary.topFiveShare, 1);
  assert.equal(a.summary.heldShares, null);
});
test("partial coverage is carried through to the evidence report", () => {
  const b = fixture();
  b.tape.coverage.trades = false;
  b.tape.coverage.warnings = ["Incomplete tape"];
  const a = analyzeMarket(b);
  assert.ok(a.signals.find((s) => s.id === "M2")?.text.includes("incomplete"));
  assert.ok(a.limitations.includes("Incomplete tape"));
});
test("wallet primary markets rank turnover without calling it invested capital", () => {
  const b: WalletBundle = {
    address: wallet,
    trades: [
      trade(0, 0.2, wallet, 100),
      { ...trade(1, 0.8, wallet, 50), side: "SELL" },
      { ...trade(2, 0.5, wallet, 10), condition_id: "0x" + "e".repeat(64) },
    ],
    activity: [],
    positions: [],
    resolutions: [],
    pnl: [],
    stats: null,
    coverage: {
      trades: true,
      activity: true,
      positions: true,
      resolutions: true,
      warnings: [],
    },
    provenance: { origin: "snapshot", fetchedAt: "2026-01-01" },
  };
  const rows = primaryMarkets(b);
  assert.equal(rows[0].turnover, 60);
  assert.equal(rows[0].buyNotional, 20);
  assert.equal(rows[0].realizedPnl, null);
  assert.equal(rows[0].heldShares, null);
  assert.equal(rows[0].fills, 2);
});
test("exact Poisson-binomial probabilities handle edge cases and reference tail", () => {
  assert.deepEqual(poissonBinomial([]), [1]);
  assert.deepEqual(poissonBinomial([0, 1]), [0, 1, 0]);
  assert.equal(exactTail([0.5, 0.5], 0), 1);
  const q = [0.08, 0.12, 0.1, 0.15, 0.3, 0.45, 0.2, 0.1, 0.25, 0.12],
    pmf = poissonBinomial(q);
  assert.ok(Math.abs(exactTail(pmf, 8) - 0.000019267416) < 1e-14);
  assert.ok(Math.abs(pmf.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(Math.abs(oddsMultiplier(q, 8)! - 22.74535376354) < 1e-8);
  assert.equal(oddsMultiplier(q, 10), Infinity);
  assert.equal(oddsMultiplier(q, 0), 0);
  assert.throws(() => poissonBinomial([NaN]));
  assert.throws(() => poissonBinomial([1.1]));
});
test("BH and BY return values in original order with reference corrections", () => {
  const values = [0.8, 0.04, 0.001, 0.02],
    bh = adjustPValues(values),
    by = adjustPValues(values, "BY");
  assert.deepEqual(bh, [0.8, 0.05333333333333334, 0.004, 0.04]);
  assert.ok(by.every((p, i) => p >= bh[i]));
  assert.equal(by.filter((p) => p <= 0.05).length, 1);
  assert.equal(bh.filter((p) => p <= 0.05).length, 2);
  assert.deepEqual(adjustPValues([]), []);
  assert.throws(() => adjustPValues([-1]));
});
test("validation uses known labels, reproducible seed and explicit scope", () => {
  const a = runValidation(),
    b = runValidation();
  assert.ok(a.checks.every((c) => c.passed));
  assert.deepEqual(a.power, b.power);
  assert.deepEqual(a.mixture, b.mixture);
  assert.ok(
    a.power.every((row) => row.total === 6000 && row.detected <= row.total),
  );
  // Five-bet wallets can never clear 0.05 ÷ m in a group this large: the
  // method's pre-filter labels them "record too short to test".
  assert.ok(a.power.filter((r) => r.positions === 5).every((r) => r.detected === 0));
  for (const n of [10, 20, 50])
    assert.ok(
      a.power.find((r) => r.positions === n && r.oddsRatio === 4)!.recall >
        a.power.find((r) => r.positions === n && r.oddsRatio === 2)!.recall,
    );
  assert.equal(
    a.allNull.histogram.reduce((s, n) => s + n, 0),
    30000,
  );
  assert.match(a.scope, /placebo tests on the reference library/);
  assert.ok(a.notRun.some((t) => t.includes("Random-time placebo")));
  assert.ok(a.checks.every((c) => c.passed));
  assert.ok(a.marketTest.nullShare <= 0.1, `null share ${a.marketTest.nullShare}`);
  assert.ok(a.mixture.meanFdp <= 0.05 + 2 * a.mixture.standardError);
});
test("invalid quote values remain unavailable", () => {
  const m = normalizeMarket({
    conditionId: condition,
    question: "Question",
    outcomes: '["Yes","No"]',
    outcomePrices: '["1.2","-0.1"]',
  });
  assert.deepEqual(
    m?.outcomes.map((o) => o.price),
    [null, null],
  );
});
test("empty activity does not become a fairness or concentration finding", () => {
  const b = fixture();
  b.tape.trades = [];
  const a = analyzeMarket(b);
  assert.equal(a.summary.topFiveShare, null);
  assert.equal(a.summary.hhi, null);
  assert.equal(a.participants.length, 0);
  assert.ok(a.signals[0].text.includes("No valid"));
});

test("links parse with or without a scheme, on polymarket.com and polymarket.us", () => {
  assert.deepEqual(parseMarketQuery("polymarket.com/event/fed-decision"), { kind: "event", slug: "fed-decision", child: undefined });
  assert.deepEqual(parseMarketQuery("www.polymarket.com/market/some-market?tid=1"), { kind: "market", slug: "some-market", child: undefined });
  assert.deepEqual(parseMarketQuery("polymarket.us/event/usp-2028-11-07"), { kind: "us-event", slug: "usp-2028-11-07", path: "/event/usp-2028-11-07" });
  assert.deepEqual(parseMarketQuery("https://polymarket.us/sports/cfb/cfb-ore-ohiost-2026-11-07"), {
    kind: "us-event",
    slug: "cfb-ore-ohiost-2026-11-07",
    path: "/sports/cfb/cfb-ore-ohiost-2026-11-07",
  });
  assert.deepEqual(parseMarketQuery("https://polymarket.com/sports/nfl/nfl-buf-kc-2026-11-08"), { kind: "event", slug: "nfl-buf-kc-2026-11-08", child: undefined });
  assert.equal(parseMarketQuery("polymarket odds").kind, "text");
});

test("wallet lookup accepts addresses, @usernames and profile links, not market links", async () => {
  const { parseWalletQuery } = await import("../src/lib/wallet-lookup");
  const a = "0x9d84ce0306f8551e02efef1680475fc0f1dc1344";
  assert.deepEqual(parseWalletQuery(a.toUpperCase().replace("0X", "0x")), { kind: "address", address: a });
  assert.deepEqual(parseWalletQuery(`https://polymarket.com/profile/${a}`), { kind: "address", address: a });
  assert.deepEqual(parseWalletQuery(`polymarket.com/profile/${a}?tab=activity`), { kind: "address", address: a });
  assert.deepEqual(parseWalletQuery("https://polymarket.com/@ImJustKen"), { kind: "username", name: "ImJustKen" });
  assert.deepEqual(parseWalletQuery("@ImJustKen"), { kind: "username", name: "ImJustKen" });
  assert.equal(parseWalletQuery("https://polymarket.com/event/fed-decision"), null);
  assert.equal(parseWalletQuery("polymarket.us/sports/cfb/cfb-ore-ohiost-2026-11-07"), null);
  assert.equal(parseWalletQuery("Fed rates"), null);
});
