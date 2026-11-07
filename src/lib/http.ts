import { DataError } from "./polymarket";
export function apiError(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof DataError
          ? error.message
          : "The request could not be completed. Please retry.",
    },
    {
      status: error instanceof DataError ? error.status : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new DataError("Cross-origin requests are not allowed.", 403);
}
export async function readBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 2048)
    throw new DataError("Request body is too large.", 413);
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new DataError("Invalid JSON body.", 400);
  }
}
