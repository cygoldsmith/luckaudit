import assert from "node:assert/strict";
import test from "node:test";
import { statisticalReport, aiReport } from "../src/lib/report";
import { auditWallet } from "../src/lib/analysis";
import type { WalletBundle } from "../src/lib/domain";
function bundle(time: string): WalletBundle {
  return {
    address: "0x" + "a".repeat(40),
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
    provenance: { origin: "snapshot", fetchedAt: time },
  };
}
test("statistical fallback is explicit and withholds unsupported conclusions", () => {
  const b = bundle("2026-01-01");
  const r = statisticalReport(b, auditWallet(b));
  assert.equal(r.mode, "statistical");
  assert.match(r.headline, /Too few qualifying bets/);
  assert.ok(r.limitations.some((x) => x.includes("leaderboard")));
});
test("local model uses loopback structured output without an API key", async () => {
  const original = global.fetch;
  const urls: string[] = [];
  global.fetch = async (input, init) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/api/tags"))
      return Response.json({ models: [{ name: "gemma4:test" }] });
    const payload = JSON.parse(init?.body as string);
    assert.equal(payload.stream, false);
    assert.equal(payload.think, false);
    assert.equal(payload.format.type, "object");
    return Response.json({
      message: {
        content: JSON.stringify({
          findings: [
            {
              title: "Coverage",
              text: "No eligible history supports a conclusion.",
              evidenceIds: [],
            },
          ],
          alternatives: [
            "Selection can favor successful traders.",
            "Dependence can affect the baseline.",
          ],
          limitations: [
            "The history is unavailable.",
            "No causal conclusion follows.",
          ],
        }),
      },
    });
  };
  try {
    const b = bundle("2026-01-02");
    const r = await aiReport(b, auditWallet(b));
    assert.equal(r.mode, "ai");
    assert.equal(r.model, "gemma4:test");
    assert.ok(urls.every((url) => new URL(url).hostname === "127.0.0.1"));
  } finally {
    global.fetch = original;
  }
});
test("unknown AI evidence IDs are rejected", async () => {
  const original = global.fetch;
  global.fetch = async () =>
    Response.json({
      message: {
        content: JSON.stringify({
          findings: [
            {
              title: "Unsupported",
              text: "An observation.",
              evidenceIds: ["E999"],
            },
          ],
          alternatives: ["One hypothesis.", "Another hypothesis."],
          limitations: ["Missing data.", "Uncertain model."],
        }),
      },
    });
  try {
    const b = bundle("2026-01-03");
    await assert.rejects(
      () => aiReport(b, auditWallet(b)),
      /unsupported evidence/,
    );
  } finally {
    global.fetch = original;
  }
});

test("local JSON control-character repair preserves text and never completes truncation", async () => {
  const { parseLocalJson } = await import("../src/lib/report");
  assert.deepEqual(parseLocalJson('{"text":"first\nsecond"}'), {
    text: "first\nsecond",
  });
  assert.throws(() => parseLocalJson('{"text":"unfinished'));
});
