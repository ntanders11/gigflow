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
import { BlackoutDate } from "@/types";

type Venue = {
  id: string;
  gig_id?: string;
  name: string;
  city: string | null;
  address: string | null;
  follow_up_date: string | null;
  gig_time: string | null;
  gig_end_time?: string | null;
  notes: string | null;
};

function downloadICS(venue: Venue) {
  const d = venue.follow_up_date!;
  const [y, m, day] = d.split("-");
  const pad = (n: string) => n.padStart(2, "0");
  const startH = venue.gig_time ? parseInt(venue.gig_time.split(":")[0]) : 19;
  const startM = venue.gig_time ? parseInt(venue.gig_time.split(":")[1]) : 0;
  const endH = startH + 3;
  const dtStart = `${y}${pad(m)}${pad(day)}T${String(startH).padStart(2,"0")}${String(startM).padStart(2,"0")}00`;
  const dtEnd   = `${y}${pad(m)}${pad(day)}T${String(endH).padStart(2,"0")}${String(startM).padStart(2,"0")}00`;
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z/, "Z");
  const escape = (s: string) => s.replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StageReach//StageReach//EN",
    "BEGIN:VEVENT",
    `UID:gigflow-${venue.id}@gigflow.app`,
    `DTSTAMP:${now}`,
    `DTSTART;TZID=America/Los_Angeles:${dtStart}`,
    `DTEND;TZID=America/Los_Angeles:${dtEnd}`,
    `SUMMARY:${escape(`Gig at ${venue.name}`)}`,
    `LOCATION:${escape(venue.address ?? venue.city ?? venue.name)}`,
    `DESCRIPTION:${escape(venue.notes ?? `Booked gig at ${venue.name}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${venue.name.replace(/[^a-z0-9]/gi, "_")}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

// "Sep 12, 2026" for a single day, "Sep 12 – Sep 19, 2026" for a range.
function fmtRange(startDate: string, endDate: string): string {
  const start = new Date(startDate + "T12:00:00");
  if (startDate === endDate) {
    return format(start, "EEEE, MMMM d, yyyy");
  }
  const end = new Date(endDate + "T12:00:00");
  return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
}

