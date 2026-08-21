// app/api/public/artists/[id]/availability/route.ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = await createServiceClient();

  const today = new Date().toISOString().slice(0, 10);
  const { data: rows, error } = await service
    .from("gigs")
    .select("date")
    .eq("user_id", id)
    .eq("status", "upcoming")
    .gte("date", today);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const dates = (rows ?? []).map((r) => r.date as string);
  return NextResponse.json({ dates });
}
