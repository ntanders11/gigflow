import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NotificationView } from "@/types";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();

  // Unread notifications always show, however old — an artist shouldn't
  // lose something they haven't seen yet. Once read, a notification only
  // sticks around for 7 days before it's hidden from this list (it's never
  // deleted by this alone — "Clear all" is the only thing that removes rows).
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await service
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .or(`read_at.is.null,created_at.gte.${sevenDaysAgo}`)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { count: unreadCount, error: countError } = await service
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null);
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });

  const notifications: NotificationView[] = (rows ?? []).map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    link: r.link,
    read: r.read_at !== null,
    created_at: r.created_at,
  }));

  return NextResponse.json({ notifications, unreadCount: unreadCount ?? 0 });
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = await createServiceClient();
  const { error } = await service
    .from("notifications")
    .delete()
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
