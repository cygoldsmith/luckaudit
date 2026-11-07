import { runValidation } from "@/lib/validation";
export const runtime = "nodejs";
let cached: ReturnType<typeof runValidation> | null = null;
export async function GET(request: Request) {
  if (!cached || new URL(request.url).searchParams.get("refresh") === "1")
    cached = runValidation();
  return Response.json(cached, { headers: { "Cache-Control": "no-store" } });
}
