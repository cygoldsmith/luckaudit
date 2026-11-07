import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const origin = process.env.LUCKAUDIT_URL || "http://127.0.0.1:3001";
const target = new URL(origin);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
  throw new Error("Use a local LuckAudit server.");
const folder = new URL("../src/data/snapshots/", import.meta.url);
await mkdir(folder, { recursive: true });
async function get(path) {
  const r = await fetch(new URL(path, origin), {
    signal: AbortSignal.timeout(180000),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || r.status);
  return data;
}
const marketFolder = new URL("markets/", folder);
await mkdir(marketFolder, { recursive: true });
async function recordMarket(key, data) {
  if (data.provenance.origin !== "live")
    throw new Error("A live market retrieval is required.");
  const file = createHash("sha256").update(key).digest("hex");
  await writeFile(
    new URL(`${file}.json.gz`, marketFolder),
    gzipSync(JSON.stringify(data)),
  );
}
await recordMarket(
  "catalogue:active:",
  await get("/api/markets?state=active&refresh=1"),
);
const condition =
  "0x9db8905bffc0df478b336591504245614c631976329df65efd7609f32167a693";
await recordMarket(
  `market:${condition}`,
  (await get(`/api/market/${condition}?refresh=1`)).bundle,
);
const board = await get("/api/leaderboard?period=month&refresh=1");
if (board.provenance.origin !== "live")
  throw new Error("A live leaderboard is required to update the recording.");
await writeFile(
  new URL("board-month-overall-PNL.json", folder),
  JSON.stringify(board),
);
for (const address of [
  "0x549b491ac7f6a675b56ff0a261d147daa73ac0ae",
  "0x4f1d5ae26fc31472966e951af3183308736d8de2",
]) {
  const data = await get(`/api/wallet/${address}?refresh=1`);
  if (data.bundle.provenance.origin !== "live")
    throw new Error("A live wallet retrieval is required.");
  await writeFile(
    new URL(`wallet-${address}.json.gz`, folder),
    gzipSync(JSON.stringify(data.bundle)),
  );
  console.log(`Saved ${address}: ${data.bundle.provenance.fetchedAt}`);
}
console.log("Saved public-data snapshots.");
