import Link from "next/link";

export default function VenuesLandingPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: "#0E0E10" }}>
      <div className="max-w-md w-full text-center">
        <div
          className="text-xs font-semibold uppercase tracking-widest mb-6"
          style={{ color: "#D4A64F" }}
        >
          StageReach for Venues
        </div>
        <h1 className="text-3xl font-bold mb-4" style={{ color: "#F4E8D2" }}>
          Get discovered by artists in your area
        </h1>
        <p className="text-sm mb-8" style={{ color: "#9a9591" }}>
          Set up your venue&apos;s profile — genres you book, your stage setup, how to reach you —
          so artists already using StageReach can find you.
        </p>
        <Link
          href="/venues/signup"
          className="inline-block px-6 py-3 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
          style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
        >
          Set Up My Venue
        </Link>
        <p className="text-xs mt-8" style={{ color: "#5e5c58" }}>
          An artist? <Link href="/login" className="underline">Log in here</Link> instead.
        </p>
      </div>
    </div>
  );
}
