import { gamma } from "@/lib/market-data";
import { object } from "@/lib/market-normalize";
import { DataError } from "@/lib/polymarket";
import { apiError } from "@/lib/http";
import { parseWalletQuery } from "@/lib/wallet-lookup";
export const runtime = "nodejs";

/** Resolve a pasted address, @username or profile link to a wallet address. */
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const parsed = parseWalletQuery(q);
    if (!parsed) throw new DataError("Paste a wallet address (0x…), an @username, or a Polymarket profile link.", 400);
    if (parsed.kind === "address") return Response.json({ address: parsed.address, candidates: [] });
    const raw = object(await gamma("public-search", { q: parsed.name, search_profiles: "true", limit_per_type: "8" }));
    const candidates = (Array.isArray(raw.profiles) ? raw.profiles : [])
      .map((p) => object(p))
      .filter((p) => typeof p.proxyWallet === "string" && /^0x[\da-f]{40}$/i.test(p.proxyWallet as string))
      .map((p) => ({ name: String(p.name || p.pseudonym || ""), address: (p.proxyWallet as string).toLowerCase() }));
    const exact = candidates.find((c) => c.name.toLowerCase() === parsed.name.toLowerCase());
    if (!exact && !candidates.length) throw new DataError(`No Polymarket profile named “${parsed.name}” was found.`, 404);
    return Response.json(
      { address: exact?.address ?? null, name: exact?.name ?? null, candidates: exact ? [] : candidates.slice(0, 6) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
