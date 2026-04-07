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

  const allVenues = venues ?? [];

  const { data: unpaidInvoices } = await supabase
    .from("invoices")
    .select("id, amount_cents, status")
    .eq("user_id", user.id)
    .in("status", ["sent", "draft"]);

  const unpaidCount = unpaidInvoices?.length ?? 0;
  const unpaidTotal = (unpaidInvoices ?? []).reduce((sum, inv) => sum + inv.amount_cents, 0);

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

  // Derived lists
  const bookedVenues = allVenues.filter((v) => v.stage === "booked");

  const statCards = [
    {
      label: "Total Venues",
      value: totalVenues,
      trend: "in your pipeline",
      color: "#f0ede8",
    },
    {
      label: "Booked",
      value: bookedCount,
      trend: "confirmed gigs",
      color: "#4caf7d",
    },
    {
      label: "Awaiting Reply",
      value: respondedCount,
      trend: "venues responded",
      color: "#9b7fe8",
    },
    {
      label: "Needs Attention",
      value: needsAttention.length,
      trend: "no reply in 5+ days",
      color: needsAttention.length > 0 ? "#e25c5c" : "#9a9591",
    },
    {
      label: "Unpaid Invoices",
      value: unpaidCount,
      trend: `$${(unpaidTotal / 100).toFixed(0)} outstanding`,
      color: "#e09b50",
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
          <div
            key={stat.label}
            className="rounded-xl p-5"
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
          </div>
        ))}
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
                      <p
                        className="text-sm font-medium truncate"
                        style={{ color: "#f0ede8" }}
                      >
                        {venue.name}
                      </p>
                      {venue.city && (
                        <p className="text-xs truncate" style={{ color: "#9a9591" }}>
                          {venue.city}
                        </p>
                      )}
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
