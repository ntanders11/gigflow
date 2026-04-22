"use client";

import { useState, useEffect } from "react";
import { ArtistProfile } from "@/types";

interface VenueRow {
  id: string;
  name: string;
  type: string | null;
  city: string | null;
  contact_email: string | null;
  contact_name: string | null;
  last_contacted_at: string | null;
  user_id: string;
}

function buildFollowUpEmail(venueName: string, profile: ArtistProfile | null, contactName?: string | null) {
  const greeting = contactName ? `Hi ${contactName},` : `Hi there,`;
  const name = profile?.display_name ?? "Taylor Anderson";
  const phone = profile?.phone ?? "(503) 997-3586";
  const website = profile?.social_links?.website ?? "taylorandersonmusic.com";
  const youtube = profile?.social_links?.youtube
    ?? profile?.video_samples?.[0]?.url
    ?? "https://youtu.be/JaPOuz1R0HI?si=lo5JhEbgowL2g5JU";

  const subject = `Following up — live music inquiry for ${venueName}`;
  const body = `${greeting}

I wanted to follow up on my email from last week about playing at ${venueName}.

I know inboxes get busy — just wanted to make sure my note didn't get buried. I'd love to find a time to connect and see if there's a fit.

Hear it for yourself: ${youtube}

Happy to work around your schedule. Thanks for your time!

${name}
${phone}
${website}`;

  return { subject, body };
}

function daysAgo(dateStr: string | null) {
  if (!dateStr) return "";
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  return `${d}d ago`;
}

type Phase = "loading" | "confirm" | "sending" | "done";

interface Props {
  onClose: () => void;
  onSent: (count: number) => void;
}

export default function BulkFollowUpModal({ onClose, onSent }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [profile, setProfile] = useState<ArtistProfile | null>(null);
  const [progress, setProgress] = useState({ done: 0, sent: 0, failed: 0 });
  const [results, setResults] = useState<{ name: string; status: "sent" | "failed" }[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/venues/needs-followup").then((r) => r.json()),
      fetch("/api/artist-profile").then((r) => r.json()).catch(() => null),
    ]).then(([venueData, profileData]) => {
      setVenues(venueData.venues ?? []);
      setProfile(profileData);
      setPhase("confirm");
    });
  }, []);

  async function sendAll() {
    setPhase("sending");
    const newResults: { name: string; status: "sent" | "failed" }[] = [];
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < venues.length; i++) {
      const v = venues[i];
      const { subject, body } = buildFollowUpEmail(v.name, profile, v.contact_name);

      try {
        const res = await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: v.contact_email,
            subject,
            body,
            venue_id: v.id,
            user_id: v.user_id,
          }),
        });

        if (res.ok) {
          sent++;
          newResults.push({ name: v.name, status: "sent" });
        } else {
          failed++;
          newResults.push({ name: v.name, status: "failed" });
        }
      } catch {
        failed++;
        newResults.push({ name: v.name, status: "failed" });
      }

      setProgress({ done: i + 1, sent, failed });
      setResults([...newResults]);

      if (i < venues.length - 1) await new Promise((r) => setTimeout(r, 150));
    }

    setPhase("done");
    onSent(sent);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
      <div
        className="w-full max-w-lg rounded-xl flex flex-col"
        style={{
          backgroundColor: "#16181c",
          border: "1px solid rgba(255,255,255,0.1)",
          maxHeight: "85vh",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <h2 className="text-base font-semibold" style={{ color: "#f0ede8" }}>
            {phase === "loading" && "Loading…"}
            {phase === "confirm" && `Send follow-ups to ${venues.length} venue${venues.length !== 1 ? "s" : ""}`}
            {phase === "sending" && "Sending…"}
            {phase === "done" && "All done!"}
          </h2>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: "#5e5c58" }}>×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {phase === "loading" && (
            <p className="text-sm text-center py-8" style={{ color: "#9a9591" }}>Checking who needs a follow-up…</p>
          )}

          {phase === "confirm" && (
            <>
              {venues.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm font-medium mb-1" style={{ color: "#4caf7d" }}>All caught up!</p>
                  <p className="text-xs" style={{ color: "#5e5c58" }}>No eligible venues — either they've already had a follow-up, or it hasn't been 5 days yet.</p>
                </div>
              ) : (
                <>
                  <p className="text-xs mb-4" style={{ color: "#9a9591" }}>
                    A short follow-up email will be sent to each venue below. You can review the template — it references your previous message and includes your video link.
                  </p>
                  <div className="space-y-1.5">
                    {venues.map((v) => (
                      <div
                        key={v.id}
                        className="flex items-center justify-between rounded-lg px-3 py-2.5"
                        style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.06)" }}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: "#f0ede8" }}>{v.name}</p>
                          <p className="text-xs truncate" style={{ color: "#9a9591" }}>{v.contact_email}</p>
                        </div>
                        <span className="text-xs ml-3 shrink-0" style={{ color: "#e25c5c" }}>
                          {daysAgo(v.last_contacted_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {(phase === "sending" || phase === "done") && (
            <div className="space-y-3">
              {/* Progress bar */}
              {phase === "sending" && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs mb-1.5" style={{ color: "#9a9591" }}>
                    <span>Sending {progress.done} of {venues.length}…</span>
                    <span>{progress.sent} sent</span>
                  </div>
                  <div className="w-full rounded-full overflow-hidden" style={{ backgroundColor: "#262b33", height: "5px" }}>
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.round((progress.done / venues.length) * 100)}%`, backgroundColor: "#d4a853" }}
                    />
                  </div>
                </div>
              )}

              {phase === "done" && (
                <div className="rounded-lg px-4 py-3 mb-3 text-center" style={{ backgroundColor: "rgba(76,175,125,0.1)", border: "1px solid rgba(76,175,125,0.25)" }}>
                  <p className="text-sm font-semibold" style={{ color: "#4caf7d" }}>
                    ✓ {progress.sent} follow-up{progress.sent !== 1 ? "s" : ""} sent
                    {progress.failed > 0 ? `, ${progress.failed} failed` : ""}
                  </p>
                </div>
              )}

              {/* Per-venue results */}
              <div className="space-y-1.5">
                {results.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg px-3 py-2"
                    style={{ backgroundColor: "#1e2128" }}
                  >
                    <span className="text-sm" style={{ color: "#f0ede8" }}>{r.name}</span>
                    <span className="text-xs font-medium" style={{ color: r.status === "sent" ? "#4caf7d" : "#e25c5c" }}>
                      {r.status === "sent" ? "✓ Sent" : "✕ Failed"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 shrink-0 flex gap-3" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          {phase === "confirm" && venues.length > 0 && (
            <>
              <button
                onClick={onClose}
                className="flex-1 text-sm py-2.5 rounded-lg"
                style={{ backgroundColor: "#1e2128", color: "#9a9591", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                Cancel
              </button>
              <button
                onClick={sendAll}
                className="flex-1 text-sm py-2.5 rounded-lg font-semibold transition-all hover:brightness-110"
                style={{ backgroundColor: "#d4a853", color: "#0e0f11" }}
              >
                Send {venues.length} email{venues.length !== 1 ? "s" : ""}
              </button>
            </>
          )}
          {(phase === "confirm" && venues.length === 0) || phase === "done" ? (
            <button
              onClick={onClose}
              className="flex-1 text-sm py-2.5 rounded-lg font-semibold"
              style={{ backgroundColor: "#d4a853", color: "#0e0f11" }}
            >
              Close
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
