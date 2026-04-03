"use client";

import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
} from "date-fns";
import { useState } from "react";
import Link from "next/link";

type Venue = {
  id: string;
  name: string;
  city: string | null;
  follow_up_date: string | null;
  notes: string | null;
};

export default function CalendarView({
  bookedVenues,
  isOutlookConnected,
}: {
  bookedVenues: Venue[];
  isOutlookConnected: boolean;
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [syncing, setSyncing] = useState<string | null>(null);
  const [synced, setSynced] = useState<Set<string>>(new Set());

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  const venuesWithDate = bookedVenues.filter((v) => v.follow_up_date);
  const venuesWithoutDate = bookedVenues.filter((v) => !v.follow_up_date);

  function venuesOnDay(day: Date) {
    return venuesWithDate.filter((v) =>
      isSameDay(new Date(v.follow_up_date + "T12:00:00"), day)
    );
  }

  async function syncToOutlook(venue: Venue) {
    setSyncing(venue.id);
    try {
      const res = await fetch("/api/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueName: venue.name,
          city: venue.city,
          gigDate: venue.follow_up_date,
          notes: venue.notes,
        }),
      });
      if (res.ok) {
        setSynced((prev) => new Set([...prev, venue.id]));
      }
    } finally {
      setSyncing(null);
    }
  }

  return (
    <div>
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          className="px-3 py-1.5 rounded-lg text-sm transition-all"
          style={{ color: "#9a9591", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          ← Prev
        </button>
        <h2 className="text-lg font-semibold" style={{ color: "#f0ede8" }}>
          {format(currentMonth, "MMMM yyyy")}
        </h2>
        <button
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          className="px-3 py-1.5 rounded-lg text-sm transition-all"
          style={{ color: "#9a9591", border: "1px solid rgba(255,255,255,0.1)" }}
        >
          Next →
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-2">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="text-center text-xs font-semibold uppercase tracking-widest py-2"
            style={{ color: "#5e5c58" }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div
        className="grid grid-cols-7 rounded-xl overflow-hidden"
        style={{ border: "1px solid rgba(255,255,255,0.07)" }}
      >
        {days.map((day, idx) => {
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isToday = isSameDay(day, new Date());
          const dayVenues = venuesOnDay(day);

          return (
            <div
              key={idx}
              className="min-h-[90px] p-2"
              style={{
                backgroundColor: isCurrentMonth ? "#16181c" : "#13141700",
                borderRight: (idx + 1) % 7 === 0 ? "none" : "1px solid rgba(255,255,255,0.05)",
                borderBottom: idx < days.length - 7 ? "1px solid rgba(255,255,255,0.05)" : "none",
              }}
            >
              <div
                className="text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full"
                style={{
                  color: isToday ? "#0e0f11" : isCurrentMonth ? "#9a9591" : "#2e2c28",
                  backgroundColor: isToday ? "#d4a853" : "transparent",
                  fontWeight: isToday ? 700 : 400,
                }}
              >
                {format(day, "d")}
              </div>
              {dayVenues.map((v) => (
                <Link
                  key={v.id}
                  href={`/venues/${v.id}`}
                  className="block text-xs px-1.5 py-0.5 rounded mb-1 truncate"
                  style={{
                    backgroundColor: "rgba(76,175,125,0.2)",
                    color: "#4caf7d",
                    fontSize: "10px",
                  }}
                >
                  {v.name}
                </Link>
              ))}
            </div>
          );
        })}
      </div>

      {/* Booked gigs list */}
      <div className="mt-8">
        <h3 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: "#9a9591" }}>
          All Booked Gigs
        </h3>
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid rgba(255,255,255,0.07)" }}
        >
          {bookedVenues.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm" style={{ color: "#5e5c58" }}>
                No booked gigs yet. Move a venue to "Booked" in your pipeline.
              </p>
            </div>
          ) : (
            bookedVenues.map((venue, idx) => {
              const isLast = idx === bookedVenues.length - 1;
              const isSyncedAlready = synced.has(venue.id);
              return (
                <div
                  key={venue.id}
                  className="flex items-center gap-4 px-5 py-4"
                  style={{
                    backgroundColor: "#16181c",
                    borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)",
                    borderLeft: "3px solid #4caf7d",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <Link href={`/venues/${venue.id}`}>
                      <p className="text-sm font-medium truncate" style={{ color: "#f0ede8" }}>
                        {venue.name}
                      </p>
                    </Link>
                    <p className="text-xs" style={{ color: "#9a9591" }}>
                      {venue.follow_up_date
                        ? format(new Date(venue.follow_up_date + "T12:00:00"), "EEEE, MMMM d, yyyy")
                        : "No date set — add a Gig Date in the venue detail"}
                      {venue.city ? ` · ${venue.city}` : ""}
                    </p>
                  </div>
                  {isOutlookConnected && venue.follow_up_date && (
                    <button
                      onClick={() => syncToOutlook(venue)}
                      disabled={!!syncing || isSyncedAlready}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={{
                        backgroundColor: isSyncedAlready ? "rgba(76,175,125,0.15)" : "rgba(255,255,255,0.07)",
                        color: isSyncedAlready ? "#4caf7d" : "#9a9591",
                        border: `1px solid ${isSyncedAlready ? "#4caf7d" : "rgba(255,255,255,0.1)"}`,
                        cursor: isSyncedAlready ? "default" : "pointer",
                      }}
                    >
                      {syncing === venue.id
                        ? "Syncing..."
                        : isSyncedAlready
                        ? "✓ Added to Outlook"
                        : "Add to Outlook"}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
        {venuesWithoutDate.length > 0 && (
          <p className="text-xs mt-3" style={{ color: "#5e5c58" }}>
            {venuesWithoutDate.length} booked venue{venuesWithoutDate.length > 1 ? "s" : ""} without a date — open the venue and set a Gig Date to show it on the calendar.
          </p>
        )}
      </div>
    </div>
  );
}
