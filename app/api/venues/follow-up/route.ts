// app/api/venues/follow-up/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function buildFollowUpBody(venueName: string): string {
  return `Hi there,

I wanted to follow up on my email from last week about playing at ${venueName}.

I know inboxes get busy — just wanted to make sure my note didn't get buried. I'd love to find a time to connect and see if there's a fit.

Here's my performance video again if it's helpful: https://youtu.be/JaPOuz1R0HI?si=lo5JhEbgowL2g5JU

Happy to work around your schedule. Thanks for your time!

Taylor Anderson
(503) 997-3586
taylorandersonmusic.com`;
}

export async function POST(request: NextRequest) {
  // Vercel injects Authorization: Bearer <CRON_SECRET> on cron invocations
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

  // Get contacted venues last touched 5+ days ago with an email address
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

  // Filter out venues that already received a follow-up
  const venueIds = venues.map((v) => v.id);
  const { data: existingFollowUps } = await supabase
    .from("interactions")
    .select("venue_id")
    .in("venue_id", venueIds)
    .eq("type", "follow_up");

  const alreadyFollowedUp = new Set(
    (existingFollowUps ?? []).map((i) => i.venue_id)
  );

  const eligible = venues.filter((v) => !alreadyFollowedUp.has(v.id));

  if (eligible.length === 0) {
    return NextResponse.json({ sent: 0, message: "All contacted venues already received a follow-up" });
  }

  const now = new Date().toISOString();
  const results: { venue: string; status: string }[] = [];

  for (const venue of eligible) {
    const subject = `Following up — live music inquiry for ${venue.name}`;
    const body = buildFollowUpBody(venue.name);
    const htmlBody = body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#4a9d7a;">$1</a>')
      .replace(/\n/g, "<br>");

    const { data: sendData, error: sendError } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: venue.contact_email!,
      subject,
      text: body,
      html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px">${htmlBody}</div>`,
    });

    if (sendError) {
      results.push({ venue: venue.name, status: `error: ${sendError.message}` });
      continue;
    }

    // Log interaction
    await supabase.from("interactions").insert({
      venue_id: venue.id,
      user_id: venue.user_id,
      type: "follow_up",
      email_subject: subject,
      email_sent: true,
      resend_id: sendData?.id ?? null,
      occurred_at: now,
    });

    // Update last_contacted_at
    await supabase
      .from("venues")
      .update({ last_contacted_at: now })
      .eq("id", venue.id);

    results.push({ venue: venue.name, status: "sent" });
  }

  return NextResponse.json({
    sent: results.filter((r) => r.status === "sent").length,
    results,
  });
}
