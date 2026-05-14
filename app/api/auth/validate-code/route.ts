import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const { code } = await request.json();

  if (!code || typeof code !== "string") {
    return NextResponse.json({ valid: false, error: "Code is required" });
  }

  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("invite_codes")
    .select("id")
    .eq("code", code.trim().toUpperCase())
    .eq("active", true)
    .single();

  if (!data) {
    return NextResponse.json({ valid: false, error: "Invalid invite code" });
  }

  return NextResponse.json({ valid: true });
}
