import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { hasReadScope } from "@/lib/email/outlook";

async function getConn() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const service = await createServiceClient();
  const { data } = await service
    .from("email_connections")
    .select("id, scope, status, reply_detection_enabled, connected_email")
    .eq("user_id", user.id)
    .eq("provider", "outlook")
    .maybeSingle();
  return { service, userId: user.id, conn: data };
}

export async function GET() {
  const ctx = await getConn();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const c = ctx.conn;
  return NextResponse.json({
    outlookConnected: !!c && c.status === "active",
    enabled: !!c && c.reply_detection_enabled === true,
    hasReadPermission: !!c && hasReadScope(c.scope as string),
    email: c?.connected_email ?? null,
  });
}

// Turning off is immediate. Turning on goes through Microsoft's permission screen
// (the client sends the artist to /api/auth/outlook/connect?reply_detection=1).
export async function PATCH(req: NextRequest) {
  const ctx = await getConn();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.enabled !== false) return NextResponse.json({ error: "Use the connect flow to turn this on." }, { status: 400 });
  if (!ctx.conn) return NextResponse.json({ ok: true });
  await ctx.service.from("email_connections").update({ reply_detection_enabled: false }).eq("id", ctx.conn.id);
  return NextResponse.json({ ok: true });
}
