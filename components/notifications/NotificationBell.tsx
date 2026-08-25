"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { NotificationView } from "@/types";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Pass listenForRefreshEvents=true only where the existing
// stagereach:profile-updated / stagereach:booking-request-updated events
// are actually dispatched today (the artist side) — they're never fired
// from venue-side code, so passing true there would just add two dead
// listeners.
//
// align controls which side the dropdown's edge is pinned to — pass
// "left" whenever the bell sits closer to the left side of its bar than
// the right (the desktop Sidebar, and VenueNav's bar, which packs its
// items to the left with no spacer), so the dropdown grows rightward
// into open space instead of running off the left edge of the screen.
// The "right" default suits a bell placed near the right edge of a bar,
// or one in a slot where growing rightward would run off-screen instead
// (MobileBottomNav's bell, in the bottom-right corner, uses this default).
//
// dropUp renders the dropdown above the bell instead of below — needed
// for MobileBottomNav, which is pinned to the bottom of the viewport, so
// a below-anchored dropdown would render off-screen.
export default function NotificationBell({
  listenForRefreshEvents = false,
  align = "right",
  dropUp = false,
}: {
  listenForRefreshEvents?: boolean;
  align?: "left" | "right";
  dropUp?: boolean;
}) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function load() {
      fetch("/api/notifications")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          setNotifications(data?.notifications ?? []);
          setUnreadCount(data?.unreadCount ?? 0);
        })
        .catch(() => {});
    }
    load();
    if (!listenForRefreshEvents) return;
    window.addEventListener("stagereach:profile-updated", load);
    window.addEventListener("stagereach:booking-request-updated", load);
    return () => {
      window.removeEventListener("stagereach:profile-updated", load);
      window.removeEventListener("stagereach:booking-request-updated", load);
    };
  }, [listenForRefreshEvents]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleToggle() {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && unreadCount > 0) {
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      fetch("/api/notifications/mark-read", { method: "PATCH" }).catch(() => {});
    }
  }

  function handleClickNotification(n: NotificationView) {
    setOpen(false);
    router.push(n.link);
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={handleToggle}
        className="relative flex items-center justify-center transition-all hover:brightness-125"
        style={{ width: "32px", height: "32px", color: "#9a9591" }}
        aria-label="Notifications"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute", top: "2px", right: "2px",
              backgroundColor: "#D4A64F", color: "#0E0E10",
              fontSize: "9px", fontWeight: 700, borderRadius: "999px",
              minWidth: "15px", height: "15px", display: "flex",
              alignItems: "center", justifyContent: "center", padding: "0 3px",
            }}
          >
            {unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div
          className="rounded-xl overflow-hidden"
          style={{
            position: "absolute",
            ...(dropUp ? { bottom: "40px" } : { top: "40px" }),
            ...(align === "left" ? { left: "0" } : { right: "0" }),
            width: "320px", maxWidth: "calc(100vw - 32px)", maxHeight: "400px", overflowY: "auto",
            backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)",
            zIndex: 50, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {notifications.length === 0 ? (
            <p className="text-sm p-4 text-center" style={{ color: "#5e5c58" }}>Nothing yet</p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClickNotification(n)}
                className="w-full text-left px-4 py-3 transition-all hover:brightness-125"
                style={{
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  backgroundColor: n.read ? "transparent" : "rgba(212,166,79,0.06)",
                }}
              >
                <div className="text-sm font-medium" style={{ color: "#F4E8D2" }}>{n.title}</div>
                {n.body && <div className="text-xs mt-0.5" style={{ color: "#9a9591" }}>{n.body}</div>}
                <div className="text-xs mt-1" style={{ color: "#5e5c58" }}>{timeAgo(n.created_at)}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
