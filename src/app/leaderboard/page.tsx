"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Bookmark,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Compass,
  Download,
  ExternalLink,
  History,
  Info,
  LoaderCircle,
  Menu,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import Dialog from "@/components/dialog";
import CompareWallets from "@/components/compare-wallets";
import { Logo } from "@/components/visuals";
import {
  compact,
  dateTime,
  isAddress,
  money,
  shortAddress,
  type Board,
  type Period,
  type Trader,
} from "@/lib/domain";
import {
  csv,
  download,
  readStore,
  requestJson,
  saveTrader,
} from "@/lib/client";
type View = "explore" | "watchlist" | "recent";
const labels: Record<Period, string> = {
  week: "Past week",
  month: "Past month",
  all: "All time",
};
export default function Home() {
  const router = useRouter();
  const [view, setView] = useState<View>("explore");
  const [board, setBoard] = useState<Board | null>(null);
  const [period, setPeriod] = useState<Period>("month");
  const [category, setCategory] = useState("overall");
  const [order, setOrder] = useState<"PNL" | "VOLUME">("PNL");
  const [snapshot, setSnapshot] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [store, setStore] = useState({
    saved: [] as Trader[],
    recent: [] as Trader[],
  });
  const [mobile, setMobile] = useState(false);
  const [lookup, setLookup] = useState(false);
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState("");
  const [methodology, setMethodology] = useState(false);
  const [compare, setCompare] = useState(false);
  const [toast, setToast] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const initialView = new URLSearchParams(window.location.search).get("view");
    if (initialView === "watchlist" || initialView === "recent")
      setView(initialView);
    setStore(readStore());
    const sync = () => setStore(readStore());
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setLookup(true);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (lookup) input.current?.focus();
  }, [lookup]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setBoard(null);
    setPage(0);
    const p = new URLSearchParams({
      period,
      category,
      order,
      snapshot: snapshot ? "1" : "0",
      refresh: refresh ? "1" : "0",
    });
    requestJson<Board>(`/api/leaderboard?${p}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setBoard(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [period, category, order, snapshot, refresh]);
  const loaded = board?.traders || [];
  const list =
    view === "explore"
      ? loaded
      : (view === "watchlist" ? store.saved : store.recent).map(
          (t) => loaded.find((l) => l.address === t.address) || t,
        );
  const filtered = list.filter((t) =>
    `${t.name} ${t.address}`.toLowerCase().includes(query.toLowerCase()),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(currentPage * 10, (currentPage + 1) * 10);
  function navigate(next: View) {
    setView(next);
    setMobile(false);
    setPage(0);
    setQuery("");
  }
  function bookmark(trader: Trader) {
    const existed = store.saved.some((t) => t.address === trader.address);
    setStore(saveTrader(trader));
    setToast(existed ? "Removed from watchlist" : "Added to watchlist");
  }
  function lookupWallet(e: React.FormEvent) {
    e.preventDefault();
    const value = address.trim();
    if (!isAddress(value)) {
      setAddressError("Enter 0x followed by 40 hexadecimal characters.");
      return;
    }
    router.push(`/wallet/${value.toLowerCase()}`);
  }
  function exportData() {
    if (!filtered.length) {
      setToast("No traders to export");
      return;
    }
    download(
      `luckaudit-leaderboard-${period}.csv`,
      csv([
        ["Source", board?.provenance.origin || "saved identity"],
        ["Fetched at", board?.provenance.fetchedAt || ""],
        ["Period", labels[period]],
        ["Trader", "Wallet", "Rank", "API P&L USD", "Volume shares"],
        ...filtered.map((t) => [
          t.name,
          t.address,
          t.rank || null,
          t.pnl,
          t.volume,
        ]),
      ]),
      "text/csv;charset=utf-8",
    );
  }
  async function more() {
    if (!board?.nextCursor) return;
    setLoadingMore(true);
    try {
      const p = new URLSearchParams({
        period,
        category,
        order,
        cursor: board.nextCursor,
        snapshot: snapshot ? "1" : "0",
      });
      const result = await requestJson<Board>(`/api/leaderboard?${p}`);
      setBoard((previous) =>
        previous &&
        previous.period === result.period &&
        previous.category === result.category &&
        previous.order === result.order
          ? {
              ...previous,
              traders: [
                ...new Map(
                  [...previous.traders, ...result.traders].map((t) => [
                    t.address,
                    t,
                  ]),
                ).values(),
              ],
              nextCursor: result.nextCursor,
              provenance: result.provenance,
            }
          : previous,
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Could not load more traders");
    } finally {
      setLoadingMore(false);
    }
  }
  return (
    <div className="app-shell">
      {mobile ? (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      ) : null}
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <Link className="brand" href="/">
          <Logo />
          <span>LuckAudit</span>
        </Link>
        <div className="platform-label">
          <AudioLines size={17} />
          <span>Polymarket analytics</span>
        </div>
        <p className="nav-caption">ANALYTICS</p>
        <nav aria-label="Main navigation">
          <Link className="nav-item" href="/">
            <Search size={18} />
            <span>Market explorer</span>
          </Link>
          <button
            className={`nav-item ${view === "explore" ? "active" : ""}`}
            onClick={() => navigate("explore")}
          >
            <Compass size={18} />
            <span>Leaderboard</span>
          </button>
          <button
            className={`nav-item ${view === "watchlist" ? "active" : ""}`}
            onClick={() => navigate("watchlist")}
          >
            <Bookmark size={18} />
            <span>Watchlist</span>
            <span className="nav-count">{store.saved.length}</span>
          </button>
          <button
            className={`nav-item ${view === "recent" ? "active" : ""}`}
            onClick={() => navigate("recent")}
          >
            <History size={18} />
            <span>Recently viewed</span>
            <span className="nav-count">{store.recent.length}</span>
          </button>
        </nav>
        <div className="sidebar-divider" />
        <p className="nav-caption">TOOLS</p>
        <Link className="nav-item" href="/validation">
          <BookOpen size={18} />
          <span>Validation</span>
        </Link>
        <button
          className="nav-item"
          onClick={() => {
            setLookup(true);
            setMobile(false);
          }}
        >
          <Wallet size={18} />
          <span>Wallet lookup</span>
          <kbd>⌘ K</kbd>
        </button>
        <button
          className="nav-item"
          disabled={loaded.length < 2}
          onClick={() => setCompare(true)}
        >
          <ArrowLeftRight size={18} />
          <span>Compare traders</span>
        </button>
        <button className="nav-item" onClick={exportData}>
          <Download size={18} />
          <span>Export data</span>
        </button>
        <div className="sidebar-bottom">
          <div className="data-source-card">
            <div>
              <span className="tiny-dot" />
              DATA SOURCE
            </div>
            <strong>
              {board?.provenance.origin === "snapshot"
                ? "Saved public snapshot"
                : "Polymarket Data API"}
            </strong>
            <p>
              {board
                ? `${loaded.length} loaded traders`
                : loading
                  ? "Connecting…"
                  : "Connection unavailable"}
            </p>
          </div>
          <button className="nav-item" onClick={() => setMethodology(true)}>
            <BookOpen size={18} />
            <span>Methodology</span>
            <ArrowUpRight size={14} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              aria-expanded={mobile}
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb-root">Analytics</span>
            <ChevronRight size={13} />
            <span>
              {view === "explore"
                ? "Leaderboard"
                : view === "watchlist"
                  ? "Watchlist"
                  : "Recently viewed"}
            </span>
          </div>
          <div className="topbar-right">
            <button
              className="topbar-help"
              onClick={() => setMethodology(true)}
            >
              <CircleHelp size={16} />
              <span>Methodology</span>
            </button>
            <a
              className="platform-link"
              href="https://polymarket.com"
              target="_blank"
              rel="noreferrer"
            >
              Polymarket
              <ExternalLink size={13} />
            </a>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <h1>
                {view === "explore"
                  ? "Trader leaderboard"
                  : view === "watchlist"
                    ? "Watchlist"
                    : "Recently viewed"}
              </h1>
              <p>
                Browse real traders. Open a record. Investigate the evidence.
              </p>
            </div>
            <div className="heading-actions">
              <button className="outline-button" onClick={exportData}>
                <Download size={15} />
                Export CSV
              </button>
              <button
                className="primary-button"
                disabled={loaded.length < 2}
                onClick={() => setCompare(true)}
              >
                <ArrowLeftRight size={15} />
                Compare traders
              </button>
            </div>
          </div>
          <div className="source-bar">
            <span
              className={`source-pill ${board?.provenance.origin === "snapshot" ? "is-snapshot" : ""}`}
            >
              <span className="tiny-dot" />
              {loading
                ? "Loading"
                : board?.provenance.origin === "snapshot"
                  ? "Saved snapshot"
                  : board?.provenance.origin === "cache"
                    ? "Cached API data"
                    : board
                      ? "Public API"
                      : "Unavailable"}
            </span>
            <span>
              {board
                ? `Retrieved ${dateTime(board.provenance.fetchedAt)}`
                : loading
                  ? "Connecting to Polymarket"
                  : "No data loaded"}
            </span>
            <div className="source-actions">
              <label className="sr-only" htmlFor="data-mode">
                Data mode
              </label>
              <select
                id="data-mode"
                value={snapshot ? "snapshot" : "live"}
                onChange={(e) => setSnapshot(e.target.value === "snapshot")}
              >
                <option value="live">Live data</option>
                <option value="snapshot">Saved snapshot</option>
              </select>
              <button
                className="icon-button"
                aria-label="Refresh leaderboard"
                disabled={loading}
                onClick={() => setRefresh((x) => x + 1)}
              >
                <RefreshCw size={15} className={loading ? "spin" : ""} />
              </button>
            </div>
          </div>
          {board?.provenance.warning ? (
            <div className="inline-notice">
              <Info size={15} />
              {board.provenance.warning}
            </div>
          ) : null}
          <section
            className="stats-grid"
            aria-label="Loaded leaderboard totals"
          >
            <div className="stat-card">
              <div className="stat-top">
                <span>Loaded traders</span>
                <Users size={16} />
              </div>
              <div className="stat-bottom">
                <strong>{loading ? "—" : loaded.length}</strong>
                <span className="stat-unit">Current board</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-top">
                <span>Combined volume · shares</span>
                <AudioLines size={16} />
              </div>
              <div className="stat-bottom">
                <strong>
                  {board && loaded.every((t) => t.volume !== null)
                    ? compact(loaded.reduce((s, t) => s + t.volume!, 0))
                    : "—"}
                </strong>
                <span className="stat-unit">{labels[period]}</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-top">
                <span>Combined API P&L</span>
                <TrendingUp size={16} />
              </div>
              <div className="stat-bottom">
                <strong className="positive">
                  {board && loaded.every((t) => t.pnl !== null)
                    ? money(loaded.reduce((s, t) => s + t.pnl!, 0))
                    : "—"}
                </strong>
                <span className="stat-unit">{labels[period]}</span>
              </div>
            </div>
          </section>
          <div className="case-strip">
            <span>Saved investigations</span>
            <Link href="/wallet/0x549b491ac7f6a675b56ff0a261d147daa73ac0ae?snapshot=1">
              Resolved-position case
              <ArrowUpRight size={13} />
            </Link>
            <Link href="/wallet/0x4f1d5ae26fc31472966e951af3183308736d8de2?snapshot=1">
              Coverage-limited case
              <ArrowUpRight size={13} />
            </Link>
          </div>
          <section className="traders-section" aria-label="Trader rankings">
            <div className="section-title">
              <div>
                <h2>
                  {view === "explore"
                    ? "Trader rankings"
                    : view === "watchlist"
                      ? "Saved traders"
                      : "Recent investigations"}
                  <span>{filtered.length}</span>
                </h2>
                <p>
                  Select a trader to retrieve their positions and run a
                  statistical audit.
                </p>
              </div>
              <button
                className="text-button"
                onClick={() => setMethodology(true)}
              >
                <Info size={14} />
                Metric definitions
              </button>
            </div>
            <div className="table-card">
              <div className="table-toolbar">
                <div className="table-tabs">
                  <button
                    className={view === "explore" ? "selected" : ""}
                    onClick={() => navigate("explore")}
                  >
                    <Users size={15} />
                    Leaderboard
                  </button>
                  <button
                    className={view === "watchlist" ? "selected" : ""}
                    onClick={() => navigate("watchlist")}
                  >
                    <Bookmark size={15} />
                    Watchlist
                  </button>
                </div>
                <div className="period-control" aria-label="Leaderboard period">
                  {(["week", "month", "all"] as Period[]).map((value) => (
                    <button
                      key={value}
                      className={value === period ? "selected" : ""}
                      aria-pressed={value === period}
                      onClick={() => setPeriod(value)}
                    >
                      {value === "week"
                        ? "7D"
                        : value === "month"
                          ? "30D"
                          : "All time"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="table-filters">
                <label className="table-search">
                  <Search size={16} />
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(0);
                    }}
                    placeholder="Search loaded traders…"
                    aria-label="Search loaded traders"
                  />
                  {query ? (
                    <button
                      aria-label="Clear search"
                      onClick={() => setQuery("")}
                    >
                      <X size={14} />
                    </button>
                  ) : null}
                </label>
                <div className="filter-right">
                  <label className="category-select">
                    <SlidersHorizontal size={14} />
                    <select
                      aria-label="Market category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      {[
                        "overall",
                        "politics",
                        "sports",
                        "crypto",
                        "economics",
                      ].map((value) => (
                        <option key={value} value={value}>
                          {value === "overall"
                            ? "All markets"
                            : value[0].toUpperCase() + value.slice(1)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={12} />
                  </label>
                </div>
              </div>
              {error && view === "explore" ? (
                <div className="empty-state" role="alert">
                  <Info size={26} />
                  <h3>Leaderboard unavailable</h3>
                  <p>{error}</p>
                  <button
                    className="outline-button"
                    onClick={() => setRefresh((x) => x + 1)}
                  >
                    Retry
                    <RefreshCw size={14} />
                  </button>
                </div>
              ) : loading && view === "explore" ? (
                <div className="loading-state" role="status">
                  <LoaderCircle className="spin" size={22} />
                  Retrieving leaderboard…
                </div>
              ) : (
                <>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th className="rank-column">#</th>
                          <th>Trader</th>
                          <th>
                            <button onClick={() => setOrder("PNL")}>
                              API P&L{" "}
                              {order === "PNL" ? <ArrowDown size={12} /> : null}
                            </button>
                          </th>
                          <th>
                            <button onClick={() => setOrder("VOLUME")}>
                              Volume · shares{" "}
                              {order === "VOLUME" ? (
                                <ArrowDown size={12} />
                              ) : null}
                            </button>
                          </th>
                          <th>Investigation</th>
                          <th>
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((trader, index) => (
                          <tr key={trader.address}>
                            <td className="rank-column">
                              {trader.rank || "—"}
                            </td>
                            <td>
                              <Link
                                className="trader-profile"
                                href={`/wallet/${trader.address}`}
                              >
                                <span
                                  className={`trader-avatar ${["sage", "orange", "purple", "blue", "rose", "yellow"][index % 6]}`}
                                >
                                  <span>{trader.name[0]?.toUpperCase()}</span>
                                </span>
                                <span className="trader-name">
                                  <strong>
                                    {trader.name.length > 28
                                      ? `${trader.name.slice(0, 25)}…`
                                      : trader.name}
                                    {trader.verified ? (
                                      <Check size={11} />
                                    ) : null}
                                  </strong>
                                  <span>{shortAddress(trader.address)}</span>
                                </span>
                              </Link>
                            </td>
                            <td
                              className={
                                trader.pnl !== null && trader.pnl < 0
                                  ? "negative profit-value"
                                  : "profit-value"
                              }
                            >
                              {money(trader.pnl)}
                            </td>
                            <td className="volume-value">
                              {compact(trader.volume)}
                            </td>
                            <td>
                              <span className="audit-status">Not assessed</span>
                            </td>
                            <td>
                              <div className="row-actions">
                                <button
                                  className={`bookmark-button ${store.saved.some((t) => t.address === trader.address) ? "is-saved" : ""}`}
                                  aria-label={`${store.saved.some((t) => t.address === trader.address) ? "Remove" : "Save"} ${trader.name}`}
                                  aria-pressed={store.saved.some(
                                    (t) => t.address === trader.address,
                                  )}
                                  onClick={() => bookmark(trader)}
                                >
                                  <Bookmark
                                    size={16}
                                    fill={
                                      store.saved.some(
                                        (t) => t.address === trader.address,
                                      )
                                        ? "currentColor"
                                        : "none"
                                    }
                                  />
                                </button>
                                <Link
                                  className="analyze-row"
                                  href={`/wallet/${trader.address}`}
                                >
                                  Investigate
                                  <ArrowUpRight size={14} />
                                </Link>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!rows.length ? (
                    <div className="empty-state">
                      <Search size={25} />
                      <h3>
                        {view === "watchlist"
                          ? "No saved traders"
                          : view === "recent"
                            ? "No recent investigations"
                            : "No matching traders"}
                      </h3>
                      <p>
                        {query
                          ? "Try another name or address."
                          : "Select a trader from the leaderboard to get started."}
                      </p>
                    </div>
                  ) : null}
                  <div className="table-footer">
                    <span>
                      {filtered.length
                        ? `${currentPage * 10 + 1}–${Math.min((currentPage + 1) * 10, filtered.length)} of ${filtered.length} loaded traders`
                        : "No traders in this view"}
                    </span>
                    <div className="pagination">
                      <button
                        aria-label="Previous page"
                        disabled={currentPage === 0}
                        onClick={() => setPage((x) => x - 1)}
                      >
                        <ChevronLeft size={15} />
                      </button>
                      <span>
                        {currentPage + 1} / {pageCount}
                      </span>
                      <button
                        aria-label="Next page"
                        disabled={currentPage >= pageCount - 1}
                        onClick={() => setPage((x) => x + 1)}
                      >
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>
                  {view === "explore" && board?.nextCursor ? (
                    <button
                      className="load-more"
                      disabled={loadingMore}
                      onClick={more}
                    >
                      {loadingMore ? (
                        <LoaderCircle className="spin" size={15} />
                      ) : null}
                      Load more traders
                    </button>
                  ) : null}
                </>
              )}
            </div>
            <div className="table-disclaimer">
              <Info size={13} />
              <span>
                Finite-period P&L includes mark changes; all-time P&L is
                realized. Volume is shares, not dollars. A leaderboard rank is
                not an anomaly finding.
              </span>
            </div>
          </section>
          <footer className="page-footer">
            <span>
              Public Polymarket records · No wallet connection required
            </span>
            <a
              href="https://data-api.polymarket.com/v2/docs"
              target="_blank"
              rel="noreferrer"
            >
              API documentation
              <ArrowUpRight size={13} />
            </a>
          </footer>
        </main>
      </div>
      {toast ? (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      ) : null}
      {compare && loaded.length >= 2 ? (
        <CompareWallets
          traders={loaded}
          periodLabel={labels[period]}
          onClose={() => setCompare(false)}
        />
      ) : null}
      {lookup ? (
        <Dialog title="Wallet lookup" onClose={() => setLookup(false)}>
          <p className="dialog-description">
            Enter a public Polymarket proxy wallet address.
          </p>
          <form onSubmit={lookupWallet}>
            <div className="wallet-search">
              <Search size={18} />
              <input
                ref={input}
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setAddressError("");
                }}
                placeholder="0x…"
                aria-label="Wallet address"
                autoComplete="off"
                spellCheck={false}
              />
              <button>
                Investigate
                <ArrowRight size={15} />
              </button>
            </div>
            {addressError ? (
              <p className="field-error" role="alert">
                {addressError}
              </p>
            ) : null}
          </form>
        </Dialog>
      ) : null}
      {methodology ? (
        <Dialog
          title="Data & methodology"
          onClose={() => setMethodology(false)}
        >
          <div className="methodology-steps">
            <div>
              <Info size={22} />
              <div>
                <h3>Leaderboard metrics</h3>
                <p>
                  Monthly and weekly P&L reflect marked equity changes. All-time
                  P&L is realized. Volume is both-sides shares; missing values
                  stay unavailable.
                </p>
              </div>
            </div>
            <div>
              <Wallet size={22} />
              <div>
                <h3>Bets in a record</h3>
                <p>
                  A bet is a resolved binary position still held at resolution
                  (shares bought minus sold), costing at least $10 at an average
                  price of 3¢–50¢, without holding both outcomes. Only the
                  largest bet per event counts.
                </p>
              </div>
            </div>
            <div>
              <BookOpen size={22} />
              <div>
                <h3>Interpretation</h3>
                <p>
                  Each bet&apos;s fair chance is the higher of its price and its
                  price bucket&apos;s win rate. The exact chance of the wallet&apos;s
                  wins by luck is the p-value: one wallet is judged at 0.05,
                  wallets tested together use Benjamini–Hochberg. Leaderboard
                  winners are selected for success, so a single unusual record
                  is an anomaly to look at, not an accusation.
                </p>
              </div>
            </div>
          </div>
          <a
            className="outline-button"
            href="https://data-api.polymarket.com/v2/docs"
            target="_blank"
            rel="noreferrer"
          >
            Source documentation
            <ExternalLink size={14} />
          </a>
        </Dialog>
      ) : null}
    </div>
  );
}
