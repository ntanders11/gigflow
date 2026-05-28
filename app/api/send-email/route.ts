import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";

// Initialized per-request so env var updates take effect without redeploy
function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

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

  const fromEmail = (process.env.RESEND_FROM_EMAIL ?? "").trim();
  if (!fromEmail) {
    return NextResponse.json({ error: "RESEND_FROM_EMAIL is not configured" }, { status: 500 });
  }
  const artistName = (artistProfile?.display_name ?? "StageReach Artist").replace(/[<>"]/g, "").trim();
  const replyToEmail = (artistProfile?.contact_email ?? user.email ?? "").trim();
  const fromAddress = artistName ? `${artistName} <${fromEmail}>` : fromEmail;

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

  const resend = getResend();
  const { data: sendData, error: sendError } = await resend.emails.send({
    from: fromAddress,
    replyTo: replyToEmail,
    to,
    subject,
    text: emailBody,
    html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px">${htmlBody}</div>`,
  });

  if (sendError) {
    return NextResponse.json({ error: sendError.message }, { status: 500 });
  }

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

  // Update last_contacted_at on the venue
  await supabase
    .from("venues")
    .update({ last_contacted_at: new Date().toISOString() })
    .eq("id", venue_id)
    .eq("user_id", user.id);

  return NextResponse.json({ success: true, resend_id: sendData?.id, interaction });
}
