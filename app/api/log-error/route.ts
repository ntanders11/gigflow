import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/monitoring/log-error";

// Browser-side errors. Public on purpose (errors happen on logged-out pages
// too), so it is rate limited per address and size capped; identical errors
// collapse into one row with a count, so spam can't fill the table.
const hits = new Map<string, { n: number; reset: number }>();
const MAX_PER_MINUTE = 10;

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) hits.set(ip, { n: 1, reset: now + 60_000 });
  else if (++h.n > MAX_PER_MINUTE) return NextResponse.json({ ok: true });
  if (hits.size > 5000) hits.clear();

  const raw = await request.text();
  if (raw.length > 8000) return NextResponse.json({ ok: true });
  let body: { message?: unknown; stack?: unknown; path?: unknown };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  if (typeof body.message !== "string" || !body.message) return NextResponse.json({ ok: true });

  let userId: string | null = null;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  } catch { /* logged out is fine */ }

  await logError({
    source: "browser",
    message: body.message,
    stack: typeof body.stack === "string" ? body.stack : null,
    path: typeof body.path === "string" ? body.path : null,
    userId,
    userAgent: request.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true });
}
