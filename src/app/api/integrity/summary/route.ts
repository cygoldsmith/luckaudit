import { librarySummary, methodCheck } from "@/lib/integrity/data";
import { apiError } from "@/lib/http";
export const runtime = "nodejs";

/** Everything the Method page needs: library-wide results plus validation. */
export async function GET() {
  try {
    const [summary, check] = await Promise.all([librarySummary(), methodCheck()]);
    return Response.json({ summary, check }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
