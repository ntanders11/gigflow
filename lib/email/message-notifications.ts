// lib/email/message-notifications.ts
import { Resend } from "resend";
import { SupabaseClient } from "@supabase/supabase-js";

async function sendSystemEmail(to: string, subject: string, text: string): Promise<void> {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = (process.env.RESEND_FROM_EMAIL ?? "").trim();
  if (!apiKey || !fromEmail) {
    console.error("message-notifications: Resend not configured (missing API key or from address)");
    return;
  }
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({ from: `StageReach <${fromEmail}>`, to, subject, text });
  if (error) console.error("message-notifications: send failed", error);
}

// Sent for the first unread message in a thread only (the caller decides),
// and skipped when the recipient turned message emails off.
export async function sendNewMessageEmail(
  service: SupabaseClient,
  recipientUserId: string,
  senderName: string,
  link: string
): Promise<void> {
  const { data: profile, error } = await service
    .from("profiles")
    .select("email, message_emails_enabled")
    .eq("id", recipientUserId)
    .maybeSingle();
  if (error) console.error("sendNewMessageEmail: profile lookup failed", error);
  if (!profile?.email || profile.message_emails_enabled === false) return;

  const safeName = senderName.replace(/[\r\n]+/g, " ").trim().slice(0, 80);
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
  await sendSystemEmail(
    profile.email as string,
    `${safeName} sent you a message on StageReach`,
    `${safeName} sent you a message on StageReach. Open it here: ${base}${link}\n\nYou can turn these emails off from your profile page.`
  );
}
