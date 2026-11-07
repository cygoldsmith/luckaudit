"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, LoaderCircle, Printer } from "lucide-react";
import { requestJson } from "@/lib/client";
import { marketPlainReport, type PlainReport } from "@/lib/plain-report";
import type { IntegrityReport } from "@/lib/integrity/data";

/** Plain-English evidence report with collapsible statistics and print-to-PDF. */
export default function PlainReportView({ report, generatedAt }: { report: PlainReport; generatedAt?: string }) {
  return (
    <article className={`panel plain-report tone-${report.tone}`}>
      <header className="plain-report-head">
        <div>
          <div className="eyebrow">EVIDENCE REPORT</div>
          <h2>{report.title}</h2>
          <p className="plain-report-verdict">{report.verdict}</p>
        </div>
        <button className="outline-button no-print" onClick={() => window.print()}>
          <Printer size={15} /> Print / save as PDF
        </button>
      </header>

      {report.sections.map((s) => (
        <section key={s.heading}>
          <h3>{s.heading}</h3>
          {s.body.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </section>
      ))}

      {report.items ? (
        <section>
          <h3>{report.items.heading}</h3>
          <ul className="plain-report-items">
            {report.items.rows.map((row, i) => (
              <li key={i}>
                {row.href ? (
                  <Link className="evidence-link" href={row.href}>
                    {row.label}
                    <ArrowUpRight size={12} />
                  </Link>
                ) : (
                  <strong>{row.label}</strong>
                )}
                <span>{row.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <details className="plain-report-technical">
        <summary>Show the statistics</summary>
        <dl>
          {report.technical.map((t) => (
            <div key={t.label}>
              <dt>{t.label}</dt>
              <dd>{t.value}</dd>
            </div>
          ))}
        </dl>
      </details>

      <section>
        <h3>What this can&apos;t tell you</h3>
        <ul className="plain-report-limits">
          {report.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <footer className="plain-report-foot">
        Written from computed results, not by AI. Statistical anomaly under market odds; consistent with skill, speed, or
        information. Not an accusation.{generatedAt ? ` Generated ${new Date(generatedAt).toLocaleString()}.` : ""}
      </footer>
    </article>
  );
}

/* Market report tab: loads the wallet-based analysis and writes it up. */

export function MarketReportTab({ condition }: { condition: string }) {
  const [data, setData] = useState<IntegrityReport | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    requestJson<IntegrityReport>(`/api/integrity/${condition}`)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof Error ? e.message : "Report unavailable."));
    return () => {
      live = false;
    };
  }, [condition]);
  if (error) return <div className="inline-notice warning">{error}</div>;
  if (!data)
    return (
      <div className="loading-state" role="status">
        <LoaderCircle className="spin" size={27} />
        <p>Writing the report from this market&apos;s wallet analysis…</p>
      </div>
    );
  return <PlainReportView report={marketPlainReport(data)} generatedAt={data.generatedAt} />;
}
