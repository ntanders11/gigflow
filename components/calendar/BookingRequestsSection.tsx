// components/calendar/BookingRequestsSection.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PendingBookingRequest } from "@/types";

function RequestCard({ r, onResponded }: { r: PendingBookingRequest; onResponded: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function respond(status: "accepted" | "declined") {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/booking-requests/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setSaving(false);
    if (res.ok) {
      onResponded();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't respond — please try again.");
    }
  }

  return (
    <div
      className="rounded-xl p-4 flex items-center gap-4"
      style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      {r.venue_photo_url ? (
        <img src={r.venue_photo_url} alt={r.venue_name} className="w-10 h-10 rounded-full object-cover shrink-0" />
      ) : (
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
          style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}
        >
          {r.venue_name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold" style={{ color: "#F4E8D2" }}>{r.venue_name}</div>
        <div className="text-xs" style={{ color: "#9a9591" }}>
          {r.date}{r.start_time ? ` · ${r.start_time}` : ""}{r.end_time ? `–${r.end_time}` : ""}
        </div>
        {r.message && (
          <div className="text-xs mt-1" style={{ color: "#5e5c58" }}>{r.message}</div>
        )}
        {error && <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>{error}</p>}
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={() => respond("accepted")}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
          style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: saving ? 0.6 : 1 }}
        >
          Accept
        </button>
        <button
          onClick={() => respond("declined")}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ color: "#9a9591", border: "1px solid rgba(255,255,255,0.1)", opacity: saving ? 0.6 : 1 }}
        >
          Decline
        </button>
      </div>
    </div>
  );
}

export default function BookingRequestsSection() {
  const router = useRouter();
  const [pending, setPending] = useState<PendingBookingRequest[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/booking-requests");
    const data = res.ok ? await res.json() : { pending: [] };
    setPending(data.pending ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  if (!loading && pending.length === 0) return null;

  return (
    <div className="mb-8 max-w-5xl">
      <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5e5c58" }}>
        Booking Requests {pending.length > 0 && `(${pending.length})`}
      </h2>
      <div className="space-y-3">
        {pending.map((r) => (
          <RequestCard
            key={r.id}
            r={r}
            onResponded={() => {
              load();
              router.refresh();
              window.dispatchEvent(new Event("stagereach:booking-request-updated"));
            }}
          />
        ))}
      </div>
    </div>
  );
}
