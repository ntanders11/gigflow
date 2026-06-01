"use client";

import { useState, useEffect } from "react";
import { Venue, ArtistProfile } from "@/types";
import {
  buildSubjectTemplate,
  buildBodyTemplate,
  buildFollowUpBodyTemplate,
  applyTemplate,
} from "@/lib/email-templates";

export interface SendResult {
  venueId: string;
  venueName: string;
  success: boolean;
  error?: string;
}

interface Props {
  venues: Venue[];
  mode: "pitch" | "followup";
  onClose: () => void;
  onComplete: (results: SendResult[], sentVenueIds: string[]) => void;
}

export default function BatchEmailModal({ venues, mode, onClose, onComplete }: Props) {
  const [profile, setProfile]           = useState<ArtistProfile | null>(null);
  const [step, setStep]                 = useState<"confirm" | "sending" | "results">("confirm");
  const [progress, setProgress]         = useState(0);
  const [results, setResults]           = useState<SendResult[]>([]);
  const [subjectTemplate, setSubjectTemplate] = useState(buildSubjectTemplate(mode));
  const [bodyTemplate, setBodyTemplate]       = useState("");

  const previewVenue = venues[0];

  // Preview shows what the email will actually look like for the first venue
  const previewSubject = previewVenue
    ? applyTemplate(subjectTemplate, previewVenue.name, previewVenue.contact_name)
    : subjectTemplate;
  const previewBody = previewVenue && bodyTemplate
    ? applyTemplate(bodyTemplate, previewVenue.name, previewVenue.contact_name)
    : bodyTemplate;

  useEffect(() => {
    fetch("/api/artist-profile")
      .then((r) => r.json())
      .then((p: ArtistProfile) => {
        setProfile(p);
        setBodyTemplate(
          mode === "pitch"
            ? buildBodyTemplate(p)
            : buildFollowUpBodyTemplate(p)
        );
      })
      .catch(() => {
        setBodyTemplate(
          mode === "pitch"
            ? buildBodyTemplate(null)
            : buildFollowUpBodyTemplate(null)
        );
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSend() {
    setStep("sending");
    const sendResults: SendResult[] = [];

    for (let i = 0; i < venues.length; i++) {
      const venue = venues[i];
      setProgress(i);

      try {
        const subject   = applyTemplate(subjectTemplate, venue.name, venue.contact_name);
        const emailBody = applyTemplate(bodyTemplate,    venue.name, venue.contact_name);

        const res = await fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: venue.contact_email!,
            subject,
            body: emailBody,
            venue_id: venue.id,
            user_id: venue.user_id,
            interaction_type: mode === "followup" ? "follow_up" : "email",
          }),
        });

        const data = await res.json();
        sendResults.push({
          venueId: venue.id,
          venueName: venue.name,
          success: res.ok,
          error: res.ok ? undefined : (data.error ?? "Unknown error"),
        });
      } catch {
        sendResults.push({
          venueId: venue.id,
          venueName: venue.name,
          success: false,
          error: "Network error",
        });
      }

      // Small delay between sends to avoid Resend rate limits
      if (i < venues.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    setProgress(venues.length);
    setResults(sendResults);
    setStep("results");
  }

  const sentVenueIds = results.filter((r) => r.success).map((r) => r.venueId);
  const successCount = sentVenueIds.length;
  const failCount = results.length - successCount;

  const accentColor = mode === "pitch" ? "#d4a853" : "#9b7fe8";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="w-full max-w-lg rounded-xl flex flex-col max-h-[90vh]"
        style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          <h2 className="text-base font-semibold" style={{ color: "#f0ede8" }}>
            {mode === "pitch" ? "Send Batch Pitch" : "Send Follow-up"} — {venues.length} venue{venues.length !== 1 ? "s" : ""}
          </h2>
          {step !== "sending" && (
            <button
              onClick={onClose}
              style={{ color: "#9a9591", fontSize: "1.25rem", lineHeight: 1 }}
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>

        {/* Confirm step */}
        {step === "confirm" && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

              {/* Venue list */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5e5c58" }}>
                  Sending to {venues.length} venue{venues.length !== 1 ? "s" : ""}
                </p>
                <div className="space-y-1 max-h-24 overflow-y-auto">
                  {venues.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between text-xs px-2 py-1.5 rounded"
                      style={{ backgroundColor: "#1e2128", color: "#f0ede8" }}
                    >
                      <span>{v.name}</span>
                      <span style={{ color: "#5e5c58" }}>{v.contact_email}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Editable email */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#5e5c58" }}>
                    Edit your email
                  </p>
                  <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: "#1e2128", color: "#9a9591" }}>
                    <span style={{ color: accentColor }}>{"{{venue}}"}</span> and <span style={{ color: accentColor }}>{"{{contact}}"}</span> personalize per venue
                  </span>
                </div>

                {/* Subject */}
                <div className="mb-2">
                  <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Subject</label>
                  <input
                    type="text"
                    value={subjectTemplate}
                    onChange={(e) => setSubjectTemplate(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-xs outline-none"
                    style={{ backgroundColor: "#1e2128", color: "#f0ede8", border: "1px solid rgba(255,255,255,0.08)" }}
                  />
                </div>

                {/* Body */}
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Body</label>
                  <textarea
                    value={bodyTemplate}
                    onChange={(e) => setBodyTemplate(e.target.value)}
                    rows={10}
                    className="w-full rounded-lg px-3 py-2 text-xs outline-none resize-none"
                    style={{
                      backgroundColor: "#1e2128",
                      color: "#f0ede8",
                      border: "1px solid rgba(255,255,255,0.08)",
                      lineHeight: 1.6,
                      fontFamily: "inherit",
                    }}
                  />
                </div>
              </div>

              {/* Live preview for first venue */}
              {previewVenue && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5e5c58" }}>
                    Preview — {previewVenue.name}
                  </p>
                  <div
                    className="rounded-lg px-4 py-3 space-y-2"
                    style={{ backgroundColor: "#0e0f11", border: "1px solid rgba(255,255,255,0.05)" }}
                  >
                    <p className="text-xs" style={{ color: "#9a9591" }}>
                      Subject: <span style={{ color: "#f0ede8" }}>{previewSubject}</span>
                    </p>
                    <pre
                      className="text-xs whitespace-pre-wrap max-h-32 overflow-y-auto"
                      style={{ color: "#9a9591", fontFamily: "inherit", lineHeight: 1.6 }}
                    >
                      {previewBody}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            <div
              className="flex items-center justify-end gap-3 px-6 py-4 shrink-0"
              style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
            >
              <button
                onClick={onClose}
                className="text-sm px-4 py-2 rounded-lg"
                style={{ color: "#9a9591" }}
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={!bodyTemplate.trim()}
                className="text-sm px-4 py-2 rounded-lg font-semibold transition-all hover:brightness-110 disabled:opacity-40"
                style={{ backgroundColor: accentColor, color: "#0e0f11" }}
              >
                Send to {venues.length} venue{venues.length !== 1 ? "s" : ""} →
              </button>
            </div>
          </>
        )}

        {/* Sending step */}
        {step === "sending" && (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 gap-4">
            <div
              className="w-full rounded-full overflow-hidden"
              style={{ backgroundColor: "#262b33", height: "4px" }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${venues.length > 0 ? Math.round((progress / venues.length) * 100) : 0}%`,
                  backgroundColor: accentColor,
                }}
              />
            </div>
            <p className="text-sm" style={{ color: "#9a9591" }}>
              Sending {Math.min(progress + 1, venues.length)} of {venues.length}…
            </p>
          </div>
        )}

        {/* Results step */}
        {step === "results" && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
                  style={{
                    backgroundColor:
                      successCount > 0
                        ? "rgba(76,175,125,0.15)"
                        : "rgba(226,92,92,0.15)",
                  }}
                >
                  {successCount > 0 ? "✓" : "✗"}
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: "#f0ede8" }}>
                    {successCount} of {results.length} sent successfully
                  </p>
                  {failCount > 0 && (
                    <p className="text-xs mt-0.5" style={{ color: "#e25c5c" }}>
                      {failCount} failed — open each venue to retry
                    </p>
                  )}
                </div>
              </div>

              {failCount > 0 && (
                <div className="space-y-1">
                  {results
                    .filter((r) => !r.success)
                    .map((r) => (
                      <div
                        key={r.venueId}
                        className="text-xs px-3 py-2 rounded"
                        style={{
                          backgroundColor: "rgba(226,92,92,0.08)",
                          color: "#e25c5c",
                          border: "1px solid rgba(226,92,92,0.2)",
                        }}
                      >
                        {r.venueName}: {r.error}
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div
              className="flex justify-end px-6 py-4 shrink-0"
              style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}
            >
              <button
                onClick={() => onComplete(results, sentVenueIds)}
                className="text-sm px-4 py-2 rounded-lg font-semibold transition-all hover:brightness-110"
                style={{ backgroundColor: accentColor, color: "#0e0f11" }}
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
