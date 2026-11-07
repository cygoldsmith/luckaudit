export function poissonBinomial(probabilities: number[]): number[] {
  if (probabilities.some((q) => !Number.isFinite(q) || q < 0 || q > 1))
    throw new Error("Probabilities must be finite and in [0,1].");
  const pmf = new Array(probabilities.length + 1).fill(0);
  pmf[0] = 1;
  for (let i = 0; i < probabilities.length; i++) {
    const q = probabilities[i];
    for (let k = i + 1; k >= 0; k--)
      pmf[k] = pmf[k] * (1 - q) + (k ? pmf[k - 1] * q : 0);
  }
  return pmf;
}
export function exactTail(pmf: number[], observed: number) {
  if (!Number.isInteger(observed) || observed < 0 || observed >= pmf.length)
    throw new Error("Invalid observed win count.");
  return Math.min(
    1,
    Math.max(
      0,
      pmf.slice(observed).reduce((a, b) => a + b, 0),
    ),
  );
}
export function adjustPValues(values: number[], method: "BH" | "BY" = "BH") {
  if (values.some((p) => !Number.isFinite(p) || p < 0 || p > 1))
    throw new Error("Invalid p-value.");
  const m = values.length,
    harmonic =
      method === "BY" ? values.reduce((s, _, i) => s + 1 / (i + 1), 0) : 1,
    sorted = values.map((p, index) => ({ p, index })).sort((a, b) => a.p - b.p),
    out = new Array<number>(m);
  let last = 1;
  for (let i = m - 1; i >= 0; i--) {
    last = Math.min(last, (sorted[i].p * m * harmonic) / (i + 1));
    out[sorted[i].index] = Math.min(1, last);
  }
  return out;
}
export function oddsMultiplier(q: number[], wins: number): number | null {
  if (
    !q.length ||
    wins < 0 ||
    wins > q.length ||
    !Number.isInteger(wins) ||
    q.some((p) => p <= 0 || p >= 1 || !Number.isFinite(p))
  )
    return null;
  if (wins === 0) return 0;
  if (wins === q.length) return Infinity;
  let lo = -50,
    hi = 50;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2,
      expected = q.reduce(
        (sum, p) => sum + 1 / (1 + Math.exp(-(Math.log(p / (1 - p)) + mid))),
        0,
      );
    if (expected < wins) lo = mid;
    else hi = mid;
  }
  return Math.exp((lo + hi) / 2);
}
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
