import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CalendarView from "@/components/calendar/CalendarView";
import BookingRequestsSection from "@/components/calendar/BookingRequestsSection";
import { BlackoutDate } from "@/types";

export default async function CalendarPage() {
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

  const { data: gigs } = await supabase
    .from("gigs")
    .select("id, date, start_time, end_time, notes, status, venues(id, name, city, address)")
    .eq("user_id", user.id)
    .neq("status", "cancelled")
    .order("date", { ascending: true });

  // artist_blackout_dates has a real owner-only RLS policy (unlike
  // most tables added this session) — the ordinary RLS-scoped
  // `supabase` client above is exactly right here, no service-role
  // client needed.
  const { data: blackoutDates } = await supabase
    .from("artist_blackout_dates")
    .select("id, start_date, end_date, note")
    .eq("user_id", user.id)
    .order("start_date", { ascending: true });

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
    <div className="min-h-screen p-4 md:p-8" style={{ backgroundColor: "#0E0E10", color: "#F4E8D2" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6 max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#F4E8D2" }}>
          Booking Calendar
        </h1>
      </div>

      <BookingRequestsSection />

      <div className="max-w-5xl">
        <CalendarView
          bookedVenues={bookedVenues}
          subscriptionUrl={subscriptionUrl}
          initialBlackoutDates={(blackoutDates as BlackoutDate[]) ?? []}
        />
      </div>
    </div>
  );
}
