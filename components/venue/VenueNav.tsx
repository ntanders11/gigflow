"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/venue/profile", label: "My Profile" },
  { href: "/venue/discover", label: "Discover Artists" },
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
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="text-sm transition-all hover:brightness-125"
          style={{ color: pathname === link.href ? "#D4A64F" : "#9a9591", fontWeight: pathname === link.href ? 600 : 400 }}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
