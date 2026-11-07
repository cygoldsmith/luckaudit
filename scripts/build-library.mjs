// Builds the Market Integrity reference library through the running app.
// Usage: node scripts/build-library.mjs [--discover] [--batch 3]
const base = process.env.LUCKAUDIT_URL || "http://localhost:3000";
const args = process.argv.slice(2);
const batch = Number(args[args.indexOf("--batch") + 1]) || 3;
const post = async (body) => {
  const r = await fetch(`${base}/api/integrity/library`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || `HTTP ${r.status}`);
  return json;
};
if (args.includes("--discover")) console.log("discovered", await post({ action: "discover" }));
for (;;) {
  const step = await post({ action: "step", count: batch });
  console.log(new Date().toISOString(), `+${step.processed}`, `remaining ${step.remaining}`, JSON.stringify(step.status.byCategory));
  if (!step.processed && step.remaining <= 0) break;
}
const check = await fetch(`${base}/api/integrity/method-check?refresh=1`).then((r) => r.json());
console.log("method check", JSON.stringify(check.check?.randomTime?.categories), "fake-wallet rate", check.check?.fakeWallet?.falseFlagRate);
