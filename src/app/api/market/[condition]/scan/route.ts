import { z } from "zod";
import { getMarketBundle } from "@/lib/market-data";
import { analyzeMarket } from "@/lib/market-analysis";
import { scanParticipants } from "@/lib/participant-scan";
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
        count: z.number().int().min(1).max(5).default(3),
        snapshot: z.boolean().optional(),
        fetchedAt: z.string().max(60).optional(),
      })
      .safeParse(await readBody(request));
    if (!parsed.success)
      throw new DataError("Choose one to five participating wallets.", 400);
    const { condition } = await params,
      bundle = await getMarketBundle(condition, {
        snapshot: parsed.data.snapshot,
      });
    if (
      parsed.data.fetchedAt &&
      parsed.data.fetchedAt !== bundle.provenance.fetchedAt
    )
      throw new DataError(
        "Market records changed. Refresh before scanning participants.",
        409,
      );
    return Response.json(
      {
        results: await scanParticipants(
          analyzeMarket(bundle),
          parsed.data.count,
        ),
        fetchedAt: bundle.provenance.fetchedAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
