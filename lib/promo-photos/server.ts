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
// per photo: one for displaying it, one that makes the browser download it.
export async function toPhotoViews(service: SupabaseClient, rows: PhotoRow[]): Promise<PromoPhotoView[]> {
  if (rows.length === 0) return [];
  const paths = rows.map((r) => r.storage_path);
  const { data: shown } = await service.storage.from(PROMO_BUCKET).createSignedUrls(paths, 3600);
  const { data: downloads } = await service.storage.from(PROMO_BUCKET).createSignedUrls(paths, 3600, { download: true });
  const shownBy = new Map((shown ?? []).map((s) => [s.path, s.signedUrl]));
  const downBy = new Map((downloads ?? []).map((s) => [s.path, s.signedUrl]));
  return rows
    .filter((r) => shownBy.get(r.storage_path))
    .map((r) => ({
      id: r.id,
      file_name: r.file_name,
      url: shownBy.get(r.storage_path)!,
      download_url: downBy.get(r.storage_path) ?? shownBy.get(r.storage_path)!,
    }));
}
