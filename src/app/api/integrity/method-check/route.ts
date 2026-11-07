import { methodCheck } from "@/lib/integrity/data";
import { apiError } from "@/lib/http";
import { DATA_CHECK, SETTINGS } from "@/lib/integrity/settings";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    return Response.json(
      { settings: SETTINGS, dataCheck: DATA_CHECK, check: await methodCheck(refresh) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
