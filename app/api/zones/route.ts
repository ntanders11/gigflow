import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: zones } = await supabase
    .from("zones")
    .select("id, name, zip_code, radius_mi")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ zones: zones ?? [] });
}
