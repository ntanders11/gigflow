import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Package } from "@/types";

const DEFAULT_PACKAGES: Package[] = [
  {
    id: "solo",
    label: "Solo",
    price_min: null,
    price_max: null,
    description: "",
    duration: "",
    color: "#d4a853",
  },
  {
    id: "trio",
    label: "Trio",
    price_min: null,
    price_max: null,
    description: "",
    duration: "",
    color: "#9b7fe8",
  },
  {
    id: "five_piece",
    label: "Five Piece Band",
    price_min: null,
    price_max: null,
    description: "",
    duration: "",
    color: "#4caf7d",
  },
];

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("artist_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!profile) {
    // First visit — create a default profile
    const { data: newProfile, error } = await supabase
      .from("artist_profiles")
      .insert({
        user_id: user.id,
        bio: "",
        genres: [],
        photo_url: null,
        social_links: { instagram: "", spotify: "", youtube: "", website: "" },
        video_samples: [],
        packages: DEFAULT_PACKAGES,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const contact_email = newProfile.contact_email ?? user.email ?? null;
    return NextResponse.json({ ...newProfile, contact_email });
  }

  // contact_email falls back to the auth email if not explicitly set
  const contact_email = profile.contact_email ?? user.email ?? null;
  return NextResponse.json({ ...profile, contact_email });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const ts = new Date().toISOString();

  // Try UPDATE first (works for all existing users, Taylor included).
  const { data: updated } = await supabase
    .from("artist_profiles")
    .update({ ...body, updated_at: ts })
    .eq("user_id", user.id)
    .select()
    .single();

  if (updated) return NextResponse.json(updated);

  // No existing row — this is a brand-new user. INSERT with safe defaults so
  // any NOT NULL columns without DB defaults are satisfied.
  const { data: inserted, error: insertError } = await supabase
    .from("artist_profiles")
    .insert({
      user_id:       user.id,
      bio:           "",
      genres:        [],
      photo_url:     null,
      social_links:  { instagram: "", spotify: "", youtube: "", website: "" },
      video_samples: [],
      packages:      [],
      ...body,
      updated_at:    ts,
    })
    .select()
    .single();

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  return NextResponse.json(inserted);
}
