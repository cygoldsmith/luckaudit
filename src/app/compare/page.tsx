"use client";
import AppFrame from "@/components/app-frame";
import { MultiSearch } from "@/components/integrity-sections";
import { DISCLAIMER } from "@/components/integrity-panel";
import { Info } from "lucide-react";

export default function ComparePage() {
  return (
    <AppFrame active="compare">
      <main>
        <div className="page-heading">
          <div>
            <h1>Compare markets</h1>
            <p>
              Check many markets at once and see which ones drew unusually many traders with records luck can&apos;t
              explain. Checking several together raises the bar, so a result that is only lucky doesn&apos;t stand out.
            </p>
          </div>
        </div>
        <p className="market-scope-banner">
          <Info size={15} /> <strong>{DISCLAIMER}</strong>
        </p>
        <MultiSearch />
      </main>
    </AppFrame>
  );
}
