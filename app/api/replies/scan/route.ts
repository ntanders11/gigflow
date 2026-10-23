import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { scanOutlookReplies } from "@/lib/replies/scan-outlook";

// "Check for replies now" — scans only the logged-in artist's own inbox.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();
  const { data: conn } = await service
    .from("email_connections")
    .select("id, user_id, access_token, refresh_token, expires_at, reply_scan_cursor, reply_detection_enabled")
    .eq("user_id", user.id)
    .eq("provider", "outlook")
    .eq("status", "active")
    .maybeSingle();

  if (!conn || !conn.reply_detection_enabled) {
    return NextResponse.json({ error: "Reply detection isn't turned on." }, { status: 400 });
  }
  const result = await scanOutlookReplies(service, conn);
  if (result.error === "permission") {
    return NextResponse.json({ error: "Microsoft didn't allow reading your inbox. Turn reply detection off and on again to re-approve it." }, { status: 403 });
  }
  if (result.error) return NextResponse.json({ error: "Couldn't check your inbox just now. Try again in a minute." }, { status: 502 });
  return NextResponse.json(result);
}
