"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import NotificationBell from "@/components/notifications/NotificationBell";

const links = [
  { href: "/venue/profile", label: "My Profile" },
  { href: "/venue/discover", label: "Discover Artists" },
  { href: "/venue/bookings", label: "Bookings" },
  { href: "/venue/ratings", label: "Ratings" },
];

export default function VenueNav() {
  const pathname = usePathname();

  return (
    <nav
      className="px-6 py-3 flex items-center gap-6"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", backgroundColor: "#16181c" }}
    >
      <div style={{ fontFamily: "serif", fontSize: "1rem", color: "#D4A64F", fontWeight: 600 }}>
        StageReach
      </div>
      <NotificationBell align="left" />
      {links.map((link) => {
        const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
        return (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center gap-1.5 text-sm transition-all hover:brightness-125"
            style={{ color: isActive ? "#D4A64F" : "#9a9591", fontWeight: isActive ? 600 : 400 }}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
