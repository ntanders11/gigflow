import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CalendarView from "@/components/calendar/CalendarView";

export default async function CalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: gigs } = await supabase
    .from("gigs")
    .select("id, date, start_time, end_time, notes, status, venues(id, name, city, address)")
    .eq("user_id", user.id)
    .neq("status", "cancelled")
    .order("date", { ascending: true });

  const bookedVenues = (gigs ?? []).map((g: any) => ({
    id: g.venues?.id ?? g.id,
    gig_id: g.id,
    name: g.venues?.name ?? "Unknown",
    city: g.venues?.city ?? null,
    address: g.venues?.address ?? null,
    follow_up_date: g.date,
    gig_time: g.start_time,
    gig_end_time: g.end_time,
    notes: g.notes,
  }));

  // Build the subscription URL using the user's ID as a token
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://gigflow-git-main-taylor-anderson.vercel.app";
  const subscriptionUrl = `${baseUrl}/api/calendar/ics?uid=${user.id}`;

  return (
    <div className="min-h-screen p-8" style={{ backgroundColor: "#0e0f11", color: "#f0ede8" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#f0ede8" }}>
          Booking Calendar
        </h1>
      </div>

      {/* iCloud subscription banner */}
      <div
        className="flex items-center justify-between rounded-xl px-5 py-4 mb-8 max-w-5xl"
        style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div>
          <p className="text-sm font-semibold mb-0.5" style={{ color: "#f0ede8" }}>
            Sync with iCloud Calendar
          </p>
          <p className="text-xs" style={{ color: "#9a9591" }}>
            Subscribe once — your booked gigs will appear automatically and stay up to date.
          </p>
        </div>
        <a
          href={`webcal://${subscriptionUrl.replace(/^https?:\/\//, "")}`}
          className="px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:brightness-110 shrink-0 ml-6"
          style={{ backgroundColor: "#d4a853", color: "#0e0f11" }}
        >
          Subscribe in iCloud →
        </a>
      </div>

      <div className="max-w-5xl">
        <CalendarView bookedVenues={bookedVenues} subscriptionUrl={subscriptionUrl} />
      </div>
    </div>
  );
}
