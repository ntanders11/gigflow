"use client";

import { useEffect, useState } from "react";
import { DEFAULT_FOLLOW_UP_TEMPLATE } from "@/lib/bookings/follow-up-template";

// Artist-side switch for automatic follow-up emails, plus the wording they
// go out with. Off unless the artist turns it on.
export default function AutoFollowUpSettings() {
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [template, setTemplate] = useState(DEFAULT_FOLLOW_UP_TEMPLATE);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/follow-up-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) { setEnabled(d.enabled); setTemplate(d.template); setLoaded(true); }
      })
      .catch(() => {});
  }, []);

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setSaving(true);
    setStatus("idle");
    try {
      const res = await fetch("/api/follow-up-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setStatus("saved");
      return true;
    } catch {
      setStatus("error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    if (!(await patch({ enabled: next }))) setEnabled(!next);
  }

  if (!loaded) return null;

  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold mb-1" style={{ color: "#F4E8D2" }}>Automatic follow-ups</h2>
          <p className="text-xs" style={{ color: "#9a9591" }}>
            When on, StageReach emails one follow-up from your own address to venues that haven&apos;t replied after 5 days
            (up to 10 a day). Off by default.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Automatic follow-ups"
          onClick={toggle}
          disabled={saving}
          className="shrink-0 rounded-full transition-colors"
          style={{ width: 44, height: 24, backgroundColor: enabled ? "#D4A64F" : "#262b33", position: "relative" }}
        >
          <span
            style={{
              position: "absolute", top: 2, left: enabled ? 22 : 2, width: 20, height: 20,
              borderRadius: "50%", backgroundColor: "#F4E8D2", transition: "left 0.15s",
            }}
          />
        </button>
      </div>

      <label className="block text-xs mt-4 mb-1.5" style={{ color: "#9a9591" }}>
        Message — <code>{"{venue}"}</code> becomes the venue&apos;s name. Your name, phone and website are added underneath.
      </label>
      <textarea
        value={template}
        onChange={(e) => { setTemplate(e.target.value); setStatus("idle"); }}
        rows={9}
        maxLength={2000}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.07)", color: "#F4E8D2" }}
      />
      <div className="flex items-center gap-3 mt-2">
        <button
          type="button"
          onClick={() => patch({ template })}
          disabled={saving}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
          style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
        >
          Save message
        </button>
        <button
          type="button"
          onClick={() => { setTemplate(DEFAULT_FOLLOW_UP_TEMPLATE); setStatus("idle"); }}
          className="text-xs underline"
          style={{ color: "#9a9591" }}
        >
          Reset to original
        </button>
        <span className="text-xs" style={{ color: status === "error" ? "#e25c5c" : "#4caf7d" }}>
          {status === "saved" ? "Saved" : status === "error" ? "Couldn't save — try again." : ""}
        </span>
      </div>
    </div>
  );
}
