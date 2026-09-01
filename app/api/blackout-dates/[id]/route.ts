import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The RLS policy already scopes this to the caller's own rows; the
  // explicit .eq("user_id", ...) below is defense-in-depth, matching
  // this codebase's usual style (e.g. DELETE /api/gigs/[id]) rather
  // than relying on RLS alone.
  const { error } = await supabase
    .from("artist_blackout_dates")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
