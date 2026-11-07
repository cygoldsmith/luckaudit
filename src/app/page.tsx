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
import AppFrame from "@/components/app-frame";
import { requestJson } from "@/lib/client";
import { compact, dateTime, money } from "@/lib/domain";
import { parseMarketQuery } from "@/lib/market-normalize";
import type { MarketCatalogue } from "@/lib/market-types";
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
        <div className="page-heading">
          <div>
            <h1>Market explorer</h1>
            <p>
              Find a market. Inspect its activity. Follow the traders behind it.
            </p>
          </div>
          <Link className="outline-button" href="/leaderboard">
            Trader leaderboard
            <ArrowUpRight size={14} />
          </Link>
        </div>
        <section className="market-search-panel">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search(input);
            }}
          >
            <label htmlFor="market-search">
              Search a market or paste a Polymarket link
            </label>
            <div className={`wallet-search ${inputError ? "has-error" : ""}`}>
              <Search size={19} />
              <input
                id="market-search"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setInputError("");
                }}
                placeholder="Market title, topic, or polymarket.com/event/…"
                autoComplete="off"
              />
              <button type="submit">
                Search markets
                <ArrowRight size={15} />
              </button>
            </div>
            {inputError ? (
              <p className="field-error" role="alert">
                {inputError}
              </p>
            ) : null}
          </form>
          <div className="saved-market-case">
            <Link href="/market/0x9db8905bffc0df478b336591504245614c631976329df65efd7609f32167a693?snapshot=1">
              Open a saved real-market case
              <ArrowUpRight size={12} />
            </Link>
            <span>Recorded Fed rate-hike market · labeled snapshot</span>
          </div>
          <div className="search-suggestions">
            <span>Explore</span>
            {[
              "US election",
              "Federal Reserve",
              "Bitcoin",
              "Champions League",
            ].map((value) => (
              <button key={value} onClick={() => search(value)}>
                {value}
                <ArrowUpRight size={11} />
              </button>
            ))}
          </div>
          {recent.length ? (
            <div className="recent-market-searches">
              <Clock3 size={12} />
              <span>Recent</span>
              {recent.slice(0, 3).map((value) => (
                <button key={value} onClick={() => search(value)}>
                  {value.length > 38 ? value.slice(0, 35) + "…" : value}
                </button>
              ))}
            </div>
          ) : null}
        </section>
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
                <article className="market-card" key={m.condition}>
                  <div className="market-card-meta">
                    <span
                      className={`market-state ${m.closed ? "closed" : ""}`}
                    >
                      {m.closed
                        ? "Closed"
                        : m.active
                          ? "Active"
                          : "Status unavailable"}
                    </span>
                    <span>
                      {m.tags
                        .filter(
                          (t) => !["all", "games"].includes(t.toLowerCase()),
                        )
                        .slice(0, 2)
                        .join(" · ") || "Prediction market"}
                    </span>
                  </div>
                  <Link
                    href={`/market/${m.condition}`}
                    className="market-question"
                  >
                    {m.title}
                    <ArrowUpRight size={15} />
                  </Link>
                  {m.eventTitle !== m.title ? (
                    <p className="market-parent-title">{m.eventTitle}</p>
                  ) : (
                    <p className="market-parent-title">
                      {m.endTime
                        ? `Scheduled end ${dateTime(m.endTime)}`
                        : "Scheduled end unavailable"}
                    </p>
                  )}
                  <div className="outcome-preview">
                    {m.outcomes.map((outcome, i) => (
                      <div key={i}>
                        <span>{outcome.label}</span>
                        <strong>
                          {outcome.price === null
                            ? "—"
                            : `${(outcome.price * 100).toFixed(1)}%`}
                        </strong>
                      </div>
                    ))}
                  </div>
                  <div className="market-card-totals">
                    <span>
                      Reported volume
                      <strong>
                        {m.volumeUsd === null
                          ? "—"
                          : `$${compact(m.volumeUsd)}`}
                      </strong>
                    </span>
                    <span>
                      Reported liquidity<strong>{money(m.liquidityUsd)}</strong>
                    </span>
                  </div>
                  <Link
                    className="market-investigate-link"
                    href={`/market/${m.condition}`}
                  >
                    Investigate market
                    <ArrowRight size={15} />
                  </Link>
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
            <strong>An anomaly screen, not a fairness certificate.</strong>
            <p>
              Open a resolved market for its integrity test: was buying in the
              6 hours before the big move unusually one-sided? Every verdict
              shows its p-value, comparison count and measured false-alarm rate.
            </p>
          </div>
          <Link href="/validation">
            See validation
            <ArrowUpRight size={14} />
          </Link>
        </section>
        <footer className="page-footer">
          <span>
            Public data · Local AI explanations · No wallet connection
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
