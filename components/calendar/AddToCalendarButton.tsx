"use client";

import { useEffect, useState } from "react";

const CALENDAR_NAME = "StageReach Gigs";

// One button on the Booking Calendar page. Tapping it opens a small pop-up
// with a way to subscribe for whatever calendar app someone uses — Apple,
// Google, Outlook, or a copyable link for anything else. It replaces the
// old pair of blocks (an iCloud-only banner at the top and a copy box with
// iPhone-only steps further down) that both did the same job.
//
// Every option points at the same single calendar feed (the app's
// /api/calendar/ics link); only the way it gets handed to each calendar app
// differs. Subscribing means the calendar app re-checks the feed on its own
// schedule, so new gigs show up without anyone adding them one by one.
export default function AddToCalendarButton({ subscriptionUrl }: { subscriptionUrl: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // "webcal://" is the standard address style that opens a subscribe prompt
  // in Apple Calendar (and is what Google's add-by-link also expects).
  const webcalUrl = `webcal://${subscriptionUrl.replace(/^https?:\/\//, "")}`;
  const appleHref = webcalUrl;
  const googleHref = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`;
  const outlookHref = `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(subscriptionUrl)}&name=${encodeURIComponent(CALENDAR_NAME)}`;

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(subscriptionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (e.g. some in-app browsers); the link stays
      // visible below so it can still be copied by hand.
    }
  }

  const optionClass = "flex items-center justify-between w-full rounded-lg px-4 py-3 text-sm font-medium transition-all hover:brightness-125";
  const optionStyle = { backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.1)", color: "#F4E8D2", minHeight: "48px" };

  return (
    <>
      <div
        className="rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
        style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div>
          <p className="text-sm font-semibold mb-0.5" style={{ color: "#F4E8D2" }}>Add your gigs to your calendar</p>
          <p className="text-xs" style={{ color: "#9a9591" }}>Subscribe once and every booked gig shows up automatically.</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:brightness-110 shrink-0"
          style={{ backgroundColor: "#D4A64F", color: "#0E0E10", minHeight: "44px" }}
        >
          Add to my calendar
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add your gigs to your calendar"
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5"
            style={{
              backgroundColor: "#16181c",
              border: "1px solid rgba(255,255,255,0.1)",
              paddingBottom: "calc(20px + env(safe-area-inset-bottom))",
            }}
          >
            <div className="flex items-start justify-between gap-4 mb-1">
              <h2 className="text-base font-bold" style={{ color: "#F4E8D2" }}>Add to your calendar</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-lg leading-none px-2"
                style={{ color: "#9a9591", minWidth: "44px", minHeight: "44px", marginTop: "-10px", marginRight: "-10px" }}
              >
                ✕
              </button>
            </div>
            <p className="text-xs mb-4" style={{ color: "#9a9591" }}>Pick the calendar you use. You only do this once.</p>

            <div className="space-y-2">
              <a href={appleHref} className={optionClass} style={optionStyle}>
                <span>Apple Calendar</span>
                <span style={{ color: "#D4A64F" }}>→</span>
              </a>
              <a href={googleHref} target="_blank" rel="noreferrer" className={optionClass} style={optionStyle}>
                <span>Google Calendar</span>
                <span style={{ color: "#D4A64F" }}>→</span>
              </a>
              <a href={outlookHref} target="_blank" rel="noreferrer" className={optionClass} style={optionStyle}>
                <span>Outlook</span>
                <span style={{ color: "#D4A64F" }}>→</span>
              </a>
              <button
                onClick={copyLink}
                className={optionClass}
                style={{
                  ...optionStyle,
                  ...(copied ? { backgroundColor: "rgba(76,175,125,0.15)", border: "1px solid #4caf7d", color: "#4caf7d" } : {}),
                }}
              >
                <span>{copied ? "✓ Link copied" : "Copy link (any other calendar app)"}</span>
              </button>
            </div>

            <p className="text-xs mt-4" style={{ color: "#9a9591" }}>
              With the copied link, look for &ldquo;subscribe to calendar&rdquo; or &ldquo;add calendar from URL&rdquo;
              in your calendar app and paste it. Outlook through work or school? Use the copied link too.
            </p>
            <p className="text-xs mt-2" style={{ color: "#5e5c58" }}>
              Your calendar app checks for changes on its own schedule. Apple is usually quick; Google and Outlook can
              take several hours to show a new gig.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
