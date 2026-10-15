import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  PROMO_BUCKET,
  MAX_PROMO_BYTES,
  MAX_PROMO_PHOTOS,
  isOwnPromoPath,
  sniffPromoType,
} from "@/lib/promo-photos/rules";
import { toPhotoViews } from "@/lib/promo-photos/server";

// The artist's own photos (for the editor on their profile / setup).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();
  const { data: rows } = await service
    .from("artist_promo_photos")
    .select("id, storage_path, file_name")
    .eq("user_id", user.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  return NextResponse.json({ photos: await toPhotoViews(service, rows ?? []), max: MAX_PROMO_PHOTOS });
}

// Step 2 of adding a photo: the browser has uploaded the file straight to
// storage; now check what was really stored and record it.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const path = typeof body.path === "string" ? body.path : "";
  const fileName = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 120) : "photo";
  if (!path || !isOwnPromoPath(user.id, path)) {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const service = await createServiceClient();

  const { count } = await service
    .from("artist_promo_photos")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) >= MAX_PROMO_PHOTOS) {
    await service.storage.from(PROMO_BUCKET).remove([path]);
    return NextResponse.json({ error: `You can add up to ${MAX_PROMO_PHOTOS} photos.` }, { status: 400 });
  }

  const { data: blob, error: dlError } = await service.storage.from(PROMO_BUCKET).download(path);
  if (dlError || !blob) return NextResponse.json({ error: "Couldn't find that upload. Try again." }, { status: 400 });

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const realType = sniffPromoType(bytes);
  if (!realType || blob.size > MAX_PROMO_BYTES) {
    await service.storage.from(PROMO_BUCKET).remove([path]);
    return NextResponse.json(
      { error: "That file isn't a JPEG, PNG, or WebP photo under 10 MB." },
      { status: 400 }
    );
  }

  const { data: row, error } = await service
    .from("artist_promo_photos")
    .insert({
      user_id: user.id,
      storage_path: path,
      file_name: fileName,
      content_type: realType,
      size_bytes: blob.size,
      position: count ?? 0,
    })
    .select("id, storage_path, file_name")
    .single();
  if (error || !row) {
    console.error("promo photo insert failed:", error?.message);
    await service.storage.from(PROMO_BUCKET).remove([path]);
    return NextResponse.json({ error: "Couldn't save that photo. Try again." }, { status: 500 });
  }

  const [photo] = await toPhotoViews(service, [row]);
  return NextResponse.json({ photo });
}
