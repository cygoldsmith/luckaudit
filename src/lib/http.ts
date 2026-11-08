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
/**
 * Reject cross-site POSTs. Compares the browser's Origin with the Host it
 * actually requested: request.url can report the bind address (0.0.0.0) when
 * the dev server listens on all interfaces, which would block the app itself.
 */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new DataError("Cross-origin requests are not allowed.", 403);
  }
  if (host ? originHost !== host : origin !== new URL(request.url).origin)
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
