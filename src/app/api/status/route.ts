import { localAiStatus } from "@/lib/report";
import { METHOD_VERSION } from "@/lib/analysis";
export const runtime = "nodejs";
export async function GET() {
  return Response.json(
    { ai: await localAiStatus(), method: METHOD_VERSION },
    { headers: { "Cache-Control": "no-store" } },
  );
}
