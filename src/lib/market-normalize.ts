import type { MarketInfo } from "./market-types";
export const isCondition = (value: string) => /^0x[\da-f]{64}$/i.test(value);
export function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  return null;
}
function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {}
  }
  return [];
}
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
const text = (value: unknown) => (typeof value === "string" ? value : "");
export function normalizeMarket(
  value: unknown,
  eventValue?: unknown,
): MarketInfo | null {
  const m = object(value),
    parent = object(eventValue || list(m.events)[0]);
  const condition = text(m.conditionId || m.condition_id).toLowerCase(),
    labels = list(m.outcomes).filter((v): v is string => typeof v === "string");
  if (!isCondition(condition) || labels.length !== 2) return null;
  const tokens = list(m.clobTokenIds),
    prices = list(m.outcomePrices);
  const rawTime = text(m.endDate || parent.endDate);
  return {
    id: String(m.id || ""),
    condition,
    title: text(m.question || m.title) || condition,
    slug: text(m.slug),
    eventSlug: text(parent.slug || m.slug),
    eventTitle: text(parent.title || m.question),
    tags: list(parent.tags)
      .map((t) => text(object(t).label))
      .filter((t) => t && t !== "All"),
    description: text(m.description).slice(0, 3000),
    image: (() => {
      const url = text(m.icon || m.image || parent.icon || parent.image);
      return /^https:\/\//.test(url) ? url : null;
    })(),
    active: m.active === true && m.closed !== true,
    closed: m.closed === true,
    endTime: Number.isFinite(Date.parse(rawTime)) ? rawTime : null,
    volumeUsd: numeric(m.volumeNum ?? m.volume),
    liquidityUsd: numeric(m.liquidityNum ?? m.liquidity),
    outcomes: labels.map((label, i) => ({
      label,
      token: text(tokens[i]),
      price: (() => {
        const p = numeric(prices[i]);
        return p !== null && p >= 0 && p <= 1 ? p : null;
      })(),
    })),
    metadataAvailable: true,
  };
}
export function parseMarketQuery(
  input: string,
):
  | { kind: "text"; query: string }
  | { kind: "event" | "market"; slug: string; child?: string }
  | { kind: "us-event"; slug: string; path: string }
  | { kind: "condition"; condition: string } {
  const query = input.trim();
  if (query.length > 300)
    throw new Error("Search text must be at most 300 characters.");
  if (isCondition(query))
    return { kind: "condition", condition: query.toLowerCase() };
  // Accept links pasted without a scheme, e.g. "polymarket.com/event/…".
  const link = /^(www\.)?polymarket\.(com|us)\//i.test(query) ? `https://${query}` : query;
  if (/^https?:\/\//i.test(link)) {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      throw new Error("Enter a valid Polymarket link.");
    }
    const host = url.hostname.toLowerCase(),
      us = ["polymarket.us", "www.polymarket.us"].includes(host);
    if (!us && !["polymarket.com", "www.polymarket.com"].includes(host))
      throw new Error("Only Polymarket market or event links are supported.");
    const parts = url.pathname.split("/").filter(Boolean);
    const valid = (p: string | undefined): p is string => !!p && /^[-a-zA-Z0-9]+$/.test(p);
    // Polymarket US (polymarket.us) is a separate exchange. Its event pages live
    // under /event/<slug> or /sports/<league>/<slug>; the slug is the last segment.
    if (us) {
      const slug = parts[0] === "event" || parts[0] === "market" ? parts[1] : parts[0] === "sports" ? parts.at(-1) : undefined;
      if (!valid(slug) || parts.length < 2 || !parts.every(valid))
        throw new Error("Paste a Polymarket event, market or game link.");
      return { kind: "us-event", slug, path: url.pathname };
    }
    // polymarket.com game pages: /sports/<league>/<slug> is an event slug.
    if (parts[0] === "sports" && parts.length >= 3 && parts.every(valid))
      return { kind: "event", slug: parts.at(-1)!, child: undefined };
    if (
      !["event", "market"].includes(parts[0]) ||
      !parts[1] ||
      parts.slice(1).some((p) => !/^[-a-zA-Z0-9]+$/.test(p))
    )
      throw new Error("Paste a Polymarket event or market link.");
    return {
      kind: parts[0] as "event" | "market",
      slug: parts[1],
      child: parts[2],
    };
  }
  return { kind: "text", query };
}
