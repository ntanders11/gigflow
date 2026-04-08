import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { VenueStage } from "@/types";

const STAGE_STYLE: Record<
  VenueStage,
  { color: string; bg: string; label: string }
> = {
  discovered: { color: "#5b9bd5", bg: "rgba(91,155,213,0.15)", label: "Discovered" },
  contacted:  { color: "#d4a853", bg: "rgba(212,168,83,0.15)",  label: "Contacted"  },
  responded:  { color: "#9b7fe8", bg: "rgba(155,127,232,0.15)", label: "Responded"  },
  negotiating:{ color: "#e09b50", bg: "rgba(224,155,80,0.15)",  label: "Negotiating"},
  booked:     { color: "#4caf7d", bg: "rgba(76,175,125,0.15)",  label: "Booked"     },
  dormant:    { color: "#5e5c58", bg: "rgba(94,92,88,0.15)",   label: "Dormant"    },
};

// Icon box color per venue type (first letter shown)
const TYPE_COLORS: Record<string, string> = {
  bar:        "#d4a853",
  brewery:    "#e09b50",
  restaurant: "#4caf7d",
  cafe:       "#5b9bd5",
  club:       "#9b7fe8",
  winery:     "#c06080",
  hotel:      "#5b9bd5",
  venue:      "#9a9591",
};

