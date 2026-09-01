// app/api/public/artists/[id]/availability/route.ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getUnavailableDates } from "@/lib/bookings/availability";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const service = await createServiceClient();
  const dates = await getUnavailableDates(service, id);
  return NextResponse.json({ dates });
}
