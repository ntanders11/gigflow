import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import VenueNav from "@/components/venue/VenueNav";
import MessagesView from "@/components/messages/MessagesView";
import { getOwnCompletedVenueProfile } from "@/lib/bookings/venue-auth";

export default async function VenueMessagesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const venueProfile = await getOwnCompletedVenueProfile(supabase, user.id);
  if (!venueProfile) redirect("/venues/signup");
  const { c } = await searchParams;

  return (
    <>
      <VenueNav />
      <div className="min-h-screen pb-28 md:pb-0 p-4 md:p-8" style={{ backgroundColor: "#0E0E10", color: "#F4E8D2" }}>
        <h1 className="text-2xl font-bold tracking-tight mb-6 pr-14 md:pr-0">Messages</h1>
        <MessagesView key={c ?? ""} role="venue" initialConversationId={c} />
      </div>
    </>
  );
}
