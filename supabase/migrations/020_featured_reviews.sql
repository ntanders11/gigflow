-- supabase/migrations/020_featured_reviews.sql
alter table venue_artist_ratings
  add column featured_by_artist_rank smallint,
  add column featured_by_venue_rank smallint;

create unique index venue_artist_ratings_artist_featured_rank_idx
  on venue_artist_ratings (artist_user_id, featured_by_artist_rank)
  where featured_by_artist_rank is not null;

create unique index venue_artist_ratings_venue_featured_rank_idx
  on venue_artist_ratings (venue_profile_id, featured_by_venue_rank)
  where featured_by_venue_rank is not null;
