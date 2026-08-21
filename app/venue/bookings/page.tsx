// app/venue/bookings/page.tsx
"use client";

import { useState, useEffect } from "react";
import VenueNav from "@/components/venue/VenueNav";
import { VenueBookingRequestView } from "@/types";

const STATUS_STYLE: Record<VenueBookingRequestView["status"], { bg: string; color: string; label: string }> = {
  pending: { bg: "rgba(212,166,79,0.15)", color: "#D4A64F", label: "Pending" },
  accepted: { bg: "rgba(76,175,125,0.15)", color: "#4caf7d", label: "Accepted" },
  declined: { bg: "rgba(226,92,92,0.15)", color: "#e25c5c", label: "Declined" },
};

export default function VenueBookingsPage() {
  const [requests, setRequests] = useState<VenueBookingRequestView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/venue/booking-requests")
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0E0E10" }}>
      <VenueNav />
      {!loading && (
        <div className="max-w-2xl mx-auto px-6 py-10">
          <h1 className="text-xl font-bold mb-6" style={{ color: "#F4E8D2" }}>Bookings</h1>

          {requests.length === 0 ? (
            <p className="text-sm" style={{ color: "#5e5c58" }}>You haven&apos;t sent any booking requests yet.</p>
          ) : (
            <div className="space-y-3">
              {requests.map((r) => {
                const s = STATUS_STYLE[r.status];
                return (
                  <div
                    key={r.id}
                    className="rounded-xl p-4 flex items-center gap-4"
                    style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
                  >
                    {r.artist_photo_url ? (
                      <img src={r.artist_photo_url} alt={r.artist_name} className="w-10 h-10 rounded-full object-cover shrink-0" />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                        style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}
                      >
                        {r.artist_name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold" style={{ color: "#F4E8D2" }}>{r.artist_name}</div>
                      <div className="text-xs" style={{ color: "#9a9591" }}>
                        {r.date}{r.start_time ? ` · ${r.start_time}` : ""}{r.end_time ? `–${r.end_time}` : ""}
                      </div>
                      {r.message && (
                        <div className="text-xs mt-1" style={{ color: "#5e5c58" }}>{r.message}</div>
                      )}
                    </div>
                    <span
                      className="text-xs px-2.5 py-1 rounded-full shrink-0"
                      style={{ backgroundColor: s.bg, color: s.color }}
                    >
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
