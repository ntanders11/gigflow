import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isValidTimeZone, DEFAULT_TIME_ZONE } from "@/lib/time-zones";

// Works for both account types: a venue account (has a venue_profiles row)
// reads/writes its venue profile, anyone else their artist profile.
async function resolve() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const service = await createServiceClient();
  const { data: venue } = await service.from("venue_profiles").select("id").eq("user_id", user.id).maybeSingle();
  return { service, userId: user.id, table: venue ? "venue_profiles" : "artist_profiles", key: "user_id" };
}

export async function GET() {
  const ctx = await resolve();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data } = await ctx.service.from(ctx.table).select("time_zone").eq(ctx.key, ctx.userId).maybeSingle();
  return NextResponse.json({ time_zone: (data?.time_zone as string) ?? DEFAULT_TIME_ZONE });
}

export async function PATCH(req: NextRequest) {
  const ctx = await resolve();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!isValidTimeZone(body.time_zone)) {
    return NextResponse.json({ error: "That isn't a valid time zone." }, { status: 400 });
  }
  const { error } = await ctx.service.from(ctx.table).update({ time_zone: body.time_zone }).eq(ctx.key, ctx.userId);
  if (error) return NextResponse.json({ error: "Couldn't save your time zone." }, { status: 500 });
  return NextResponse.json({ time_zone: body.time_zone });
}
