"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  Info,
  LoaderCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import AppFrame, { SEARCH_EVENT } from "@/components/app-frame";
import { requestJson } from "@/lib/client";
import { compact, dateTime, money } from "@/lib/domain";
import { parseMarketQuery } from "@/lib/market-normalize";
import type { MarketCatalogue } from "@/lib/market-types";
const TOPICS: [string, string][] = [
  ["Trending", ""],
  ["Politics", "Politics"],
  ["Elections", "Elections"],
  ["Fed", "Federal Reserve"],
  ["Economy", "Economy"],
  ["Awards", "Awards"],
  ["Tech", "Tech"],
  ["Crypto", "Bitcoin"],
  ["Sports", "Champions League"],
];

/** Polymarket-style prices: whole cents, with <1¢ and >99¢ at the extremes. */
const cents = (price: number | null) =>
  price === null ? "—" : price > 0 && price < 0.01 ? "<1¢" : price < 1 && price > 0.99 ? ">99¢" : `${Math.round(price * 100)}¢`;

/** Polymarket-style half-circle chance gauge for the first outcome. */
function ChanceGauge({ value }: { value: number | null }) {
  if (value === null) return <span className="pm-gauge" />;
  const pct = Math.round(value * 100),
    label = value > 0 && value < 0.01 ? "<1%" : value < 1 && value > 0.99 ? ">99%" : `${pct}%`,
    arc = Math.PI * 22;
  return (
    <span className="pm-gauge" aria-label={`${label} chance`}>
      <svg viewBox="0 0 56 32" aria-hidden="true">
        <path d="M6 28 A22 22 0 0 1 50 28" className="track" />
        <path
          d="M6 28 A22 22 0 0 1 50 28"
          className={pct >= 50 ? "fill high" : "fill low"}
          strokeDasharray={`${(arc * value).toFixed(2)} ${arc.toFixed(2)}`}
        />
      </svg>
      <strong>{label}</strong>
      <small>chance</small>
    </span>
  );
}

