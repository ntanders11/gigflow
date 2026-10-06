"use client";

import { useEffect, useState } from "react";

// How many messages from the other side this person hasn't opened yet.
// Checked on load, whenever `refreshKey` changes (pass the current page's
// path so the number updates after visiting Messages), and every 30
// seconds. Shared by the venue and artist navigation bars.
export function useUnreadMessages(refreshKey: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch("/api/messages/unread-count")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled && d) setCount(d.count ?? 0); })
        .catch(() => {});
    }
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [refreshKey]);

  return count;
}

export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-[10px] font-bold px-1"
      style={{ backgroundColor: "#e25c5c", color: "#fff", minWidth: "16px", height: "16px" }}
      aria-label={`${count} unread ${count === 1 ? "message" : "messages"}`}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