function typeColor(type: string | null): string {
  if (!type) return "#9a9591";
  return TYPE_COLORS[type.toLowerCase()] ?? "#9a9591";
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, type, city, stage, updated_at, follow_up_date, last_contacted_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  const { data: upcomingGigs } = await supabase
    .from("gigs")
    .select("id, date, start_time, end_time, status, notes, venues(id, name, city, address)")
    .eq("user_id", user.id)
    .eq("status", "upcoming")
    .order("date", { ascending: true });

  const allVenues = venues ?? [];

  const { data: unpaidInvoices } = await supabase
    .from("invoices")
    .select("id, amount_cents, status")
    .eq("user_id", user.id)
    .in("status", ["sent", "draft"]);

  const { data: paidInvoices } = await supabase
    .from("invoices")
    .select("amount_cents")
    .eq("user_id", user.id)
    .eq("status", "paid");

  const unpaidCount = unpaidInvoices?.length ?? 0;
  const unpaidTotal = (unpaidInvoices ?? []).reduce((sum, inv) => sum + inv.amount_cents, 0);
  const revenueTotal = (paidInvoices ?? []).reduce((sum, inv) => sum + inv.amount_cents, 0);

  // Aggregate stats
  const totalVenues = allVenues.length;
  const bookedCount = allVenues.filter((v) => v.stage === "booked").length;
  const respondedCount = allVenues.filter((v) => v.stage === "responded").length;
  const contactedCount = allVenues.filter((v) => v.stage === "contacted").length;

  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

  // Venues that need attention: contacted 5+ days ago, no reply yet
  const needsAttention = allVenues
    .filter(
      (v) =>
        v.stage === "contacted" &&
        v.last_contacted_at &&
        new Date(v.last_contacted_at) < fiveDaysAgo
    )
    .sort(
      (a, b) =>
        new Date(a.last_contacted_at!).getTime() -
        new Date(b.last_contacted_at!).getTime()
    );

  // Upcoming gigs — next 30 days
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thirtyDaysOut = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  const thisWeekGigs = (upcomingGigs ?? []).filter((g: any) => {
    const d = new Date(g.date + "T12:00:00");
    return d >= today && d <= thirtyDaysOut;
  });

  // Derived lists
  const bookedVenues = allVenues
    .filter((v) => v.stage === "booked")
    .sort((a, b) => {
      if (!a.follow_up_date && !b.follow_up_date) return 0;
      if (!a.follow_up_date) return 1;
      if (!b.follow_up_date) return -1;
      return new Date(a.follow_up_date).getTime() - new Date(b.follow_up_date).getTime();
    });

  const statCards = [
    {
      label: "Total Venues",
      value: totalVenues,
      trend: "in your pipeline",
      color: "#f0ede8",
      href: "/pipeline",
    },
    {
      label: "Booked",
      value: bookedCount,
      trend: "confirmed gigs",
      color: "#4caf7d",
      href: "/pipeline?stage=booked",
    },
    {
      label: "Awaiting Reply",
      value: respondedCount,
      trend: "venues responded",
      color: "#9b7fe8",
      href: "/pipeline?stage=responded",
    },
    {
      label: "Needs Attention",
      value: needsAttention.length,
      trend: "no reply in 5+ days",
      color: needsAttention.length > 0 ? "#e25c5c" : "#9a9591",
      href: "/pipeline?stage=contacted",
    },
    {
      label: "Revenue",
      value: `$${(revenueTotal / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`,
      trend: unpaidCount > 0 ? `$${(unpaidTotal / 100).toFixed(0)} outstanding` : "all invoices paid",
      color: "#4caf7d",
      href: "/invoices",
    },
  ];

  return (
    <div
      className="min-h-screen p-8"
      style={{ backgroundColor: "#0e0f11", color: "#f0ede8" }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between mb-8 max-w-6xl">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#f0ede8" }}>
          Overview
        </h1>
        <div className="flex items-center gap-3">
          <Link
            href="/venues/import"
            className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-125"
            style={{
              color: "#f0ede8",
              border: "1px solid rgba(255,255,255,0.2)",
              backgroundColor: "transparent",
            }}
          >
            + Add Venue
          </Link>
          <Link
            href="/pipeline"
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
            style={{
              backgroundColor: "#d4a853",
              color: "#0e0f11",
            }}
          >
            Find Gigs
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-5 gap-4 mb-8 max-w-6xl">
        {statCards.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="rounded-xl p-5 block transition-all hover:brightness-125"
            style={{
              backgroundColor: "#16181c",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-widest mb-2"
              style={{ color: "#9a9591" }}
            >
              {stat.label}
            </p>
            <p
              className="text-4xl font-bold leading-none mb-2"
              style={{ color: stat.color }}
            >
              {stat.value}
            </p>
            <p className="text-xs" style={{ color: "#9a9591" }}>
              <span style={{ color: "#4caf7d" }}>↑</span>{" "}
              {stat.trend.replace(/^↑\s*/, "")}
            </p>
          </Link>
        ))}
      </div>

      {/* Upcoming Gigs */}
      <div className="mb-8 max-w-6xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#9a9591" }}>
            Upcoming Gigs
          </h2>
          <Link href="/calendar" className="text-xs transition-all hover:brightness-125" style={{ color: "#d4a853" }}>
            View calendar →
          </Link>
        </div>

        {thisWeekGigs.length === 0 ? (
          <div
            className="rounded-xl px-5 py-8 text-center"
            style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <p className="text-sm font-medium mb-1" style={{ color: "#5e5c58" }}>No gigs in the next 30 days</p>
            <p className="text-xs" style={{ color: "#5e5c58" }}>
              Add gig dates in a venue&apos;s detail page to see them here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {thisWeekGigs.map((gig: any) => {
              const d = new Date(gig.date + "T12:00:00");
              const now = new Date();
              now.setHours(0, 0, 0, 0);
              const daysUntil = Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              const isToday = daysUntil === 0;
              const isTomorrow = daysUntil === 1;
              const dayLabel = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
              const timeLabel = gig.start_time
                ? new Date(`2000-01-01T${gig.start_time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                : null;
              const endLabel = gig.end_time
                ? new Date(`2000-01-01T${gig.end_time}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                : null;
              const venue = gig.venues;

              const countdownText = isToday
                ? "Today"
                : isTomorrow
                ? "Tomorrow"
                : `In ${daysUntil} days`;

              const countdownColor = isToday
                ? "#d4a853"
                : isTomorrow
                ? "#e09b50"
                : daysUntil <= 7
                ? "#4caf7d"
                : "#9a9591";

              return (
                <Link
                  key={gig.id}
                  href={`/venues/${venue?.id}`}
                  className="rounded-xl p-5 flex flex-col gap-3 transition-all hover:brightness-125"
                  style={{
                    backgroundColor: "#16181c",
                    border: isToday
                      ? "1px solid rgba(212,168,83,0.35)"
                      : "1px solid rgba(255,255,255,0.07)",
                    borderLeft: `3px solid ${isToday ? "#d4a853" : "#4caf7d"}`,
                  }}
                >
                  {/* Top row: countdown badge + venue name */}
                  <div className="flex items-start justify-between gap-2">
                    <p
                      className="text-sm font-semibold leading-snug"
                      style={{ color: "#f0ede8", flex: 1 }}
                    >
                      {venue?.name ?? "Unknown Venue"}
                    </p>
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: `${countdownColor}22`,
                        color: countdownColor,
                        border: `1px solid ${countdownColor}44`,
                      }}
                    >
                      {countdownText}
                    </span>
                  </div>

                  {/* Date + time */}
                  <div className="flex flex-col gap-0.5">
                    <p className="text-xs font-medium" style={{ color: "#9a9591" }}>
                      {dayLabel}
                    </p>
                    {timeLabel ? (
                      <p className="text-xs" style={{ color: "#4caf7d" }}>
                        {timeLabel}{endLabel ? ` – ${endLabel}` : ""}
                      </p>
                    ) : (
                      <p className="text-xs" style={{ color: "#5e5c58" }}>No time set</p>
                    )}
                  </div>

                  {/* Location */}
                  {(venue?.city || venue?.address) && (
                    <p className="text-xs truncate" style={{ color: "#5e5c58" }}>
                      📍 {venue.address ?? venue.city}
                    </p>
                  )}

                  {/* Notes */}
                  {gig.notes && (
                    <p
                      className="text-xs leading-relaxed line-clamp-2"
                      style={{
                        color: "#9a9591",
                        borderTop: "1px solid rgba(255,255,255,0.05)",
                        paddingTop: "8px",
                        marginTop: "2px",
                      }}
                    >
                      {gig.notes}
                    </p>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Two-column section */}
      <div className="flex gap-6 max-w-6xl">
        {/* Left: Needs Attention (~60%) */}
        <div className="flex-[3]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#9a9591" }}>
              Needs Attention
            </h2>
            <Link
              href="/pipeline"
              className="text-xs transition-all hover:brightness-125"
              style={{ color: "#d4a853" }}
            >
              View pipeline →
            </Link>
          </div>

          <div
            className="rounded-xl overflow-hidden"
            style={{
              backgroundColor: "#16181c",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            {needsAttention.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm font-medium mb-1" style={{ color: "#4caf7d" }}>
                  You&apos;re all caught up!
                </p>
                <p className="text-xs" style={{ color: "#5e5c58" }}>
                  No contacted venues have been waiting more than 5 days.
                </p>
              </div>
            ) : (
              needsAttention.map((venue, idx) => {
                const iconColor = typeColor(venue.type);
                const firstLetter = (venue.type ?? "V")[0].toUpperCase();
                const isLast = idx === needsAttention.length - 1;
                const daysSince = Math.floor(
                  (Date.now() - new Date(venue.last_contacted_at!).getTime()) /
                    (1000 * 60 * 60 * 24)
                );

                return (
                  <Link
                    key={venue.id}
                    href={`/venues/${venue.id}`}
                    className="flex items-center gap-4 px-5 py-4 transition-all hover:brightness-125"
                    style={{
                      borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)",
                      borderLeft: "3px solid #e25c5c",
                    }}
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-sm"
                      style={{
                        backgroundColor: `${iconColor}22`,
                        color: iconColor,
                      }}
                    >
                      <span style={{ fontWeight: 800 }}>{firstLetter}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "#f0ede8" }}>
                        {venue.name}
                      </p>
                      <p className="text-xs truncate" style={{ color: "#9a9591" }}>
                        {[venue.type, venue.city].filter(Boolean).join(" · ")}
                      </p>
                    </div>

                    <span className="text-xs font-medium flex-shrink-0" style={{ color: "#e25c5c" }}>
                      {daysSince}d ago
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Booked Gigs (~40%) */}
        <div className="flex-[2]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#9a9591" }}>
              Booked Gigs
            </h2>
            <Link
              href="/pipeline"
              className="text-xs transition-all hover:brightness-125"
              style={{ color: "#d4a853" }}
            >
              View pipeline →
            </Link>
          </div>

          <div
            className="rounded-xl overflow-hidden"
            style={{
              backgroundColor: "#16181c",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            {bookedVenues.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm font-medium mb-1" style={{ color: "#5e5c58" }}>
                  No booked gigs yet
                </p>
                <p className="text-xs" style={{ color: "#5e5c58" }}>
                  Move a venue to &quot;Booked&quot; in your pipeline to see it here.
                </p>
              </div>
            ) : (
              bookedVenues.map((venue, idx) => {
                const isLast = idx === bookedVenues.length - 1;
                return (
                  <Link
                    key={venue.id}
                    href={`/venues/${venue.id}`}
                    className="flex items-center gap-4 px-5 py-4 transition-all hover:brightness-125"
                    style={{
                      borderBottom: isLast
                        ? "none"
                        : "1px solid rgba(255,255,255,0.05)",
                      borderLeft: "3px solid #d4a853",
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "#f0ede8" }}>
                        {venue.name}
                      </p>
                      <p className="text-xs truncate" style={{ color: "#9a9591" }}>
                        {venue.follow_up_date
                          ? new Date(venue.follow_up_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                          : venue.city ?? "No date set"}
                      </p>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
