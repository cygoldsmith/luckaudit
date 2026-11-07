import {
  isAddress,
  isFiniteNumber,
  money,
  type WalletBundle,
  type Report,
} from "./domain";
import type {
  MarketAudit,
  MarketBundle,
  MarketParticipant,
  PrimaryMarket,
} from "./market-types";
import type { IntegrityReport } from "./integrity/data";
export const MARKET_LIMITATIONS = [
  "Activity signals describe observed records; they do not establish whether a market is fair or whether a wallet used nonpublic information.",
  "The tape includes maker and taker wallet-side records. Turnover is the sum of execution notional on those records, not exchange volume, net capital, or open interest.",
  "Concentration is calculated within retrieved records. Holdings and older fills may be missing or limited, and public APIs can omit dust or unindexed activity.",
  "These are descriptive activity measures. Whether pre-move buying was unusual is answered by the Integrity test, which uses its own prespecified rules and measured false-alarm rate.",
];
const valid = (t: MarketBundle["tape"]["trades"][number]) =>
  isAddress(t.proxy_wallet) &&
  /^0x[\da-f]{64}$/i.test(t.condition_id) &&
  ["BUY", "SELL"].includes(t.side) &&
  Boolean(t.token_id) &&
  isFiniteNumber(t.price) &&
  t.price >= 0 &&
  t.price <= 1 &&
  isFiniteNumber(t.size) &&
  t.size > 0 &&
  isFiniteNumber(t.timestamp) &&
  t.timestamp > 0;
export function analyzeMarket(bundle: MarketBundle): MarketAudit {
  const trades = bundle.tape.trades.filter(valid);
  const ascending = [...trades]
    .reverse()
    .sort((a, b) => a.timestamp - b.timestamp);
  const participants = new Map<string, MarketParticipant>(),
    holdingMap = new Map<string, number>();
  for (const p of [
    ...new Map(
      bundle.tape.positions.map((p) => [`${p.proxy_wallet}:${p.token_id}`, p]),
    ).values(),
  ])
    if (isFiniteNumber(p.current_size))
      holdingMap.set(
        p.proxy_wallet.toLowerCase(),
        (holdingMap.get(p.proxy_wallet.toLowerCase()) || 0) + p.current_size,
      );
  let total = 0;
  for (const t of ascending) {
    const address = t.proxy_wallet.toLowerCase(),
      value = t.size * t.price;
    let p = participants.get(address);
    if (!p) {
      p = {
        address,
        name: t.name,
        fills: 0,
        buyNotional: 0,
        sellNotional: 0,
        turnover: 0,
        turnoverShare: 0,
        firstObserved: t.timestamp,
        heldShares: holdingMap.get(address) ?? null,
      };
      participants.set(address, p);
    }
    p.fills++;
    if (t.side === "BUY") p.buyNotional += value;
    if (t.side === "SELL") p.sellNotional += value;
    p.turnover += value;
    total += value;
  }
  const ranked = [...participants.values()].sort(
    (a, b) => b.turnover - a.turnover,
  );
  for (const p of ranked) p.turnoverShare = total ? p.turnover / total : 0;
  const topFiveShare = total
      ? ranked.slice(0, 5).reduce((s, p) => s + p.turnover, 0) / total
      : null,
    hhi = total
      ? ranked.reduce((s, p) => s + p.turnoverShare ** 2, 0) * 10000
      : null;
  const from = ascending[0]?.timestamp ?? null,
    to = ascending.at(-1)?.timestamp ?? null,
    span = (to ?? 0) - (from ?? 0),
    bucket = Math.max(60, Math.ceil(span / 240 / 60) * 60),
    times = new Map<
      number,
      { timestamp: number; prices: (number | null)[]; turnover: number }
    >();
  const outcomeTokens = bundle.market.outcomes.map((o) => o.token);
  for (const t of ascending) {
    const at = Math.floor(t.timestamp / bucket) * bucket;
    const point = times.get(at) || {
      timestamp: at,
      prices: [null, null],
      turnover: 0,
    };
    const index = outcomeTokens.indexOf(t.token_id);
    if (index >= 0) point.prices[index] = t.price;
    point.turnover += t.size * t.price;
    times.set(at, point);
  }
  const summary = {
    fills: trades.length,
    wallets: ranked.length,
    observedNotional: total,
    topFiveShare,
    hhi,
    heldShares: holdingMap.size
      ? [...holdingMap.values()].reduce((a, b) => a + b, 0)
      : null,
    from,
    to,
  };
  const signals = [
    {
      id: "M1",
      title: "Observed concentration",
      text: total
        ? `The five largest wallets account for ${(topFiveShare! * 100).toFixed(1)}% of ${money(total)} observed wallet-side turnover. This is an activity share, not a claim about control of the market.`
        : "No valid execution notional was available for concentration analysis.",
    },
    {
      id: "M2",
      title: "Coverage",
      text: `${trades.length.toLocaleString()} valid wallet-side fills and ${ranked.length.toLocaleString()} participating wallets were retrieved. ${bundle.tape.coverage.trades ? "The trade endpoint reached its last page." : "The trade tape is incomplete; metrics cover only the returned window."}`,
    },
  ];
  return {
    participants: ranked,
    timeline: [...times.values()].sort((a, b) => a.timestamp - b.timestamp),
    largeTrades: [...trades]
      .sort((a, b) => b.price * b.size - a.price * a.size)
      .slice(0, 20),
    summary,
    signals,
    limitations: [...MARKET_LIMITATIONS, ...bundle.tape.coverage.warnings],
  };
}
/** Integrity evidence cited by the market report (IDs I1–I3). */
export function integrityFindings(integrity: IntegrityReport) {
  const t = integrity.test,
    flagged = integrity.wallets.rows.filter((r) => r.label === "unusual-record").length;
  return [
    {
      id: "I1",
      title: "Pre-move market test",
      text:
        t.verdict === "not-testable"
          ? t.reason
          : integrity.calibrated === false
            ? `The random-time placebo rate for this category exceeds 10%, so the market test (p = ${t.p!.toPrecision(2)}) is not reported as a verdict.`
            : `${t.verdict === "unusual" ? "Unusual pre-move buying" : "Nothing unusual detected"}: the 6 hours before the ${t.move!.change > 0 ? "rise" : "fall"} scored ${t.preScore!.toFixed(2)}, and ${t.atLeastAsHigh} of ${t.comparisonWindows} earlier windows scored at least as high (p = ${t.p!.toPrecision(2)}, single-market bar 0.05).`,
    },
    {
      id: "I2",
      title: "Comparison with the library",
      text:
        integrity.comparison.percentile === null
          ? "No comparable library markets are available yet."
          : `The pre-move score is higher than ${Math.round(integrity.comparison.percentile * 100)}% of ${integrity.comparison.compared} comparable library markets. This is description, not a test.`,
    },
    {
      id: "I3",
      title: "Wallet check",
      text: integrity.wallets.rows.length
        ? `${flagged} of ${integrity.wallets.rows.length} listed wallets have an unusual record in other library markets after the pre-filter and ${integrity.wallets.correction} at 5%.`
        : "No wallets were listed for this market.",
    },
  ];
}

