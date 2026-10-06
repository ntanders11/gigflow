"use client";

import NotificationBell from "@/components/notifications/NotificationBell";

// The notification bell that floats in the top-right corner on phones,
// shared by the artist side (MobileNav.tsx) and the venue side (VenueNav.tsx)
// so the two can't drift apart.
//
// Its vertical position is chosen so its center lines up with the center of
// a standard page header row (a heading plus a button, as on the Overview
// pages): that row starts 16px below --app-top-inset (the page's own
// padding) and is about 36px tall, so its center is ~34px down, and this
// 42px circle starting 13px down is centered there too. Pages whose header
// row is a different height can sit a few pixels off.
//
// Made easy to see on purpose: a brighter icon, a lighter circle with a
// visible edge and a soft shadow, and set a little further down from the
// top of the screen. Before (2026-10-06) it was a thin gray bell on a circle
// that was nearly the same color as the page, tucked right under the iPhone
// clock — where iOS softens whatever sits near the top edge — so it looked
// like it was fading out.
export default function FloatingBell({ listenForRefreshEvents = false }: { listenForRefreshEvents?: boolean }) {
  return (
    <div
      className="md:hidden fixed z-50 rounded-full flex items-center justify-center"
      style={{
        top: "calc(13px + var(--app-top-inset))",
        right: "12px",
        width: "42px",
        height: "42px",
        backgroundColor: "#262b33",
        border: "1px solid rgba(255,255,255,0.22)",
        boxShadow: "0 2px 10px rgba(0,0,0,0.55)",
      }}
    >
      <NotificationBell listenForRefreshEvents={listenForRefreshEvents} tone="bright" />
    </div>
  );
}
