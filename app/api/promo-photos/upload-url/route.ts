import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { sanitizeFileName } from "@/lib/messages/rules";
import { PROMO_BUCKET, MAX_PROMO_PHOTOS, validatePromoDeclaration } from "@/lib/promo-photos/rules";

// Step 1 of adding a photo: check what the browser says it's about to upload
// and hand back a one-time signed upload token. The file goes straight from
// the browser to storage (Vercel caps request bodies at about 4.5 MB, under
// our 10 MB photo limit); the real type is checked again on registration.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const check = validatePromoDeclaration(String(body.type ?? ""), Number(body.size));
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const service = await createServiceClient();
  const { count } = await service
    .from("artist_promo_photos")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) >= MAX_PROMO_PHOTOS) {
    return NextResponse.json({ error: `You can add up to ${MAX_PROMO_PHOTOS} photos.` }, { status: 400 });
  }

  const path = `${user.id}/${randomUUID()}-${sanitizeFileName(String(body.name ?? "photo"))}`;
  const { data, error } = await service.storage.from(PROMO_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: "Couldn't prepare that upload. Try again." }, { status: 500 });

  return NextResponse.json({ path: data.path ?? path, token: data.token });
}
