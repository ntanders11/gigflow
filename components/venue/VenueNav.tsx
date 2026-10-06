"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import NotificationBell from "@/components/notifications/NotificationBell";
import { UnreadBadge, useUnreadMessages } from "@/components/messages/UnreadMessages";

// Dashboard leads and is the default landing page for every venue login
// (see proxy.ts). Desktop bar: Dashboard, Discover Artists, Bookings,
// Invoices, Messages, then (after a spacer that pushes them to the right
// edge) Profile and the notification bell. Mobile bottom bar: Dashboard,
// Discover, Bookings, Messages, Profile (Invoices has no mobile slot).
const dashboardLink = { href: "/venue/dashboard", label: "Dashboard",        mobileLabel: "Dashboard", icon: "◆" };
// Favorites lives inside Discover Artists now (a "★ Favorites" dropdown
// near the top of that page) rather than as its own tab/page.
const discoverLink  = { href: "/venue/discover",  label: "Discover Artists", mobileLabel: "Discover",  icon: "⊕" };
const bookingsLink  = { href: "/venue/bookings",  label: "Bookings",         mobileLabel: "Bookings",  icon: "☐" };
// Invoices keeps its desktop tab but gave up its mobile slot to Messages
// (2026-10-06); on phones it's reached from the Dashboard's "Outstanding"
// card. "Ratings" (/venue/ratings) is likewise reached from a dashboard card.
const invoicesLink  = { href: "/venue/invoices",  label: "Invoices",         mobileLabel: "Invoices",  icon: "$" };
const messagesLink  = { href: "/venue/messages",  label: "Messages",         mobileLabel: "Messages",  icon: "✉" };
const profileLink = { href: "/venue/profile", label: "My Profile", mobileLabel: "Profile", icon: "◉" };

const desktopMainLinks = [dashboardLink, discoverLink, bookingsLink, invoicesLink, messagesLink];
const mobileLinks = [dashboardLink, discoverLink, bookingsLink, messagesLink, profileLink];

// Renders both surfaces from one component so every page that does
// `<VenueNav />` gets both automatically, with no per-page changes: a
// desktop top bar (hidden on mobile) and a fixed mobile bottom tab bar
// (hidden on desktop) modeled directly on the artist side's
// components/layout/MobileNav.tsx — same fixed positioning, safe-area
// padding, and 44x44pt touch targets, so the two account types feel like
// the same app instead of two different ones. The old version was a single
// non-wrapping horizontal row of 6 links + logo + bell that just overflowed
// off the right edge of the screen on mobile, forcing a sideways swipe to
// reach anything past the first couple of links.
export default function VenueNav() {
  const pathname = usePathname();
  const unreadMessages = useUnreadMessages(pathname);

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
        {desktopMainLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center gap-1.5 text-sm transition-all hover:brightness-125"
            style={{ color: isActive(link.href) ? "#D4A64F" : "#9a9591", fontWeight: isActive(link.href) ? 600 : 400 }}
          >
            {link.label}
            {link.href === "/venue/messages" && <UnreadBadge count={unreadMessages} />}
          </Link>
        ))}
        {/* Spacer pushes Profile + the notification bell to the right
            edge, separated from the main nav links. */}
        <div className="flex-1" />
        <Link
          href={profileLink.href}
          className="flex items-center gap-1.5 text-sm transition-all hover:brightness-125"
          style={{ color: isActive(profileLink.href) ? "#D4A64F" : "#9a9591", fontWeight: isActive(profileLink.href) ? 600 : 400 }}
        >
          {profileLink.label}
        </Link>
        <NotificationBell />
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
        {mobileLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex flex-col items-center justify-center gap-0.5 rounded-lg transition-all"
            style={{ color: isActive(link.href) ? "#D4A64F" : "#5e5c58", minWidth: "44px", minHeight: "44px", padding: "6px 4px" }}
          >
            <span className="relative" style={{ fontSize: "18px" }}>
              {link.icon}
              {link.href === "/venue/messages" && unreadMessages > 0 && (
                <span className="absolute -top-1 -right-3"><UnreadBadge count={unreadMessages} /></span>
              )}
            </span>
            <span className="text-center" style={{ fontSize: "9px", fontWeight: isActive(link.href) ? 600 : 400 }}>
              {link.mobileLabel}
            </span>
          </Link>
        ))}
      </nav>

      {/* Fixed top-right notification bell on mobile — moved out of the
          bottom bar (2026-09-25) to match the artist side, so it doesn't
          cost a tab slot; the 5 links above stay a clean bottom bar. */}
      <div
        className="md:hidden fixed z-50 rounded-full flex items-center justify-center"
        style={{
          top: "calc(10px + env(safe-area-inset-top))",
          right: "10px",
          width: "38px",
          height: "38px",
          backgroundColor: "#16181c",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <NotificationBell />
      </div>
    </>
  );
}
