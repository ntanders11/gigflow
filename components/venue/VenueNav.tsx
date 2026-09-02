"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import NotificationBell from "@/components/notifications/NotificationBell";

const links = [
  { href: "/venue/profile",  label: "My Profile",       mobileLabel: "Profile",  icon: "◉" },
  // Favorites lives inside Discover Artists now (a "★ Favorites" dropdown
  // near the top of that page) rather than as its own tab/page.
  { href: "/venue/discover", label: "Discover Artists",  mobileLabel: "Discover", icon: "⊕" },
  { href: "/venue/bookings", label: "Bookings",          mobileLabel: "Bookings", icon: "☐" },
  { href: "/venue/invoices", label: "Invoices",          mobileLabel: "Invoices", icon: "$" },
  { href: "/venue/ratings",  label: "Ratings",           mobileLabel: "Ratings",  icon: "★" },
];

// Renders both surfaces from one component so every page that does
// `<VenueNav />` gets both automatically, with no per-page changes: a
// desktop top bar (hidden on mobile) and a fixed mobile bottom tab bar
// (hidden on desktop) modeled directly on the artist side's
// components/layout/Sidebar.tsx — same fixed positioning, safe-area
// padding, and 44x44pt touch targets, so the two account types feel like
// the same app instead of two different ones. The old version was a single
// non-wrapping horizontal row of 6 links + logo + bell that just overflowed
// off the right edge of the screen on mobile, forcing a sideways swipe to
// reach anything past the first couple of links.
export default function VenueNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <>
      {/* Desktop top bar — unchanged from before, just hidden below md */}
      <nav
        className="hidden md:flex px-6 py-3 items-center gap-6"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", backgroundColor: "#16181c" }}
      >
        <Image
          src="/stagereach-logo.png"
          alt="StageReach"
          width={150}
          height={50}
          style={{ objectFit: "contain", objectPosition: "left", height: "36px", width: "108px" }}
        />
        <NotificationBell align="left" />
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center gap-1.5 text-sm transition-all hover:brightness-125"
            style={{ color: isActive(link.href) ? "#D4A64F" : "#9a9591", fontWeight: isActive(link.href) ? 600 : 400 }}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      {/* Mobile bottom tab bar */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around px-1"
        style={{
          backgroundColor: "#16181c",
          borderTop: "1px solid rgba(255,255,255,0.07)",
          paddingTop: "10px",
          // Base padding plus the iPhone home-indicator safe area, same as
          // the artist side's MobileBottomNav — keeps tap targets clear of
          // the swipe-up gesture zone instead of sitting flush against it.
          paddingBottom: "calc(10px + env(safe-area-inset-bottom))",
        }}
      >
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex flex-col items-center justify-center gap-0.5 rounded-lg transition-all"
            style={{ color: isActive(link.href) ? "#D4A64F" : "#5e5c58", minWidth: "44px", minHeight: "44px", padding: "6px 4px" }}
          >
            <span style={{ fontSize: "18px" }}>{link.icon}</span>
            <span className="text-center" style={{ fontSize: "9px", fontWeight: isActive(link.href) ? 600 : 400 }}>
              {link.mobileLabel}
            </span>
          </Link>
        ))}
        <div className="flex flex-col items-center justify-center gap-0.5" style={{ minWidth: "44px", minHeight: "44px", padding: "6px 4px" }}>
          <NotificationBell dropUp />
        </div>
      </nav>
    </>
  );
}
