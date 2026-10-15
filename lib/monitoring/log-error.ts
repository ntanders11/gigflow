import { createServiceClient } from "@/lib/supabase/server";
import { errorFingerprint } from "./fingerprint";

export interface LoggedError {
  source: "server" | "browser";
  message: string;
  stack?: string | null;
  path?: string | null;
  method?: string | null;
  userId?: string | null;
  userAgent?: string | null;
}

const clip = (s: string | null | undefined, n: number) => (s ? String(s).slice(0, n) : null);

// Records an error, or bumps the count if the same one was seen before.
// Never throws: a failure inside the error logger must not become a new
// failure for the person using the app.
export async function logError(e: LoggedError): Promise<void> {
  try {
    const message = clip(e.message, 1000) ?? "Unknown error";
    const path = clip(e.path, 300);
    const fingerprint = errorFingerprint(e.source, message, path);
    const service = await createServiceClient();
    const now = new Date().toISOString();

    const { data: existing } = await service
      .from("error_logs")
      .select("id, count")
      .eq("fingerprint", fingerprint)
      .maybeSingle();

    if (existing) {
      // A repeat of something already reviewed is a reason to look again.
      await service
        .from("error_logs")
        .update({ count: (existing.count as number) + 1, last_seen: now, status: "new" })
        .eq("id", existing.id);
      return;
    }

    await service.from("error_logs").insert({
      fingerprint,
      source: e.source,
      message,
      stack: clip(e.stack, 4000),
      path,
      method: clip(e.method, 10),
      user_id: e.userId ?? null,
      user_agent: clip(e.userAgent, 300),
    });
  } catch (err) {
    console.error("error logger failed:", err);
  }
}
