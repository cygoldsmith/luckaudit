import { z } from "zod";
import { multiReport } from "@/lib/integrity/data";
import { DataError } from "@/lib/polymarket";
import { apiError, assertSameOrigin, readBody } from "@/lib/http";
export const runtime = "nodejs";
const condition = z.string().regex(/^0x[\da-fA-F]{64}$/);
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = z
      .object({
        conditions: z.array(condition).min(1).max(25).optional(),
        category: z.enum(["control", "awards", "announcements", "politics"]).optional(),
        from: z.string().date().optional(),
        to: z.string().date().optional(),
      })
      .refine((v) => v.conditions?.length || v.category, "Paste markets or pick a category.")
      .safeParse(await readBody(request));
    if (!parsed.success)
      throw new DataError("Paste 1–25 condition IDs, or pick a category and date range.", 400);
    return Response.json(await multiReport({ ...parsed.data, conditions: parsed.data.conditions && [...new Set(parsed.data.conditions.map((c) => c.toLowerCase()))] }), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return apiError(e);
  }
}
