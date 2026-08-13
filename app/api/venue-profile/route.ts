import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Creates the blank venue_profiles row immediately after a venue account
// is authenticated (venue_name left null). This placeholder is what lets
// the app tell "a venue mid-signup" apart from "an artist mid-signup"
// everywhere else — see proxy.ts. Called once, right after
// supabase.auth.signUp() succeeds, from the /venues/signup wizard.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: existing } = await supabase
    .from("venue_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) return NextResponse.json(existing);

  const { data, error } = await supabase
    .from("venue_profiles")
    .insert({ user_id: user.id })
    .select()
    .single();

  if (error) {
    // Two concurrent POSTs (double-click, retried request) can both pass
    // the "existing row" check above before either insert lands, so the
    // second insert hits the unique(user_id) constraint. Treat that as the
    // same "already exists" case rather than surfacing a raw 500.
    if (error.code === "23505") {
      const { data: existingRow } = await supabase
        .from("venue_profiles")
        .select("*")
        .eq("user_id", user.id)
        .single();
      if (existingRow) return NextResponse.json(existingRow);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("venue_profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No venue profile found" }, { status: 404 });
  return NextResponse.json(data);
}
