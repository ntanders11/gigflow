// Sends a browser error to /api/log-error. Fire-and-forget; never throws.
export function reportError(message: string, stack?: string | null) {
  try {
    fetch("/api/log-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, stack: stack ?? null, path: location.pathname }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}
