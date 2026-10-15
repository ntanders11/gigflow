"use client";

import { useEffect } from "react";
import { reportError } from "@/components/monitoring/reportError";

// Last-resort screen for a crash in the root layout itself (it replaces the
// whole page, so it brings its own html/body).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error.message, error.stack);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ backgroundColor: "#0E0E10", color: "#F4E8D2", fontFamily: "sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#9a9591", marginBottom: 20 }}>We&apos;ve been notified. Please try again.</p>
          <button
            onClick={reset}
            style={{ backgroundColor: "#D4A64F", color: "#0E0E10", border: 0, borderRadius: 8, padding: "8px 16px", fontWeight: 600 }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
