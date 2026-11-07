"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Search } from "lucide-react";
import { Logo } from "./visuals";

export type Section = "markets" | "integrity" | "leaderboard" | "validation" | "wallet";

const NAV: { id: Section; href: string; label: string }[] = [
  { id: "markets", href: "/", label: "Markets" },
  { id: "integrity", href: "/integrity", label: "Integrity search" },
  { id: "leaderboard", href: "/leaderboard", label: "Leaderboard" },
  { id: "validation", href: "/validation", label: "Validation" },
];

/** Event the market explorer listens for when a search is made from the header. */
export const SEARCH_EVENT = "luckaudit:search";

function HeaderSearch() {
  const router = useRouter(),
    pathname = usePathname(),
    [value, setValue] = useState("");
  return (
    <form
      className="site-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (!q) return;
        if (pathname === "/") window.dispatchEvent(new CustomEvent(SEARCH_EVENT, { detail: q }));
        router.push(`/?q=${encodeURIComponent(q)}`);
      }}
    >
      <Search size={16} aria-hidden="true" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search markets or paste a Polymarket link"
        aria-label="Search markets"
        autoComplete="off"
      />
    </form>
  );
}

/** Sticky translucent top navigation shared by every page. */
export function SiteHeader({ active }: { active: Section }) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="site-brand" href="/">
          <Logo />
          <span>LuckAudit</span>
        </Link>
        <HeaderSearch />
        <nav className="site-nav" aria-label="Main navigation">
          {NAV.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={active === item.id ? "active" : ""}
              aria-current={active === item.id ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <a className="site-external" href="https://polymarket.com" target="_blank" rel="noreferrer">
          Polymarket
          <ArrowUpRight size={13} />
        </a>
      </div>
    </header>
  );
}

export default function AppFrame({
  active,
  children,
}: {
  active: Section;
  children: React.ReactNode;
}) {
  return (
    <div className="site">
      <SiteHeader active={active} />
      <div className="site-main">{children}</div>
    </div>
  );
}
