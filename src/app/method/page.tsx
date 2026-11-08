"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import AppFrame from "@/components/app-frame";
import PlainReportView from "@/components/plain-report";
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
  return (
    <AppFrame active="method">
      <main>
        <div className="page-heading">
          <div>
            <h1>Method</h1>
            <p>How LuckAudit decides, how often it is wrong, and what it can and can&apos;t see, in plain language.</p>
          </div>
        </div>
        {error ? <div className="inline-notice warning">{error}</div> : null}
        {!data && !error ? (
          <div className="loading-state" role="status">
            <LoaderCircle className="spin" size={27} />
            <p>Summarizing the library and the validation results…</p>
          </div>
        ) : null}
        {data ? <PlainReportView report={methodPlainSummary(data.summary, data.check)} generatedAt={data.check.computedAt} /> : null}

        <section className="method-advanced">
          <button className="outline-button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
            {advanced ? "Hide the advanced statistics" : "Show the advanced statistics"}
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
