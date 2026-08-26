// lib/bookings/follow-up.ts
// Shared between the automated follow-up cron
// (app/api/venues/follow-up/route.ts) and the manual batch-follow-up
// picker in the pipeline board (components/pipeline/KanbanColumn.tsx), so
// both use the same "how recently was this venue last followed up with"
// cutoff instead of two independently-tuned rules that could drift apart.
// Previously this was "ever followed up = blocked forever," which is why
// venues sitting untouched for 80-100+ days were still showing as
// ineligible — this cooldown replaces that with a real time window.
export const FOLLOW_UP_COOLDOWN_DAYS = 30;

export function isWithinFollowUpCooldown(lastFollowUpDate: string | null): boolean {
  if (!lastFollowUpDate) return false;
  const daysSince = (Date.now() - new Date(lastFollowUpDate).getTime()) / (1000 * 60 * 60 * 24);
  return daysSince < FOLLOW_UP_COOLDOWN_DAYS;
}