export default function CalendarView({
  bookedVenues,
  subscriptionUrl,
  initialBlackoutDates,
}: {
  bookedVenues: Venue[];
  subscriptionUrl: string;
  initialBlackoutDates: BlackoutDate[];
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [copied, setCopied] = useState(false);

  const [blackoutDates, setBlackoutDates] = useState<BlackoutDate[]>(initialBlackoutDates);
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockStart, setBlockStart] = useState("");
  const [blockEnd, setBlockEnd] = useState("");
  const [blockNote, setBlockNote] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [blockError, setBlockError] = useState("");
  const [blockWarning, setBlockWarning] = useState<string | null>(null);

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

  // Plain string comparison of YYYY-MM-DD values — sidesteps every
  // timezone footgun that comparing Date objects across a day boundary
  // could introduce.
  function isDateBlocked(day: Date): boolean {
    const dayStr = format(day, "yyyy-MM-dd");
    return blackoutDates.some((b) => dayStr >= b.start_date && dayStr <= b.end_date);
  }

  function copyUrl() {
    navigator.clipboard.writeText(subscriptionUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function addBlackoutDate() {
    if (!blockStart || !blockEnd) return;
    if (blockEnd < blockStart) {
      setBlockError("End date must be on or after the start date.");
      return;
    }
    setBlocking(true);
    setBlockError("");
    const res = await fetch("/api/blackout-dates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_date: blockStart, end_date: blockEnd, note: blockNote || null }),
    });
    const data = await res.json();
    if (res.ok) {
      setBlackoutDates((prev) =>
        [...prev, data as BlackoutDate].sort((a, b) => a.start_date.localeCompare(b.start_date))
      );
      setBlockStart(""); setBlockEnd(""); setBlockNote("");
      setShowBlockForm(false);
      if (data.warning) setBlockWarning(data.warning as string);
    } else {
      setBlockError(data.error ?? "Couldn't block those dates — please try again.");
    }
    setBlocking(false);
  }

  async function removeBlackoutDate(id: string) {
    const res = await fetch(`/api/blackout-dates/${id}`, { method: "DELETE" });
    if (res.ok) setBlackoutDates((prev) => prev.filter((b) => b.id !== id));
  }

  const inputStyle = {
    background: "#262b33",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#F4E8D2",
    borderRadius: "8px",
    padding: "6px 10px",
    fontSize: "13px",
    outline: "none",
  };

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
        <h2 className="text-lg font-semibold" style={{ color: "#F4E8D2" }}>
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
          const blocked = isDateBlocked(day);

          return (
            <div
              key={idx}
              className="min-h-[90px] p-2"
              title={blocked ? "Blocked off" : undefined}
              style={{
                backgroundColor: isCurrentMonth ? "#16181c" : "#13141700",
                backgroundImage: blocked
                  ? "repeating-linear-gradient(45deg, rgba(94,92,88,0.18), rgba(94,92,88,0.18) 4px, transparent 4px, transparent 10px)"
                  : "none",
                borderRight: (idx + 1) % 7 === 0 ? "none" : "1px solid rgba(255,255,255,0.05)",
                borderBottom: idx < days.length - 7 ? "1px solid rgba(255,255,255,0.05)" : "none",
              }}
            >
              <div
                className="text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full"
                style={{
                  color: isToday ? "#0E0E10" : isCurrentMonth ? "#9a9591" : "#2e2c28",
                  backgroundColor: isToday ? "#D4A64F" : "transparent",
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
              {blocked && dayVenues.length === 0 && (
                <span
                  className="block text-xs px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: "rgba(94,92,88,0.3)", color: "#9a9591", fontSize: "10px" }}
                >
                  Blocked
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Blocked Dates */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#9a9591" }}>
            Blocked Dates
          </h3>
          <button
            onClick={() => setShowBlockForm(!showBlockForm)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all hover:brightness-110"
            style={{ background: "#D4A64F", color: "#0E0E10" }}
          >
            + Block Dates
          </button>
        </div>

        {blockWarning && (
          <div
            className="rounded-lg px-4 py-3 mb-4 flex items-start justify-between gap-3"
            style={{ backgroundColor: "rgba(212,166,79,0.1)", border: "1px solid rgba(212,166,79,0.25)" }}
          >
            <p className="text-xs" style={{ color: "#D4A64F" }}>{blockWarning}</p>
            <button
              onClick={() => setBlockWarning(null)}
              className="text-xs shrink-0"
              style={{ color: "#9a9591" }}
            >
              Dismiss
            </button>
          </div>
        )}

        {showBlockForm && (
          <div className="rounded-lg p-4 mb-4 space-y-3" style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Start Date *</label>
                <input type="date" value={blockStart} onChange={(e) => setBlockStart(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>End Date *</label>
                <input type="date" value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
              </div>
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Note (private — only you see this)</label>
              <input type="text" value={blockNote} onChange={(e) => setBlockNote(e.target.value)} placeholder="Family event, time off…" style={{ ...inputStyle, width: "100%" }} />
            </div>
            {blockError && <p className="text-xs" style={{ color: "#e25c5c" }}>{blockError}</p>}
            <div className="flex gap-2">
              <button
                onClick={addBlackoutDate}
                disabled={!blockStart || !blockEnd || blocking}
                className="text-xs px-4 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                style={{ background: "#D4A64F", color: "#0E0E10" }}
              >
                {blocking ? "Saving…" : "Block Dates"}
              </button>
              <button
                onClick={() => setShowBlockForm(false)}
                className="text-xs px-4 py-1.5 rounded-lg"
                style={{ color: "#9a9591" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
          {blackoutDates.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm" style={{ color: "#5e5c58" }}>
                No blocked dates. Use &quot;+ Block Dates&quot; to mark yourself unavailable.
              </p>
            </div>
          ) : (
            blackoutDates.map((b, idx) => {
              const isLast = idx === blackoutDates.length - 1;
              return (
                <div
                  key={b.id}
                  className="flex items-center gap-4 px-5 py-4"
                  style={{
                    backgroundColor: "#16181c",
                    borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)",
                    borderLeft: "3px solid #5e5c58",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: "#F4E8D2" }}>
                      {fmtRange(b.start_date, b.end_date)}
                    </p>
                    {b.note && (
                      <p className="text-xs mt-0.5" style={{ color: "#9a9591" }}>{b.note}</p>
                    )}
                  </div>
                  <button
                    onClick={() => removeBlackoutDate(b.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0"
                    style={{ backgroundColor: "rgba(226,92,92,0.1)", color: "#e25c5c", border: "1px solid rgba(226,92,92,0.25)" }}
                  >
                    Remove
                  </button>
                </div>
              );
            })
          )}
        </div>
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
                No booked gigs yet. Move a venue to &quot;Booked&quot; in your pipeline.
              </p>
            </div>
          ) : (
            bookedVenues.map((venue, idx) => {
              const isLast = idx === bookedVenues.length - 1;
              return (
                <div
                  key={`${venue.id}-${idx}`}
                  className="flex items-center gap-4 px-5 py-4"
                  style={{
                    backgroundColor: "#16181c",
                    borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)",
                    borderLeft: "3px solid #4caf7d",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <Link href={`/venues/${venue.id}`}>
                      <p className="text-sm font-medium truncate" style={{ color: "#F4E8D2" }}>
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
                  {venue.follow_up_date && (
                    <button
                      onClick={() => downloadICS(venue)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0"
                      style={{
                        backgroundColor: "rgba(255,255,255,0.05)",
                        color: "#9a9591",
                        border: "1px solid rgba(255,255,255,0.1)",
                      }}
                    >
                      Add to Calendar
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

      {/* Subscription URL copy box */}
      <div className="mt-8 rounded-xl px-5 py-4" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
        <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5e5c58" }}>
          Calendar Subscription URL
        </p>
        <p className="text-xs mb-3" style={{ color: "#9a9591" }}>
          On iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar → paste this URL.
        </p>
        <div className="flex items-center gap-2">
          <code
            className="flex-1 text-xs px-3 py-2 rounded-lg truncate"
            style={{ backgroundColor: "#0E0E10", color: "#9b7fe8", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            {subscriptionUrl}
          </code>
          <button
            onClick={copyUrl}
            className="px-3 py-2 rounded-lg text-xs font-medium transition-all shrink-0"
            style={{
              backgroundColor: copied ? "rgba(76,175,125,0.15)" : "rgba(255,255,255,0.07)",
              color: copied ? "#4caf7d" : "#9a9591",
              border: `1px solid ${copied ? "#4caf7d" : "rgba(255,255,255,0.1)"}`,
            }}
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
