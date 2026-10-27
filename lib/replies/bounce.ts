// Pure rules for spotting "undeliverable" notices in an inbox and working out
// which pipeline venue's address they are about.
import { normalizeEmail } from "./match";

const BOUNCE_SUBJECT = /^(undeliverable|delivery (status notification|has failed|failure)|mail delivery (failed|subsystem)|returned mail|failure notice|undelivered mail|message not delivered)/i;
// A delay or an out-of-office is not a failed address.
const NOT_A_BOUNCE = /(delayed|delay|automatic reply|auto[- ]?reply|out of office)/i;
const EMAIL = /[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function isBounceNotice(m: {
  subject: string;
  fromAddress: string;
  headers?: { name: string; value: string }[];
}): boolean {
  const subject = (m.subject ?? "").trim();
  if (NOT_A_BOUNCE.test(subject)) return false;
  if (BOUNCE_SUBJECT.test(subject)) return true;
  for (const h of m.headers ?? []) {
    if (h.name.toLowerCase() === "content-type" && /report-type=delivery-status/i.test(h.value ?? "")) return true;
  }
  return /^(mailer-daemon|postmaster)@/i.test(m.fromAddress) && !/(delay)/i.test(subject);
}

// Which of the artist's known venue addresses appear in the notice's subject or
// short preview text.
export function findBouncedAddresses(text: string, known: Iterable<string>): string[] {
  const knownSet = new Set(known);
  const found = new Set<string>();
  for (const raw of text.match(EMAIL) ?? []) {
    const e = normalizeEmail(raw.replace(/[.,;:)>\]]+$/, ""));
    if (knownSet.has(e)) found.add(e);
  }
  return [...found];
}
