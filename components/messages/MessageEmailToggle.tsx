"use client";

import { useEffect, useState } from "react";

export default function MessageEmailToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/messages/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEnabled(d ? !!d.message_emails_enabled : true))
      .catch(() => setEnabled(true));
  }, []);

  async function toggle() {
    if (enabled === null) return;
    const next = !enabled;
    setEnabled(next);
    setError("");
    let ok = false;
    try {
      const res = await fetch("/api/messages/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_emails_enabled: next }),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      setEnabled(!next);
      setError("Couldn't save that. Try again.");
    }
  }

  return (
    <div className="flex items-start justify-between gap-4 mt-3">
      <div>
        <p className="text-sm font-medium" style={{ color: "#F4E8D2" }}>Email me about new messages</p>
        <p className="text-xs mt-0.5" style={{ color: "#9a9591" }}>
          You&apos;ll still see new messages in the app and get phone alerts if those are on.
        </p>
        {error && <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>{error}</p>}
      </div>
      <button
        role="switch"
        aria-checked={!!enabled}
        aria-label="Email me about new messages"
        onClick={toggle}
        disabled={enabled === null}
        className="shrink-0 rounded-full transition-all disabled:opacity-50"
        style={{ width: "44px", height: "26px", backgroundColor: enabled ? "#D4A64F" : "#2a2a2e", position: "relative" }}
      >
        <span
          className="absolute rounded-full transition-all"
          style={{ top: "3px", left: enabled ? "21px" : "3px", width: "20px", height: "20px", backgroundColor: "#F4E8D2" }}
        />
      </button>
    </div>
  );
}
