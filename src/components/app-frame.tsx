"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  AudioLines,
  Bookmark,
  ChevronRight,
  Compass,
  FlaskConical,
  History,
  Menu,
  Search,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Logo } from "./visuals";
export default function AppFrame({
  active,
  children,
}: {
  active: "markets" | "validation" | "integrity";
  children: React.ReactNode;
}) {
  const [mobile, setMobile] = useState(false);
  return (
    <div className="app-shell">
      {mobile ? (
        <button
          className="nav-scrim"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        />
      ) : null}
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <Link className="brand" href="/">
          <Logo />
          <span>LuckAudit</span>
        </Link>
        <div className="platform-label">
          <AudioLines size={17} />
          <span>Prediction market intelligence</span>
        </div>
        <p className="nav-caption">INVESTIGATE</p>
        <nav aria-label="Main navigation">
          <Link
            className={`nav-item ${active === "markets" ? "active" : ""}`}
            href="/"
          >
            <Search size={18} />
            <span>Market explorer</span>
          </Link>
          <Link
            className={`nav-item ${active === "integrity" ? "active" : ""}`}
            href="/integrity"
          >
            <ShieldCheck size={18} />
            <span>Integrity search</span>
          </Link>
          <Link className="nav-item" href="/leaderboard">
            <Compass size={18} />
            <span>Trader leaderboard</span>
          </Link>
          <Link className="nav-item" href="/leaderboard?view=watchlist">
            <Bookmark size={18} />
            <span>Watchlist</span>
          </Link>
          <Link className="nav-item" href="/leaderboard?view=recent">
            <History size={18} />
            <span>Recently viewed</span>
          </Link>
        </nav>
        <div className="sidebar-divider" />
        <p className="nav-caption">RESEARCH</p>
        <Link
          className={`nav-item ${active === "validation" ? "active" : ""}`}
          href="/validation"
        >
          <FlaskConical size={18} />
          <span>Validation</span>
        </Link>
        <Link className="nav-item" href="/leaderboard">
          <Wallet size={18} />
          <span>Wallet lookup</span>
        </Link>
        <div className="sidebar-bottom">
          <div className="data-source-card">
            <div>
              <span className="tiny-dot" />
              {active === "validation" ? "VALIDATION SCOPE" : "DATA SOURCES"}
            </div>
            <strong>
              {active === "validation"
                ? "Known synthetic labels"
                : "Public Polymarket APIs"}
            </strong>
            <p>
              {active === "validation"
                ? "Real-world FDR is not measured"
                : "Gamma metadata + trading records"}
            </p>
          </div>
          <Link className="nav-item" href="/validation">
            <Activity size={18} />
            <span>Coverage & limitations</span>
            <ArrowUpRight size={14} />
          </Link>
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
              {active === "markets"
                ? "Market explorer"
                : active === "integrity"
                  ? "Integrity search"
                  : "Validation"}
            </span>
          </div>
          <Link
            className="topbar-help"
            href={active === "markets" ? "/validation" : "/"}
          >
            {active === "markets" ? (
              <FlaskConical size={15} />
            ) : (
              <Search size={15} />
            )}
            <span>
              {active === "markets" ? "View validation" : "Explore markets"}
            </span>
          </Link>
        </header>
        {children}
      </div>
    </div>
  );
}
