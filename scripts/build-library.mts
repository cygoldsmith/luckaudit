// Builds the reference library directly (no dev server), several markets at a
// time. Pages within one market must stay sequential (cursor paging), but
// different markets are independent. Resumable: stop any time and rerun.
//   npm run library                 build the remaining markets
//   npm run library -- --discover   re-discover candidates first
//   npm run library -- --workers 6  change parallelism (default 4)
import {
  buildLibraryMarket,
  discoverLibrary,
  libraryTodo,
  methodCheck,
  recordLibraryFailures,
} from "../src/lib/integrity/data.ts";

const args = process.argv.slice(2);
const workers = Math.max(1, Number(args[args.indexOf("--workers") + 1]) || 4);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mb = () => Math.round(process.memoryUsage().heapUsed / 1048576);

if (args.includes("--discover")) console.log("discovered", await discoverLibrary());

const start = await libraryTodo();
const queue = [...start.todo];
let built = start.built,
  failedCount = start.failed,
  pausedUntil = 0,
  backoff = 60_000;
const failures: Record<string, string> = {};
console.log(new Date().toISOString(), `resuming: ${built} built, ${queue.length} to go, ${workers} workers`);

async function flushFailures() {
  const batch = { ...failures };
  for (const k of Object.keys(batch)) delete failures[k];
  await recordLibraryFailures(batch);
}

async function worker(id: number) {
  for (;;) {
    // All workers wait out a rate-limit pause together.
    if (Date.now() < pausedUntil) {
      await sleep(pausedUntil - Date.now());
      continue;
    }
    const c = queue.shift();
    if (!c) return;
    try {
      await buildLibraryMarket(c);
      built++;
      backoff = 60_000;
      if (built % 25 === 0)
        console.log(
          new Date().toISOString(),
          `built ${built}/${start.candidates}`,
          `failed ${failedCount}`,
          `remaining ${queue.length}`,
          `heap ${mb()}MB`,
        );
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 429 || status === 503) {
        queue.unshift(c); // retry later, never drop it
        if (Date.now() >= pausedUntil) {
          pausedUntil = Date.now() + backoff;
          console.log(new Date().toISOString(), `worker ${id}: rate limited; all workers pause ${backoff / 1000}s`);
          backoff = Math.min(backoff * 2, 15 * 60_000);
        }
        continue;
      }
      failures[c.condition] = e instanceof Error ? e.message : String(e);
      failedCount++;
      if (Object.keys(failures).length >= 10) await flushFailures();
    }
  }
}

await Promise.all(Array.from({ length: workers }, (_, i) => worker(i + 1)));
await flushFailures();
console.log(new Date().toISOString(), `library complete: ${built} built, ${failedCount} failed; computing validation…`);
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
