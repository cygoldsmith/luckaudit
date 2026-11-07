import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LuckAudit — Prediction market investigations",
  description:
    "Search Polymarket markets, inspect trading activity and participating wallets, and explore evidence with local AI.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
