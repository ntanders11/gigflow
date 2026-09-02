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
import { VenueBookingRequestView } from "@/types";

const STATUS_DOT_COLOR: Record<VenueBookingRequestView["status"], string> = {
  pending: "#D4A64F",
  accepted: "#4caf7d",
  declined: "#9a9591",
  cancelled: "#e25c5c",
};

const STATUS_LABEL: Record<VenueBookingRequestView["status"], string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
};

function cancelledBySubLabel(r: VenueBookingRequestView): string | null {
  if (r.status !== "cancelled") return null;
  return r.cancelled_by === "artist" ? "Cancelled by the artist" : "Cancelled by you";
}

// Same reasoning as the artist-side add-gig form: a blank native
// <input type="time"> can silently stay empty in Safari until every
// segment is explicitly set, so the edit form starts on a real time
// rather than blank.
const DEFAULT_START_TIME = "19:00";
const DEFAULT_END_TIME = "21:00";

// Nth occurrence (n=0 is the date itself) on a weekly or monthly cadence
// from a starting date. Plain Date math, not date-fns's addWeeks/addMonths
// — this file already imports date-fns for the calendar grid, but this is
// simple enough not to need it, and keeps the diff small.
function addOccurrence(dateStr: string, pattern: "weekly" | "monthly", n: number): string {
  const d = new Date(dateStr + "T12:00:00");
  if (pattern === "weekly") d.setDate(d.getDate() + 7 * n);
  else d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
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

function DayDetailCard({ r, onCancelled }: { r: VenueBookingRequestView; onCancelled: () => void }) {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editDate, setEditDate] = useState(r.date);
  const [editStartTime, setEditStartTime] = useState(r.start_time || DEFAULT_START_TIME);
  const [editEndTime, setEditEndTime] = useState(r.end_time || DEFAULT_END_TIME);
  const [editSaving, setEditSaving] = useState(false);
  const canCancel = r.status === "pending" || r.status === "accepted";
  const canEdit = r.status === "pending" || r.status === "accepted";

  // "Book Again" — a new request to the same artist, never reusing the old
  // date (it's presumably in the past, or would collide anyway). Times
  // default to whatever this booking used, since a venue re-booking the
  // same artist is usually running the same kind of slot again.
  const [isBookingAgain, setIsBookingAgain] = useState(false);
  const [bookAgainDate, setBookAgainDate] = useState("");
  const [bookAgainStartTime, setBookAgainStartTime] = useState(r.start_time || DEFAULT_START_TIME);
  const [bookAgainEndTime, setBookAgainEndTime] = useState(r.end_time || DEFAULT_END_TIME);
  const [bookAgainMessage, setBookAgainMessage] = useState("");
  const [bookAgainRepeat, setBookAgainRepeat] = useState<"none" | "weekly" | "monthly">("none");
  const [bookAgainRepeatCount, setBookAgainRepeatCount] = useState(3);
  const [bookAgainSaving, setBookAgainSaving] = useState(false);
  const [bookAgainSent, setBookAgainSent] = useState(false);
  const [bookAgainSentCount, setBookAgainSentCount] = useState(0);
  const [bookAgainSkipped, setBookAgainSkipped] = useState<string[]>([]);
  const [bookAgainError, setBookAgainError] = useState("");
  const [unavailableDates, setUnavailableDates] = useState<Set<string>>(new Set());
  const canBookAgain = r.status === "accepted";
  const bookAgainIsUnavailable = !!bookAgainDate && unavailableDates.has(bookAgainDate);

  function startBookingAgain() {
    setIsBookingAgain(true);
    setBookAgainSent(false);
    setBookAgainError("");
    setBookAgainRepeat("none");
    setBookAgainRepeatCount(3);
    setBookAgainSkipped([]);
    fetch(`/api/public/artists/${r.artist_user_id}/availability`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUnavailableDates(new Set(data?.dates ?? [])))
      .catch(() => {});
  }

  // With a repeat pattern set, this sends one individual request per
  // occurrence instead of one — there's no "series" record anywhere, just
  // several ordinary booking_requests rows created in one action. Each one
  // still goes through the normal server-side availability check
  // (POST /api/venue/booking-requests already rejects an unavailable
  // date), so a later occurrence colliding with a blackout date or
  // another gig just gets skipped and reported, not silently created —
  // and the artist reviews and accepts each one individually, exactly
  // like any other request.
  async function submitBookAgain() {
    if (!bookAgainDate || bookAgainIsUnavailable) return;
    setBookAgainSaving(true);
    setBookAgainError("");

    const dates = bookAgainRepeat === "none"
      ? [bookAgainDate]
      : Array.from({ length: bookAgainRepeatCount }, (_, i) => addOccurrence(bookAgainDate, bookAgainRepeat, i));

    let sentCount = 0;
    const skipped: string[] = [];

    for (const date of dates) {
      const res = await fetch("/api/venue/booking-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artist_user_id: r.artist_user_id,
          date,
          start_time: bookAgainStartTime || undefined,
          end_time: bookAgainEndTime || undefined,
          message: bookAgainMessage.trim() || undefined,
        }),
      });
      if (res.ok) sentCount++;
      else skipped.push(date);
    }

    setBookAgainSaving(false);
    setBookAgainSentCount(sentCount);
    setBookAgainSkipped(skipped);

    if (sentCount > 0) {
      setBookAgainSent(true);
      onCancelled(); // reuses the same "refresh the list" callback — new pending requests should show up too
    } else {
      setBookAgainError("None of those dates could be requested — they may already be unavailable.");
    }
  }

  async function cancel() {
    if (!window.confirm(r.status === "accepted"
      ? "Cancel this booking? The artist will be notified and it will be removed from their calendar."
      : "Withdraw this booking request? The artist will be notified.")) {
      return;
    }
    setCancelling(true);
    setError("");
    const res = await fetch(`/api/venue/booking-requests/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    setCancelling(false);
    if (res.ok) {
      onCancelled();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't cancel — please try again.");
    }
  }

  async function saveEdit() {
    if (!editDate) return;
    setEditSaving(true);
    setError("");
    const res = await fetch(`/api/venue/booking-requests/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "edit",
        date: editDate,
        start_time: editStartTime || null,
        end_time: editEndTime || null,
      }),
    });
    setEditSaving(false);
    if (res.ok) {
      setIsEditing(false);
      onCancelled(); // reuses the same "refresh the list" callback the cancel flow already had
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't save — please try again.");
    }
  }

  if (isEditing) {
    return (
      <div
        className="rounded-xl p-4 space-y-3"
        style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className="text-sm font-semibold" style={{ color: "#F4E8D2" }}>{r.artist_name}</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Date *</label>
            <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
          </div>
          <div />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Start Time</label>
            <input type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>End Time</label>
            <input type="time" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
          </div>
        </div>
        {error && <p className="text-xs" style={{ color: "#e25c5c" }}>{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={saveEdit}
            disabled={!editDate || editSaving}
            className="text-xs px-4 py-1.5 rounded-lg font-semibold disabled:opacity-50"
            style={{ background: "#D4A64F", color: "#0E0E10" }}
          >
            {editSaving ? "Saving…" : "Save Changes"}
          </button>
          <button
            onClick={() => setIsEditing(false)}
            className="text-xs px-4 py-1.5 rounded-lg"
            style={{ color: "#9a9591" }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (isBookingAgain) {
    return (
      <div
        className="rounded-xl p-4 space-y-3"
        style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        {bookAgainSent ? (
          <div className="text-center py-2">
            <p className="text-sm font-semibold mb-1" style={{ color: "#F4E8D2" }}>
              {bookAgainSentCount > 1 ? `${bookAgainSentCount} requests sent` : "Request sent"}
            </p>
            <p className={bookAgainSkipped.length > 0 ? "text-xs mb-1" : "text-xs mb-3"} style={{ color: "#9a9591" }}>
              {r.artist_name} will be notified — you&apos;ll see {bookAgainSentCount > 1 ? "them" : "it"} here once they respond.
            </p>
            {bookAgainSkipped.length > 0 && (
              <p className="text-xs mb-3" style={{ color: "#e09b50" }}>
                {bookAgainSkipped.length} date{bookAgainSkipped.length !== 1 ? "s" : ""} couldn&apos;t be requested (already unavailable):{" "}
                {bookAgainSkipped.map((d) => format(new Date(d + "T12:00:00"), "MMM d")).join(", ")}.
              </p>
            )}
            <button
              onClick={() => setIsBookingAgain(false)}
              className="text-xs px-4 py-1.5 rounded-lg font-semibold"
              style={{ background: "#D4A64F", color: "#0E0E10" }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="text-sm font-semibold" style={{ color: "#F4E8D2" }}>Book {r.artist_name} again</div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Date *</label>
              <input
                type="date"
                value={bookAgainDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setBookAgainDate(e.target.value)}
                style={{ ...inputStyle, width: "100%" }}
              />
              {bookAgainIsUnavailable && (
                <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>This date is already booked — try another.</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Start Time</label>
                <input type="time" value={bookAgainStartTime} onChange={(e) => setBookAgainStartTime(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>End Time</label>
                <input type="time" value={bookAgainEndTime} onChange={(e) => setBookAgainEndTime(e.target.value)} style={{ ...inputStyle, width: "100%" }} />
              </div>
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Repeat this booking</label>
              <div className="flex gap-2">
                <select
                  value={bookAgainRepeat}
                  onChange={(e) => setBookAgainRepeat(e.target.value as "none" | "weekly" | "monthly")}
                  style={{ ...inputStyle, flex: 1 }}
                >
                  <option value="none">Don&apos;t repeat</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
                {bookAgainRepeat !== "none" && (
                  <select
                    value={bookAgainRepeatCount}
                    onChange={(e) => setBookAgainRepeatCount(Number(e.target.value))}
                    style={{ ...inputStyle, width: "140px" }}
                  >
                    {[2, 3, 6, 12].map((n) => (
                      <option key={n} value={n}>{n} bookings</option>
                    ))}
                  </select>
                )}
              </div>
              {bookAgainRepeat !== "none" && (
                <p className="text-xs mt-1" style={{ color: "#5e5c58" }}>
                  Sends {bookAgainRepeatCount} separate requests, starting {bookAgainDate ? format(new Date(bookAgainDate + "T12:00:00"), "MMM d") : "on the date above"}
                  {" "}and repeating {bookAgainRepeat}. {r.artist_name} still reviews and accepts each one individually.
                </p>
              )}
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Note (optional)</label>
              <textarea
                rows={2}
                value={bookAgainMessage}
                onChange={(e) => setBookAgainMessage(e.target.value)}
                style={{ ...inputStyle, width: "100%", resize: "none" }}
              />
            </div>
            {bookAgainError && <p className="text-xs" style={{ color: "#e25c5c" }}>{bookAgainError}</p>}
            <div className="flex gap-2">
              <button
                onClick={submitBookAgain}
                disabled={!bookAgainDate || bookAgainSaving || bookAgainIsUnavailable}
                className="text-xs px-4 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                style={{ background: "#D4A64F", color: "#0E0E10" }}
              >
                {bookAgainSaving
                  ? "Sending…"
                  : bookAgainRepeat === "none"
                  ? "Send Request"
                  : `Send ${bookAgainRepeatCount} Requests`}
              </button>
              <button
                onClick={() => setIsBookingAgain(false)}
                className="text-xs px-4 py-1.5 rounded-lg"
                style={{ color: "#9a9591" }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div
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
        {error && <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>{error}</p>}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <span
          className="text-xs px-2.5 py-1 rounded-full"
          style={{ backgroundColor: `${STATUS_DOT_COLOR[r.status]}26`, color: STATUS_DOT_COLOR[r.status] }}
        >
          {STATUS_LABEL[r.status]}
        </span>
        {cancelledBySubLabel(r) && (
          <span className="text-xs" style={{ color: "#5e5c58" }}>{cancelledBySubLabel(r)}</span>
        )}
        <div className="flex gap-1.5">
          {canBookAgain && (
            <button
              onClick={startBookingAgain}
              className="text-xs px-2.5 py-1 rounded-lg transition-all hover:brightness-125"
              style={{ background: "rgba(212,166,79,0.12)", color: "#D4A64F", border: "1px solid rgba(212,166,79,0.25)" }}
            >
              Book Again
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => setIsEditing(true)}
              className="text-xs px-2.5 py-1 rounded-lg transition-all hover:brightness-125"
              style={{ background: "rgba(255,255,255,0.05)", color: "#9a9591", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              Edit
            </button>
          )}
          {canCancel && (
            <button
              onClick={cancel}
              disabled={cancelling}
              className="text-xs px-2.5 py-1 rounded-lg transition-all hover:brightness-125"
              style={{ background: "rgba(226,92,92,0.1)", color: "#e25c5c", opacity: cancelling ? 0.6 : 1 }}
            >
              {cancelling ? "Cancelling…" : "Cancel booking"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VenueBookingsCalendar({
  requests,
  onChanged,
}: {
  requests: VenueBookingRequestView[];
  onChanged: () => void;
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calStart = startOfWeek(monthStart);
  const calEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calStart, end: calEnd });

  function requestsOnDay(day: Date) {
    return requests.filter((r) => isSameDay(new Date(r.date + "T12:00:00"), day));
  }

  const selectedDayRequests = selectedDay ? requestsOnDay(selectedDay) : [];

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
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
          const dayRequests = requestsOnDay(day);

          return (
            <button
              key={idx}
              onClick={() => setSelectedDay(dayRequests.length > 0 ? day : null)}
              className="min-h-[90px] p-2 text-left transition-all"
              style={{
                backgroundColor: isSelected ? "rgba(212,166,79,0.08)" : isCurrentMonth ? "#16181c" : "#13141700",
                borderRight: (idx + 1) % 7 === 0 ? "none" : "1px solid rgba(255,255,255,0.05)",
                borderBottom: idx < days.length - 7 ? "1px solid rgba(255,255,255,0.05)" : "none",
                cursor: dayRequests.length > 0 ? "pointer" : "default",
              }}
            >
              <div
                className="text-xs font-medium mb-1.5 w-6 h-6 flex items-center justify-center rounded-full"
                style={{
                  color: isToday ? "#0E0E10" : isCurrentMonth ? "#9a9591" : "#2e2c28",
                  backgroundColor: isToday ? "#D4A64F" : "transparent",
                  fontWeight: isToday ? 700 : 400,
                }}
              >
                {format(day, "d")}
              </div>
              <div className="flex flex-wrap gap-1">
                {dayRequests.map((r) => (
                  <span
                    key={r.id}
                    title={`${r.artist_name} — ${STATUS_LABEL[r.status]}`}
                    style={{
                      width: "7px", height: "7px", borderRadius: "999px",
                      backgroundColor: STATUS_DOT_COLOR[r.status],
                      display: "inline-block",
                    }}
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected day detail panel */}
      {selectedDay && selectedDayRequests.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: "#9a9591" }}>
            {format(selectedDay, "EEEE, MMMM d")}
          </h3>
          <div className="space-y-3">
            {selectedDayRequests.map((r) => (
              <DayDetailCard key={r.id} r={r} onCancelled={onChanged} />
            ))}
          </div>
        </div>
      )}

      {requests.length === 0 && (
        <p className="text-sm mt-8" style={{ color: "#5e5c58" }}>
          You haven&apos;t sent any booking requests yet.
        </p>
      )}
    </div>
  );
}
