"use client";

import { useEffect } from "react";
import { reportError } from "./reportError";

// Catches errors that happen in the browser outside React's own error
// screens (button handlers, failed promises) and reports them. Capped per
// page load so one broken screen can't flood the log.
export default function ErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const send = (message: string, stack?: string | null) => {
      if (sent++ < 5) reportError(message, stack);
    };
    const onError = (e: ErrorEvent) => {
      // Cross-origin "Script error." and browser-extension noise have nothing to act on.
      if (!e.message || e.message === "Script error." || e.filename?.startsWith("chrome-extension")) return;
      send(e.message, e.error?.stack);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | string | undefined;
      const message = typeof r === "string" ? r : r?.message;
      if (message) send(`Unhandled promise rejection: ${message}`, typeof r === "object" ? r?.stack : null);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
