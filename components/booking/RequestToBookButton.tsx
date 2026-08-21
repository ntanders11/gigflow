// components/booking/RequestToBookButton.tsx
"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const inputStyle = {
  background: "#1e2128",
  border: "1px solid rgba(255,255,255,0.07)",
  color: "#F4E8D2",
};

export default function RequestToBookButton({
  artistUserId,
  viewerType,
}: {
  artistUserId: string;
  viewerType: "venue" | "other";
}) {
  const [open, setOpen] = useState(false);

  if (viewerType !== "venue") {
    return (
      <div
        className="rounded-lg py-2.5 px-3 text-center text-xs"
        style={{ backgroundColor: "#1e2128", color: "#9a9591" }}
      >
        Are you a venue?{" "}
        <Link href="/venues/signup" className="underline" style={{ color: "#D4A64F" }}>
          Sign up to request a booking
        </Link>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="block w-full text-center rounded-lg py-2.5 text-sm font-bold transition-all hover:brightness-110"
        style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
      >
        Request to Book
      </button>
      {open && <RequestBookingModal artistUserId={artistUserId} onClose={() => setOpen(false)} />}
    </>
  );
}

function RequestBookingModal({ artistUserId, onClose }: { artistUserId: string; onClose: () => void }) {
  const [unavailableDates, setUnavailableDates] = useState<Set<string>>(new Set());
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fetch(`/api/public/artists/${artistUserId}/availability`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUnavailableDates(new Set(data?.dates ?? [])))
      .catch(() => {});
  }, [artistUserId]);

  const isUnavailable = !!date && unavailableDates.has(date);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!date || isUnavailable) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/venue/booking-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artist_user_id: artistUserId,
        date,
        start_time: startTime || undefined,
        end_time: endTime || undefined,
        message: message.trim() || undefined,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSent(true);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't send the request — please try again.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="rounded-xl p-6 w-full max-w-sm"
        style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {sent ? (
          <div className="text-center">
            <h2 className="text-lg font-bold mb-2" style={{ color: "#F4E8D2" }}>Request sent</h2>
            <p className="text-sm mb-4" style={{ color: "#9a9591" }}>
              You&apos;ll be notified once they respond. Track it anytime on your Bookings page.
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <h2 className="text-lg font-bold mb-1" style={{ color: "#F4E8D2" }}>Request to Book</h2>
            <div>
              <label className="block text-xs mb-1.5" style={{ color: "#9a9591" }}>Date</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                style={inputStyle}
              />
              {isUnavailable && (
                <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>
                  This date is already booked — try another.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "#9a9591" }}>Start time</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "#9a9591" }}>End time</label>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
              </div>
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={{ color: "#9a9591" }}>Note (optional)</label>
              <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none" style={inputStyle} />
            </div>
            {error && <p className="text-xs" style={{ color: "#e25c5c" }}>{error}</p>}
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={!date || saving || isUnavailable}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
                style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: (!date || saving || isUnavailable) ? 0.6 : 1 }}
              >
                {saving ? "Sending…" : "Send Request"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-lg text-sm font-semibold"
                style={{ color: "#9a9591" }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
