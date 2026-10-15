// When a day-of gig reminder is due. A gig's date is a calendar date in the
// gig's own time zone (the venue's local time), so "today" has to be worked
// out in that zone, not on the server's clock.

// Earliest local hour a reminder may go out. 7 (not a later morning) so the
// once-a-day 15:00 UTC job still lands for Pacific time in winter (7 AM).
export const REMIND_FROM_HOUR = 7;

export function localDateAndHour(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: parseInt(get("hour"), 10) };
}

export function isReminderDue(now: Date, gigDate: string, timeZone: string): boolean {
  const local = localDateAndHour(now, timeZone);
  return local.date === gigDate && local.hour >= REMIND_FROM_HOUR;
}