export default function MarketExplorer() {
  const router = useRouter();
  const [input, setInput] = useState(""),
    [query, setQuery] = useState(""),
    [state, setState] = useState<"active" | "closed" | "all">("active"),
    [catalogue, setCatalogue] = useState<MarketCatalogue | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [inputError, setInputError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [visible, setVisible] = useState(12),
    [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem("luckaudit:market-searches") || "[]",
      );
      if (Array.isArray(stored))
        setRecent(
          stored
            .filter((v) => typeof v === "string" && v.length <= 300)
            .slice(0, 5),
        );
    } catch {}
  }, []);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    setCatalogue(null);
    setVisible(12);
    requestJson<MarketCatalogue>(
      `/api/markets?${new URLSearchParams({ q: query, state, refresh: refresh ? "1" : "0" })}`,
      { signal: c.signal },
    )
      .then((value) => {
        if (!c.signal.aborted) setCatalogue(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [query, state, refresh]);
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("q");
    if (initial) search(initial);
    const listener = (e: Event) => search(String((e as CustomEvent).detail || ""));
    window.addEventListener(SEARCH_EVENT, listener);
    return () => window.removeEventListener(SEARCH_EVENT, listener);
    // search only reads setters and stable helpers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function search(value: string) {
    setInputError("");
    let parsed: ReturnType<typeof parseMarketQuery>;
    try {
      parsed = parseMarketQuery(value);
    } catch (e) {
      setInputError(e instanceof Error ? e.message : "Invalid search.");
      return;
    }
    if (parsed.kind === "condition") {
      router.push(`/market/${parsed.condition}`);
      return;
    }
    if (parsed.kind !== "text") setState("all");
    setInput(value);
    setQuery(value.trim());
    setRefresh((x) => x + 1);
    if (value.trim()) {
      const next = [
        value.trim(),
        ...recent.filter((q) => q !== value.trim()),
      ].slice(0, 5);
      setRecent(next);
      try {
        localStorage.setItem("luckaudit:market-searches", JSON.stringify(next));
      } catch {}
    }
  }
  return (
    <AppFrame active="markets">
      <main>
        <nav className="pm-topics" aria-label="Topics">
          {TOPICS.map(([label, value]) => (
            <button
              key={label}
              className={query === value ? "selected" : ""}
              aria-pressed={query === value}
              onClick={() => (value ? search(value) : search(""))}
            >
              {label}
            </button>
          ))}
          {recent
            .filter((r) => !TOPICS.some(([, v]) => v === r))
            .slice(0, 3)
            .map((value) => (
              <button key={`recent-${value}`} className="recent" onClick={() => search(value)}>
                <Clock3 size={12} />
                {value.length > 28 ? value.slice(0, 26) + "…" : value}
              </button>
            ))}
        </nav>
        {inputError ? (
          <p className="field-error" role="alert">
            {inputError}
          </p>
        ) : null}
        <div className="section-title">
          <div>
            <h2>
              {query ? "Search results" : "Markets to explore"}
              {catalogue ? <span>{catalogue.markets.length}</span> : null}
            </h2>
            <p>
              {query
                ? `Results for “${query.length > 75 ? query.slice(0, 72) + "…" : query}”`
                : "Binary markets from high-activity events. Open a specific question to investigate."}
            </p>
          </div>
          <div className="market-state-controls">
            <div className="period-control" aria-label="Market state">
              {(["active", "closed", "all"] as const).map((value) => (
                <button
                  key={value}
                  aria-pressed={state === value}
                  className={state === value ? "selected" : ""}
                  onClick={() => setState(value)}
                >
                  {value === "active"
                    ? "Active"
                    : value === "closed"
                      ? "Closed"
                      : "All"}
                </button>
              ))}
            </div>
            <button
              className="icon-button"
              aria-label="Refresh markets"
              disabled={loading}
              onClick={() => setRefresh((x) => x + 1)}
            >
              <RefreshCw size={15} className={loading ? "spin" : ""} />
            </button>
          </div>
        </div>
        {catalogue ? (
          <div className="source-bar">
            <span
              className={`source-pill ${catalogue.provenance.origin === "snapshot" ? "is-snapshot" : ""}`}
            >
              <span className="tiny-dot" />
              {catalogue.provenance.origin === "snapshot"
                ? "Saved discovery results"
                : "Gamma market metadata"}
            </span>
            <span>Retrieved {dateTime(catalogue.provenance.fetchedAt)}</span>
            <span className="source-actions">
              Live activity is collected when a market is opened
            </span>
          </div>
        ) : null}
        {catalogue?.provenance.warning ? (
          <div className="inline-notice warning">
            <Info size={15} />
            {catalogue.provenance.warning}
          </div>
        ) : null}
        {loading ? (
          <div className="loading-state" role="status">
            <LoaderCircle className="spin" size={22} />
            Finding markets…
          </div>
        ) : error ? (
          <div className="empty-state" role="alert">
            <Info size={25} />
            <h2>Market search is unavailable</h2>
            <p>{error}</p>
            <button
              className="outline-button"
              onClick={() => setRefresh((x) => x + 1)}
            >
              Retry
              <RefreshCw size={14} />
            </button>
          </div>
        ) : !catalogue?.markets.length ? (
          <div className="empty-state">
            <Search size={27} />
            <h2>No supported markets found</h2>
            <p>
              Try another topic, paste an exact event link, or include closed
              markets. This explorer currently supports markets with two
              outcomes.
            </p>
            <button className="outline-button" onClick={() => setState("all")}>
              Include all states
              <ArrowRight size={14} />
            </button>
          </div>
        ) : (
          <>
            <div className="market-grid">
              {catalogue.markets.slice(0, visible).map((m) => (
                <article className="market-card pm-card" key={m.condition}>
                  <Link href={`/market/${m.condition}`} className="pm-card-head">
                    {m.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="pm-thumb" src={m.image} alt="" loading="lazy" />
                    ) : (
                      <span className="pm-thumb" aria-hidden="true" />
                    )}
                    <span className="market-question">{m.title}</span>
                    <ChanceGauge value={m.outcomes[0]?.price ?? null} />
                  </Link>
                  <div className="outcome-preview">
                    {m.outcomes.map((outcome, i) => (
                      <div key={i}>
                        <span>{outcome.label}</span>
                        <strong>
                          {cents(outcome.price)}
                        </strong>
                      </div>
                    ))}
                  </div>
                  <div className="pm-card-foot">
                    <span>{m.volumeUsd === null ? "—" : `$${compact(m.volumeUsd).toLowerCase()} Vol.`}</span>
                    <span className={`market-state ${m.closed ? "closed" : ""}`}>
                      {m.closed ? "Resolved" : m.active ? "Live" : "—"}
                    </span>
                    <Link className="market-investigate-link" href={`/market/${m.condition}`}>
                      {m.closed ? "Integrity test" : "Investigate"}
                      <ArrowRight size={13} />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
            {visible < catalogue.markets.length ? (
              <button
                className="load-more"
                onClick={() => setVisible((v) => v + 12)}
              >
                Show more loaded markets
                <ChevronDown size={15} />
              </button>
            ) : null}
            {catalogue.hasMore ? (
              <p className="catalogue-note">
                Additional matches may exist beyond these discovery results.
                Refine the topic or paste a specific event link.
              </p>
            ) : null}
          </>
        )}
        <section className="market-method-note">
          <Check size={17} />
          <div>
            <strong>Who is really trading this market?</strong>
            <p>
              Open any market to see whether its biggest traders have records
              elsewhere that luck can&apos;t explain, measured against 85,000
              audited wallets. An anomaly screen, not an accusation.
            </p>
          </div>
          <Link href="/integrity">
            How reliable is it
            <ArrowUpRight size={14} />
          </Link>
        </section>
        <footer className="page-footer">
          <span>
            Public Polymarket data · Reports written from computed results · No wallet connection
          </span>
          <a
            href="https://docs.polymarket.com/market-data/overview"
            target="_blank"
            rel="noreferrer"
          >
            Data sources
            <ExternalLink size={12} />
          </a>
        </footer>
      </main>
    </AppFrame>
  );
}
