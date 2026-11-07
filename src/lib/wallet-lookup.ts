/** Parse what someone pastes into wallet lookup. Client- and server-safe. */
export type WalletQuery =
  | { kind: "address"; address: string }
  | { kind: "username"; name: string };

const ADDRESS = /^0x[\da-f]{40}$/i;
const NAME = /^[A-Za-z0-9_.-]{1,64}$/;

export function parseWalletQuery(input: string): WalletQuery | null {
  const q = input.trim();
  if (!q || q.length > 300) return null;
  if (ADDRESS.test(q)) return { kind: "address", address: q.toLowerCase() };
  if (q.startsWith("@") && NAME.test(q.slice(1))) return { kind: "username", name: q.slice(1) };
  // Profile links, with or without a scheme:
  //   polymarket.com/profile/0x…   polymarket.com/@name   polymarket.com/profile/@name
  const link = /^(www\.)?polymarket\.(com|us)\//i.test(q) ? `https://${q}` : q;
  if (!/^https?:\/\//i.test(link)) return null;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (!/^(www\.)?polymarket\.(com|us)$/i.test(url.hostname)) return null;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const last = parts[0] === "profile" ? parts[1] : parts[0];
  if (!last) return null;
  if (ADDRESS.test(last)) return { kind: "address", address: last.toLowerCase() };
  const name = last.startsWith("@") ? last.slice(1) : parts[0] === "profile" ? last : null;
  return name && NAME.test(name) ? { kind: "username", name } : null;
}
