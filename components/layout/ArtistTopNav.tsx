"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import NotificationBell from "@/components/notifications/NotificationBell";

// The artist side's desktop navigation: a top tab bar laid out like the
// venue side's (components/venue/VenueNav.tsx — logo and tabs on the left,
// Profile and the bell on the right) and with the same tabs as the phone's
// bottom bar (components/layout/MobileNav.tsx): Overview, Pipeline,
// Calendar, Invoices, Profile. It replaced the left sidebar on 2026-10-06.
// This bar hides itself below the md breakpoint.
//
// Pages that used to have their own sidebar link are still reachable:
//   - Discover Venues: the "Discover New Venues" toggle on Pipeline
//     (it also keeps Pipeline highlighted here).
//   - Import / Outreach: the Dashboard's header button and Pipeline's empty state.
//   - Messages and Ratings: the Dashboard's "Unread Messages" / "Pending
//     Ratings" cards, and the notification bell.
//   - Sign out: the bottom of the Artist Profile page, as on the venue side.
const mainLinks = [
  // `also` lists other sections that belong under the same tab, so it stays
  // highlighted on those pages (Discover and the venue pages are part of
  // working your pipeline).
  { href: "/dashboard", label: "Overview", also: [] as string[] },
  { href: "/pipeline",  label: "Pipeline", also: ["/discover", "/venues"] },
  { href: "/calendar",  label: "Calendar", also: [] as string[] },
  { href: "/invoices",  label: "Invoices", also: [] as string[] },
];
const profileLink = { href: "/artist-profile", label: "My Profile" };

export default function ArtistTopNav() {
  const pathname = usePathname();

  function isActive(href: string, also: string[] = []) {
    const hit = (h: string) => pathname === h || pathname.startsWith(h + "/");
    return hit(href) || also.some(hit);
  }

  return (
    <nav
      className="hidden md:flex sticky top-0 z-40 px-6 py-3 items-center gap-6"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", backgroundColor: "#16181c" }}
    >
      <Link href="/dashboard" className="shrink-0" aria-label="StageReach home">
        <Image
          src="/stagereach-logo.png"
          alt="StageReach"
          width={150}
          height={50}
          style={{ objectFit: "contain", objectPosition: "left", height: "36px", width: "108px" }}
        />
      </Link>

      {mainLinks.map((link) => {
        const active = isActive(link.href, link.also);
        return (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center gap-1.5 text-sm transition-all hover:brightness-125"
            style={{ color: active ? "#D4A64F" : "#9a9591", fontWeight: active ? 600 : 400 }}
          >
            {link.label}
          </Link>
        );
      })}

      {/* Spacer pushes Profile + the notification bell to the right edge,
          separated from the main tabs — same as the venue bar. */}
      <div className="flex-1" />

      <Link
        href={profileLink.href}
        className="flex items-center gap-1.5 text-sm transition-all hover:brightness-125"
        style={{ color: isActive(profileLink.href) ? "#D4A64F" : "#9a9591", fontWeight: isActive(profileLink.href) ? 600 : 400 }}
      >
        {profileLink.label}
      </Link>
      <NotificationBell listenForRefreshEvents />
    </nav>
  );
}
