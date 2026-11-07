import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import type {
  Activity,
  Board,
  Page,
  Period,
  PnlPoint,
  Position,
  Resolution,
  Trade,
  UserStats,
  WalletBundle,
} from "./domain";
import { isAddress } from "./domain";
import type { MarketTape } from "./market-types";

const BASE = "https://data-api.polymarket.com/v2";
const nullableNumber = z
  .number()
  .finite()
  .nullish()
  .transform((value) => value ?? null);
const tradeSchema = z.object({
  proxy_wallet: z.string(),
  side: z.string(),
  token_id: z.string(),
  condition_id: z.string(),
  size: z.number().finite(),
  price: z.number().finite(),
  timestamp: z.number().finite(),
  title: z.string(),
  slug: z.string(),
  event_slug: z.string(),
  outcome: z.string(),
  outcome_index: z.number(),
  name: z.string(),
  transaction_hash: z.string(),
});
const activitySchema = tradeSchema.extend({
  type: z.string(),
  usdc_size: z.number().finite(),
  is_combo: z.boolean().optional(),
});
const positionSchema = z.object({
  proxy_wallet: z.string(),
  token_id: z.string(),
  condition_id: z.string(),
  current_size: nullableNumber,
  avg_price: nullableNumber,
  entry_cost_usdc: nullableNumber,
  entry_fees_usdc: nullableNumber,
  total_size: nullableNumber,
  realized_pnl: nullableNumber,
  unrealized_pnl: nullableNumber,
  total_pnl: nullableNumber,
  status: z.string(),
  redeemable: z.boolean(),
  negative_risk: z.boolean(),
  title: z.string(),
  slug: z.string(),
  event_id: z.string(),
  event_slug: z.string(),
  outcome: z.string(),
  outcome_index: z.number(),
  first_entry_at: z.number(),
  last_event_at: z.number(),
});
const resolutionSchema = z.object({
  condition_id: z.string().nullish(),
  status: z.string(),
  payouts: z.array(z.number()).nullish(),
  resolved_at: z.string().nullish(),
  transaction_hash: z.string(),
});
const pnlSchema = z.object({
  timestamp: z.number(),
  trade_pnl: nullableNumber,
  realized_pnl: nullableNumber,
  economic_pnl: nullableNumber,
});
const statsSchema = z.object({
  proxy_wallet: z.string(),
  trades: z.number(),
  biggest_win: z.number(),
  join_date: nullableNumber,
  all_time_pnl: z
    .object({ realized_pnl: nullableNumber, economic_pnl: nullableNumber })
    .nullish(),
});
const leaderboardSchema = z.object({
  rank: z.number(),
  user_id: z.string().regex(/^0x[\da-f]{40}$/i),
  pnl: nullableNumber,
  volume: nullableNumber,
  user_name: z.string(),
  verified: z.boolean(),
});
const paginationSchema = z.object({
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});
const cacheRoot = path.join(process.cwd(), ".luckaudit-cache");
const snapshotRoot = path.join(process.cwd(), "src/data/snapshots");
const memory = new Map<string, { time: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
export class DataError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}
const cacheFile = (key: string) =>
  `${createHash("sha256").update(key).digest("hex")}.json`;

async function remember<T>(key: string, value: T) {
  if (memory.size > 12) memory.delete(memory.keys().next().value!);
  memory.set(key, { time: Date.now(), value });
  try {
    await mkdir(cacheRoot, { recursive: true });
    const file = path.join(cacheRoot, cacheFile(key));
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, JSON.stringify(value));
    await rename(temp, file);
  } catch {
    /* Read-only hosts retain the in-memory cache. */
  }
  return value;
}
async function fallback<T>(key: string): Promise<T | null> {
  const hit = memory.get(key);
  if (hit) return hit.value as T;
  try {
    return JSON.parse(
      await readFile(
        /* turbopackIgnore: true */ path.join(cacheRoot, cacheFile(key)),
        "utf8",
      ),
    ) as T;
  } catch {
    /* Runtime cache may be absent. */
  }
  try {
    return JSON.parse(
      await readFile(path.join(snapshotRoot, `${key}.json`), "utf8"),
    ) as T;
  } catch {
    /* Try the compressed recording. */
  }
  try {
    const bytes = await readFile(path.join(snapshotRoot, `${key}.json.gz`));
    return JSON.parse(
      gunzipSync(bytes, { maxOutputLength: 40000000 }).toString("utf8"),
    ) as T;
  } catch {
    /* No recorded data exists for this query. */
  }
  return null;
}
async function singleFlight<T>(
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const running = pending.get(key);
  if (running) return running as Promise<T>;
  const task = work();
  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}

