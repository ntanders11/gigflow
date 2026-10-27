"use client";

import { useEffect, useState } from "react";

// Opt-in switch for automatic reply detection (Outlook). Turning it on sends the
// artist to Microsoft to approve reading their inbox; turning it off is instant.
export default function ReplyDetectionSettings() {
  const [state, setState] = useState<{ outlookConnected: boolean; enabled: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/reply-detection")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setState({ outlookConnected: d.outlookConnected, enabled: d.enabled }); })
      .catch(() => {});
  }, []);

  if (!state || !state.outlookConnected) return null;

  async function turnOff() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/reply-detection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      if (!res.ok) throw new Error();
      setState((s) => (s ? { ...s, enabled: false } : s));
    } catch {
      setMessage({ kind: "error", text: "Couldn't turn it off — try again." });
    } finally {
      setBusy(false);
    }
  }

  async function checkNow() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/replies/scan", { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Couldn't check your inbox.");
      setMessage({
        kind: "ok",
        text: d.replies > 0 ? `Found ${d.replies} new repl${d.replies === 1 ? "y" : "ies"} from venues.` : "No new replies from venues.",
      });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : "Couldn't check your inbox." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold mb-1" style={{ color: "#F4E8D2" }}>Reply detection</h2>
          <p className="text-xs" style={{ color: "#9a9591" }}>
            StageReach checks your Outlook inbox once a day for replies from venues in your pipeline, marks them Responded,
            and notifies you. It also spots undeliverable notices (pausing follow-ups to that venue) and suggests a
            reminder date when a reply says something like &quot;not booking until spring&quot;. It reads the sender, subject
            and a short preview, and saves only the subject line — it never stores the message itself. Off by default.
          </p>
        </div>
        {state.enabled && (
          <button
            type="button"
            role="switch"
            aria-checked
            aria-label="Reply detection"
            onClick={turnOff}
            disabled={busy}
            className="shrink-0 rounded-full"
            style={{ width: 44, height: 24, backgroundColor: "#D4A64F", position: "relative" }}
          >
            <span style={{ position: "absolute", top: 2, left: 22, width: 20, height: 20, borderRadius: "50%", backgroundColor: "#F4E8D2" }} />
          </button>
        )}
      </div>

      {state.enabled ? (
        <div className="flex items-center gap-3 mt-4">
          <button
            type="button"
            onClick={checkNow}
            disabled={busy}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
            style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
          >
            {busy ? "Checking…" : "Check for replies now"}
          </button>
        </div>
      ) : (
        <div className="mt-4">
          <a
            href="/api/auth/outlook/connect?reply_detection=1"
            className="inline-block text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
          >
            Turn on reply detection
          </a>
          <p className="text-xs mt-2" style={{ color: "#5e5c58" }}>
            You&apos;ll be sent to Microsoft to approve reading your inbox, then brought back here.
          </p>
        </div>
      )}

      {message && (
        <p className="text-xs mt-3" style={{ color: message.kind === "error" ? "#e25c5c" : "#4caf7d" }}>{message.text}</p>
      )}
    </div>
  );
}
