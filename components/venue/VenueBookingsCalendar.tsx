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

function DayDetailCard({ r, onCancelled }: { r: VenueBookingRequestView; onCancelled: () => void }) {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const canCancel = r.status === "pending" || r.status === "accepted";

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
