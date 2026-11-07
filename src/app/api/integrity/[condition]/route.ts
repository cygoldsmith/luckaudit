import { integrityReport } from "@/lib/integrity/data";
import { apiError } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ condition: string }> },
) {
  try {
    const { condition } = await params;
    return Response.json(await integrityReport(condition), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}
