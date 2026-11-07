import { isAddress, type Trader } from "./domain";
type Store = { saved: Trader[]; recent: Trader[] };
export function readStore(): Store {
  try {
    const data = JSON.parse(localStorage.getItem("luckaudit:v2") || "{}");
    const clean = (value: unknown) =>
      Array.isArray(value)
        ? value
            .filter(
              (v): v is Trader =>
                !!v &&
                typeof v.address === "string" &&
                isAddress(v.address) &&
                typeof v.name === "string",
            )
            .slice(0, 100)
        : [];
    return { saved: clean(data.saved), recent: clean(data.recent) };
  } catch {
    return { saved: [], recent: [] };
  }
}
function identity(trader: Trader): Trader {
  return { ...trader, pnl: null, volume: null, rank: 0 };
}
export function saveTrader(trader: Trader): Store {
  const state = readStore();
  state.saved = state.saved.some((t) => t.address === trader.address)
    ? state.saved.filter((t) => t.address !== trader.address)
    : [identity(trader), ...state.saved].slice(0, 100);
  try {
    localStorage.setItem("luckaudit:v2", JSON.stringify(state));
  } catch {}
  return state;
}
export function markRecent(trader: Trader) {
  const state = readStore();
  state.recent = [
    identity(trader),
    ...state.recent.filter((t) => t.address !== trader.address),
  ].slice(0, 30);
  try {
    localStorage.setItem("luckaudit:v2", JSON.stringify(state));
  } catch {}
}
export function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csv(rows: (string | number | null)[][]) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const safe =
            typeof value === "string" && /^[=+\-@\t\r]/.test(value)
              ? `'${value}`
              : String(value ?? "");
          return `"${safe.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
}
export async function requestJson<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
