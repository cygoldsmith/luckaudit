/**
 * Plain-English evidence reports, written from templates. No AI: every
 * sentence is filled in from computed numbers, so nothing can be overstated.
 */
import type { IntegrityReport } from "./integrity/data";
import type { WalletResult } from "./integrity/wallet-spec";
import type { Audit } from "./domain";

export interface PlainReport {
  /** Small label above the title (defaults to "Evidence report"). */
  eyebrow?: string;
  title: string;
  verdict: string;
  tone: "alert" | "calm" | "muted";
  sections: { heading: string; body: string[] }[];
  items?: { heading: string; rows: { label: string; detail: string; href?: string }[] };
  technical: { label: string; value: string }[];
  limits: string[];
}

/* ------------------------------------------------------------- phrasing */

const NUMBER_WORDS = [
  [1e9, "billion"],
  [1e6, "million"],
  [1e3, "thousand"],
] as const;

/** 4.3e9 → "4 billion", 52,000 → "52 thousand", 180 → "180". */
export function humanNumber(n: number) {
  for (const [size, word] of NUMBER_WORDS)
    if (n >= size) {
      const v = n / size;
      return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${word}`;
    }
  return String(n >= 100 ? Math.round(n / 10) * 10 : Math.round(n));
}

/** A probability as everyday odds: 0.024 → "about 2 in 100"; 2.3e-10 → "roughly 1 in 4.3 billion". */
export function oddsPhrase(p: number) {
  if (p >= 0.5) return "more often than not";
  if (p >= 0.095) return `about ${Math.round(p * 10)} in 10`;
  if (p >= 0.0095) return `about ${Math.round(p * 100)} in 100`;
  return `roughly 1 in ${humanNumber(1 / p)}`;
}

const about = (x: number) => (x < 1 ? "less than 1" : `about ${Math.round(x)}`);
const pct = (x: number) => `${Math.round(x * 100)}%`;
/** A share of money: never "0%" for a real but tiny share. */
const sharePct = (x: number) => (x > 0 && x < 0.005 ? "less than 1%" : pct(x));
const fmtP = (p: number | null | undefined) =>
  p === null || p === undefined ? "—" : p < 0.001 ? p.toExponential(1) : p.toFixed(3);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const CATEGORY_NOUN: Record<string, string> = {
  politics: "a politics market",
  awards: "an awards market",
  announcements: "a company or government announcement market",
  control: "a crypto price market",
};

function placeboSentence(fdr: number | null) {
  if (fdr === null) return "We haven't yet measured how often this check raises false alarms.";
  if (fdr === 0) return "When we run the same check on fake wallets built from random real bets, it flags none of them.";
  return `When we run the same check on fake wallets built from random real bets, about ${pct(fdr)} of flags turn out to be false alarms.`;
}

const LIMITS = [
  "A wallet with only one or two bets can't be judged, so a one-time insider is invisible to this check.",
  "One person using many wallets looks like many ordinary traders.",
  "Only bets held until the market resolved count toward a record.",
  "Wallets are shown by shortened address only; we never try to link a wallet to a person.",
];

/* --------------------------------------------------------------- market */

export function marketPlainReport(r: IntegrityReport): PlainReport {
  const p = r.participation,
    noun = CATEGORY_NOUN[p.rateBasis] ?? "a market like this",
    flagged = p.rows.filter((x) => x.flagged),
    live = !r.market.resolution.resolved;
  const sections: PlainReport["sections"] = [];

  if (p.verdict === "not-testable") {
    sections.push({
      heading: "What we found",
      body: [
        `Only ${p.tested} of the ${p.examined} biggest traders in this market have enough past bets (5 or more) for us to judge their records. That isn't enough to say anything about this market.`,
      ],
    });
    sections.push({
      heading: "What that means",
      body: [
        "This is neither a warning nor a clean bill of health. Most traders here are too new or too occasional to have a track record.",
      ],
    });
  } else {
    const found = [
      `${p.flagged === 0 ? "None" : p.flagged} of the ${p.tested} wallets we could check in this market ${p.flagged === 1 ? "has a track record" : "have track records"} elsewhere that ${p.flagged === 1 ? "is" : "are"} very hard to explain by luck. For ${noun} we'd expect ${about(p.expected)}.`,
    ];
    if (p.flagged) found.push(`${p.flagged === 1 ? "That wallet" : `Those ${p.flagged} wallets`} placed ${sharePct(p.flaggedVolumeShare)} of the money traded here.`);
    sections.push({ heading: "What we found", body: found });
    sections.push({
      heading: "What that means",
      body:
        p.verdict === "elevated"
          ? [
              `This market drew more unusually successful traders than is typical for ${noun}.`,
              "That is consistent with skill, speed, or inside information. This tool can't tell which, and it isn't an accusation.",
            ]
          : [
              `The traders here look like the traders in similar markets: no more unusually successful wallets than usual for ${noun}.`,
              "That doesn't prove nothing happened. A careful insider who trades small can stay invisible.",
            ],
    });
    const sure = [`A result at least this lopsided would happen by chance ${oddsPhrase(p.p!)}.`];
    const cc = r.categoryCheck;
    if (p.verdict === "elevated" && cc)
      sure.push(
        cc.flagged
          ? `It still stands out when checked together with all ${cc.markets.toLocaleString()} similar markets in our library.`
          : `But when we checked it together with the other ${(cc.markets - 1).toLocaleString()} similar markets in our library, it no longer stood out. With that many markets, a few results like this are expected by chance.`,
      );
    sure.push(placeboSentence(r.population.empiricalFdr));
    sections.push({ heading: "How sure are we?", body: sure });
  }
  if (live)
    sections.push({
      heading: "This market is still open",
      body: ["Bets placed here don't count toward anyone's record until it resolves. The verdict is about who is trading, not about how the market will end."],
    });

  return {
    title: r.market.title,
    verdict:
      p.verdict === "elevated"
        ? "More unusually successful traders than usual"
        : p.verdict === "typical"
          ? "Typical mix of traders"
          : "Not enough data to judge",
    tone: p.verdict === "elevated" ? "alert" : p.verdict === "typical" ? "calm" : "muted",
    sections,
    items: flagged.length
      ? {
          heading:
            p.verdict === "elevated"
              ? "The wallets that stood out"
              : "Wallets with unusual records (about as many as usual here)",
          rows: flagged.map((x) => ({
            label: short(x.wallet),
            href: `/wallet/${x.wallet}`,
            detail: `Won ${x.card!.O} of ${x.card!.n} bets when ${about(x.card!.E)} wins were expected. The chance of that by luck is ${oddsPhrase(x.card!.p1)}. Placed ${sharePct(x.share)} of the money traded here.`,
          })),
        }
      : undefined,
    technical: [
      { label: "Verdict", value: p.verdict },
      { label: "Flagged / tested participants", value: `${p.flagged} / ${p.tested} (of ${p.examined} examined)` },
      { label: "Comparison rate", value: `${(p.baseRate * 100).toFixed(2)}% (${p.rateBasis}, ${p.rateTested.toLocaleString()} tested participants)` },
      { label: "Exact binomial p", value: fmtP(p.p) },
      { label: "Category check (BH q)", value: r.categoryCheck ? `${fmtP(r.categoryCheck.q)} across ${r.categoryCheck.markets.toLocaleString()} markets` : "—" },
      { label: "Flag rule", value: `Tier 1–2 and Test 1 p ≤ ${fmtP(r.population.cutoff)} without this market (${r.population.primary} at 5%, m = ${r.population.m.toLocaleString()})` },
      { label: "Placebo A false-flag rate", value: r.population.empiricalFdr === null ? "not measured" : pct(r.population.empiricalFdr) },
      { label: "Method", value: r.method },
    ],
    limits: LIMITS,
  };
}

