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

  // Auto-complete any gigs whose date has already passed
  const yesterdayStr = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await supabase
    .from("gigs")
    .update({ status: "completed" })
    .eq("user_id", user.id)
    .eq("status", "upcoming")
    .lt("date", yesterdayStr);

  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, type, city, stage, updated_at, follow_up_date, last_contacted_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  const { data: upcomingGigs } = await supabase
    .from("gigs")
    .select("id, date, start_time, end_time, status, notes, venues(id, name, city, address)")
    .eq("user_id", user.id)
    .neq("status", "cancelled")
    .order("date", { ascending: true });

  const allVenues = venues ?? [];

  const { count: totalInteractions } = await supabase
    .from("interactions")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

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
  const bookedCount      = allVenues.filter((v) => v.stage === "booked").length;
  const respondedCount   = allVenues.filter((v) => v.stage === "responded").length;
  const contactedCount   = allVenues.filter((v) => v.stage === "contacted").length;
  const negotiatingCount = allVenues.filter((v) => v.stage === "negotiating").length;
  const discoveredCount  = allVenues.filter((v) => v.stage === "discovered").length;

  // Conversion funnel
  const activeVenues = allVenues.filter((v) => v.stage !== "dormant");
  const totalActive  = activeVenues.length;
  const funnelStages = [
    { key: "discovered",  label: "Discovered",  color: "#5b9bd5", count: discoveredCount },
    { key: "contacted",   label: "Contacted",   color: "#d4a853", count: contactedCount  },
    { key: "responded",   label: "Responded",   color: "#9b7fe8", count: respondedCount  },
    { key: "negotiating", label: "Negotiating", color: "#e09b50", count: negotiatingCount},
    { key: "booked",      label: "Booked",      color: "#4caf7d", count: bookedCount     },
  ].map((s) => ({
    ...s,
    pct: totalActive > 0 ? Math.round((s.count / totalActive) * 100) : 0,
  }));
  const maxFunnelCount = Math.max(...funnelStages.map((s) => s.count), 1);

  const everContacted = contactedCount + respondedCount + negotiatingCount + bookedCount;
  const everResponded = respondedCount + negotiatingCount + bookedCount;
  const contactRate  = totalActive > 0   ? Math.round((everContacted / totalActive)   * 100) : 0;
  const responseRate = everContacted > 0 ? Math.round((everResponded / everContacted)  * 100) : 0;
  const bookingRate  = everResponded > 0 ? Math.round((bookedCount   / everResponded)  * 100) : 0;

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

  // Upcoming gigs — next 30 days (and any past gigs not yet marked done)
  const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD" in UTC
  const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const thisWeekGigs = (upcomingGigs ?? []).filter((g: any) => {
    return g.date >= todayStr && g.date <= thirtyDaysFromNow;
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
      className="min-h-screen p-4 md:p-8"
      style={{ backgroundColor: "#0e0f11", color: "#f0ede8" }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6 max-w-6xl">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#f0ede8" }}>
          Overview
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href="/venues/import"
            className="hidden sm:block px-4 py-2 rounded-lg text-sm font-medium transition-all hover:brightness-125"
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
            className="px-3 py-2 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
            style={{
              backgroundColor: "#d4a853",
              color: "#0e0f11",
            }}
          >
            <span className="sm:hidden">Pipeline</span>
            <span className="hidden sm:inline">Find Gigs</span>
          </Link>
        </div>
      </div>

      {/* Follow-up alert banner */}
      {needsAttention.length > 0 && (
        <div
          className="mb-6 max-w-6xl rounded-xl p-4"
          style={{
            backgroundColor: "rgba(226,92,92,0.08)",
            border: "1px solid rgba(226,92,92,0.25)",
            borderLeft: "3px solid #e25c5c",
          }}
        >
          <div className="flex items-start gap-3">
            <span className="text-base mt-0.5">🔔</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold mb-2.5" style={{ color: "#e25c5c" }}>
                {needsAttention.length} venue{needsAttention.length !== 1 ? "s" : ""} waiting on a follow-up
              </p>
              <div className="flex flex-wrap gap-2">
                {needsAttention.slice(0, 5).map((venue) => {
                  const daysSince = Math.floor(
                    (Date.now() - new Date(venue.last_contacted_at!).getTime()) /
                      (1000 * 60 * 60 * 24)
                  );
                  return (
                    <Link
                      key={venue.id}
                      href={`/venues/${venue.id}`}
                      className="text-xs px-3 py-1.5 rounded-full transition-all hover:brightness-125"
                      style={{
                        backgroundColor: "rgba(226,92,92,0.12)",
                        color: "#f0ede8",
                        border: "1px solid rgba(226,92,92,0.2)",
                      }}
                    >
                      {venue.name} · {daysSince}d ago
                    </Link>
                  );
                })}
                {needsAttention.length > 5 && (
                  <Link
                    href="/pipeline?stage=contacted"
                    className="text-xs px-3 py-1.5 rounded-full transition-all hover:brightness-125"
                    style={{ color: "#9a9591", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    +{needsAttention.length - 5} more →
                  </Link>
                )}
              </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {thisWeekGigs.map((gig: any) => {
              const tomorrowStr = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
              const isToday = gig.date === todayStr;
              const isTomorrow = gig.date === tomorrowStr;
              const daysUntil = Math.round(
                (new Date(gig.date + "T12:00:00Z").getTime() - Date.now()) / (1000 * 60 * 60 * 24)
              );
              const d = new Date(gig.date + "T12:00:00");
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

      {/* Conversion Stats */}
      <div className="mb-8 max-w-6xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#9a9591" }}>
            Pipeline Funnel
          </h2>
          {totalInteractions != null && totalInteractions > 0 && (
            <span className="text-xs" style={{ color: "#5e5c58" }}>
              {totalInteractions} total interaction{totalInteractions !== 1 ? "s" : ""} logged
            </span>
          )}
        </div>

        <div
          className="rounded-xl p-5 mb-4"
          style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="space-y-3">
            {funnelStages.map((stage) => (
              <div key={stage.key} className="flex items-center gap-3">
                <span
                  className="text-xs font-medium w-24 shrink-0 text-right"
                  style={{ color: "#9a9591" }}
                >
                  {stage.label}
                </span>
                <div className="flex-1 rounded-full overflow-hidden" style={{ backgroundColor: "#1e2128", height: "8px" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.round((stage.count / maxFunnelCount) * 100)}%`,
                      backgroundColor: stage.color,
                      minWidth: stage.count > 0 ? "4px" : "0",
                    }}
                  />
                </div>
                <span className="text-xs font-semibold w-6 text-right shrink-0" style={{ color: stage.color }}>
                  {stage.count}
                </span>
                <span className="text-xs w-8 shrink-0" style={{ color: "#5e5c58" }}>
                  {stage.pct}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Conversion rate cards */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Contact Rate", value: contactRate, desc: "venues reached out to", color: "#d4a853" },
            { label: "Response Rate", value: responseRate, desc: "of contacted replied", color: "#9b7fe8" },
            { label: "Booking Rate", value: bookingRate, desc: "of replies turned to gigs", color: "#4caf7d" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl p-4 text-center"
              style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <p
                className="text-3xl font-bold mb-1"
                style={{ color: stat.value > 0 ? stat.color : "#5e5c58" }}
              >
                {stat.value}%
              </p>
              <p className="text-xs font-semibold mb-0.5" style={{ color: "#f0ede8" }}>
                {stat.label}
              </p>
              <p className="text-xs" style={{ color: "#5e5c58" }}>
                {stat.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Two-column section */}
      <div className="flex flex-col md:flex-row gap-6 max-w-6xl">
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
