"use client";

import { useEffect, useState } from "react";
import { TIME_ZONE_OPTIONS } from "@/lib/time-zones";

// Time zone picker for both artist and venue profile pages. Saves on change.
// It's what calendar apps use to show gig times at the right hour.
export default function TimeZoneField() {
  const [zone, setZone] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [deviceZone, setDeviceZone] = useState<string | null>(null);

  useEffect(() => {
    try { setDeviceZone(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* ignore */ }
    fetch("/api/time-zone")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.time_zone) setZone(d.time_zone); })
      .catch(() => {});
  }, []);

  async function save(next: string) {
    const prev = zone;
    setZone(next);
    setStatus("saving");
    try {
      const res = await fetch("/api/time-zone", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ time_zone: next }),
      });
      if (!res.ok) throw new Error();
      setStatus("saved");
    } catch {
      setZone(prev);
      setStatus("error");
    }
  }

  if (zone === null) return null;
  const known = TIME_ZONE_OPTIONS.some((o) => o.value === zone);
  const options = known ? TIME_ZONE_OPTIONS : [{ value: zone, label: zone.replace(/_/g, " ") }, ...TIME_ZONE_OPTIONS];
  const deviceDiffers = deviceZone && deviceZone !== zone;

  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
      <h2 className="text-sm font-semibold mb-1" style={{ color: "#F4E8D2" }}>Time zone</h2>
      <p className="text-xs mb-3" style={{ color: "#9a9591" }}>
        Used so gigs show at the right hour in your calendar app. Gigs at a StageReach venue always use that venue&apos;s local time.
      </p>
      <select
        value={zone}
        onChange={(e) => save(e.target.value)}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.07)", color: "#F4E8D2" }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {deviceDiffers && (
        <button type="button" onClick={() => save(deviceZone!)} className="mt-2 text-xs underline" style={{ color: "#D4A64F" }}>
          Your device is set to {deviceZone!.replace(/_/g, " ")} — use that
        </button>
      )}
      <p className="text-xs mt-2 h-4" style={{ color: status === "error" ? "#e25c5c" : "#4caf7d" }}>
        {status === "saving" ? "" : status === "saved" ? "Saved" : status === "error" ? "Couldn't save — try again." : ""}
      </p>
    </div>
  );
}
