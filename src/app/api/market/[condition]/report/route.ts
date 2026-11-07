import { z } from "zod";
import { getMarketBundle } from "@/lib/market-data";
import { analyzeMarket, marketReport } from "@/lib/market-analysis";
import { explainMarket } from "@/lib/market-report";
import { integrityReport } from "@/lib/integrity/data";
import { aiConfigured } from "@/lib/report";
import { DataError } from "@/lib/polymarket";
import { apiError, assertSameOrigin, readBody } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ condition: string }> },
) {
  try {
    assertSameOrigin(request);
    const parsed = z
      .object({
        snapshot: z.boolean().optional(),
        fetchedAt: z.string().max(60).optional(),
      })
      .safeParse(await readBody(request));
    if (!parsed.success) throw new DataError("Invalid report request.", 400);
    const { condition } = await params,
      bundle = await getMarketBundle(condition, {
        snapshot: parsed.data.snapshot,
      });
    if (
      parsed.data.fetchedAt &&
      parsed.data.fetchedAt !== bundle.provenance.fetchedAt
    )
      throw new DataError(
        "Market records changed. Refresh before generating the report.",
        409,
      );
    const audit = analyzeMarket(bundle),
      integrity = await integrityReport(condition).catch(() => null);
    // Without local AI, the computed report still includes the integrity evidence.
    if (!(await aiConfigured()))
      return Response.json(
        { report: marketReport(bundle, audit, integrity) },
        { headers: { "Cache-Control": "no-store" } },
      );
    try {
      return Response.json(
        { report: await explainMarket(bundle, audit, integrity) },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (e) {
      console.warn(
        "Local market explanation failed:",
        e instanceof Error ? e.message : "Unknown local model error",
      );
      throw new DataError(
        "Local AI explanation is unavailable or failed validation. The computed activity report remains available.",
        502,
      );
    }
  } catch (e) {
    return apiError(e);
  }
}