export function marketReport(
  bundle: MarketBundle,
  audit: MarketAudit,
  integrity?: IntegrityReport | null,
): Report {
  const extra = integrity ? integrityFindings(integrity) : [];
  return {
    mode: "statistical",
    generatedAt: new Date().toISOString(),
    headline: integrity
      ? integrity.headline
      : bundle.tape.coverage.trades
        ? "Observed activity; run the Integrity test for the pre-move verdict"
        : "Partial market tape; activity signals have limited coverage",
    findings: [...extra, ...audit.signals].map((s) => ({
      title: s.title,
      text: s.text,
      evidenceIds: [s.id],
    })),
    alternatives: [
      "Fast readers of public news, or good forecasters, can produce one-sided buying before a move.",
      "A careful insider who trades small can stay invisible, so nothing unusual is not a clean bill of health.",
      "Large or concentrated activity can reflect liquidity provision, hedging, or one person using several wallets.",
    ],
    limitations: audit.limitations,
  };
}

export function primaryMarkets(bundle: WalletBundle): PrimaryMarket[] {
  const result = new Map<string, PrimaryMarket>();
  for (const t of bundle.trades) {
    if (!valid(t)) continue;
    let m = result.get(t.condition_id);
    if (!m) {
      m = {
        condition: t.condition_id,
        title: t.title,
        eventSlug: t.event_slug || t.slug,
        fills: 0,
        buyNotional: 0,
        turnover: 0,
        turnoverShare: 0,
        realizedPnl: null,
        heldShares: null,
      };
      result.set(t.condition_id, m);
    }
    m.fills++;
    m.turnover += t.price * t.size;
    if (t.side === "BUY") m.buyNotional += t.price * t.size;
  }
  for (const [condition, m] of result) {
    const positions = bundle.positions.filter(
      (p) => p.condition_id === condition,
    );
    if (
      positions.length &&
      positions.every((p) => isFiniteNumber(p.realized_pnl))
    )
      m.realizedPnl = positions.reduce((s, p) => s + p.realized_pnl!, 0);
    if (
      positions.length &&
      positions.every((p) => isFiniteNumber(p.current_size))
    )
      m.heldShares = positions.reduce((s, p) => s + p.current_size!, 0);
  }
  const all = [...result.values()],
    total = all.reduce((s, m) => s + m.turnover, 0);
  for (const m of all) m.turnoverShare = total ? m.turnover / total : 0;
  return all.sort((a, b) => b.turnover - a.turnover);
}
