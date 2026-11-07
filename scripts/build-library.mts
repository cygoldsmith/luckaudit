// Builds the reference library directly (no dev server), so the build and the
// app never compete for memory. Resumable: stop any time and run it again.
//   npm run library              build the remaining markets
//   npm run library -- --discover  re-discover candidates first
import { buildLibraryStep, discoverLibrary, methodCheck } from "../src/lib/integrity/data.ts";

const args = process.argv.slice(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mb = () => Math.round(process.memoryUsage().heapUsed / 1048576);

if (args.includes("--discover")) console.log("discovered", await discoverLibrary());

let backoff = 60_000,
  errors = 0;
for (;;) {
  try {
    const step = await buildLibraryStep(1);
    backoff = 60_000;
    errors = 0;
    const s = step.status;
    if (s.built % 10 === 0 || !step.remaining)
      console.log(new Date().toISOString(), `built ${s.built}/${s.candidates}`, `failed ${s.failed}`, `remaining ${step.remaining}`, `heap ${mb()}MB`);
    if (!step.processed && step.remaining <= 0) break;
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 429 || status === 503) {
      console.log(new Date().toISOString(), `paused (${status}); retrying in ${backoff / 1000}s`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 15 * 60_000);
      continue;
    }
    if (++errors > 10) throw e;
    console.log(new Date().toISOString(), `error: ${e instanceof Error ? e.message : e}; retry ${errors}/10`);
    await sleep(15_000);
  }
}
console.log(new Date().toISOString(), "library complete; computing validation…");
const check = await methodCheck(true);
console.log(
  "validation",
  JSON.stringify({
    tested: check.population.tested,
    flagged: check.population.family1.flagged,
    primary: check.population.primary,
    fdr: check.placeboA.fdr,
  }),
);
