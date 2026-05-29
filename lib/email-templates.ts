import { ArtistProfile } from "@/types";

export function buildSubject(venueName: string): string {
  return `Live music inquiry for ${venueName} — full-band sound, one performer`;
}

export function buildFollowUpSubject(venueName: string): string {
  return `Following up — live music inquiry for ${venueName}`;
}

export function buildBody(
  venueName: string,
  profile: ArtistProfile | null,
  contactName?: string | null
): string {
  const greeting = contactName ? `Hi ${contactName},` : `Hi there,`;
  const name = profile?.display_name ?? "";
  const phone = profile?.phone ?? "";
  const website = profile?.social_links?.website ?? "";
  const youtube =
    profile?.social_links?.youtube ??
    profile?.video_samples?.[0]?.url ??
    "";
  const bio = profile?.bio?.trim() ?? "";

  const bioSection = bio ? `\n${bio}\n` : "";
  const youtubeSection = youtube ? `\nHear it for yourself: ${youtube}\n` : "";
  const signature = [name, phone, website].filter(Boolean).join("\n");

  return `${greeting}

I'm ${name} — a musician who'd love to play at ${venueName}.
${bioSection}${youtubeSection}
I'm booking upcoming dates now and would love to find a time that works for ${venueName}. Would you be open to a quick call this week?

Thanks so much,
${signature}`;
}

export function buildFollowUpBody(
  venueName: string,
  profile: ArtistProfile | null,
  contactName?: string | null
): string {
  const greeting = contactName ? `Hi ${contactName},` : `Hi there,`;
  const name = profile?.display_name ?? "";
  const phone = profile?.phone ?? "";
  const website = profile?.social_links?.website ?? "";
  const youtube =
    profile?.social_links?.youtube ??
    profile?.video_samples?.[0]?.url ??
    "";
  const youtubeSection = youtube ? `\nHear it for yourself: ${youtube}\n` : "";
  const signature = [name, phone, website].filter(Boolean).join("\n");

  return `${greeting}

I wanted to follow up on my email from last week about playing at ${venueName}.

I know inboxes get busy — just wanted to make sure my note didn't get buried. I'd love to find a time to connect and see if there's a fit.
${youtubeSection}
Happy to work around your schedule. Thanks for your time!

${signature}`;
}
