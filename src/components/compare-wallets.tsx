"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import Dialog from "./dialog";
import { compact, money, shortAddress, type Trader } from "@/lib/domain";
export default function CompareWallets({
  traders,
  onClose,
  periodLabel,
}: {
  traders: Trader[];
  onClose: () => void;
  periodLabel: string;
}) {
  const [left, setLeft] = useState(traders[0]?.address || "");
  const [right, setRight] = useState(traders[1]?.address || "");
  const a = traders.find((t) => t.address === left),
    b = traders.find((t) => t.address === right);
  return (
    <Dialog title="Compare traders" onClose={onClose}>
      <p className="dialog-description">
        Reported leaderboard performance · {periodLabel}. Volume is in shares.
      </p>
      {a && b ? (
        <>
          <div className="comparison-selectors">
            {[
              { value: left, set: setLeft, other: right },
              { value: right, set: setRight, other: left },
            ].map(({ value, set, other }, i) => (
              <label key={i}>
                <span>{i ? "Second trader" : "First trader"}</span>
                <select value={value} onChange={(e) => set(e.target.value)}>
                  {traders.map((t) => (
                    <option
                      key={t.address}
                      value={t.address}
                      disabled={t.address === other}
                    >
                      {t.name}
                    </option>
                  ))}
                </select>
                <small>{shortAddress(value)}</small>
              </label>
            ))}
          </div>
          <div className="comparison-metrics">
            <div>
              <span>API P&L</span>
              <strong>{money(a.pnl)}</strong>
              <strong>{money(b.pnl)}</strong>
            </div>
            <div>
              <span>Volume (shares)</span>
              <strong>{compact(a.volume)}</strong>
              <strong>{compact(b.volume)}</strong>
            </div>
            <div>
              <span>Board rank</span>
              <strong>{a.rank || "—"}</strong>
              <strong>{b.rank || "—"}</strong>
            </div>
          </div>
          <div className="comparison-actions">
            {[a, b].map((t) => (
              <Link
                className="outline-button"
                key={t.address}
                href={`/wallet/${t.address}`}
              >
                Investigate {t.name.slice(0, 20)}
                <ArrowUpRight size={14} />
              </Link>
            ))}
          </div>
          <p className="comparison-note">
            These are leaderboard statistics, not anomaly findings. Open an
            investigation to inspect the underlying positions.
          </p>
        </>
      ) : (
        <p>Load at least two traders to compare.</p>
      )}
    </Dialog>
  );
}
