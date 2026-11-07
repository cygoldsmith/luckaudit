import type { Position, Provenance, Report, Resolution, Trade } from "./domain";
export interface MarketInfo {
  id: string;
  condition: string;
  title: string;
  slug: string;
  eventSlug: string;
  eventTitle: string;
  tags: string[];
  description: string;
  /** Market or event image (https only), or null. */
  image?: string | null;
  active: boolean;
  closed: boolean;
  endTime: string | null;
  volumeUsd: number | null;
  liquidityUsd: number | null;
  outcomes: { label: string; token: string; price: number | null }[];
  metadataAvailable: boolean;
}
export interface MarketCatalogue {
  markets: MarketInfo[];
  query: string;
  state: "active" | "closed" | "all";
  hasMore: boolean;
  provenance: Provenance;
}
export interface MarketTape {
  trades: Trade[];
  positions: Position[];
  resolutions: Resolution[];
  coverage: {
    trades: boolean;
    holdings: boolean;
    resolutions: boolean;
    warnings: string[];
  };
}
export interface MarketBundle {
  market: MarketInfo;
  tape: MarketTape;
  provenance: Provenance;
}
export interface MarketParticipant {
  address: string;
  name: string;
  fills: number;
  buyNotional: number;
  sellNotional: number;
  turnover: number;
  turnoverShare: number;
  firstObserved: number;
  heldShares: number | null;
}
export interface MarketAudit {
  participants: MarketParticipant[];
  timeline: {
    timestamp: number;
    prices: (number | null)[];
    turnover: number;
  }[];
  largeTrades: Trade[];
  summary: {
    fills: number;
    wallets: number;
    observedNotional: number;
    topFiveShare: number | null;
    hhi: number | null;
    heldShares: number | null;
    from: number | null;
    to: number | null;
  };
  signals: { id: string; title: string; text: string }[];
  limitations: string[];
}
export interface MarketInvestigation {
  bundle: MarketBundle;
  audit: MarketAudit;
  report: Report;
  aiConfigured: boolean;
}
export interface ParticipantAudit {
  address: string;
  label: import("./domain").RecordLabel | "unavailable";
  observations: number;
  wins: number;
  expected: number;
  luckRatio: number | null;
  p: number | null;
  allWinChance: number | null;
  /** BH q-value across the wallets scanned together. */
  q: number | null;
  reason: string;
  provenance?: Provenance;
}
export interface PrimaryMarket {
  condition: string;
  title: string;
  eventSlug: string;
  fills: number;
  buyNotional: number;
  turnover: number;
  turnoverShare: number;
  realizedPnl: number | null;
  heldShares: number | null;
}
