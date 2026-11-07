// Builds the Market Integrity reference library through the running app.
// Usage: node scripts/build-library.mjs [--discover] [--batch 1]
// Resumable: stop it any time and run it again to continue.
const base = process.env.LUCKAUDIT_URL || "http://localhost:3000";
const args = process.argv.slice(2);
const batch = Number(args[args.indexOf("--batch") + 1]) || 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (body) => {
  const r = await fetch(`${base}/api/integrity/library`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({ error: `non-JSON response (HTTP ${r.status})` }));
  if (!r.ok || json.error) throw Object.assign(new Error(json.error || `HTTP ${r.status}`), { status: r.ok ? 502 : Math.max(r.status, 500) });
  return json;
};
if (args.includes("--discover")) console.log("discovered", await post({ action: "discover" }));
let backoff = 60_000,
  serverErrors = 0;
for (;;) {
  let step;
  try {
    step = await post({ action: "step", count: batch });
    backoff = 60_000;
    serverErrors = 0;
  } catch (e) {
    if ([429, 503].includes(e.status) || e.cause) {
      console.log(new Date().toISOString(), `paused: ${e.message}; retrying in ${backoff / 1000}s`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 15 * 60_000);
      continue;
    }
    // Steps are idempotent, so a transient server error (e.g. a locked file) is retried.
    if (e.status >= 500 && ++serverErrors <= 10) {
      console.log(new Date().toISOString(), `server error: ${e.message}; retry ${serverErrors}/10 in 15s`);
      await sleep(15_000);
      continue;
    }
    throw e;
  }
  const s = step.status;
  console.log(
    new Date().toISOString(),
    `built ${s.built}/${s.candidates}`,
    `failed ${s.failed}`,
    `remaining ${step.remaining}`,
  );
  if (!step.processed && step.remaining <= 0) break;
}
const check = await fetch(`${base}/api/integrity/method-check?refresh=1`).then((r) => r.json());
console.log("method check", JSON.stringify(check.check?.randomTime?.categories), "fake-wallet rate", check.check?.fakeWallet?.falseFlagRate);
