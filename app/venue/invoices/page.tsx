import { createClient, createServiceClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import VenueNav from "@/components/venue/VenueNav";
import VenueInvoicesList from "@/components/venue/VenueInvoicesList";
import { getOwnCompletedVenueProfile } from "@/lib/bookings/venue-auth";
import { VenueInvoiceView } from "@/types";

export default async function VenueInvoicesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const venueProfile = await getOwnCompletedVenueProfile(supabase, user.id);

  let invoices: VenueInvoiceView[] = [];

  if (venueProfile) {
    // invoices carries RLS scoped to the artist who created it
    // ("own invoices only" — auth.uid() = user_id, migration
    // 003_invoices.sql), with no venue-facing policy at all: a venue's
    // own session literally cannot read this table directly. Same
    // reasoning as booking_requests and venue_artist_ratings — the
    // service-role client plus explicit filtering down to this venue's
    // own linked pipeline rows is the only way to read across into an
    // artist-owned table.
    const service = await createServiceClient();

    const { data: myVenueRows } = await service
      .from("venues")
      .select("id, user_id")
      .eq("venue_profile_id", venueProfile.id);

    const venueRowIds = (myVenueRows ?? []).map((v) => v.id as string);

    if (venueRowIds.length > 0) {
      const { data: invoiceRows } = await service
        .from("invoices")
        .select("*")
        .in("venue_id", venueRowIds)
        .order("created_at", { ascending: false });

      const artistIds = [...new Set((invoiceRows ?? []).map((i) => i.user_id as string))];
      const { data: artists } = await service
        .from("artist_profiles")
        .select("user_id, display_name")
        .in("user_id", artistIds.length > 0 ? artistIds : [""]);
      const artistNameByUserId = new Map(
        (artists ?? []).map((a) => [a.user_id as string, (a.display_name as string | null) ?? "An artist"])
      );

      invoices = (invoiceRows ?? []).map((i): VenueInvoiceView => ({
        id: i.id,
        artist_name: artistNameByUserId.get(i.user_id as string) ?? "An artist",
        amount_cents: i.amount_cents,
        payment_type: i.payment_type,
        event_date: i.event_date,
        package_label: i.package_label,
        status: i.status,
        stripe_invoice_url: i.stripe_invoice_url,
        created_at: i.created_at,
      }));
    }
  }

  return (
    <>
      <VenueNav />
      <div className="min-h-screen pb-28 md:pb-0" style={{ backgroundColor: "#0E0E10" }}>
        <div className="max-w-4xl mx-auto px-6 py-10">
          <h1 className="text-2xl font-bold mb-6" style={{ color: "#F4E8D2" }}>Invoices</h1>
          <VenueInvoicesList invoices={invoices} />
        </div>
      </div>
    </>
  );
}
