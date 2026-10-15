import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { PROMO_BUCKET } from "@/lib/promo-photos/rules";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();
  const { data: row } = await service
    .from("artist_promo_photos")
    .select("id, storage_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  await service.storage.from(PROMO_BUCKET).remove([row.storage_path as string]);
  const { error } = await service.from("artist_promo_photos").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Couldn't remove that photo." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
