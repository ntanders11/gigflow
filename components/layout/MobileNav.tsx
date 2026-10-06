"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import FloatingBell from "@/components/notifications/FloatingBell";

// Artist navigation for phones: the bottom tab bar and the floating bell.
// (The desktop navigation is the top tab bar in ArtistTopNav.tsx — this
// file used to also hold the desktop left sidebar, replaced 2026-10-06.)
//
// "Ratings" (/ratings) is deliberately not a tab — it's reached from the
// Dashboard's "Pending Ratings" card, to keep the nav from growing one
// tab per feature (2026-09-01).

// Mobile bottom navigation bar
export function MobileBottomNav() {
  const pathname = usePathname();

  // Discover dropped from here 2026-09-25 — it's now reached via a toggle
  // on the Pipeline page itself (components/pipeline/PipelineView.tsx),
  // freeing up a tab slot to get down to 5. The notification bell moved
  // out of this bar entirely, to a fixed top-right icon rendered once in
  // app/(protected)/layout.tsx — same reasoning as the venue side's bell,
  // just relocated further so it doesn't cost a tab slot at all.
  const mobileLinks = [
    { href: "/dashboard",  label: "Overview",  icon: "◆" },
    { href: "/pipeline",   label: "Pipeline",  icon: "◎" },
    { href: "/calendar",   label: "Calendar",  icon: "☐" },
    { href: "/invoices",   label: "Invoices",  icon: "$" },
    { href: "/artist-profile", label: "Profile", icon: "◉" },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around px-1"
      style={{
        backgroundColor: "#16181c",
        borderTop: "1px solid rgba(255,255,255,0.07)",
        // Base padding for the bar itself, plus however much the device's
        // home-indicator gesture area actually needs (0 on devices without
        // one, ~34px on notched iPhones) — keeps every tap target clear of
        // that zone instead of sitting flush against the bottom edge.
        paddingTop: "10px",
        paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
      }}
    >
      {mobileLinks.map((link) => {
        const isActive = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            className="flex flex-col items-center justify-center gap-0.5 rounded-lg transition-all"
            style={{ color: isActive ? "#D4A64F" : "#5e5c58", minWidth: "44px", minHeight: "44px", padding: "6px 8px" }}
          >
            <span style={{ fontSize: "18px" }}>{link.icon}</span>
            <span style={{ fontSize: "9px", fontWeight: isActive ? 600 : 400 }}>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// Fixed top-right notification bell for mobile — rendered once in
// app/(protected)/layout.tsx so every artist page gets it without a
// per-page change, and it no longer competes with the 5 bottom tabs for
// space (2026-09-25).
export function MobileNotificationBell() {
  return <FloatingBell listenForRefreshEvents />;
}
