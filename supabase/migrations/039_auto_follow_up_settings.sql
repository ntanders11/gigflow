-- Per-artist opt-in for automatic follow-up emails, plus their own wording.
-- Off by default: nobody gets automatic follow-ups unless they turn them on.
alter table public.artist_profiles
  add column if not exists auto_follow_up_enabled boolean not null default false;
alter table public.artist_profiles
  add column if not exists auto_follow_up_template text;
