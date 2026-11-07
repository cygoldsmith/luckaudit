/**
 * Wallet record test — the Market Integrity Search wallet check (Part B,
 * steps 2–6) applied to one wallet's resolved history.
 */
import {
  isFiniteNumber,
  type Audit,
  type EligibleBet,
  type PositionReview,
  type RecordTest,
  type WalletBundle,
} from "./domain";
import { scoreRecord, type WalletRecord } from "./integrity/core";
import { SETTINGS, WALLET_METHOD_ID, WALLET_SETTINGS } from "./integrity/settings";

export const METHOD_VERSION = WALLET_METHOD_ID;
/** Null win probability for an entry price: q = max(p, c(p)) from the library calibration curve. */
export type NullModel = ((price: number) => number) | null;
export const LIMITATIONS = [
  "This is an anomaly screen, not a finding that a trader is lucky, skilled, or used nonpublic information. Good forecasters and fast readers of public news can produce unusual records.",
  "A single-wallet p-value does not correct for how the wallet was chosen or for repeated lookups. Wallets picked because they won are selected for success; the library population card applies the Benjamini–Hochberg correction across every tested wallet.",
  "Positions follow the Advanced spec: net shares (bought − sold) still held at resolution, cost of at least $10, first-buy entry price 2¢–95¢, not holding both outcomes, and one bet per event (the largest). Positions moved by splits, merges or transfers are counted by their trades only.",
  "Each bet's null probability is q = max(entry price, calibrated win rate at that price) from the library's isotonic calibration curve. Prices are not perfectly calibrated probabilities, and related events can still be dependent.",
  "One person using many wallets looks like many small traders; wallets are shown as shortened addresses only.",
];

const PAYOUT = 1_000_000;

interface Book {
  firstPrice: [number, number];
  firstTime: [number, number];
  shares: [number, number];
  buyShares: [number, number];
  buyUsd: [number, number];
  first: number;
  title: string;
  slug: string;
  outcomes: [string, string];
  tokens: [string, string];
  event: string;
  transactions: string[];
}

