import { discoverMarkets } from "@/lib/market-data";
import { DataError } from "@/lib/polymarket";
import { apiError } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams,
      state = p.get("state") || "active";
    if (!["active", "closed", "all"].includes(state))
      throw new DataError("Invalid market state.", 400);
    return Response.json(
      await discoverMarkets(
        p.get("q") || "",
        state as "active" | "closed" | "all",
        {
          refresh: p.get("refresh") === "1",
          snapshot: p.get("snapshot") === "1",
        },
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