async function remote<T>(
  endpoint: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<T> {
  const url = new URL(`${BASE}/${endpoint}`);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
        headers: { Accept: "application/json" },
      });
    } catch {
      throw new DataError(
        "Polymarket is unreachable or timed out. Try again or use a saved snapshot.",
        503,
      );
    }
    if (!response.ok) {
      if (attempt === 0 && [429, 503].includes(response.status)) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        continue;
      }
      throw new DataError(
        response.status === 429
          ? "Polymarket is rate limiting requests. Try again shortly."
          : `Polymarket returned HTTP ${response.status}.`,
        response.status === 429 ? 429 : 502,
      );
    }
    const result = schema.safeParse(await response.json());
    if (!result.success)
      throw new DataError(
        "Polymarket returned an unexpected data format. No statistics were inferred from it.",
      );
    return result.data;
  }
  throw new DataError("Polymarket request failed.");
}

async function walk<T>(
  endpoint: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
  maxPages: number,
): Promise<{ rows: T[]; complete: boolean; warning?: string }> {
  const envelope = z.object({
    data: z.array(schema),
    pagination: paginationSchema,
  });
  const rows: T[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  for (let i = 0; i < maxPages; i++) {
    let page: Page<T>;
    try {
      page = await remote(
        endpoint,
        { ...params, limit: "1000", ...(cursor ? { cursor } : {}) },
        envelope,
      );
    } catch (error) {
      if (!rows.length) throw error;
      return {
        rows,
        complete: false,
        warning: `${endpoint}: retrieval stopped after ${rows.length} records.`,
      };
    }
    rows.push(...page.data);
    if (!page.pagination?.has_more) return { rows, complete: true };
    const next = page.pagination.next_cursor;
    if (!next || seen.has(next))
      return {
        rows,
        complete: false,
        warning: `${endpoint}: missing or repeated pagination cursor.`,
      };
    cursor = next;
    seen.add(next);
  }
  return {
    rows,
    complete: false,
    warning: `${endpoint}: safety limit reached (${rows.length} records).`,
  };
}

export async function getLeaderboard(options: {
  period: Period;
  category: string;
  order: "PNL" | "VOLUME";
  cursor?: string;
  refresh?: boolean;
  snapshot?: boolean;
}): Promise<Board> {
  const key = `board-${options.period}-${options.category}-${options.order}${options.cursor ? `-${cacheFile(options.cursor).slice(0, 12)}` : ""}`;
  const cached = memory.get(key);
  if (
    !options.snapshot &&
    !options.refresh &&
    cached &&
    Date.now() - cached.time < 60000
  )
    return {
      ...(cached.value as Board),
      provenance: { ...(cached.value as Board).provenance, origin: "cache" },
    };
  return singleFlight(
    `${key}:${options.snapshot ? "snapshot" : "live"}`,
    async () => {
      try {
        if (options.snapshot)
          throw new DataError(
            "No saved snapshot is available for these leaderboard filters yet.",
            404,
          );
        const page = await remote(
          "leaderboard",
          {
            time_period: options.period,
            category: options.category,
            sort_by: options.order,
            limit: "50",
            ...(options.cursor ? { cursor: options.cursor } : {}),
          },
          z.object({
            data: z.array(leaderboardSchema),
            pagination: paginationSchema,
          }),
        );
        return await remember(key, {
          traders: page.data.map((row) => ({
            address: row.user_id.toLowerCase(),
            name: row.user_name || row.user_id,
            rank: row.rank,
            pnl: row.pnl,
            volume: row.volume,
            verified: row.verified,
          })),
          period: options.period,
          category: options.category,
          order: options.order,
          nextCursor: page.pagination?.next_cursor || null,
          provenance: {
            origin: "live" as const,
            fetchedAt: new Date().toISOString(),
          },
        });
      } catch (error) {
        const saved = await fallback<Board>(key);
        if (saved)
          return {
            ...saved,
            provenance: {
              ...saved.provenance,
              origin: "snapshot",
              warning: options.snapshot
                ? "Saved public-data snapshot; not a live refresh."
                : "Live leaderboard unavailable. Showing the saved data timestamp below.",
            },
          };
        throw error;
      }
    },
  );
}

export async function getWallet(
  address: string,
  {
    refresh = false,
    snapshot = false,
  }: { refresh?: boolean; snapshot?: boolean } = {},
): Promise<WalletBundle> {
  if (!isAddress(address))
    throw new DataError("Enter a valid 0x wallet address.", 400);
  address = address.toLowerCase();
  const key = `wallet-${address}`,
    cached = memory.get(key);
  if (!snapshot && !refresh && cached && Date.now() - cached.time < 300000)
    return {
      ...(cached.value as WalletBundle),
      provenance: {
        ...(cached.value as WalletBundle).provenance,
        origin: "cache",
      },
    };
  return singleFlight(`${key}:${snapshot ? "snapshot" : "live"}`, async () => {
    try {
      if (snapshot)
        throw new DataError(
          "No saved snapshot is available for this wallet yet.",
          404,
        );
      const [
        tradesResult,
        activityResult,
        closedResult,
        openResult,
        pnlResult,
        statsResult,
      ] = await Promise.allSettled([
        walk<Trade>(
          "trades",
          { user: address, start: "1", taker_only: "false" },
          tradeSchema,
          10,
        ),
        walk<Activity>(
          "activity",
          { user: address, start: "1" },
          activitySchema,
          10,
        ),
        walk<Position>(
          "positions",
          { user: address, status: "CLOSED", sort_by: "TIMESTAMP" },
          positionSchema,
          3,
        ),
        walk<Position>(
          "positions",
          { user: address, status: "OPEN", include_archived: "true" },
          positionSchema,
          2,
        ),
        remote(
          "user-pnl",
          { user: address, interval: "all", fidelity: "1d" },
          z.object({
            data: z.object({ points: z.array(pnlSchema) }).nullable(),
          }),
        ),
        remote(
          "user-stats",
          { user: address },
          z.object({ data: statsSchema.nullable() }),
        ),
      ]);
      if (tradesResult.status === "rejected") throw tradesResult.reason;
      if (
        closedResult.status === "rejected" &&
        openResult.status === "rejected"
      )
        throw closedResult.reason;
      const trades = tradesResult.value;
      const warnings: string[] = [];
      for (const [name, result] of [
        ["Trade history", tradesResult],
        ["Activity", activityResult],
        ["Closed positions", closedResult],
        ["Open positions", openResult],
        ["Profit history", pnlResult],
        ["Profile stats", statsResult],
      ] as const) {
        if (result.status === "rejected") warnings.push(`${name} unavailable.`);
        else if ("complete" in result.value && !result.value.complete)
          warnings.push(result.value.warning || `${name} incomplete.`);
      }
      const positions = [
        ...new Map(
          [
            ...(closedResult.status === "fulfilled"
              ? closedResult.value.rows
              : []),
            ...(openResult.status === "fulfilled" ? openResult.value.rows : []),
          ].map((p) => [p.token_id, p]),
        ).values(),
      ];
      const allConditions = [
        ...new Set(
          positions
            .map((p) => p.condition_id)
            .filter((id) => /^0x[\da-f]{64}$/i.test(id)),
        ),
      ];
      const conditions = allConditions.slice(0, 240);
      const resolutions: Resolution[] = [];
      let resolutionsComplete = allConditions.length <= 240;
      if (!resolutionsComplete)
        warnings.push(
          "Resolution lookup limited to 240 markets; coverage is incomplete.",
        );
      for (let start = 0; start < conditions.length; start += 80) {
        const batches = [];
        for (
          let i = start;
          i < Math.min(start + 80, conditions.length);
          i += 20
        )
          batches.push(conditions.slice(i, i + 20));
        const results = await Promise.allSettled(
          batches.map((batch) =>
            remote(
              "resolutions",
              { condition: batch.join(",") },
              z.object({ data: z.array(resolutionSchema) }),
            ),
          ),
        );
        for (const result of results)
          if (result.status === "fulfilled")
            resolutions.push(...result.value.data);
          else {
            resolutionsComplete = false;
            warnings.push(
              "A resolution lookup failed; affected positions were excluded.",
            );
          }
      }
      const bundle: WalletBundle = {
        address,
        trades: trades.rows,
        activity:
          activityResult.status === "fulfilled"
            ? activityResult.value.rows
            : [],
        positions,
        resolutions,
        pnl:
          pnlResult.status === "fulfilled"
            ? pnlResult.value.data?.points || []
            : [],
        stats:
          statsResult.status === "fulfilled" ? statsResult.value.data : null,
        coverage: {
          trades: trades.complete,
          activity:
            activityResult.status === "fulfilled" &&
            activityResult.value.complete,
          positions:
            closedResult.status === "fulfilled" &&
            openResult.status === "fulfilled" &&
            closedResult.value.complete &&
            openResult.value.complete,
          resolutions: resolutionsComplete,
          warnings: [...new Set(warnings)],
        },
        provenance: { origin: "live", fetchedAt: new Date().toISOString() },
      };
      return remember(key, bundle);
    } catch (error) {
      const saved = await fallback<WalletBundle>(key);
      if (saved)
        return {
          ...saved,
          provenance: {
            ...saved.provenance,
            origin: "snapshot",
            warning: snapshot
              ? "Saved public-data snapshot; not live trading data."
              : "Live wallet retrieval failed. Showing the saved snapshot.",
          },
        };
      throw error;
    }
  });
}

export async function fetchConditionRecords(
  condition: string,
): Promise<MarketTape> {
  if (!/^0x[\da-f]{64}$/i.test(condition))
    throw new DataError("Invalid market condition ID.", 400);
  const [trades, holdings, resolutions] = await Promise.allSettled([
    walk<Trade>("trades", { condition, taker_only: "false" }, tradeSchema, 10),
    walk<Position>(
      "positions",
      { condition, status: "OPEN" },
      positionSchema,
      3,
    ),
    remote(
      "resolutions",
      { condition },
      z.object({ data: z.array(resolutionSchema) }),
    ),
  ]);
  if (trades.status === "rejected") throw trades.reason;
  const warnings: string[] = [];
  if (!trades.value.complete)
    warnings.push(trades.value.warning || "Trade tape is incomplete.");
  if (holdings.status === "rejected")
    warnings.push("Open holdings were unavailable.");
  else if (!holdings.value.complete)
    warnings.push("Open holdings reached the retrieval limit.");
  if (resolutions.status === "rejected")
    warnings.push("Resolution metadata was unavailable.");
  return {
    trades: trades.value.rows,
    positions: holdings.status === "fulfilled" ? holdings.value.rows : [],
    resolutions:
      resolutions.status === "fulfilled" ? resolutions.value.data : [],
    coverage: {
      trades: trades.value.complete,
      holdings: holdings.status === "fulfilled" && holdings.value.complete,
      resolutions: resolutions.status === "fulfilled",
      warnings,
    },
  };
}

/** Every fill for one market. takerOnly=true serves each fill once, on its taker (aggressor) side. */
export async function fetchFills(
  condition: string,
  takerOnly: boolean,
  maxPages: number,
): Promise<{ rows: Trade[]; complete: boolean; warning?: string }> {
  if (!/^0x[\da-f]{64}$/i.test(condition))
    throw new DataError("Invalid market condition ID.", 400);
  return walk<Trade>(
    "trades",
    { condition, taker_only: takerOnly ? "true" : "false" },
    tradeSchema,
    maxPages,
  );
}
