import { z } from "zod";
import { buildLibraryStep, discoverLibrary, libraryStatus } from "@/lib/integrity/data";
import { DataError } from "@/lib/polymarket";
import { apiError, assertSameOrigin, readBody } from "@/lib/http";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET() {
  try {
    return Response.json(await libraryStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("discover") }),
        z.object({ action: z.literal("step"), count: z.number().int().min(1).max(10).default(3) }),
      ])
      .safeParse(await readBody(request));
    if (!parsed.success) throw new DataError("Use action 'discover' or 'step'.", 400);
    const result =
      parsed.data.action === "discover" ? await discoverLibrary() : await buildLibraryStep(parsed.data.count);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
