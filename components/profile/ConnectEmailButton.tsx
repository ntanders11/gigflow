"use client";

import { useEffect, useState } from "react";

// One "Connect email" button for the Artist Profile's Connected Accounts
// section. Tapping it opens a small pop-up with the two choices, Gmail or
// Outlook, in the same style as the calendar page's "Add to my calendar"
// pop-up. Each choice is a plain link into the existing OAuth start routes
// (/api/auth/gmail/connect, /api/auth/outlook/connect), so nothing about
// how connecting works changed — only how the choice is presented.
//
// Shown only while NO account is connected: an artist connects one account
// at a time (sending only ever uses one anyway), so once something is
// connected this button goes away and the connected row takes its place.
export default function ConnectEmailButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const optionClass = "flex items-center justify-between w-full rounded-lg px-4 py-3 text-sm font-medium transition-all hover:brightness-125";
  const optionStyle = { backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.1)", color: "#F4E8D2", minHeight: "48px" };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
        style={{ backgroundColor: "#D4A64F", color: "#0E0E10", minHeight: "44px" }}
      >
        Connect email
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Connect your email"
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5"
            style={{
              backgroundColor: "#16181c",
              border: "1px solid rgba(255,255,255,0.1)",
              paddingBottom: "calc(20px + env(safe-area-inset-bottom))",
            }}
          >
            <div className="flex items-start justify-between gap-4 mb-1">
              <h2 className="text-base font-bold" style={{ color: "#F4E8D2" }}>Connect your email</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-lg leading-none px-2"
                style={{ color: "#9a9591", minWidth: "44px", minHeight: "44px", marginTop: "-10px", marginRight: "-10px" }}
              >
                ✕
              </button>
            </div>
            <p className="text-xs mb-4" style={{ color: "#9a9591" }}>
              Pick the one you use. Pitch and follow-up emails will send from that address.
            </p>

            <div className="space-y-2">
              <a href="/api/auth/gmail/connect" className={optionClass} style={optionStyle}>
                <span>Gmail</span>
                <span style={{ color: "#D4A64F" }}>→</span>
              </a>
              <a href="/api/auth/outlook/connect" className={optionClass} style={optionStyle}>
                <span>Outlook</span>
                <span style={{ color: "#D4A64F" }}>→</span>
              </a>
            </div>

            <p className="text-xs mt-4" style={{ color: "#5e5c58" }}>
              StageReach only gets permission to send email on your behalf — it can&apos;t read your inbox.
              You can disconnect any time from this page.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