/* --------------------------------------------------------------- wallet */

export function walletPlainReport(input: {
  address: string;
  name: string;
  card: WalletResult | null;
  tested: number;
  empiricalFdr: number | null;
  audit: Audit;
}): PlainReport {
  const c = input.card,
    sections: PlainReport["sections"] = [];
  const r = input.audit.record;

  // Wallets outside the library: describe the own-history fallback.
  if (!c || !c.tested1) {
    const usable = r.p !== null && (r.label === "unusual-record" || r.label === "nothing-unusual");
    sections.push({
      heading: "What we found",
      body: usable
        ? [`This wallet won ${r.wins} of ${r.observations} qualifying bets. Given the prices it paid, a typical trader would win ${about(r.expected)}.`]
        : [
            c
              ? `This wallet has only ${plural(c.n, "qualifying bet")} in our library, fewer than the 5 we need to judge a record.`
              : "This wallet doesn't appear in the markets in our library, so it has no record we can judge.",
          ],
    });
    sections.push({
      heading: "What that means",
      body: usable
        ? r.label === "unusual-record"
          ? [`The chance of doing this well by luck is ${oddsPhrase(r.p!)}. That is consistent with skill, speed, or inside information, and it isn't an accusation.`, "This result comes from the wallet's own history only, not the full population check, so treat it as a first look."]
          : ["Its record is in line with what luck and the prices it paid would produce."]
        : ["This is neither a warning nor a clean bill of health; there just isn't enough history."],
    });
    return {
      title: input.name,
      verdict: usable ? (r.label === "unusual-record" ? "Unusually successful record (first look)" : "Record in line with luck") : "Not enough data to judge",
      tone: usable && r.label === "unusual-record" ? "alert" : usable ? "calm" : "muted",
      sections,
      technical: [
        { label: "Source", value: "Own retrieved history (wallet not tested in the library)" },
        { label: "Wins / expected", value: r.observations ? `${r.wins} / ${r.expected.toFixed(2)} of ${r.observations}` : "—" },
        { label: "Exact p (single test)", value: fmtP(r.p) },
        { label: "Label", value: r.label },
      ],
      limits: LIMITS,
    };
  }

  sections.push({
    heading: "What we found",
    body: [`This wallet won ${c.O} of ${c.n} bets. Given the prices it paid, a typical trader would win ${about(c.E)}.`],
  });
  const flaggedTier = c.tier === 1 || c.tier === 2;
  const meaning: string[] = [];
  if (flaggedTier) {
    meaning.push(`The chance of doing this well by luck is ${oddsPhrase(c.p1)}. That is very hard to explain by luck alone.`);
    meaning.push("It is consistent with skill, speed, or inside information. This tool can't tell which, and it isn't an accusation.");
  } else if (c.tier === 3)
    meaning.push("Something about this record stands out, but it doesn't hold up under our stricter checks (for example, it depends on a single bet), so we don't count it as an anomaly.");
  else meaning.push(`Its record is in line with what luck and the prices it paid would produce (a result like this happens ${oddsPhrase(c.p1)}).`);
  if (flaggedTier && c.group === "control")
    meaning.push("Most of its bets are in crypto price markets, where inside information is essentially impossible, so skill or speed is the likelier explanation.");
  else if (flaggedTier && c.edge === "high-volume") meaning.push("Its pattern (many bets with a modest edge) looks more like a skilled or automated trader.");
  else if (flaggedTier && c.edge === "concentrated-longshot")
    meaning.push("Its pattern (a few bets, mostly cheap long shots that paid off) is the kind most worth a closer look.");
  sections.push({ heading: "What that means", body: meaning });

  const sure = [`We checked ${input.tested.toLocaleString()} wallets, and this result accounts for that: it isn't just the luckiest of many.`];
  if (c.loeo === true) sure.push("It still holds up after we remove its single most surprising win.");
  if (c.loeo === false) sure.push("It does not hold up once we remove its single most surprising win, so one bet is doing most of the work.");
  if (c.test2) sure.push("It also bought into markets just before sudden price jumps more often than other traders did.");
  sure.push(placeboSentence(input.empiricalFdr));
  sections.push({ heading: "How sure are we?", body: sure });

  return {
    title: input.name,
    verdict:
      c.tier === 1
        ? "Strong anomaly: very unlikely to be luck"
        : c.tier === 2
          ? "Anomaly: very unlikely to be luck"
          : c.tier === 3
            ? "Something stands out, but it doesn't hold up"
            : "Record in line with luck",
    tone: flaggedTier ? "alert" : c.tier === 3 ? "muted" : "calm",
    sections,
    items: c.top.length
      ? {
          heading: "Its most surprising bets",
          rows: c.top.map((b) => ({
            label: b.won ? "Won" : "Lost",
            detail: `Bought at ${Math.round(b.p * 100)}¢ (about a ${Math.round(b.q * 100)}% chance) on “${b.title}”.`,
          })),
        }
      : undefined,
    technical: [
      { label: "Tier", value: String(c.tier) },
      { label: "Test 1: wins / expected", value: `${c.O} / ${c.E.toFixed(2)} of ${c.n}` },
      { label: "Test 1 p / q", value: `${fmtP(c.p1)} / ${fmtP(c.q1)}${c.byRobust ? " · BY-robust" : ""}` },
      { label: "Odds multiplier", value: c.odds === null ? "—" : c.odds === Infinity ? `all ${c.n} won` : `×${c.odds.toFixed(1)}` },
      { label: "Leave-one-event-out", value: c.loeo === null ? "—" : c.loeo ? `pass (p ${fmtP(c.loeoP)})` : `fail (p ${fmtP(c.loeoP)})` },
      { label: "Test 2: entries before jumps", value: `${c.K} vs ${c.EK.toFixed(1)} expected · q ${fmtP(c.q2)}` },
      { label: "Edge profile / group", value: `${c.edge} · ${c.group} (${pct(c.studyShare)} study bets)` },
      { label: "Placebo A false-flag rate", value: input.empiricalFdr === null ? "not measured" : pct(input.empiricalFdr) },
    ],
    limits: LIMITS,
  };
}

