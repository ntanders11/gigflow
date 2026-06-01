import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Wrap a CSV field in quotes if it contains a comma, quote, or newline.
function csvField(value: string | null | undefined): string {
  const s = value ?? "";
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: venues, error } = await supabase
    .from("venues")
    .select("name, type, city, zone_ring, confidence, website, live_music_details, contact_email, contact_phone")
    .eq("user_id", user.id)
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Build CSV — headers match exactly what the importer expects
  const header = "Venue Name,Type,City,Zone,Confidence,Website,Live Music Details,Contact,Phone";

  const rows = (venues ?? []).map((v) =>
    [
      csvField(v.name),
      csvField(v.type),
      csvField(v.city),
      csvField(v.zone_ring),
      csvField(v.confidence ?? "MEDIUM"),
      csvField(v.website),
      csvField(v.live_music_details),
      csvField(v.contact_email),
      csvField(v.contact_phone),
    ].join(",")
  );

  const csv = [header, ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="stagereach-venues.csv"',
    },
  });
}
