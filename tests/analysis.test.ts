import assert from "node:assert/strict";
import test from "node:test";
import { auditWallet } from "../src/lib/analysis";
import { calibrate } from "../src/lib/integrity/core";
import { csv } from "../src/lib/client";
import type { WalletBundle } from "../src/lib/domain";
const address = "0x" + "a".repeat(40),
  start = 1700000000;
function fixture(count = 12): WalletBundle {
  const b: WalletBundle = {
    address,
    trades: [],
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
    provenance: { origin: "live", fetchedAt: "2026-01-01T00:00:00Z" },
  };
  for (let i = 0; i < count; i++) {
    const token = String(i),
      condition = "0x" + i.toString(16).padStart(64, "0"),
      time = start + i * 100;
    const t = {
      proxy_wallet: address,
      side: "BUY",
      token_id: token,
      condition_id: condition,
      size: 100,
      price: 0.2,
      timestamp: time,
      title: `Market ${i}`,
      slug: `market-${i}`,
      event_slug: `event-${i}`,
      outcome: "Yes",
      outcome_index: 0,
      name: "Fixture",
      transaction_hash: "0x" + (i + 1).toString(16).padStart(64, "0"),
    };
    b.trades.push(t);
    b.activity.push({ ...t, type: "TRADE", usdc_size: 20 });
    b.positions.push({
      proxy_wallet: address,
      token_id: token,
      condition_id: condition,
      current_size: 100,
      avg_price: 0.2,
      entry_cost_usdc: 20,
      entry_fees_usdc: 0,
      total_size: 100,
      realized_pnl: 0,
      unrealized_pnl: 80,
      total_pnl: 80,
      status: "REDEEMABLE",
      redeemable: true,
      negative_risk: false,
      title: t.title,
      slug: t.slug,
      event_id: `event-${i}`,
      event_slug: t.event_slug,
      outcome: "Yes",
      outcome_index: 0,
      first_entry_at: time,
      last_event_at: time,
    });
    b.resolutions.push({
      condition_id: condition,
      status: "resolved",
      payouts: [1000000, 0],
      resolved_at: new Date((time + 3000) * 1000).toISOString(),
      transaction_hash: t.transaction_hash,
    });
  }
  return b;
}
const lose = (b: WalletBundle, i: number) => {
  b.resolutions[i].payouts = [0, 1000000];
};
test("rule-7 bets: one per event, all won at 20¢ is an unusual record", () => {
  const a = auditWallet(fixture());
  assert.equal(a.summary.eligible, 12);
  assert.equal(a.summary.eventGroups, 12);
  assert.equal(a.record.wins, 12);
  assert.ok(Math.abs(a.record.expected - 2.4) < 1e-9);
  assert.ok(Math.abs(a.record.p! - 0.2 ** 12) < 1e-15);
  assert.equal(a.record.label, "unusual-record");
  assert.equal(a.record.calibration, "price-only");
  assert.equal(a.record.fragile, false);
});
test("partial sales keep the net held shares; selling out is excluded", () => {
  const b = fixture(2);
  b.trades.push({ ...b.trades[0], side: "SELL", size: 40, price: 0.5, timestamp: start + 10 });
  b.trades.push({ ...b.trades[1], side: "SELL", size: 100, price: 0.5, timestamp: start + 110 });
  const a = auditWallet(b);
  assert.equal(a.bets.length, 1);
  assert.equal(a.bets[0].shares, 60);
  assert.ok(Math.abs(a.bets[0].stake - 12) < 1e-9);
  assert.match(a.reviews.find((r) => !r.eligible)!.reason, /Sold out/);
});
test("cost, price band and both-outcome holdings follow the bet rules", () => {
  const b = fixture(4);
  b.trades[0].size = 40; // $8 < $10
  b.trades[1].price = 0.6; // above 50¢
  b.trades[2].price = 0.02; // below 3¢
  b.trades[2].size = 1000;
  b.trades.push({ ...b.trades[3], outcome_index: 1, outcome: "No", token_id: "x", price: 0.8, timestamp: start + 310 });
  const reasons = auditWallet(b).reviews.map((r) => r.reason);
  assert.ok(reasons.some((r) => /Cost under/.test(r)));
  assert.equal(reasons.filter((r) => /Average price outside/.test(r)).length, 2);
  assert.ok(reasons.some((r) => /both outcomes/.test(r)));
});
test("several markets in one event keep only the largest bet", () => {
  const b = fixture(3);
  for (const t of b.trades) t.event_slug = "same";
  for (const p of b.positions) p.event_id = "same";
  b.trades[1].size = 300;
  const a = auditWallet(b);
  assert.equal(a.summary.eventGroups, 1);
  assert.equal(a.bets.find((x) => x.selected)!.condition, b.trades[1].condition_id);
});
test("losses count, fair chance uses the library bucket rate when higher", () => {
  const b = fixture(6);
  lose(b, 0);
  const cal = calibrate([
    { wallet: "w", condition: "m1", event: "e1", outcome: 0, price: 0.25, cost: 20, won: true },
    { wallet: "w", condition: "m2", event: "e2", outcome: 0, price: 0.25, cost: 20, won: false },
  ]);
  const a = auditWallet(b, cal);
  assert.equal(a.record.wins, 5);
  assert.equal(a.bets[0].probability, 0.5);
  assert.ok(Math.abs(a.record.expected - 3) < 1e-9);
  assert.equal(a.record.calibration, "library");
});
test("short records, incomplete coverage and too few bets are not tested", () => {
  assert.equal(auditWallet(fixture(3)).record.label, "too-few-bets");
  // Five 45¢ bets whose bucket won 80% of the time: winning all five has a
  // 0.8^5 = 33% chance by luck, so the record can never pass the 0.05 bar.
  const b = fixture(5);
  for (const t of b.trades) t.price = 0.45;
  const cal = calibrate([
    { wallet: "w", condition: "m1", event: "e1", outcome: 0, price: 0.45, cost: 20, won: true },
    { wallet: "w", condition: "m2", event: "e2", outcome: 0, price: 0.45, cost: 20, won: true },
    { wallet: "w", condition: "m3", event: "e3", outcome: 0, price: 0.45, cost: 20, won: true },
    { wallet: "w", condition: "m4", event: "e4", outcome: 0, price: 0.45, cost: 20, won: true },
    { wallet: "w", condition: "m5", event: "e5", outcome: 0, price: 0.45, cost: 20, won: false },
  ]);
  assert.equal(auditWallet(b, cal).record.label, "record-too-short");
  const c = fixture();
  c.coverage.trades = false;
  assert.equal(auditWallet(c).record.label, "incomplete-history");
});
test("trades after resolution and unresolved markets are excluded", () => {
  const b = fixture(2);
  b.resolutions[0].status = "proposed";
  b.trades[1].timestamp = start + 100000;
  const a = auditWallet(b);
  assert.equal(a.bets.length, 0);
});
test("exact win distribution sums to one and matches the p-value", () => {
  const a = auditWallet(fixture(8));
  const r = a.record;
  assert.ok(Math.abs(r.pmf.reduce((x, y) => x + y, 0) - 1) < 1e-12);
  assert.ok(Math.abs(r.pmf.slice(r.wins).reduce((x, y) => x + y, 0) - r.p!) < 1e-15);
});
test("CSV escapes quotes and spreadsheet formulas while preserving numeric losses", () => {
  assert.equal(
    csv([['=FORMULA("x")', -2, null]]),
    '"\'=FORMULA(""x"")","-2",""',
  );
});
test("recorded real-wallet snapshot supports a reproducible record test", async () => {
  const { readFile } = await import("node:fs/promises");
  const { gunzipSync } = await import("node:zlib");
  const bundle = JSON.parse(
    gunzipSync(
      await readFile(
        "src/data/snapshots/wallet-0x549b491ac7f6a675b56ff0a261d147daa73ac0ae.json.gz",
      ),
    ).toString(),
  ) as WalletBundle;
  const a = auditWallet(bundle),
    b = auditWallet(bundle);
  assert.equal(bundle.provenance.origin, "live");
  assert.deepEqual(a.record, b.record);
  assert.ok(a.record.observations > 0);
  assert.ok(["unusual-record", "nothing-unusual", "record-too-short", "too-few-bets"].includes(a.record.label));
});
