"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import NotificationBell from "@/components/notifications/NotificationBell";
import { UnreadBadge, useUnreadMessages } from "@/components/messages/UnreadMessages";

// The artist side's desktop navigation: a sticky top tab bar, matching the
// venue side's (components/venue/VenueNav.tsx). It replaced the left
// sidebar on 2026-10-06. Phones are unchanged — they keep the bottom tab
// bar in MobileNav.tsx, and this bar is hidden below the md breakpoint.
//
// Between 768px and 1024px there isn't room for the full labels, so those
// widths use the short ones (and drop the name next to the photo).
//
// "Ratings" (/ratings) is deliberately not a tab — it's reached from the
// Dashboard's "Pending Ratings" card, to keep the nav from growing one tab
// per feature.
const links = [
  { href: "/dashboard",     label: "Overview",         short: "Overview" },
  { href: "/pipeline",      label: "Pipeline",         short: "Pipeline" },
  { href: "/discover",      label: "Discover Venues",  short: "Discover" },
  { href: "/venues/import", label: "Outreach",         short: "Outreach" },
  { href: "/calendar",      label: "Booking Calendar", short: "Calendar" },
  { href: "/invoices",      label: "Invoices",         short: "Invoices" },
  { href: "/messages",      label: "Messages",         short: "Messages" },
];

export default function ArtistTopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const unreadMessages = useUnreadMessages(pathname);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function loadProfile() {
      fetch("/api/artist-profile")
        .then((r) => (r.ok ? r.json() : null))
        .then((p) => {
          if (p) {
            setDisplayName(p.display_name ?? null);
            setPhotoUrl(p.photo_url ?? null);
          }
        })
        .catch(() => {});
    }
    loadProfile();

    // The Artist Profile page dispatches this after a successful save, since
    // this bar keeps its own copy of name/photo and only loads it on mount.
    window.addEventListener("stagereach:profile-updated", loadProfile);
    return () => window.removeEventListener("stagereach:profile-updated", loadProfile);
  }, []);

  // Close the profile menu on a click outside it and on Escape (and the
  // menu's own links close it when used).
  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function isActive(href: string) {
    return pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));
  }

  return (
    <nav
      className="hidden md:flex sticky top-0 z-40 px-6 py-3 items-center gap-4 lg:gap-6"
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

      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="flex items-center gap-1.5 text-sm whitespace-nowrap transition-all hover:brightness-125"
          style={{ color: isActive(link.href) ? "#D4A64F" : "#9a9591", fontWeight: isActive(link.href) ? 600 : 400 }}
        >
          <span className="lg:hidden">{link.short}</span>
          <span className="hidden lg:inline">{link.label}</span>
          {link.href === "/messages" && <UnreadBadge count={unreadMessages} />}
        </Link>
      ))}

      {/* Spacer pushes the bell and the profile menu to the right edge. */}
      <div className="flex-1" />

      <NotificationBell listenForRefreshEvents />

      <div ref={menuRef} className="relative shrink-0">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Account menu"
          className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-all hover:brightness-125"
        >
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" className="w-8 h-8 rounded-full shrink-0 object-cover" />
          ) : (
            <div
              className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold"
              style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}
            >
              {displayName ? displayName.charAt(0).toUpperCase() : "?"}
            </div>
          )}
          <span className="hidden lg:block text-sm max-w-[140px] truncate" style={{ color: "#F4E8D2" }}>
            {displayName ?? "Your Profile"}
          </span>
          <span className="text-xs" style={{ color: "#5e5c58" }} aria-hidden="true">▾</span>
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 mt-2 rounded-lg py-1 min-w-[190px] shadow-lg"
            style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <div className="px-3 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="text-sm font-medium truncate" style={{ color: "#F4E8D2" }}>{displayName ?? "Your Profile"}</div>
              <div className="text-xs" style={{ color: "#5e5c58" }}>Artist</div>
            </div>
            <Link
              href="/artist-profile"
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              className="block px-3 py-2 text-sm transition-all hover:brightness-125"
              style={{ color: isActive("/artist-profile") ? "#D4A64F" : "#F4E8D2" }}
            >
              My Artist Profile
            </Link>
            <button
              role="menuitem"
              onClick={handleSignOut}
              className="w-full text-left px-3 py-2 text-sm transition-all hover:brightness-125"
              style={{ color: "#9a9591" }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
