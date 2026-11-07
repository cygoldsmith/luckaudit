export type Period = "week" | "month" | "all";
export type DataOrigin = "live" | "cache" | "snapshot";
export interface Provenance {
  origin: DataOrigin;
  fetchedAt: string;
  warning?: string;
}
export interface Page<T> {
  data: T[];
  pagination?: { has_more: boolean; next_cursor: string | null };
}
export interface Trader {
  address: string;
  name: string;
  rank: number;
  pnl: number | null;
  volume: number | null;
  verified: boolean;
}
export interface Board {
  traders: Trader[];
  period: Period;
  category: string;
  order: "PNL" | "VOLUME";
  nextCursor: string | null;
  provenance: Provenance;
}
export interface Trade {
  proxy_wallet: string;
  side: string;
  token_id: string;
  condition_id: string;
  size: number;
  price: number;
  timestamp: number;
  title: string;
  slug: string;
  event_slug: string;
  outcome: string;
  outcome_index: number;
  name: string;
  transaction_hash: string;
}
export interface Activity extends Trade {
  type: string;
  usdc_size: number;
  is_combo?: boolean;
}
export interface Position {
  proxy_wallet: string;
  token_id: string;
  condition_id: string;
  current_size: number | null;
  avg_price: number | null;
  entry_cost_usdc: number | null;
  entry_fees_usdc: number | null;
  total_size: number | null;
  realized_pnl: number | null;
  unrealized_pnl: number | null;
  total_pnl: number | null;
  status: string;
  redeemable: boolean;
  negative_risk: boolean;
  title: string;
  slug: string;
  event_id: string;
  event_slug: string;
  outcome: string;
  outcome_index: number;
  first_entry_at: number;
  last_event_at: number;
}
export interface Resolution {
  condition_id?: string | null;
  status: string;
  payouts?: number[] | null;
  resolved_at?: string | null;
  transaction_hash: string;
}
export interface PnlPoint {
  timestamp: number;
  trade_pnl: number | null;
  realized_pnl: number | null;
  economic_pnl: number | null;
}
export interface UserStats {
  proxy_wallet: string;
  trades: number;
  biggest_win: number;
  join_date?: number | null;
  all_time_pnl?: {
    realized_pnl: number | null;
    economic_pnl: number | null;
  } | null;
}
export interface Coverage {
  trades: boolean;
  activity: boolean;
  positions: boolean;
  resolutions: boolean;
  warnings: string[];
}
export interface WalletBundle {
  address: string;
  trades: Trade[];
  activity: Activity[];
  positions: Position[];
  resolutions: Resolution[];
  pnl: PnlPoint[];
  stats: UserStats | null;
  coverage: Coverage;
  provenance: Provenance;
}
export interface EligibleBet {
  id: string;
  token: string;
  condition: string;
  event: string;
  title: string;
  outcome: string;
  slug: string;
  /** Average entry price of the shares still held at resolution. */
  price: number;
  /** Fair chance = max(price, library price-bucket win rate). */
  probability: number;
  stake: number;
  shares: number;
  fees: number;
  won: boolean;
  pnl: number;
  firstEntry: number;
  resolvedAt: number;
  transactions: string[];
  /** The one bet counted for its event (largest cost). */
  selected: boolean;
}
export interface PositionReview {
  token: string;
  condition: string;
  eligible: boolean;
  reason: string;
  evidenceId?: string;
  won?: boolean;
}
export type RecordLabel =
  | "unusual-record"
  | "nothing-unusual"
  | "too-few-bets"
  | "record-too-short"
  | "incomplete-history";
/** Exact wallet record test (Market Integrity Search, Part B steps 3–6). */
export interface RecordTest {
  observations: number;
  wins: number;
  expected: number;
  luckRatio: number | null;
  /** Exact Poisson-binomial P(at least this many wins | fair chances). */
  p: number | null;
  /** Chance of winning every bet by luck (pre-filter input). */
  allWinChance: number | null;
  /** Probability of each win count 0..n under the fair chances. */
  pmf: number[];
  alpha: number;
  label: RecordLabel;
  fragile: boolean | null;
  fragileP: number | null;
  calibration: "library" | "price-only";
  calibrationMarkets: number;
  reasons: string[];
}
export interface Audit {
  bets: EligibleBet[];
  reviews: PositionReview[];
  record: RecordTest;
  summary: {
    positions: number;
    closed: number;
    profitableClosed: number;
    losingClosed: number;
    closedWinRate: number | null;
    realizedPnl: number | null;
    unrealizedPnl: number | null;
    eligible: number;
    eventGroups: number;
    fees: number;
  };
  limitations: string[];
}
export interface ReportSection {
  title: string;
  text: string;
  evidenceIds: string[];
}
export interface Report {
  mode: "statistical" | "ai";
  generatedAt: string;
  model?: string;
  headline: string;
  findings: ReportSection[];
  alternatives: string[];
  limitations: string[];
}
export interface Investigation {
  bundle: WalletBundle;
  audit: Audit;
  report: Report;
  aiConfigured: boolean;
  /** Advanced spec wallet card from the library population, when available. */
  library?: Awaited<ReturnType<typeof import("./integrity/data").walletCard>> | null;
}

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
export const isAddress = (value: string) => /^0x[\da-f]{40}$/i.test(value);
export const shortAddress = (value: string) =>
  `${value.slice(0, 6)}…${value.slice(-4)}`;
export const money = (value: number | null | undefined) =>
  isFiniteNumber(value)
    ? new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value)
    : "—";
export const compact = (value: number | null | undefined) =>
  isFiniteNumber(value)
    ? new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(value)
    : "—";
export const dateTime = (value: string | number) =>
  new Date(typeof value === "number" ? value * 1000 : value).toLocaleString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    },
  );
export const marketLink = (slug: string) =>
  `https://polymarket.com/event/${encodeURIComponent(slug)}`;
export const txLink = (hash: string) =>
  `https://polygonscan.com/tx/${encodeURIComponent(hash)}`;
