import Link from "next/link";
export default function NotFound() {
  return (
    <main className="empty-state">
      <h1>Page not found</h1>
      <p>Search for a market, or look up a wallet by its address.</p>
      <Link className="primary-button" href="/">
        Back to markets
      </Link>
    </main>
  );
}
