"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Bookmark, Clock3, Info, LoaderCircle, Search } from "lucide-react";
import AppFrame from "@/components/app-frame";
import { readStore, requestJson } from "@/lib/client";
import { shortAddress, type Trader } from "@/lib/domain";
import { parseWalletQuery } from "@/lib/wallet-lookup";

type Lookup = { address: string | null; name?: string | null; candidates: { name: string; address: string }[] };

export default function WalletLookup() {
  const router = useRouter();
  const [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [candidates, setCandidates] = useState<Lookup["candidates"]>([]),
    [saved, setSaved] = useState<Trader[]>([]),
    [recent, setRecent] = useState<Trader[]>([]);

  async function lookup(value: string) {
    setError("");
    setCandidates([]);
    const parsed = parseWalletQuery(value);
    if (!parsed) {
      setError("Paste a wallet address (0x…), an @username, or a Polymarket profile link.");
      return;
    }
    if (parsed.kind === "address") {
      router.push(`/wallet/${parsed.address}`);
      return;
    }
    setBusy(true);
    try {
      const r = await requestJson<Lookup>(`/api/wallet-lookup?q=${encodeURIComponent(value.trim())}`);
      if (r.address) router.push(`/wallet/${r.address}`);
      else setCandidates(r.candidates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const store = readStore();
    setSaved(store.saved);
    setRecent(store.recent);
    // Lookups started from the header search arrive as ?q=.
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      setInput(q);
      lookup(q);
    }
    // lookup only uses stable setters and the router
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppFrame active="wallets">
      <main>
        <div className="page-heading">
          <div>
            <h1>Wallet lookup</h1>
            <p>
              Paste a wallet to see whether its record on resolved bets is too good to be luck under calibrated market
              odds.
            </p>
          </div>
        </div>
        <section className="panel wallet-lookup">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              lookup(input);
            }}
          >
            <div className="site-search wallet-lookup-input">
              <Search size={18} aria-hidden="true" />
              <input
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setError("");
                }}
                placeholder="0x… address, @username, or polymarket.com/@name"
                aria-label="Wallet address, username or profile link"
                autoComplete="off"
                autoFocus
              />
            </div>
            <button className="primary-button" type="submit" disabled={busy || !input.trim()}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <ArrowRight size={15} />}
              Assess wallet
            </button>
          </form>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          {candidates.length ? (
            <div className="wallet-candidates">
              <p>No exact match. Did you mean:</p>
              {candidates.map((c) => (
                <Link key={c.address} href={`/wallet/${c.address}`} className="wallet-row">
                  <strong>{c.name || shortAddress(c.address)}</strong>
                  <span>{shortAddress(c.address)}</span>
                  <ArrowUpRight size={14} />
                </Link>
              ))}
            </div>
          ) : null}
          <p className="panel-footnote">
            <Info size={12} /> The assessment uses the wallet&apos;s resolved bets: Test 1 (wins vs. calibrated odds),
            Test 2 (entries before price jumps) and leave-one-event-out, against {""}
            <Link href="/method">the library population</Link>. Statistical anomaly under market odds; consistent with
            skill, speed, or information. Not an accusation.
          </p>
        </section>
        <div className="analysis-grid">
          <WalletList title="Saved wallets" icon={<Bookmark size={15} />} wallets={saved} empty="Save a wallet from its page to keep it here." />
          <WalletList title="Recently viewed" icon={<Clock3 size={15} />} wallets={recent} empty="Wallets you open appear here." />
        </div>
      </main>
    </AppFrame>
  );
}

function WalletList({ title, icon, wallets, empty }: { title: string; icon: React.ReactNode; wallets: Trader[]; empty: string }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>
            {icon} {title}
          </h2>
        </div>
      </div>
      {wallets.length ? (
        <div className="wallet-list">
          {wallets.slice(0, 12).map((t) => (
            <Link key={t.address} href={`/wallet/${t.address}`} className="wallet-row">
              <strong>{t.name && t.name !== shortAddress(t.address) ? t.name : shortAddress(t.address)}</strong>
              <span>{shortAddress(t.address)}</span>
              <ArrowUpRight size={14} />
            </Link>
          ))}
        </div>
      ) : (
        <p className="chart-empty">{empty}</p>
      )}
    </section>
  );
}
