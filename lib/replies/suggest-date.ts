// Spots "we're not booking until January / next spring / next year" in the short
// preview of a venue's reply and suggests a day to check back in. Suggest-only:
// nothing is changed until the artist taps yes.
import { addMonths, iso, nextOccurrence } from "@/lib/venues/remind-dates";

export interface DateSuggestion { date: string; label: string }

const DEFERRAL = /(until|till|after the|check back|reach out|circle back|try again|get back|contact us|again in|not (currently )?(booking|taking|looking|hiring)|fully booked|booked (up|through|solid)|no (openings|availability|dates)|next (year|season|spring|summer|fall|autumn|winter|month)|in the (spring|summer|fall|autumn|winter|new year))/i;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const SEASONS: { re: RegExp; label: string; month: number }[] = [
  { re: /\bspring\b/i, label: "in spring", month: 3 },
  { re: /\bsummer\b/i, label: "in summer", month: 6 },
  { re: /\b(fall|autumn)\b/i, label: "in the fall", month: 9 },
  { re: /\bwinter\b/i, label: "in winter", month: 12 },
];

export function suggestRemindDate(text: string, today: Date = new Date()): DateSuggestion | null {
  const t = (text ?? "").replace(/\s+/g, " ");
  if (!DEFERRAL.test(t)) return null;

  for (let i = 0; i < MONTHS.length; i++) {
    const name = MONTHS[i];
    // "may" is also a verb, so it only counts right after a timing word.
    const re = name === "may" ? /\b(until|till|in|after|next|early|late|by) may\b/i : new RegExp(`\\b${name}\\b`, "i");
    if (re.test(t)) {
      return { date: nextOccurrence(today, i + 1, 1), label: `in ${name[0].toUpperCase()}${name.slice(1)}` };
    }
  }
  for (const s of SEASONS) {
    if (s.re.test(t)) return { date: nextOccurrence(today, s.month, 1), label: s.label };
  }
  if (/\b(next|new) year\b|\bafter the holidays\b/i.test(t)) {
    return { date: nextOccurrence(today, 1, 5), label: "after the new year" };
  }
  if (/\bnext month\b/i.test(t)) {
    const d = new Date(addMonths(today, 1) + "T12:00:00");
    return { date: iso(d.getFullYear(), d.getMonth() + 1, 1), label: "next month" };
  }
  return null;
}

export function formatSuggestedDate(date: string): string {
  return new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
