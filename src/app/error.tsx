"use client";
import Link from "next/link";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="empty-state">
      <h1>This view couldn’t load</h1>
      <p>
        Your saved wallets remain in this browser. Retry the view or return to
        the markets.
      </p>
      <button className="primary-button" onClick={reset}>
        Try again
      </button>
      <Link className="outline-button" href="/">
        Markets
      </Link>
    </main>
  );
}
