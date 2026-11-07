import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { DataError, fetchConditionRecords } from "./polymarket";
import {
  isCondition,
  normalizeMarket,
  object,
  parseMarketQuery,
} from "./market-normalize";
import type { MarketBundle, MarketCatalogue, MarketInfo } from "./market-types";
const GAMMA = "https://gamma-api.polymarket.com";
const cacheRoot = path.join(process.cwd(), ".luckaudit-cache", "markets"),
  snapshots = path.join(process.cwd(), "src/data/snapshots/markets");
const memory = new Map<string, { at: number; value: unknown }>(),
  pending = new Map<string, Promise<unknown>>();
const hash = (key: string) => createHash("sha256").update(key).digest("hex");
async function save<T>(key: string, value: T) {
  if (memory.size > 12) memory.delete(memory.keys().next().value!);
  memory.set(key, { at: Date.now(), value });
  try {
    await mkdir(cacheRoot, { recursive: true });
    const file = path.join(cacheRoot, `${hash(key)}.json`),
      temp = `${file}.${Date.now()}.tmp`;
    await writeFile(temp, JSON.stringify(value));
    await rename(temp, file);
  } catch {}
  return value;
}
async function saved<T>(key: string): Promise<T | null> {
  const hit = memory.get(key);
  if (hit) return hit.value as T;
  try {
    return JSON.parse(
      await readFile(
        /* turbopackIgnore: true */ path.join(cacheRoot, `${hash(key)}.json`),
        "utf8",
      ),
    ) as T;
  } catch {}
  try {
    return JSON.parse(
      gunzipSync(await readFile(path.join(snapshots, `${hash(key)}.json.gz`)), {
        maxOutputLength: 30000000,
      }).toString("utf8"),
    ) as T;
  } catch {
    return null;
  }
}
async function once<T>(key: string, work: () => Promise<T>): Promise<T> {
  if (pending.has(key)) return pending.get(key) as Promise<T>;
  const job = work();
  pending.set(key, job);
  try {
    return await job;
  } finally {
    pending.delete(key);
  }
}
export async function gamma(
  endpoint: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  const url = new URL(`${GAMMA}/${endpoint}`);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  for (let i = 0; i < 2; i++) {
    let r: Response;
    try {
      r = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new DataError("Market discovery is temporarily unreachable.", 503);
    }
    if (!r.ok) {
      if (i === 0 && [429, 503].includes(r.status)) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        continue;
      }
      throw new DataError(
        `Market metadata returned HTTP ${r.status}.`,
        r.status === 404 ? 404 : 502,
      );
    }
    return r.json();
  }
  throw new DataError("Market discovery failed.");
}
export async function discoverMarkets(
  query = "",
  state: "active" | "closed" | "all" = "active",
  {
    refresh = false,
    snapshot = false,
  }: { refresh?: boolean; snapshot?: boolean } = {},
): Promise<MarketCatalogue> {
  let parsed: ReturnType<typeof parseMarketQuery>;
  try {
    parsed = parseMarketQuery(query);
  } catch (e) {
    throw new DataError(
      e instanceof Error ? e.message : "Invalid market query.",
      400,
    );
  }
  const key = `catalogue:${state}:${query.trim().toLowerCase()}`,
    hit = memory.get(key);
  if (!refresh && !snapshot && hit && Date.now() - hit.at < 60000)
    return {
      ...(hit.value as MarketCatalogue),
      provenance: {
        ...(hit.value as MarketCatalogue).provenance,
        origin: "cache",
      },
    };
  return once(`${key}:${snapshot}`, async () => {
    try {
      if (snapshot)
        throw new DataError("No saved results for this search.", 404);
      let events: unknown[] = [],
        direct: unknown[] = [],
        hasMore = false;
      if (parsed.kind === "condition") {
        const raw = await gamma("markets", { condition_ids: parsed.condition });
        direct = Array.isArray(raw) ? raw : [];
      } else if (parsed.kind === "market") {
        const raw = await gamma("markets", { slug: parsed.slug });
        direct = Array.isArray(raw) ? raw : [];
      } else if (parsed.kind === "event") {
        const raw = await gamma("events", { slug: parsed.slug });
        events = Array.isArray(raw) ? raw : [];
      } else if (parsed.kind === "text" && parsed.query) {
        const raw = object(
          await gamma("public-search", {
            q: parsed.query,
            limit_per_type: "10",
            ...(state !== "all" ? { events_status: state } : {}),
          }),
        );
        events = Array.isArray(raw.events) ? raw.events : [];
        hasMore = object(raw.pagination).hasMore === true;
      } else {
        const raw = await gamma("events", {
          limit: "12",
          order: "volume24hr",
          ascending: "false",
          ...(state === "active"
            ? { active: "true", closed: "false" }
            : state === "closed"
              ? { closed: "true" }
              : {}),
        });
        events = Array.isArray(raw) ? raw : [];
        hasMore = events.length >= 12;
      }
      const all: MarketInfo[] = [];
      for (const event of events) {
        const markets = object(event).markets;
        if (Array.isArray(markets))
          for (const raw of markets) {
            const market = normalizeMarket(raw, event);
            if (market) all.push(market);
          }
      }
      for (const raw of direct) {
        const market = normalizeMarket(raw);
        if (market) all.push(market);
      }
      const eligible = [
        ...new Map(
          all
            .filter(
              (m) =>
                (state === "all" ||
                  (state === "active" && m.active) ||
                  (state === "closed" && m.closed)) &&
                (parsed.kind !== "event" ||
                  !parsed.child ||
                  m.slug === parsed.child),
            )
            .map((m) => [m.condition, m]),
        ).values(),
      ].sort((a, b) => (b.volumeUsd ?? -1) - (a.volumeUsd ?? -1));
      return save(key, {
        markets: eligible.slice(0, 160),
        query,
        state,
        hasMore: hasMore || eligible.length > 160,
        provenance: {
          origin: "live" as const,
          fetchedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      const previous = await saved<MarketCatalogue>(key);
      if (previous)
        return {
          ...previous,
          provenance: {
            ...previous.provenance,
            origin: "snapshot",
            warning:
              "Saved market-discovery results; current prices and status may have changed.",
          },
        };
      throw error;
    }
  });
}
export async function getMarketBundle(
  condition: string,
  {
    refresh = false,
    snapshot = false,
  }: { refresh?: boolean; snapshot?: boolean } = {},
): Promise<MarketBundle> {
  if (!isCondition(condition))
    throw new DataError("Invalid market condition ID.", 400);
  condition = condition.toLowerCase();
  const key = `market:${condition}`,
    hit = memory.get(key);
  if (!refresh && !snapshot && hit && Date.now() - hit.at < 300000)
    return {
      ...(hit.value as MarketBundle),
      provenance: {
        ...(hit.value as MarketBundle).provenance,
        origin: "cache",
      },
    };
  return once(`${key}:${snapshot}`, async () => {
    try {
      if (snapshot)
        throw new DataError(
          "No saved snapshot is available for this market.",
          404,
        );
      const [metadata, tape] = await Promise.allSettled([
        gamma("markets", { condition_ids: condition }),
        fetchConditionRecords(condition),
      ]);
      if (tape.status === "rejected") throw tape.reason;
      let market =
        metadata.status === "fulfilled" && Array.isArray(metadata.value)
          ? metadata.value
              .map((m) => normalizeMarket(m))
              .find((m) => m?.condition === condition)
          : null;
      if (!market) {
        const first = tape.value.trades[0];
        if (!first)
          throw new DataError(
            "No market metadata or trade records were found for this condition.",
            404,
          );
        const outcomes = [
          ...new Map(
            tape.value.trades.map((t) => [
              t.token_id,
              { label: t.outcome, token: t.token_id, price: null },
            ]),
          ).values(),
        ];
        market = {
          id: "",
          condition,
          title: first.title || condition,
          slug: first.slug,
          eventSlug: first.event_slug || first.slug,
          eventTitle: first.title,
          tags: [],
          description: "",
          active: false,
          closed: tape.value.resolutions.some((r) => r.status === "resolved"),
          endTime: null,
          volumeUsd: null,
          liquidityUsd: null,
          outcomes: outcomes.slice(0, 2),
          metadataAvailable: false,
        };
        tape.value.coverage.warnings.push(
          "Gamma metadata is unavailable. The title and outcome labels come from trade records; current prices are unavailable.",
        );
      }
      const result: MarketBundle = {
        market,
        tape: tape.value,
        provenance: { origin: "live", fetchedAt: new Date().toISOString() },
      };
      return save(key, result);
    } catch (error) {
      const previous = await saved<MarketBundle>(key);
      if (previous)
        return {
          ...previous,
          provenance: {
            ...previous.provenance,
            origin: "snapshot",
            warning: snapshot
              ? "Saved market tape; not a live market refresh."
              : "Live market retrieval failed. Showing a saved market snapshot.",
          },
        };
      throw error;
    }
  });
}
