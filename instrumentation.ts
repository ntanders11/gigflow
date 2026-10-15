// Next.js calls this for every error thrown while handling a request on the
// server (pages and API routes), so unexpected crashes land in error_logs.
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logError } = await import("@/lib/monitoring/log-error");
  const error = err as { message?: string; stack?: string };
  await logError({
    source: "server",
    message: error?.message ?? String(err),
    stack: error?.stack,
    path: request.path,
    method: request.method,
  });
}
