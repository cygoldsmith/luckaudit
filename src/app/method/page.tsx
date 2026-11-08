"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, LoaderCircle } from "lucide-react";
import AppFrame from "@/components/app-frame";
import { MethodCheck, Parameters } from "@/components/integrity-sections";
import { requestJson } from "@/lib/client";
import { methodPlainSummary } from "@/lib/plain-report";
import type { librarySummary, methodCheck } from "@/lib/integrity/data";

type Summary = {
  summary: Awaited<ReturnType<typeof librarySummary>>;
  check: Awaited<ReturnType<typeof methodCheck>>;
};

export default function MethodPage() {
  const [data, setData] = useState<Summary | null>(null),
    [error, setError] = useState(""),
    [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    requestJson<Summary>("/api/integrity/summary")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Summary unavailable."));
  }, []);

  const report = data ? methodPlainSummary(data.summary, data.check) : null;
  const a = data?.check.placeboA;
  const figures = data
    ? [
        { value: data.summary.markets.toLocaleString(), label: "Resolved markets in the library" },
        { value: data.summary.tested.toLocaleString(), label: "Wallets with enough bets to judge" },
        { value: (data.summary.tiers[1] + data.summary.tiers[2]).toLocaleString(), label: "Records very unlikely to be luck" },
        {
          value: a!.meanFlags === 0 ? "0" : a!.meanFlags.toFixed(1),
          label: a!.meanFlags === 0 ? `False flags in ${a!.runs} fake-wallet runs` : `Average false flags per fake-wallet run`,
        },
      ]
    : [];

  return (
    <AppFrame active="method">
      <main className="method-page">
        <header className="method-hero">
          <h1>How LuckAudit works</h1>
          <p>How it decides, how often it is wrong, and what it can and can&apos;t see.</p>
        </header>

        {error ? <div className="inline-notice warning">{error}</div> : null}
        {!data && !error ? (
          <div className="loading-state" role="status">
            <LoaderCircle className="spin" size={27} />
            <p>Summarizing the library and the validation results…</p>
          </div>
        ) : null}

        {report ? (
          <>
            <dl className="method-figures">
              {figures.map((f) => (
                <div key={f.label}>
                  <dd>{f.value}</dd>
                  <dt>{f.label}</dt>
                </div>
              ))}
            </dl>

            <article className="method-doc">
              {report.sections.map((s) => (
                <section key={s.heading}>
                  <h2>{s.heading}</h2>
                  <ul>
                    {s.body.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </article>
            <p className="method-note">
              Written from computed results, not by AI. A flag is a statistical anomaly under market odds, consistent
              with skill, speed, or information. It is not an accusation.
            </p>
          </>
        ) : null}

        <section className="method-advanced">
          <button
            className={`method-disclosure${advanced ? " open" : ""}`}
            onClick={() => setAdvanced((v) => !v)}
            aria-expanded={advanced}
          >
            <span>
              <strong>Advanced statistics</strong>
              <small>Calibration, placebos, power, controls and every parameter</small>
            </span>
            <ChevronDown size={18} aria-hidden="true" />
          </button>
          {advanced ? (
            <div className="method-advanced-body">
              <MethodCheck />
              <Parameters />
              <p className="panel-footnote">
                Synthetic benchmarks (known-answer checks of the arithmetic):{" "}
                <Link href="/validation">
                  open <ArrowUpRight size={12} />
                </Link>
              </p>
            </div>
          ) : null}
        </section>
      </main>
    </AppFrame>
  );
}
