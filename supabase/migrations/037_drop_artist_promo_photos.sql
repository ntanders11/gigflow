-- supabase/migrations/037_drop_artist_promo_photos.sql
-- The promo photos feature (036) was removed 2026-10-16 because the photo
-- files were too large for now. The table held no real data. The private
-- `promo-photos` storage bucket is removed through the Storage API, not SQL
-- (Supabase blocks direct deletes on its storage tables).
drop table if exists public.artist_promo_photos;
