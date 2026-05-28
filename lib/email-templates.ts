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
  const name = profile?.display_name ?? "Taylor Anderson";
  const phone = profile?.phone ?? "(503) 997-3586";
  const website = profile?.social_links?.website ?? "taylorandersonmusic.com";
  const youtube =
    profile?.social_links?.youtube ??
    profile?.video_samples?.[0]?.url ??
    "https://youtu.be/JaPOuz1R0HI?si=lo5JhEbgowL2g5JU";
  const bio = profile?.bio?.trim()
    ? profile.bio.trim()
    : `For over a decade, I ran my own music business — booking and performing at resorts, wineries, and venues throughout the Scottsdale and Phoenix area. What makes my show unique: using a live looper, I build guitar, bass, keys, and drums on the spot — a full-band sound with just one performer. My sets blend Top 40, '60s–'00s classics, and a touch of country.`;

  return `${greeting}

I'm ${name} — a full-time musician with over a decade of live performance experience. I recently relocated to the Newberg area and would love to play at ${venueName}.

${bio}

Hear it for yourself: ${youtube}

I'm booking upcoming dates now and would love to find a time that works for ${venueName}. Would you be open to a quick call this week?

Thanks so much,
${name}
${phone}
${website}`;
}

export function buildFollowUpBody(
  venueName: string,
  profile: ArtistProfile | null,
  contactName?: string | null
): string {
  const greeting = contactName ? `Hi ${contactName},` : `Hi there,`;
  const name = profile?.display_name ?? "Taylor Anderson";
  const phone = profile?.phone ?? "(503) 997-3586";
  const website = profile?.social_links?.website ?? "taylorandersonmusic.com";
  const youtube =
    profile?.social_links?.youtube ??
    profile?.video_samples?.[0]?.url ??
    "https://youtu.be/JaPOuz1R0HI?si=lo5JhEbgowL2g5JU";

  return `${greeting}

I wanted to follow up on my email from last week about playing at ${venueName}.

I know inboxes get busy — just wanted to make sure my note didn't get buried. I'd love to find a time to connect and see if there's a fit.

Hear it for yourself: ${youtube}

Happy to work around your schedule. Thanks for your time!

${name}
${phone}
${website}`;
}
