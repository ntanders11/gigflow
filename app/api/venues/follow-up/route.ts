// app/api/venues/follow-up/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendArtistEmail } from "@/lib/email/send-artist-email";
import { createNotification } from "@/lib/notifications/create";
import { isWithinFollowUpCooldown } from "@/lib/bookings/follow-up";

interface ArtistInfo {
  name: string;
  email: string;
  phone: string | null;
  website: string | null;
}

function buildFollowUpBody(venueName: string, artist: ArtistInfo): string {
  const signature = [
    artist.name,
    artist.phone,
    artist.website,
  ].filter(Boolean).join("\n");

  return `Hi there,

I wanted to follow up on my email from last week about playing at ${venueName}.

I know inboxes get busy — just wanted to make sure my note didn't get buried. I'd love to find a time to connect and see if there's a fit.

Happy to work around your schedule. Thanks for your time!

${signature}`;
}

export async function POST(request: NextRequest) {
  // Vercel injects Authorization: Bearer <CRON_SECRET> on cron invocations
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

  const { data: venues, error: venueError } = await supabase
    .from("venues")
    .select("id, name, contact_email, user_id")
    .eq("stage", "contacted")
    .not("contact_email", "is", null)
    .lt("last_contacted_at", fiveDaysAgo);

  if (venueError) {
    return NextResponse.json({ error: venueError.message }, { status: 500 });
  }

  if (!venues || venues.length === 0) {
    return NextResponse.json({ sent: 0, message: "No venues need follow-up" });
  }

  const venueIds = venues.map((v) => v.id);
  const { data: existingFollowUps } = await supabase
    .from("interactions")
    .select("venue_id, occurred_at")
    .in("venue_id", venueIds)
    .eq("type", "follow_up");

  // Most recent follow-up per venue, not just whether one ever happened —
  // a venue that got followed up with months ago should be eligible
  // again, same cooldown rule as the manual batch-follow-up picker on the
  // pipeline board (see lib/bookings/follow-up.ts).
  const lastFollowUpByVenue = new Map<string, string>();
  for (const f of existingFollowUps ?? []) {
    const prev = lastFollowUpByVenue.get(f.venue_id);
    if (!prev || f.occurred_at > prev) lastFollowUpByVenue.set(f.venue_id, f.occurred_at);
  }

  const eligible = venues.filter(
    (v) => !isWithinFollowUpCooldown(lastFollowUpByVenue.get(v.id) ?? null)
  );

  if (eligible.length === 0) {
    return NextResponse.json({ sent: 0, message: "No contacted venues are due for a follow-up right now" });
  }

  const uniqueUserIds = [...new Set(eligible.map((v) => v.user_id))];

  const { data: artistProfiles } = await supabase
    .from("artist_profiles")
    .select("user_id, display_name, phone, social_links")
    .in("user_id", uniqueUserIds);

  const { data: profileEmails } = await supabase
    .from("profiles")
    .select("id, email")
    .in("id", uniqueUserIds);

  const artistMap = new Map<string, ArtistInfo>();
  for (const uid of uniqueUserIds) {
    const ap = artistProfiles?.find((p) => p.user_id === uid);
    const pr = profileEmails?.find((p) => p.id === uid);
    artistMap.set(uid, {
      name: ap?.display_name ?? "StageReach Artist",
      email: pr?.email ?? "",
      phone: ap?.phone ?? null,
      website: ap?.social_links?.website ?? null,
    });
  }

  const now = new Date().toISOString();
  const results: { venue: string; status: string }[] = [];

  for (const venue of eligible) {
    try {
      const artist = artistMap.get(venue.user_id)!;
      const subject = `Following up — live music inquiry for ${venue.name}`;
      const body = buildFollowUpBody(venue.name, artist);
      const htmlBody = body
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#4a9d7a;">$1</a>')
        .replace(/\n/g, "<br>");

      const sendResult = await sendArtistEmail({
        userId: venue.user_id,
        to: venue.contact_email!,
        subject,
        text: body,
        html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px">${htmlBody}</div>`,
        fromName: artist.name,
        replyTo: artist.email || undefined,
      });

      if (!sendResult.success) {
        results.push({ venue: venue.name, status: `error: ${sendResult.error}` });
        continue;
      }

      await supabase.from("interactions").insert({
        venue_id: venue.id,
        user_id: venue.user_id,
        type: "follow_up",
        email_subject: subject,
        email_sent: true,
        resend_id: sendResult.providerMessageId,
        sent_via: sendResult.provider,
        occurred_at: now,
      });

      await supabase
        .from("venues")
        .update({ last_contacted_at: now })
        .eq("id", venue.id);

      results.push({ venue: venue.name, status: "sent" });

      try {
        await createNotification(supabase, {
          userId: venue.user_id,
          type: "follow_up_sent",
          title: "Follow-up email sent",
          body: `A follow-up went out to ${venue.name} automatically.`,
          link: "/pipeline",
        });
      } catch (notifyErr) {
        console.error(`follow-up: failed to create notification for venue ${venue.name}:`, notifyErr);
      }
    } catch (err) {
      console.error(`follow-up: unexpected error for venue ${venue.name}:`, err);
      results.push({ venue: venue.name, status: `error: ${err}` });
    }
  }

  return NextResponse.json({
    sent: results.filter((r) => r.status === "sent").length,
    results,
  });
}
