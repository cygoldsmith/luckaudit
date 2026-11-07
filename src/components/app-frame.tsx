"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "./visuals";

export type Section = "markets" | "integrity" | "leaderboard" | "validation" | "wallet";

const NAV: { id: Section; href: string; label: string }[] = [
  { id: "markets", href: "/", label: "Markets" },
  { id: "integrity", href: "/integrity", label: "Integrity search" },
  { id: "leaderboard", href: "/leaderboard", label: "Leaderboard" },
  { id: "validation", href: "/validation", label: "Validation" },
];

/** Sticky translucent top navigation shared by every page. */
export function SiteHeader({ active }: { active: Section }) {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="site-brand" href="/">
          <Logo />
          <span>LuckAudit</span>
        </Link>
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
