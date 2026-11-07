import { getWallet, DataError } from "@/lib/polymarket";
import { auditWallet } from "@/lib/analysis";
import { libraryQ } from "@/lib/integrity/data";
import { aiConfigured, aiReport } from "@/lib/report";
import { apiError, assertSameOrigin, readBody } from "@/lib/http";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    assertSameOrigin(request);
    if (!(await aiConfigured()))
      throw new DataError(
        "Local AI is unavailable. Start Ollama with an installed model; the statistical report remains available.",
        503,
      );
    const parsed = z
      .object({
        fetchedAt: z.string().max(60).optional(),
      })
      .safeParse(await readBody(request));
    if (!parsed.success) throw new DataError("Invalid report request.", 400);
    const { address } = await params;
    const bundle = await getWallet(address, {
      snapshot: new URL(request.url).searchParams.get("snapshot") === "1",
    });
    if (
      parsed.data.fetchedAt &&
      parsed.data.fetchedAt !== bundle.provenance.fetchedAt
    )
      throw new DataError(
        "Wallet records changed. Refresh this investigation before generating its report.",
        409,
      );
    try {
      return Response.json(
        {
          report: await aiReport(
            bundle,
            auditWallet(bundle, await libraryQ()),
          ),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      console.warn(
        "Local AI report failed:",
        error instanceof Error ? error.message : "Unknown model error",
      );
      throw new DataError(
        "AI generation failed or returned unsupported evidence. Your statistical report remains available.",
        502,
      );
    }
  } catch (error) {
    return apiError(error);
  }
}