/** Rule #7 bets from the wallet's own trades and verified binary resolutions. */
export function walletBets(bundle: WalletBundle, qOf: NullModel) {
  const reviews: PositionReview[] = [],
    bets: EligibleBet[] = [];
  const resolutions = new Map(bundle.resolutions.map((r) => [r.condition_id, r]));
  const events = new Map<string, string>(),
    fees = new Map<string, number>();
  for (const p of bundle.positions) {
    if (p.event_id || p.event_slug) events.set(p.condition_id, p.event_id || p.event_slug);
    if (isFiniteNumber(p.entry_fees_usdc))
      fees.set(p.token_id, (fees.get(p.token_id) || 0) + p.entry_fees_usdc);
  }
  const books = new Map<string, Book>();
  const rule = { minCost: WALLET_SETTINGS.minCost, minPrice: WALLET_SETTINGS.priceRange[0], maxPrice: WALLET_SETTINGS.priceRange[1] };
  for (const t of bundle.trades) {
    const o = t.outcome_index;
    if ((o !== 0 && o !== 1) || !isFiniteNumber(t.price) || !isFiniteNumber(t.size) || t.size <= 0) continue;
    let b = books.get(t.condition_id);
    if (!b)
      books.set(
        t.condition_id,
        (b = {
          firstPrice: [0, 0],
          firstTime: [Infinity, Infinity],
          shares: [0, 0],
          buyShares: [0, 0],
          buyUsd: [0, 0],
          first: t.timestamp,
          title: t.title,
          slug: t.event_slug || t.slug,
          outcomes: ["", ""],
          tokens: ["", ""],
          event: events.get(t.condition_id) || t.event_slug || t.slug,
          transactions: [],
        }),
      );
    const resolution = resolutions.get(t.condition_id),
      cutoff = resolution?.resolved_at ? Date.parse(resolution.resolved_at) / 1000 : Infinity;
    if (t.timestamp >= cutoff) continue;
    b.outcomes[o] = t.outcome;
    b.tokens[o] = t.token_id;
    b.first = Math.min(b.first, t.timestamp);
    if (t.side === "BUY") {
      if (t.timestamp < b.firstTime[o]) {
        b.firstTime[o] = t.timestamp;
        b.firstPrice[o] = t.price;
      }
      b.shares[o] += t.size;
      b.buyShares[o] += t.size;
      b.buyUsd[o] += t.size * t.price;
      if (/^0x[\da-f]{64}$/i.test(t.transaction_hash) && b.transactions.length < 20)
        b.transactions.push(t.transaction_hash);
    } else if (t.side === "SELL") b.shares[o] -= t.size;
  }
  for (const [condition, b] of books) {
    const reject = (reason: string, o: 0 | 1 = 0) =>
      reviews.push({ token: b.tokens[o] || condition, condition, eligible: false, reason });
    const r = resolutions.get(condition),
      payouts = r?.payouts;
    if (
      r?.status !== "resolved" ||
      !payouts ||
      payouts.length !== 2 ||
      !payouts.every((x) => x === 0 || x === PAYOUT) ||
      payouts[0] + payouts[1] !== PAYOUT
    ) {
      reject("No verified final binary payout");
      continue;
    }
    const held = ([0, 1] as const).filter((o) => b.shares[o] > 0.01);
    if (held.length === 2) {
      reject("Held both outcomes at resolution");
      continue;
    }
    if (!held.length) {
      reject("Sold out before resolution");
      continue;
    }
    const o = held[0],
      vwap = b.buyShares[o] ? b.buyUsd[o] / b.buyShares[o] : 0,
      price = b.firstPrice[o],
      shares = b.shares[o],
      stake = vwap * shares;
    if (stake < rule.minCost) {
      reject(`Cost under $${rule.minCost}`, o);
      continue;
    }
    if (price < rule.minPrice || price > rule.maxPrice) {
      reject(`Entry price outside ${rule.minPrice * 100}¢–${rule.maxPrice * 100}¢`, o);
      continue;
    }
    const won = payouts[o] === PAYOUT,
      fee = fees.get(b.tokens[o]) ?? 0,
      bet: EligibleBet = {
        id: `E${bets.length + 1}`,
        token: b.tokens[o],
        condition,
        event: b.event,
        title: b.title,
        outcome: b.outcomes[o],
        slug: b.slug,
        price,
        probability: qOf ? qOf(price) : price,
        stake,
        shares,
        fees: fee,
        won,
        pnl: (won ? shares : 0) - stake,
        firstEntry: b.first,
        resolvedAt: r.resolved_at ? Date.parse(r.resolved_at) / 1000 : 0,
        transactions: b.transactions,
        selected: false,
      };
    bets.push(bet);
    reviews.push({ token: bet.token, condition, eligible: true, reason: "Held to resolution under the bet rules", evidenceId: bet.id, won });
  }
  // One bet per event: the largest by cost.
  const largest = new Map<string, EligibleBet>();
  for (const bet of bets) {
    const prev = largest.get(bet.event);
    if (!prev || bet.stake > prev.stake) largest.set(bet.event, bet);
  }
  for (const bet of largest.values()) bet.selected = true;
  return { bets, reviews };
}

/**
 * Single-wallet record test. One wallet is one test (m = 1): the pre-filter bar
 * and the verdict bar are both α. Groups of wallets go through walletCheck/BH.
 */
