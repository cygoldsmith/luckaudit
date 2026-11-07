import Link from "next/link";
export default function NotFound() {
  return (
    <main className="empty-state">
      <h1>Page not found</h1>
      <p>Open a trader from the leaderboard or enter a valid wallet address.</p>
      <Link className="primary-button" href="/">
        Back to leaderboard
      </Link>
    </main>
  );
}
