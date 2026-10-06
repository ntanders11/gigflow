"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MessageArtistButton({ artistUserId }: { artistUserId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/messages/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist_user_id: artistUserId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error ?? "Couldn't open a conversation. Try again.");
      setBusy(false);
      return;
    }
    router.push(`/venue/messages?c=${json.id}`);
  }

  return (
    <div>
      <button
        onClick={start}
        disabled={busy}
        className="block w-full text-center rounded-lg py-2.5 text-sm font-semibold transition-all hover:brightness-110 disabled:opacity-60"
        style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.1)", color: "#F4E8D2" }}
      >
        {busy ? "Opening…" : "Message"}
      </button>
      {error && <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>{error}</p>}
    </div>
  );
}
