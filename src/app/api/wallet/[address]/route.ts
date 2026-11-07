import { getWallet } from "@/lib/polymarket";
import { auditWallet } from "@/lib/analysis";
import { libraryCalibration } from "@/lib/integrity/data";
import { aiConfigured, statisticalReport } from "@/lib/report";
import { apiError } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    const { address } = await params;
    const p = new URL(request.url).searchParams;
    const bundle = await getWallet(address, {
      refresh: p.get("refresh") === "1",
      snapshot: p.get("snapshot") === "1",
    });
    const audit = auditWallet(bundle, await libraryCalibration());
    return Response.json(
      {
        bundle,
        audit,
        report: statisticalReport(bundle, audit),
        aiConfigured: await aiConfigured(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
