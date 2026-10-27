// Quick date choices for "remind me later", worked out from today's date.
// All dates are plain "YYYY-MM-DD" strings (no time zone — it's a calendar day).

export interface RemindOption { key: string; label: string; date: string }

export function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Adds whole months to a date, clamping to the end of a short month.
export function addMonths(from: Date, months: number): string {
  const y = from.getFullYear();
  const m = from.getMonth() + months;
  const target = new Date(y, m, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return iso(target.getFullYear(), target.getMonth() + 1, Math.min(from.getDate(), lastDay));
}

// The next occurrence of month/day strictly after today.
export function nextOccurrence(today: Date, month: number, day: number): string {
  const thisYear = iso(today.getFullYear(), month, day);
  const todayIso = iso(today.getFullYear(), today.getMonth() + 1, today.getDate());
  return thisYear > todayIso ? thisYear : iso(today.getFullYear() + 1, month, day);
}

export function remindOptions(today: Date = new Date()): RemindOption[] {
  return [
    { key: "1m", label: "In 1 month", date: addMonths(today, 1) },
    { key: "3m", label: "In 3 months", date: addMonths(today, 3) },
    { key: "jan", label: "January", date: nextOccurrence(today, 1, 5) },
    { key: "spring", label: "Spring (March 1)", date: nextOccurrence(today, 3, 1) },
  ];
}

export function isRemindDue(remindOn: string | null, today: string): boolean {
  return !!remindOn && remindOn <= today;
}
