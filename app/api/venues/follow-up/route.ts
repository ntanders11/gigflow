// app/api/venues/follow-up/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendArtistEmail } from "@/lib/email/send-artist-email";
import { createNotification } from "@/lib/notifications/create";
import { isWithinFollowUpCooldown } from "@/lib/bookings/follow-up";
import { pickDailyBatch } from "@/lib/bookings/follow-up-cap";
import { renderFollowUpBody } from "@/lib/bookings/follow-up-template";

interface ArtistInfo {
  name: string;
  email: string;
  phone: string | null;
  website: string | null;
  template: string | null;
}

// Vercel starts scheduled jobs with GET (this used to accept only POST, so
// no scheduled run ever got through); POST stays for triggering by hand.
async function handleFollowUps(request: NextRequest) {
  // Vercel injects Authorization: Bearer <CRON_SECRET> on cron invocations.
  // The secret must be set, or the text "Bearer undefined" would be accepted.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const dayMs = 24 * 60 * 60 * 1000;
  const fiveDaysAgo = new Date(Date.now() - 5 * dayMs).toISOString();
  // Leads older than this are skipped: a "following up on my email from last
  // week" message to someone contacted months ago would read as wrong.
  const sixtyDaysAgo = new Date(Date.now() - 60 * dayMs).toISOString();

  // Opt-in only: just artists who turned automatic follow-ups on in their profile.
  const { data: optedIn } = await supabase
    .from("artist_profiles")
    .select("user_id")
    .eq("auto_follow_up_enabled", true);
  const optedInIds = (optedIn ?? []).map((a) => a.user_id as string);
  if (optedInIds.length === 0) {
    return NextResponse.json({ sent: 0, message: "No artists have automatic follow-ups turned on" });
  }

  const { data: venues, error: venueError } = await supabase
    .from("venues")
    .select("id, name, contact_email, user_id, last_contacted_at")
    .in("user_id", optedInIds)
    .eq("stage", "contacted")
    .not("contact_email", "is", null)
    .lt("last_contacted_at", fiveDaysAgo)
    .gte("last_contacted_at", sixtyDaysAgo);

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

  // Daily cap: at most N per artist per run, longest-waiting first, so a big
  // backlog trickles out instead of going all at once.
  const eligible = pickDailyBatch(
    venues.filter((v) => !isWithinFollowUpCooldown(lastFollowUpByVenue.get(v.id) ?? null))
  );

  if (eligible.length === 0) {
    return NextResponse.json({ sent: 0, message: "No contacted venues are due for a follow-up right now" });
  }

  const uniqueUserIds = [...new Set(eligible.map((v) => v.user_id))];

  const { data: artistProfiles } = await supabase
    .from("artist_profiles")
    .select("user_id, display_name, phone, social_links, auto_follow_up_enabled, auto_follow_up_template")
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
      template: ap?.auto_follow_up_template ?? null,
    });
  }

  const now = new Date().toISOString();
  const results: { venue: string; status: string }[] = [];

  // Artists whose email isn't connected: every send would be refused, so skip
  // the rest of their batch instead of trying each one.
  const blockedArtists = new Set<string>();

  for (const venue of eligible) {
    if (blockedArtists.has(venue.user_id)) continue;
    try {
      const artist = artistMap.get(venue.user_id)!;
      const subject = `Following up — live music inquiry for ${venue.name}`;
      const signature = [artist.name, artist.phone, artist.website].filter(Boolean).join("\n");
      const body = renderFollowUpBody(artist.template, venue.name, signature);
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
        if (sendResult.code === "not_connected" || sendResult.code === "needs_reconnect") {
          blockedArtists.add(venue.user_id);
        }
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

export const GET = handleFollowUps;
export const POST = handleFollowUps;
