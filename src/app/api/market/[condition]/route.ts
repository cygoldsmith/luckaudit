import { getMarketBundle } from "@/lib/market-data";
import { analyzeMarket, marketReport } from "@/lib/market-analysis";
import { aiConfigured } from "@/lib/report";
import { apiError } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ condition: string }> },
) {
  try {
    const { condition } = await params,
      p = new URL(request.url).searchParams,
      bundle = await getMarketBundle(condition, {
        refresh: p.get("refresh") === "1",
        snapshot: p.get("snapshot") === "1",
      }),
      audit = analyzeMarket(bundle);
    return Response.json(
      {
        bundle,
        audit,
        report: marketReport(bundle, audit),
        aiConfigured: await aiConfigured(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
