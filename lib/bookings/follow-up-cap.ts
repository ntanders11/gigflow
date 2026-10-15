// Daily cap for the automatic follow-up job. Each artist sends from their own
// Gmail/Outlook, so the limit is per artist: a backlog of venues goes out a
// few at a time, oldest first, instead of all at once.

export const MAX_AUTO_FOLLOW_UPS_PER_ARTIST_PER_RUN = 10;

export function pickDailyBatch<T extends { user_id: string; last_contacted_at: string | null }>(
  venues: T[],
  maxPerArtist: number = MAX_AUTO_FOLLOW_UPS_PER_ARTIST_PER_RUN,
): T[] {
  const sorted = [...venues].sort((a, b) =>
    (a.last_contacted_at ?? "").localeCompare(b.last_contacted_at ?? ""),
  );
  const taken = new Map<string, number>();
  const batch: T[] = [];
  for (const v of sorted) {
    const n = taken.get(v.user_id) ?? 0;
    if (n >= maxPerArtist) continue;
    taken.set(v.user_id, n + 1);
    batch.push(v);
  }
  return batch;
}
