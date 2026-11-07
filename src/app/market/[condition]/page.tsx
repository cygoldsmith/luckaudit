import { notFound } from "next/navigation";
import { isCondition } from "@/lib/market-normalize";
import MarketInvestigation from "@/components/market-investigation";
export default async function MarketPage({
  params,
  searchParams,
}: {
  params: Promise<{ condition: string }>;
  searchParams: Promise<{ snapshot?: string }>;
}) {
  const { condition } = await params;
  if (!isCondition(condition)) notFound();
  return (
    <MarketInvestigation
      condition={condition.toLowerCase()}
      initialSnapshot={(await searchParams).snapshot === "1"}
    />
  );
}
