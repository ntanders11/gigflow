// app/venue/bookings/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import VenueNav from "@/components/venue/VenueNav";
import VenueBookingsCalendar from "@/components/venue/VenueBookingsCalendar";
import { VenueBookingRequestView } from "@/types";

export default function VenueBookingsPage() {
  const [requests, setRequests] = useState<VenueBookingRequestView[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    return fetch("/api/venue/booking-requests")
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((data) => setRequests(data.requests ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen pb-28 md:pb-0" style={{ backgroundColor: "#0E0E10" }}>
      <VenueNav />
      {!loading && (
        <div className="max-w-2xl mx-auto px-6 py-10">
          <h1 className="text-xl font-bold mb-6" style={{ color: "#F4E8D2" }}>Bookings</h1>
          <VenueBookingsCalendar requests={requests} onChanged={load} />
        </div>
      )}
    </div>
  );
}