/* ---------------------------------------------------------- method page */

type MethodCheckData = Awaited<ReturnType<typeof import("./integrity/data").methodCheck>>;
type LibrarySummary = Awaited<ReturnType<typeof import("./integrity/data").librarySummary>>;

/** The Method page in plain English: how it works and how far to trust it. */
export function methodPlainSummary(summary: LibrarySummary, check: MethodCheckData): PlainReport {
  const a = check.placeboA,
    anomalies = summary.tiers[1] + summary.tiers[2],
    recall = (n: number, or: number) => check.positiveControl.find((c) => c.n === n && c.or === or)?.recall ?? null,
    study = summary.categories.filter((c) => c.id !== "control"),
    control = summary.categories.find((c) => c.id === "control"),
    nc = check.negativeControl,
    fitted = check.calibration.filter((b) => b.usesFit && b.meanPrice !== null && b.winRate !== null),
    maxGap = fitted.reduce((m, b) => Math.max(m, Math.abs(b.winRate! - b.meanPrice!)), 0),
    cheapest = fitted[0];
  const elevatedStudyAlone = study.reduce((s, c) => s + c.elevatedAlone, 0),
    testableStudy = study.reduce((s, c) => s + c.testable, 0),
    elevatedCorrected = summary.categories.reduce((s, c) => s + c.elevatedCorrected, 0);
  const r50 = recall(50, 4),
    r20 = recall(20, 4);

  const wrong = [
    a.fdr === null
      ? "We haven't measured the false-alarm rate yet."
      : a.meanFlags === 0
        ? `We built fake wallets from random real bets and ran the full check on them ${a.runs} times. It flagged none of them, while it flagged ${a.realFlags} real wallets.`
        : `We built fake wallets from random real bets and ran the full check on them ${a.runs} times. On average it flagged ${a.meanFlags.toFixed(1)} of them, against ${a.realFlags} real wallets, so about ${pct(a.fdr)} of flags may be false alarms.`,
    check.timingPlacebo.meanFlags < 0.5
      ? "When we shuffled when wallets entered markets, the timing check flagged essentially nothing, so its timing flags aren't an artifact."
      : `When we shuffled when wallets entered markets, the timing check still flagged about ${check.timingPlacebo.meanFlags.toFixed(1)} wallets.`,
    check.placeboB.flags === 0
      ? "When we replaced every real outcome with a coin flip weighted by its price, nothing was flagged, which confirms the arithmetic."
      : `When we replaced every real outcome with a coin flip weighted by its price, ${check.placeboB.flags} wallets were still flagged.`,
  ];

  const found = [
    `${summary.tested.toLocaleString()} wallets had enough bets to judge. ${anomalies} of them have records very unlikely to be luck, and ${summary.tiers[3]} more show something that doesn't hold up under our stricter checks.`,
  ];
  if (nc.study.per1000 !== null && nc.control.per1000 !== null)
    found.push(
      `The surprise: wallets trading crypto price markets, where inside information is essentially impossible, are flagged more often (${nc.control.per1000.toFixed(0)} per 1,000) than wallets in politics, awards and announcements (${nc.study.per1000.toFixed(0)} per 1,000). So most "too lucky" records are better explained by skill, speed or automation than by inside information.`,
    );
  found.push(
    `For individual markets: ${elevatedStudyAlone} of ${testableStudy.toLocaleString()} politics, awards and announcement markets look unusual on their own, fewer than chance alone would produce. ${
      elevatedCorrected === 0
        ? "Once we account for checking so many markets, none stands out."
        : `Once we account for checking so many markets, ${elevatedCorrected} still stand out.`
    }`,
  );

  const sections: PlainReport["sections"] = [
    {
      heading: "How it works",
      body: [
        `1. We collected every trade in ${summary.markets.toLocaleString()} resolved Polymarket markets from the last six months, covering ${summary.wallets.toLocaleString()} wallets.`,
        "2. For each wallet, we compare how often its bets won with how often they should have won given the prices it paid. Cheap bets that keep winning are what's hard to explain by luck.",
        `3. We flag a wallet only if its record is extremely unlikely to be luck after accounting for the fact that we checked ${summary.tested.toLocaleString()} wallets, and only if it still holds up without its single best bet.`,
        "4. For any market, we count how many of its traders are flagged and compare that with what's normal for that kind of market.",
      ],
    },
    { heading: "How often are we wrong?", body: wrong },
    {
      heading: "What it can and can't catch",
      body: [
        `We planted a fake edge into copies of real wallets. A wallet with about 50 bets and a strong edge (4× better odds than the price) is caught ${r50 === null ? "—" : pct(r50)} of the time; with 20 bets, ${r20 === null ? "—" : pct(r20)}.`,
        "With 10 bets or fewer, even a strong edge is almost never caught. That's the price of rarely raising false alarms: the check is built to be sure rather than sensitive.",
      ],
    },
    { heading: `What we found across ${summary.markets.toLocaleString()} markets`, body: found },
    {
      heading: "Are market prices fair odds?",
      body: [
        `Mostly, yes. Across ${fitted.length} price ranges, how often shares actually won stays within ${Math.round(maxGap * 100)} points of their price.${
          cheapest
            ? ` The cheapest shares (${Math.round(cheapest.low * 100)}–${Math.round(cheapest.high * 100)}¢) won ${(cheapest.winRate! * 100).toFixed(1)}% of the time.`
            : ""
        } Where prices and results differ, we use whichever is kinder to the wallet, so a trader is never flagged just for buying shares the market underpriced.`,
      ],
    },
  ];

  return {
    eyebrow: "Method summary",
    title: "How LuckAudit works, and how far to trust it",
    verdict:
      a.fdr === 0
        ? `0 false flags in ${a.runs} fake-wallet runs`
        : a.fdr === null
          ? "Validation not yet measured"
          : `About ${pct(a.fdr)} of flags may be false alarms`,
    tone: a.fdr !== null && a.fdr <= 0.1 ? "calm" : "muted",
    sections,
    items: {
      heading: "By category",
      rows: summary.categories.map((c) => ({
        label: c.label,
        detail: `${c.markets.toLocaleString()} markets. ${c.flaggedRate === null ? "" : `${(c.flaggedRate * 100).toFixed(1)}% of tested traders flagged. `}${c.elevatedAlone} look unusual on their own; ${c.elevatedCorrected} after accounting for multiple checks.`,
      })),
    },
    technical: [
      { label: "Library", value: `${summary.markets.toLocaleString()} markets · ${summary.wallets.toLocaleString()} wallets · ${summary.tested.toLocaleString()} tested` },
      { label: "Tiers (strong / anomaly / weak)", value: `${summary.tiers[1]} / ${summary.tiers[2]} / ${summary.tiers[3]}` },
      { label: "Placebo A (matched twins)", value: `${a.meanFlags.toFixed(2)} twin flags vs ${a.realFlags} real · FDR ${a.fdr === null ? "—" : pct(a.fdr)} · ${a.runs} runs` },
      { label: "Negative control (per 1,000)", value: `study ${nc.study.per1000?.toFixed(1) ?? "—"} · crypto ${nc.control.per1000?.toFixed(1) ?? "—"} · Fisher p ${fmtP(nc.fisherP)}` },
      { label: "Control category", value: control ? `${control.markets.toLocaleString()} crypto price markets` : "—" },
    ],
    limits: [
      "One-time insiders with fresh wallets have no record to test.",
      "One person can split activity across many wallets.",
      "A flagged record is consistent with skill, speed, or inside information. The tool cannot tell which.",
      "Results describe the library built for this project: resolved markets with at least $10k volume over six months.",
    ],
  };
}
