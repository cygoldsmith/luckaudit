import WalletInvestigation from "@/components/wallet-investigation";
import { isAddress } from "@/lib/domain";
import { notFound } from "next/navigation";
export default async function WalletPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ snapshot?: string }>;
}) {
  const { address } = await params;
  if (!isAddress(address)) notFound();
  return (
    <WalletInvestigation
      address={address.toLowerCase()}
      initialSnapshot={(await searchParams).snapshot === "1"}
    />
  );
}
