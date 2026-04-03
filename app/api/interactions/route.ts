import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { venue_id, type, notes, occurred_at, email_subject, email_body } = body;

  if (!venue_id || !type) {
    return NextResponse.json({ error: "venue_id and type are required" }, { status: 400 });
  }

  const { data: interaction, error } = await supabase
    .from("interactions")
    .insert({
      venue_id,
      user_id: user.id,
      type,
      notes: notes || null,
      occurred_at: occurred_at || new Date().toISOString(),
      email_subject: email_subject || null,
      email_body: email_body || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update last_contacted_at on the venue
  await supabase
    .from("venues")
    .update({ last_contacted_at: new Date().toISOString() })
    .eq("id", venue_id)
    .eq("user_id", user.id);

  return NextResponse.json(interaction);
}
