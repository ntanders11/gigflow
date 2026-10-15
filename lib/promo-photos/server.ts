import { SupabaseClient } from "@supabase/supabase-js";
import { PROMO_BUCKET } from "@/lib/promo-photos/rules";

export type PromoPhotoView = {
  id: string;
  file_name: string;
  url: string;          // for showing in the page
  download_url: string; // forces a file download
};

type PhotoRow = { id: string; storage_path: string; file_name: string };

// Turns stored photo rows into short-lived (1 hour) signed links. Two links
// per photo: one for displaying it, one that makes the browser download it
// under the photo's original file name (not the internal storage name).
export async function toPhotoViews(service: SupabaseClient, rows: PhotoRow[]): Promise<PromoPhotoView[]> {
  if (rows.length === 0) return [];
  const bucket = service.storage.from(PROMO_BUCKET);
  const { data: shown } = await bucket.createSignedUrls(rows.map((r) => r.storage_path), 3600);
  const shownBy = new Map((shown ?? []).map((s) => [s.path, s.signedUrl]));

  const views = await Promise.all(
    rows.map(async (r) => {
      const url = shownBy.get(r.storage_path);
      if (!url) return null;
      const { data: dl } = await bucket.createSignedUrl(r.storage_path, 3600, { download: r.file_name });
      return { id: r.id, file_name: r.file_name, url, download_url: dl?.signedUrl ?? url };
    })
  );
  return views.filter((v): v is PromoPhotoView => v !== null);
}
