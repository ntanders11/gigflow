-- Remembers which of a venue's details the artist has edited by hand
-- (website, contact_phone, address, city, type), so Discover Venues never
-- "fills in" or changes a field the artist has touched — even one they
-- cleared on purpose. Only the artist's own edits through the venue page add
-- to this list.
alter table public.venues
  add column if not exists manual_edit_fields text[] not null default '{}';
