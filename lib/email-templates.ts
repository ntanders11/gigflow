import { ArtistProfile } from "@/types";

// ── Subject helpers ──────────────────────────────────────────────────────────

export function buildSubject(venueName: string): string {
  return `Live music inquiry for ${venueName} — full-band sound, one performer`;
}

export function buildFollowUpSubject(venueName: string): string {
  return `Following up — live music inquiry for ${venueName}`;
}

// ── Template builders (for batch editing) ───────────────────────────────────
// These build the editable template text. {{venue}} and {{contact}} are
// placeholder markers that get substituted per-venue at send time.
// The artist's own profile data (name, bio, links) is baked in since
// it's the same for every email in the batch.

export function buildSubjectTemplate(mode: "pitch" | "followup"): string {
  if (mode === "pitch") return `Live music inquiry for {{venue}} — full-band sound, one performer`;
  return `Following up — live music inquiry for {{venue}}`;
}

export function buildBodyTemplate(profile: ArtistProfile | null): string {
  const name    = profile?.display_name ?? "";
  const phone   = profile?.phone ?? "";
  const website = profile?.social_links?.website ?? "";
  const youtube = profile?.social_links?.youtube ?? profile?.video_samples?.[0]?.url ?? "";
  const bio     = profile?.bio?.trim() ?? "";

  const bioSection     = bio     ? `\n${bio}\n`                           : "";
  const youtubeSection = youtube ? `\nHear it for yourself: ${youtube}\n` : "";
  const signature      = [name, phone, website].filter(Boolean).join("\n");

  return `Hi {{contact}},

I'm ${name} — a musician who'd love to play at {{venue}}.
${bioSection}${youtubeSection}
I'm booking upcoming dates now and would love to find a time that works for {{venue}}. Would you be open to a quick call this week?

Thanks so much,
${signature}`;
}

export function buildFollowUpBodyTemplate(profile: ArtistProfile | null): string {
  const name    = profile?.display_name ?? "";
  const phone   = profile?.phone ?? "";
  const website = profile?.social_links?.website ?? "";
  const youtube = profile?.social_links?.youtube ?? profile?.video_samples?.[0]?.url ?? "";

  const youtubeSection = youtube ? `\nHear it for yourself: ${youtube}\n` : "";
  const signature      = [name, phone, website].filter(Boolean).join("\n");

  return `Hi {{contact}},

I wanted to follow up on my email from last week about playing at {{venue}}.

I know inboxes get busy — just wanted to make sure my note didn't get buried. I'd love to find a time to connect and see if there's a fit.
${youtubeSection}
Happy to work around your schedule. Thanks for your time!

${signature}`;
}

// Swap {{venue}} and {{contact}} markers with the real values for a specific venue.
export function applyTemplate(
  template: string,
  venueName: string,
  contactName?: string | null
): string {
  return template
    .replace(/\{\{venue\}\}/g, venueName)
    .replace(/\{\{contact\}\}/g, contactName?.trim() || "there");
}

// ── Single-venue helpers (kept for the individual PitchEmailModal) ───────────

export function buildBody(
  venueName: string,
  profile: ArtistProfile | null,
  contactName?: string | null
): string {
  return applyTemplate(buildBodyTemplate(profile), venueName, contactName);
}

export function buildFollowUpBody(
  venueName: string,
  profile: ArtistProfile | null,
  contactName?: string | null
): string {
  return applyTemplate(buildFollowUpBodyTemplate(profile), venueName, contactName);
}
