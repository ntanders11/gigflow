"use client";

import { useState } from "react";

export default function FeedbackBox() {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    if (!message.trim() || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (res.ok) {
        setSent(true);
        setMessage("");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't send that — please try again.");
      }
    } catch {
      setError("Couldn't send that — please try again.");
    }
    setSending(false);
  }

  return (
    <div
      className="rounded-xl p-5"
      style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div style={{ fontSize: "9px", color: "#5e5c58", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
        Feedback
      </div>
      <p className="text-sm font-semibold mb-1" style={{ color: "#F4E8D2" }}>Do you have feedback?</p>
      <p className="text-xs mb-3" style={{ color: "#9a9591", lineHeight: 1.6 }}>
        Something broken, confusing, or missing? Tell us — StageReach is in beta and what you write shapes what gets built next.
      </p>
      {sent ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs" style={{ color: "#4caf7d" }}>Thank you — your feedback was sent.</p>
          <button onClick={() => setSent(false)} className="text-xs underline" style={{ color: "#D4A64F" }}>
            Send more
          </button>
        </div>
      ) : (
        <>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Type your feedback here…"
            className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none"
            style={{ backgroundColor: "#1e2128", color: "#F4E8D2", border: "1px solid rgba(255,255,255,0.1)" }}
          />
          {error && <p className="text-xs mt-2" style={{ color: "#e25c5c" }}>{error}</p>}
          <button
            onClick={send}
            disabled={!message.trim() || sending}
            className="mt-3 px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:brightness-110 disabled:opacity-50"
            style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
          >
            {sending ? "Sending…" : "Send feedback"}
          </button>
        </>
      )}
    </div>
  );
}
