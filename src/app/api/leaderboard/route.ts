import { getLeaderboard, DataError } from "@/lib/polymarket";
import { apiError } from "@/lib/http";
import type { Period } from "@/lib/domain";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const period = p.get("period") || "month",
      category = p.get("category") || "overall",
      order = p.get("order") || "PNL",
      cursor = p.get("cursor") || undefined;
    if (
      !["week", "month", "all"].includes(period) ||
      !["overall", "politics", "sports", "crypto", "economics"].includes(
        category,
      ) ||
      !["PNL", "VOLUME"].includes(order) ||
      (cursor && cursor.length > 2000)
    )
      throw new DataError("Invalid leaderboard filters.", 400);
    return Response.json(
      await getLeaderboard({
        period: period as Period,
        category,
        order: order as "PNL" | "VOLUME",
        cursor,
        refresh: p.get("refresh") === "1",
        snapshot: p.get("snapshot") === "1",
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
