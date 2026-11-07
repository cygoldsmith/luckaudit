import { getWallet } from "@/lib/polymarket";
import { auditWallet } from "@/lib/analysis";
import { libraryQ, walletCard, walletPopulation } from "@/lib/integrity/data";
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
    const pop = await walletPopulation().catch(() => null),
      audit = auditWallet(
        bundle,
        await libraryQ(),
        pop ? pop.curve.filter((b) => b.usesFit).reduce((s, b) => s + b.markets, 0) : 0,
      ),
      library = pop ? await walletCard(bundle.address) : null;
    return Response.json(
      {
        bundle,
        audit,
        report: statisticalReport(bundle, audit),
        library,
        aiConfigured: await aiConfigured(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
