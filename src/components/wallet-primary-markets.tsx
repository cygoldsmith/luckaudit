"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import { primaryMarkets } from "@/lib/market-analysis";
import { compact, money, type WalletBundle } from "@/lib/domain";
export default function WalletPrimaryMarkets({
  bundle,
}: {
  bundle: WalletBundle;
}) {
  const all = useMemo(() => primaryMarkets(bundle), [bundle]),
    [sort, setSort] = useState("turnover"),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(0);
  const rows = all
      .filter((m) => m.title.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) =>
        sort === "fills"
          ? b.fills - a.fills
          : sort === "buy"
            ? b.buyNotional - a.buyNotional
            : b.turnover - a.turnover,
      ),
    pages = Math.max(1, Math.ceil(rows.length / 12)),
    current = Math.min(page, pages - 1);
  return (
    <section className="panel positions-panel">
      <div className="panel-heading">
        <div>
          <h2>Primary markets</h2>
          <p>
            Where this wallet trades, ranked within its retrieved history.
            Turnover includes purchases and sales; it is not net capital
            committed.
          </p>
        </div>
        <span className="chart-source-label">
          {all.length} observed markets
        </span>
      </div>
      <div className="evidence-filters">
        <label className="table-search">
          <Search size={15} />
          <input
            aria-label="Search wallet markets"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Search this wallet’s markets…"
          />
        </label>
        <select
          aria-label="Rank primary markets"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(0);
          }}
        >
          <option value="turnover">Observed turnover</option>
          <option value="buy">Purchase notional</option>
          <option value="fills">Number of fills</option>
        </select>
      </div>
      <div className="table-scroll">
        <table className="records-table">
          <thead>
            <tr>
              <th>Market</th>
              <th>Observed turnover / share</th>
              <th>Purchase notional</th>
              <th>Fills</th>
              <th>Loaded realized P&L</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.slice(current * 12, (current + 1) * 12).map((m) => (
              <tr key={m.condition}>
                <td className="market-cell">
                  <Link href={`/market/${m.condition}`}>
                    {m.title || m.condition}
                    <ArrowUpRight size={12} />
                  </Link>
                </td>
                <td>
                  {money(m.turnover)}
                  <span className="cell-subline">
                    {(m.turnoverShare * 100).toFixed(1)}% of loaded turnover
                  </span>
                </td>
                <td>{money(m.buyNotional)}</td>
                <td>{compact(m.fills)}</td>
                <td
                  className={
                    m.realizedPnl !== null && m.realizedPnl < 0
                      ? "negative"
                      : "positive"
                  }
                >
                  {money(m.realizedPnl)}
                </td>
                <td>
                  <Link className="analyze-row" href={`/market/${m.condition}`}>
                    Inspect market
                    <ArrowUpRight size={13} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length ? (
        <p className="chart-empty">
          No matching markets in the retrieved wallet history.
        </p>
      ) : null}
      <div className="table-footer">
        <span>
          {rows.length} loaded markets ·{" "}
          {bundle.coverage.trades
            ? "API walk completed"
            : "Partial trade history"}
        </span>
        <div className="pagination">
          <button
            aria-label="Previous wallet markets"
            disabled={!current}
            onClick={() => setPage((p) => p - 1)}
          >
            ←
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            aria-label="Next wallet markets"
            disabled={current >= pages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            →
          </button>
        </div>
      </div>
    </section>
  );
}
