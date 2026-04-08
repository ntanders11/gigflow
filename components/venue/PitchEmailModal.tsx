"use client";

import { useState, useEffect } from "react";
import { Venue, Interaction, ArtistProfile } from "@/types";

function buildSubject(venueName: string) {
  return `Live music inquiry for ${venueName} — full-band sound, one performer`;
}

function buildBody(venueName: string, profile: ArtistProfile | null, contactName?: string | null) {
  const greeting = contactName ? `Hi ${contactName},` : `Hi there,`;
  const name = profile?.display_name ?? "Taylor Anderson";
  const phone = profile?.phone ?? "(503) 997-3586";
  const website = profile?.social_links?.website ?? "taylorandersonmusic.com";
  const youtube = profile?.social_links?.youtube
    ?? profile?.video_samples?.[0]?.url
    ?? "https://youtu.be/JaPOuz1R0HI?si=lo5JhEbgowL2g5JU";
  const bio = profile?.bio?.trim()
    ? profile.bio.trim()
    : `For over a decade, I ran my own music business — booking and performing at resorts, wineries, and venues throughout the Scottsdale and Phoenix area. What makes my show unique: using a live looper, I build guitar, bass, keys, and drums on the spot — a full-band sound with just one performer. My sets blend Top 40, '60s–'00s classics, and a touch of country.`;

  return `${greeting}

I'm ${name} — a full-time musician with over a decade of live performance experience. I recently relocated to the Newberg area and would love to play at ${venueName}.

${bio}

Hear it for yourself: ${youtube}

I'm booking upcoming dates now and would love to find a time that works for ${venueName}. Would you be open to a quick call this week?

Thanks so much,
${name}
${phone}
${website}`;
}

interface Props {
  venue: Venue;
  onClose: () => void;
  onSuccess: (interaction: Interaction) => void;
}

export default function PitchEmailModal({ venue, onClose, onSuccess }: Props) {
  const [profile, setProfile] = useState<ArtistProfile | null>(null);
  const [to, setTo] = useState(venue.contact_email ?? "");
  const [subject, setSubject] = useState(buildSubject(venue.name));
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Load artist profile and build email body from it
  useEffect(() => {
    fetch("/api/artist-profile")
      .then((r) => r.json())
      .then((p: ArtistProfile) => {
        setProfile(p);
        setBody(buildBody(venue.name, p, venue.contact_name));
      })
      .catch(() => {
        setBody(buildBody(venue.name, null, venue.contact_name));
      });
  }, [venue.name, venue.contact_name]);

  async function handleSend() {
    if (!to.trim()) {
      setErrorMessage("Please enter a recipient email address.");
      setStatus("error");
      return;
    }

    setSending(true);
    setStatus("idle");
    setErrorMessage("");

    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: to.trim(),
          subject: subject.trim(),
          body: body.trim(),
          venue_id: venue.id,
          user_id: venue.user_id,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error ?? "Failed to send email.");
        setStatus("error");
      } else {
        setStatus("success");
        if (data.interaction) {
          onSuccess(data.interaction as Interaction);
        }
      }
    } catch {
      setErrorMessage("An unexpected error occurred.");
      setStatus("error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="text-base font-semibold text-slate-900">Send Pitch Email</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {status === "success" ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-12">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-slate-700 font-medium">Email sent successfully!</p>
            <p className="text-sm text-slate-500">The interaction has been logged to this venue.</p>
            <button
              onClick={onClose}
              className="mt-2 text-sm bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-700 transition-colors"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Form */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
                <input
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="venue@example.com"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Message</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none"
                />
              </div>

              {status === "error" && errorMessage && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {errorMessage}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
              <button
                onClick={onClose}
                disabled={sending}
                className="text-sm text-slate-600 px-4 py-2 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending}
                className="text-sm bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {sending ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Sending...
                  </>
                ) : (
                  "Send Email"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
