import { createClient, createServiceClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import VenueNav from "@/components/venue/VenueNav";
import { getOwnCompletedVenueProfile } from "@/lib/bookings/venue-auth";
import { getVenuePendingRelationships } from "@/lib/ratings/eligibility";
import { buildArtistResults, ArtistResult } from "@/lib/venues/artist-results";

type RequestRow = {
  id: string;
  artist_user_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
};

function fmtDay(dateStr: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function fmtTime(t: string | null): string | null {
  if (!t) return null;
  return new Date(`2000-01-01T${t}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default async function VenueDashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const venueProfile = await getOwnCompletedVenueProfile(supabase, user.id);
  if (!venueProfile) redirect("/venues/signup");

  const service = await createServiceClient();

  // Every request this venue has ever sent — same source the Bookings
  // page reads, but here we only need enough to compute counts and the
  // two lists below, not the full VenueBookingRequestView shape.
  const { data: requestRows } = await service
    .from("booking_requests")
    .select("id, artist_user_id, date, start_time, end_time, status")
    .eq("venue_profile_id", venueProfile.id)
    .order("date", { ascending: true });

  const requests: RequestRow[] = requestRows ?? [];
  const pending = requests.filter((r) => r.status === "pending");
  const accepted = requests.filter((r) => r.status === "accepted");

  const todayStr = new Date().toISOString().slice(0, 10);
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const upcomingGigs = accepted.filter((r) => r.date >= todayStr && r.date <= thirtyDaysFromNow);

  const artistIds = [...new Set(requests.map((r) => r.artist_user_id))];
  const { data: artistRows } = await service
    .from("artist_profiles")
    .select("user_id, display_name, photo_url")
    .in("user_id", artistIds.length > 0 ? artistIds : [""]);
  const artistByUserId = new Map((artistRows ?? []).map((a) => [a.user_id as string, a]));

  // Outstanding invoices — same cross-account read pattern
  // app/venue/invoices/page.tsx already uses (invoices carries no
  // venue-facing RLS policy, so this has to go through the service
  // client filtered down to this venue's own linked pipeline rows).
  const { data: myVenueRows } = await service
    .from("venues")
    .select("id")
    .eq("venue_profile_id", venueProfile.id);
  const venueRowIds = (myVenueRows ?? []).map((v) => v.id as string);

  let outstandingCents = 0;
  if (venueRowIds.length > 0) {
    const { data: unpaidInvoices } = await service
      .from("invoices")
      .select("amount_cents")
      .in("venue_id", venueRowIds)
      .in("status", ["sent", "draft"]);
    outstandingCents = (unpaidInvoices ?? []).reduce((sum, i) => sum + (i.amount_cents as number), 0);
  }

  // Pending ratings — wrapped defensively so one failing query doesn't
  // take the whole dashboard down; worst case this card reads 0.
  let pendingRatingsCount = 0;
  try {
    const pendingRatings = await getVenuePendingRelationships(service, venueProfile.id);
    pendingRatingsCount = pendingRatings.length;
  } catch (err) {
    console.error("venue dashboard: pending ratings lookup failed", err);
  }

  // Favorited artists — same RLS-scoped read the favorites dropdown on
  // Discover Artists uses.
  const { data: favoriteRows } = await supabase
    .from("venue_favorites")
    .select("artist_user_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const favoriteIds = (favoriteRows ?? []).map((r) => r.artist_user_id as string);
  let favorites: ArtistResult[] = [];
  try {
    favorites = await buildArtistResults(supabase, service, favoriteIds, new Set(favoriteIds));
  } catch (err) {
    console.error("venue dashboard: favorites lookup failed", err);
  }

  const statCards = [
    { label: "Pending Requests", value: pending.length, trend: "awaiting your response", color: pending.length > 0 ? "#e25c5c" : "#9a9591", href: "/venue/bookings" },
    { label: "Upcoming Gigs", value: upcomingGigs.length, trend: "in the next 30 days", color: "#4caf7d", href: "/venue/bookings" },
    { label: "Outstanding", value: `$${(outstandingCents / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`, trend: "owed to artists", color: "#D4A64F", href: "/venue/invoices" },
    { label: "Favorited Artists", value: favorites.length, trend: "saved for later", color: "#9b7fe8", href: "/venue/discover" },
    { label: "Pending Ratings", value: pendingRatingsCount, trend: pendingRatingsCount > 0 ? "ready to rate" : "all caught up", color: pendingRatingsCount > 0 ? "#e09b50" : "#9a9591", href: "/venue/ratings" },
  ];

  return (
    <>
      <VenueNav />
      <div className="min-h-screen pb-28 md:pb-0 p-4 md:p-8" style={{ backgroundColor: "#0E0E10", color: "#F4E8D2" }}>
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6 max-w-6xl">
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#F4E8D2" }}>Overview</h1>
          <Link
            href="/venue/discover"
            className="px-3 py-2 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
            style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
          >
            Discover Artists
          </Link>
        </div>

        {/* Pending requests alert banner */}
        {pending.length > 0 && (
          <div
            className="mb-6 max-w-6xl rounded-xl p-4"
            style={{ backgroundColor: "rgba(226,92,92,0.08)", border: "1px solid rgba(226,92,92,0.25)", borderLeft: "3px solid #e25c5c" }}
          >
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">🔔</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold mb-1" style={{ color: "#e25c5c" }}>
                  {pending.length} booking request{pending.length !== 1 ? "s" : ""} awaiting your response
                </p>
                <Link href="/venue/bookings" className="text-xs transition-all hover:brightness-125" style={{ color: "#F4E8D2" }}>
                  Review requests →
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-8 max-w-6xl">
          {statCards.map((stat) => (
            <Link
              key={stat.label}
              href={stat.href}
              className="rounded-xl p-5 block transition-all hover:brightness-125"
              style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#9a9591" }}>{stat.label}</p>
              <p className="text-4xl font-bold leading-none mb-2" style={{ color: stat.color }}>{stat.value}</p>
              <p className="text-xs" style={{ color: "#9a9591" }}>{stat.trend}</p>
            </Link>
          ))}
        </div>

        {/* Upcoming Gigs */}
        <div className="mb-8 max-w-6xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#9a9591" }}>Upcoming Gigs</h2>
            <Link href="/venue/bookings" className="text-xs transition-all hover:brightness-125" style={{ color: "#D4A64F" }}>
              View bookings →
            </Link>
          </div>

          {upcomingGigs.length === 0 ? (
            <div className="rounded-xl px-5 py-8 text-center" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
              <p className="text-sm font-medium mb-1" style={{ color: "#5e5c58" }}>No gigs in the next 30 days</p>
              <p className="text-xs" style={{ color: "#5e5c58" }}>Send a booking request from Discover Artists to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {upcomingGigs.map((r) => {
                const artist = artistByUserId.get(r.artist_user_id);
                const isToday = r.date === todayStr;
                const daysUntil = Math.round((new Date(r.date + "T12:00:00Z").getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                const countdownText = isToday ? "Today" : daysUntil === 1 ? "Tomorrow" : `In ${daysUntil} days`;
                const countdownColor = isToday ? "#D4A64F" : daysUntil <= 1 ? "#e09b50" : daysUntil <= 7 ? "#4caf7d" : "#9a9591";
                const start = fmtTime(r.start_time);
                const end = fmtTime(r.end_time);

                return (
                  <Link
                    key={r.id}
                    href="/venue/bookings"
                    className="rounded-xl p-5 flex flex-col gap-3 transition-all hover:brightness-125"
                    style={{
                      backgroundColor: "#16181c",
                      border: isToday ? "1px solid rgba(212,166,79,0.35)" : "1px solid rgba(255,255,255,0.07)",
                      borderLeft: `3px solid ${isToday ? "#D4A64F" : "#4caf7d"}`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-snug" style={{ color: "#F4E8D2", flex: 1 }}>
                        {(artist?.display_name as string | null) ?? "An artist"}
                      </p>
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0"
                        style={{ backgroundColor: `${countdownColor}22`, color: countdownColor, border: `1px solid ${countdownColor}44` }}
                      >
                        {countdownText}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <p className="text-xs font-medium" style={{ color: "#9a9591" }}>{fmtDay(r.date)}</p>
                      {start ? (
                        <p className="text-xs" style={{ color: "#4caf7d" }}>{start}{end ? ` – ${end}` : ""}</p>
                      ) : (
                        <p className="text-xs" style={{ color: "#5e5c58" }}>No time set</p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Two-column section */}
        <div className="flex flex-col md:flex-row gap-6 max-w-6xl">
          {/* Left: Pending Requests */}
          <div className="flex-[3]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#9a9591" }}>Pending Requests</h2>
              <Link href="/venue/bookings" className="text-xs transition-all hover:brightness-125" style={{ color: "#D4A64F" }}>
                View all →
              </Link>
            </div>
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
              {pending.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm font-medium mb-1" style={{ color: "#5e5c58" }}>Nothing waiting on you</p>
                  <p className="text-xs" style={{ color: "#5e5c58" }}>Every booking request you&apos;ve sent has been answered.</p>
                </div>
              ) : (
                pending.map((r, idx) => {
                  const artist = artistByUserId.get(r.artist_user_id);
                  const isLast = idx === pending.length - 1;
                  return (
                    <Link
                      key={r.id}
                      href="/venue/bookings"
                      className="flex items-center gap-4 px-5 py-4 transition-all hover:brightness-125"
                      style={{ borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)", borderLeft: "3px solid #e25c5c" }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: "#F4E8D2" }}>
                          {(artist?.display_name as string | null) ?? "An artist"}
                        </p>
                        <p className="text-xs truncate" style={{ color: "#9a9591" }}>{fmtDay(r.date)}</p>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Favorited Artists */}
          <div className="flex-[2]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#9a9591" }}>Favorited Artists</h2>
              <Link href="/venue/discover" className="text-xs transition-all hover:brightness-125" style={{ color: "#D4A64F" }}>
                View all →
              </Link>
            </div>
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
              {favorites.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm font-medium mb-1" style={{ color: "#5e5c58" }}>No favorites yet</p>
                  <p className="text-xs" style={{ color: "#5e5c58" }}>Tap the heart on any artist in Discover Artists to save them here.</p>
                </div>
              ) : (
                favorites.slice(0, 6).map((a, idx) => {
                  const isLast = idx === Math.min(favorites.length, 6) - 1;
                  return (
                    <Link
                      key={a.user_id}
                      href={`/profile/${a.user_id}`}
                      className="flex items-center gap-4 px-5 py-4 transition-all hover:brightness-125"
                      style={{ borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)", borderLeft: "3px solid #9b7fe8" }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: "#F4E8D2" }}>{a.display_name}</p>
                        <p className="text-xs truncate" style={{ color: "#9a9591" }}>{a.genres.join(" · ") || "—"}</p>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