export function recordTest(
  bets: EligibleBet[],
  coverageComplete: boolean,
  qOf: NullModel,
  calibrationMarkets = 0,
): RecordTest {
  const alpha = SETTINGS.alpha,
    selected = bets.filter((b) => b.selected),
    record: WalletRecord = scoreRecord(
      "",
      selected.map((b) => ({
        wallet: "",
        condition: b.condition,
        event: b.event,
        outcome: 0 as const,
        price: b.price,
        cost: b.stake,
        won: b.won,
        fair: b.probability,
      })),
    );
  const pmf = pmfOf(selected.map((b) => b.probability));
  const reasons: string[] = [];
  let label: RecordTest["label"];
  if (!coverageComplete) {
    label = "incomplete-history";
    reasons.push("Trade or resolution retrieval was incomplete, so the record cannot be tested.");
  } else if (selected.length < WALLET_SETTINGS.minPositions) {
    label = "too-few-bets";
    reasons.push(`Fewer than ${WALLET_SETTINGS.minPositions} qualifying bets in different events.`);
  } else if ((record.allWinChance ?? 1) > alpha + 1e-15) {
    label = "record-too-short";
    reasons.push(`Even winning every bet would have a ${(record.allWinChance! * 100).toFixed(1)}% chance by luck, above the ${alpha * 100}% bar.`);
  } else label = record.p! <= alpha + 1e-15 ? "unusual-record" : "nothing-unusual";
  let fragile: boolean | null = null,
    fragileP: number | null = null;
  if (label === "unusual-record") {
    const wins = record.bets.filter((b) => b.won),
      surprising = wins.reduce((a, b) => (b.fair < a.fair ? b : a));
    const rest = scoreRecord("", record.bets.filter((b) => b !== surprising));
    fragileP = rest.p;
    fragile = rest.p === null || rest.p > alpha + 1e-15;
  }
  return {
    observations: selected.length,
    wins: record.wins,
    expected: record.expected,
    luckRatio: record.luckRatio,
    p: record.p,
    allWinChance: record.allWinChance,
    pmf,
    alpha,
    label,
    fragile,
    fragileP,
    calibration: qOf && calibrationMarkets ? "library" : "price-only",
    calibrationMarkets,
    reasons,
  };
}

function pmfOf(q: number[]) {
  const pmf = new Array(q.length + 1).fill(0);
  pmf[0] = 1;
  for (let i = 0; i < q.length; i++)
    for (let k = i + 1; k >= 0; k--) pmf[k] = pmf[k] * (1 - q[i]) + (k ? pmf[k - 1] * q[i] : 0);
  return pmf;
}

function completeSum(values: (number | null)[]) {
  return values.length && values.every(isFiniteNumber)
    ? (values as number[]).reduce((a, b) => a + b, 0)
    : null;
}

export function auditWallet(bundle: WalletBundle, qOf: NullModel = null, calibrationMarkets = 0): Audit {
  const { bets, reviews } = walletBets(bundle, qOf);
  const positions = [...new Map(bundle.positions.map((p) => [p.token_id, p])).values()];
  const closed = positions.filter((p) => p.status === "CLOSED");
  const profitableClosed = closed.filter((p) => isFiniteNumber(p.realized_pnl) && p.realized_pnl > 0).length;
  const losingClosed = closed.filter((p) => isFiniteNumber(p.realized_pnl) && p.realized_pnl < 0).length;
  const coverageComplete = bundle.coverage.trades && bundle.coverage.resolutions;
  const selected = bets.filter((b) => b.selected);
  return {
    bets,
    reviews,
    record: recordTest(bets, coverageComplete, qOf, calibrationMarkets),
    summary: {
      positions: positions.length,
      closed: closed.length,
      profitableClosed,
      losingClosed,
      closedWinRate: profitableClosed + losingClosed ? profitableClosed / (profitableClosed + losingClosed) : null,
      realizedPnl: completeSum(positions.map((p) => p.realized_pnl)),
      unrealizedPnl: completeSum(positions.map((p) => p.unrealized_pnl)),
      eligible: bets.length,
      eventGroups: selected.length,
      fees: selected.reduce((sum, b) => sum + b.fees, 0),
    },
    limitations: [...LIMITATIONS, ...bundle.coverage.warnings],
  };
}

export const RECORD_LABELS: Record<RecordTest["label"], string> = {
  "unusual-record": "Unusual record",
  "nothing-unusual": "Nothing unusual detected",
  "too-few-bets": "Too few bets to test",
  "record-too-short": "Record too short to test",
  "incomplete-history": "History incomplete",
};
