"use client";

import { useEffect } from "react";
import { reportError } from "@/components/monitoring/reportError";

// Shown when a page crashes while rendering. Reports it and offers a retry
// instead of a blank screen.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error.message, error.stack);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
      <h1 className="text-xl font-bold mb-2" style={{ color: "#F4E8D2" }}>Something went wrong</h1>
      <p className="text-sm mb-5 max-w-sm" style={{ color: "#9a9591" }}>
        We&apos;ve been notified and will look into it. You can try again, or head back to your overview.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
        >
          Try again
        </button>
        <a
          href="/dashboard"
          className="px-4 py-2 rounded-lg text-sm"
          style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#F4E8D2" }}
        >
          Go to overview
        </a>
      </div>
    </div>
  );
}
