"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const mainLinks = [
  { href: "/dashboard",  label: "Overview",         icon: "◆", badge: null, comingSoon: false },
  { href: "/pipeline",   label: "Pipeline",          icon: "◎", badge: null, comingSoon: false },
  { href: "/discover",   label: "Discover Venues",   icon: "⊕", badge: null, comingSoon: false },
  { href: "/venues/import", label: "Outreach",       icon: "✉", badge: null, comingSoon: false },
  { href: "/calendar",   label: "Booking Calendar",  icon: "☐", badge: null, comingSoon: false },
  { href: "/invoices",   label: "Invoices",          icon: "$", badge: null, comingSoon: false },
];

const profileLinks = [
  { href: "/artist-profile", label: "My Artist Profile", icon: "◎" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside
      className="w-56 shrink-0 flex flex-col h-screen"
      style={{ backgroundColor: "#16181c", borderRight: "1px solid rgba(255,255,255,0.07)" }}
    >
      {/* Logo area */}
      <div
        className="px-4 pt-5 pb-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: "1.25rem",
            color: "#d4a853",
            letterSpacing: "-0.01em",
            lineHeight: 1.2,
          }}
        >
          GigFlow
        </div>
        <div
          style={{
            fontSize: "9px",
            color: "#5e5c58",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            marginTop: "3px",
          }}
        >
          Musician Dashboard
        </div>
      </div>

      {/* Main nav */}
      <nav className="px-2 pt-4 pb-2">
        <div
          style={{
            fontSize: "9px",
            color: "#5e5c58",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            paddingLeft: "10px",
            marginBottom: "6px",
          }}
        >
          Main
        </div>
        <div className="space-y-0.5">
          {mainLinks.map((link) => {
            const isActive =
              !link.comingSoon &&
              (pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href + "/")));

            return (
              <Link
                key={link.label}
                href={link.comingSoon ? "#" : link.href}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
                style={{
                  backgroundColor: isActive ? "rgba(212,168,83,0.12)" : "transparent",
                  color: link.comingSoon ? "#5e5c58" : isActive ? "#d4a853" : "#9a9591",
                  fontWeight: isActive ? 500 : 400,
                  cursor: link.comingSoon ? "default" : "pointer",
                  pointerEvents: link.comingSoon ? "none" : "auto",
                }}
              >
                <span style={{ fontSize: "13px", opacity: link.comingSoon ? 0.5 : 1 }}>
                  {link.icon}
                </span>
                <span className="flex-1 truncate">{link.label}</span>
                {link.badge && (
                  <span
                    style={{
                      backgroundColor: "#d4a853",
                      color: "#0e0f11",
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
                    {link.badge}
                  </span>
                )}
                {link.comingSoon && (
                  <span
                    style={{
                      fontSize: "9px",
                      color: "#5e5c58",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    Soon
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Profile nav */}
      <nav className="px-2 pt-3 pb-2">
        <div
          style={{
            fontSize: "9px",
            color: "#5e5c58",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            paddingLeft: "10px",
            marginBottom: "6px",
          }}
        >
          Profile
        </div>
        <div className="space-y-0.5">
          {profileLinks.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.label}
                href={link.href}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
                style={{
                  backgroundColor: isActive ? "rgba(212,168,83,0.12)" : "transparent",
                  color: isActive ? "#d4a853" : "#9a9591",
                  fontWeight: isActive ? 500 : 400,
                }}
              >
                <span style={{ fontSize: "13px" }}>{link.icon}</span>
                <span className="flex-1 truncate">{link.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="flex-1" />

      {/* Profile bar */}
      <div
        className="px-4 py-4"
        style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className="flex items-center gap-3">
          <img
            src="https://rqwlsxjdwuqizkacrtmb.supabase.co/storage/v1/object/public/artist-photos/d002fe32-fd2b-48a8-9874-60d2c2380bbf/avatar.JPG"
            alt="Taylor Anderson"
            className="w-8 h-8 rounded-full shrink-0 object-cover"
          />
          <div className="min-w-0">
            <div
              className="text-sm font-medium truncate"
              style={{ color: "#f0ede8", lineHeight: 1.3 }}
            >
              Taylor Anderson
            </div>
            <div
              className="text-xs truncate"
              style={{ color: "#5e5c58", lineHeight: 1.3 }}
            >
              Solo Artist
            </div>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="w-full text-left px-3 py-1.5 text-xs rounded-lg transition-colors mt-2"
          style={{ color: "#5e5c58" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = "#1e2128";
            (e.currentTarget as HTMLElement).style.color = "#9a9591";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
            (e.currentTarget as HTMLElement).style.color = "#5e5c58";
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

// Mobile bottom navigation bar
export function MobileBottomNav() {
  const pathname = usePathname();

  const mobileLinks = [
    { href: "/dashboard",  label: "Overview",  icon: "◆" },
    { href: "/pipeline",   label: "Pipeline",  icon: "◎" },
    { href: "/discover",   label: "Discover",  icon: "⊕" },
    { href: "/calendar",   label: "Calendar",  icon: "☐" },
    { href: "/invoices",   label: "Invoices",  icon: "$" },
  ];

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around px-2 py-2"
      style={{ backgroundColor: "#16181c", borderTop: "1px solid rgba(255,255,255,0.07)" }}
    >
      {mobileLinks.map((link) => {
        const isActive = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));
        return (
          <Link
            key={link.href}
            href={link.href}
            className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-all"
            style={{ color: isActive ? "#d4a853" : "#5e5c58" }}
          >
            <span style={{ fontSize: "16px" }}>{link.icon}</span>
            <span style={{ fontSize: "9px", fontWeight: isActive ? 600 : 400 }}>{link.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
