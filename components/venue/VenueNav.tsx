"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const links = [
  { href: "/venue/profile", label: "My Profile" },
  { href: "/venue/discover", label: "Discover Artists" },
  { href: "/venue/ratings", label: "Ratings" },
];

export default function VenueNav() {
  const pathname = usePathname();
  const [pendingRatingsCount, setPendingRatingsCount] = useState(0);

  useEffect(() => {
    fetch("/api/venue/ratings/pending")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setPendingRatingsCount(data?.pending?.length ?? 0))
      .catch(() => {});
  }, []);

  return (
    <nav
      className="px-6 py-3 flex items-center gap-6"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", backgroundColor: "#16181c" }}
    >
      <div style={{ fontFamily: "serif", fontSize: "1rem", color: "#D4A64F", fontWeight: 600 }}>
        StageReach
      </div>
      {links.map((link) => {
        const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
        const badge = link.href === "/venue/ratings" && pendingRatingsCount > 0 ? pendingRatingsCount : null;
        return (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center gap-1.5 text-sm transition-all hover:brightness-125"
            style={{ color: isActive ? "#D4A64F" : "#9a9591", fontWeight: isActive ? 600 : 400 }}
          >
            {link.label}
            {badge && (
              <span
                style={{
                  backgroundColor: "#D4A64F",
                  color: "#0E0E10",
                  fontSize: "10px",
                  fontWeight: 700,
                  borderRadius: "999px",
                  minWidth: "18px",
                  height: "18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 5px",
                }}
              >
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
