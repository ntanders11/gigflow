"use client";

import { useEffect, useState } from "react";
import { canSendEmail } from "@/lib/email/send-rules";

// Whether the logged-in artist has a working Gmail/Outlook connected, so the
// screens that send email can warn up front instead of letting a send fail.
// While loading — or if the check itself fails — this says "can send" so a
// hiccup never blocks anyone; the server still refuses unconnected sends.
export function useCanSendEmail(): { loading: boolean; canSend: boolean } {
  const [state, setState] = useState({ loading: true, canSend: true });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/email-connections")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        setState({ loading: false, canSend: d ? canSendEmail(d.connections ?? []) : true });
      })
      .catch(() => { if (!cancelled) setState({ loading: false, canSend: true }); });
    return () => { cancelled = true; };
  }, []);

  return state;
}
