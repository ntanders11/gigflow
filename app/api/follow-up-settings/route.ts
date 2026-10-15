import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_FOLLOW_UP_TEMPLATE, MAX_TEMPLATE_LENGTH } from "@/lib/bookings/follow-up-template";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data } = await supabase
    .from("artist_profiles")
    .select("auto_follow_up_enabled, auto_follow_up_template")
    .eq("user_id", user.id)
    .maybeSingle();
  return NextResponse.json({
    enabled: data?.auto_follow_up_enabled === true,
    template: (data?.auto_follow_up_template as string | null) ?? DEFAULT_FOLLOW_UP_TEMPLATE,
  });
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const update: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") update.auto_follow_up_enabled = body.enabled;
  if (typeof body.template === "string") {
    const t = body.template.trim();
    if (t.length > MAX_TEMPLATE_LENGTH) {
      return NextResponse.json({ error: `Keep the message under ${MAX_TEMPLATE_LENGTH} characters.` }, { status: 400 });
    }
    // Saving the untouched default (or nothing) stores null, so the default
    // can be improved later without anyone being stuck on an old copy.
    update.auto_follow_up_template = t === "" || t === DEFAULT_FOLLOW_UP_TEMPLATE ? null : t;
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });

  const { error } = await supabase.from("artist_profiles").update(update).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
