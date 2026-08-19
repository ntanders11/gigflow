import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { maybeSendNewGigToRateEmails } from "@/lib/email/rating-notifications";

// PATCH /api/gigs/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  // Read the prior status before the update — the notification below only
  // fires on an actual transition INTO "completed", not on every PATCH
  // that happens to include status: "completed" again.
  const { data: before } = await supabase
    .from("gigs")
    .select("status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("gigs")
    .update(body)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const justCompleted = before?.status !== "completed" && data.status === "completed";
  if (justCompleted) {
    // venue_artist_ratings has no client-facing RLS policies (see
    // supabase/migrations/018_venue_artist_ratings.sql) — a read through
    // the ordinary `supabase` client above would silently return nothing
    // rather than error, making the re-fire guard inside
    // maybeSendNewGigToRateEmails a no-op. Must use the service-role
    // client for this side-effect, kept deliberately separate from the
    // RLS-scoped client used for the security-relevant gig update above.
    const service = await createServiceClient();
    try {
      await maybeSendNewGigToRateEmails(service, {
        artistUserId: user.id,
        venueId: data.venue_id,
      });
    } catch (err) {
      console.error("PATCH /api/gigs/[id]: failed to send new-gig-to-rate emails", err);
    }
  }

  return NextResponse.json(data);
}

// DELETE /api/gigs/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("gigs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
