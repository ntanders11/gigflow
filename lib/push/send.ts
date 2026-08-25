// lib/push/send.ts
import webpush from "web-push";
import { SupabaseClient } from "@supabase/supabase-js";

let vapidConfigured = false;
let missingEnvLogged = false;

// Configures web-push with the VAPID keys on first real use, not at
// module import time — see this file's header comment in the plan for
// why an eager call here would be a serious problem. Returns false
// (without throwing) if the required env vars aren't set, or if the
// values fail web-push's own validation (setVapidDetails throws on a
// malformed subject/key rather than returning an error), so callers
// can skip sending rather than crash.
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const publicKey = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (process.env.VAPID_SUBJECT ?? "").trim();
  if (!publicKey || !privateKey || !subject) {
    if (!missingEnvLogged) {
      console.error("sendPushToUser: VAPID env vars not configured, skipping push send");
      missingEnvLogged = true;
    }
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (err) {
    console.error("sendPushToUser: invalid VAPID configuration, skipping push send", err);
    return false;
  }
  vapidConfigured = true;
  return true;
}

// Sends a push notification to every device a user has subscribed on.
// Never throws — a failed push send must never affect the in-app
// notification it's attached to. Logs and continues past a single
// failed device rather than aborting the rest.
export async function sendPushToUser(
  service: SupabaseClient,
  userId: string,
  payload: { title: string; body?: string; url: string }
): Promise<void> {
  if (!ensureVapidConfigured()) return;

  const { data: subscriptions, error } = await service
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (error) {
    console.error("sendPushToUser: subscriptions lookup failed", error);
    return;
  }
  if (!subscriptions || subscriptions.length === 0) return;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    url: payload.url,
  });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint as string,
          keys: { p256dh: sub.p256dh as string, auth: sub.auth as string },
        },
        body
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Push service says this subscription is gone for good (device
        // uninstalled the app, revoked permission at the OS level, etc.)
        // — clean it up so we stop retrying it forever.
        const { error: deleteError } = await service
          .from("push_subscriptions")
          .delete()
          .eq("id", sub.id as string);
        if (deleteError) {
          console.error("sendPushToUser: failed to delete stale subscription", deleteError);
        }
      } else {
        console.error("sendPushToUser: send failed for one subscription", err);
      }
    }
  }
}
