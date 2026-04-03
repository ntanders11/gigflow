import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import Link from "next/link";
import CalendarView from "@/components/calendar/CalendarView";

export default async function CalendarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, city, follow_up_date, notes")
    .eq("user_id", user!.id)
    .eq("stage", "booked")
    .order("follow_up_date", { ascending: true });

  const bookedVenues = venues ?? [];

  const cookieStore = await cookies();
  const isOutlookConnected = !!cookieStore.get("outlook_access_token")?.value;

  return (
    <div className="min-h-screen p-8" style={{ backgroundColor: "#0e0f11", color: "#f0ede8" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8 max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#f0ede8" }}>
          Booking Calendar
        </h1>
        <div className="flex items-center gap-3">
          {isOutlookConnected ? (
            <div
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
              style={{
                backgroundColor: "rgba(76,175,125,0.1)",
                border: "1px solid rgba(76,175,125,0.3)",
                color: "#4caf7d",
              }}
            >
              <span>✓</span> Outlook Connected
            </div>
          ) : (
            <Link
              href="/api/auth/outlook/connect"
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
              style={{ backgroundColor: "#d4a853", color: "#0e0f11" }}
            >
              Connect Outlook Calendar
            </Link>
          )}
        </div>
      </div>

      <div className="max-w-5xl">
        <CalendarView bookedVenues={bookedVenues} isOutlookConnected={isOutlookConnected} />
      </div>
    </div>
  );
}
