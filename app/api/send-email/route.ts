import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";


export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { to, subject, body: emailBody, venue_id, user_id, interaction_type } = body;

  const missing = [!to && "to", !subject && "subject", !emailBody && "body", !venue_id && "venue_id"].filter(Boolean);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  // Look up artist's display name and booking email for From/Reply-To
  const { data: artistProfile } = await supabase
    .from("artist_profiles")
    .select("display_name, contact_email")
    .eq("user_id", user.id)
    .maybeSingle();

  // Guard: both env vars must be present or emails can never work
  const apiKey   = (process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL ?? "").trim();
  if (!apiKey) {
    console.error("send-email: RESEND_API_KEY is not set in environment variables");
    return NextResponse.json({ error: "Email service not configured (missing API key)" }, { status: 500 });
  }
  if (!fromEmail) {
    console.error("send-email: RESEND_FROM_EMAIL is not set in environment variables");
    return NextResponse.json({ error: "Email service not configured (missing from address)" }, { status: 500 });
  }

  const artistName   = (artistProfile?.display_name ?? "StageReach Artist").replace(/[<>"]/g, "").trim();
  const replyToRaw   = (artistProfile?.contact_email ?? user.email ?? "").trim();
  const fromAddress  = artistName ? `${artistName} <${fromEmail}>` : fromEmail;

  // Only include replyTo when we have a real address — passing an empty
  // string to Resend causes the send to fail silently.
  const replyTo = replyToRaw || undefined;

  console.log(`send-email: from="${fromAddress}" replyTo="${replyTo ?? "(none)"}" to="${to}" subject="${subject}"`);

  // Send via Resend
  // Convert plain text to HTML, making the YouTube link clickable
  const htmlBody = emailBody
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(
      /(Hear it for yourself): (https?:\/\/[^\s]+)/g,
      '<a href="$2" style="color:#4a9d7a;">$1</a>'
    )
    .replace(/\n/g, "<br>");

  const resend = new Resend(apiKey);
  const { data: sendData, error: sendError } = await resend.emails.send({
    from: fromAddress,
    ...(replyTo ? { replyTo } : {}),
    to,
    subject,
    text: emailBody,
    html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px">${htmlBody}</div>`,
  });

  if (sendError) {
    console.error("send-email: Resend error:", sendError.message);
    return NextResponse.json({ error: sendError.message }, { status: 500 });
  }

  console.log(`send-email: Resend accepted → id=${sendData?.id}`);

  // Log the interaction
  const { data: interaction, error: interactionError } = await supabase
    .from("interactions")
    .insert({
      venue_id,
      user_id: user_id ?? user.id,
      type: interaction_type === "follow_up" ? "follow_up" : "email",
      email_subject: subject,
      email_body: emailBody,
      email_sent: true,
      resend_id: sendData?.id ?? null,
      occurred_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (interactionError) {
    // Email was sent — log the error but don't fail the request
    console.error("Failed to log interaction:", interactionError.message);
  }

  // Update last_contacted_at, and advance stage discovered → contacted
  const { data: venueNow } = await supabase
    .from("venues")
    .select("stage")
    .eq("id", venue_id)
    .eq("user_id", user.id)
    .single();

  const stageUpdate: Record<string, string> = {
    last_contacted_at: new Date().toISOString(),
  };
  if (venueNow?.stage === "discovered") {
    stageUpdate.stage = "contacted";
  }

  await supabase
    .from("venues")
    .update(stageUpdate)
    .eq("id", venue_id)
    .eq("user_id", user.id);

  return NextResponse.json({
    success: true,
    resend_id: sendData?.id,
    interaction,
    stage: stageUpdate.stage ?? venueNow?.stage ?? null,
  });
}
