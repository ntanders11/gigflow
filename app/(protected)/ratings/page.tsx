// app/(protected)/ratings/page.tsx
"use client";

import { useState, useEffect } from "react";
import { PendingRating, RatingView } from "@/types";

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className="text-xl leading-none"
          style={{ color: n <= value ? "#D4A64F" : "#5e5c58" }}
        >
          {n <= value ? "★" : "☆"}
        </button>
      ))}
    </div>
  );
}

function PendingRow({ item, onSubmitted }: { item: PendingRating; onSubmitted: () => void }) {
  const [stars, setStars] = useState(0);
  const [review, setReview] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (stars < 1) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue_profile_id: item.venue_profile_id,
        stars,
        review: review.trim() || undefined,
        qualifying_gig_id: item.qualifying_gig_id,
      }),
    });
    setSaving(false);
    if (res.ok) {
      onSubmitted();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't submit — please try again.");
    }
  }

  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex items-center gap-3 mb-3">
        {item.counterpart_photo_url ? (
          <img src={item.counterpart_photo_url} alt={item.counterpart_name} className="w-9 h-9 rounded-full object-cover" />
        ) : (
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
            style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}>
            {item.counterpart_name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <div className="text-sm font-semibold" style={{ color: "#F4E8D2" }}>{item.counterpart_name}</div>
          <div className="text-xs" style={{ color: "#5e5c58" }}>Gig on {item.qualifying_gig_date}</div>
        </div>
      </div>
      <StarPicker value={stars} onChange={setStars} />
      <textarea
        rows={2}
        placeholder="Optional review"
        value={review}
        onChange={(e) => setReview(e.target.value)}
        className="w-full mt-2 rounded-lg px-3 py-2 text-sm outline-none resize-none"
        style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.07)", color: "#F4E8D2" }}
      />
      {error && <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>{error}</p>}
      <button
        onClick={submit}
        disabled={stars < 1 || saving}
        className="mt-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
        style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: stars < 1 || saving ? 0.6 : 1 }}
      >
        {saving ? "Submitting…" : "Submit Rating"}
      </button>
    </div>
  );
}

function GivenRow({ rating, onUpdated }: { rating: RatingView; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [stars, setStars] = useState(rating.my_stars);
  const [review, setReview] = useState(rating.my_review ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reported, setReported] = useState(false);
  const [reportError, setReportError] = useState("");

  async function saveEdit() {
    if (stars < 1) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue_profile_id: rating.venue_profile_id,
        stars,
        review: review.trim() || undefined,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      onUpdated();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Couldn't save — please try again.");
    }
  }

  async function submitReport() {
    setReportSubmitting(true);
    setReportError("");
    const res = await fetch(`/api/ratings/${rating.id}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reportReason.trim() || undefined }),
    });
    setReportSubmitting(false);
    if (res.ok) {
      setReported(true);
      setReporting(false);
    } else {
      const data = await res.json().catch(() => ({}));
      setReportError(data.error ?? "Couldn't submit report — please try again.");
    }
  }

  return (
    <div className="rounded-xl p-4" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="text-sm font-semibold mb-1" style={{ color: "#F4E8D2" }}>{rating.counterpart_name}</div>

      {editing ? (
        <>
          <StarPicker value={stars} onChange={setStars} />
          <textarea
            rows={2}
            placeholder="Optional review"
            value={review}
            onChange={(e) => setReview(e.target.value)}
            className="w-full mt-2 rounded-lg px-3 py-2 text-sm outline-none resize-none"
            style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.07)", color: "#F4E8D2" }}
          />
          {error && <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>{error}</p>}
          <div className="flex gap-2 mt-2">
            <button
              onClick={saveEdit}
              disabled={stars < 1 || saving}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
              style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: stars < 1 || saving ? 0.6 : 1 }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => { setEditing(false); setStars(rating.my_stars); setReview(rating.my_review ?? ""); setError(""); }}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold"
              style={{ color: "#9a9591" }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs" style={{ color: "#D4A64F" }}>
            Your rating: {"★".repeat(rating.my_stars)}{"☆".repeat(5 - rating.my_stars)}
          </p>
          {rating.revealed ? (
            <p className="text-xs mt-1" style={{ color: "#9a9591" }}>
              Their rating: {"★".repeat(rating.their_stars ?? 0)}{"☆".repeat(5 - (rating.their_stars ?? 0))}
            </p>
          ) : (
            <p className="text-xs mt-1" style={{ color: "#5e5c58" }}>Awaiting their response</p>
          )}
          <div className="flex gap-3 mt-2">
            <button onClick={() => setEditing(true)} className="text-xs" style={{ color: "#5b9bd5" }}>
              Edit
            </button>
            {rating.revealed && !reported && (
              <button onClick={() => setReporting(true)} className="text-xs" style={{ color: "#e25c5c" }}>
                Report
              </button>
            )}
            {reported && <span className="text-xs" style={{ color: "#5e5c58" }}>Reported</span>}
          </div>
          {reporting && (
            <div className="mt-2">
              <textarea
                rows={2}
                placeholder="Optional reason"
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none"
                style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.07)", color: "#F4E8D2" }}
              />
              {reportError && <p className="text-xs mt-1" style={{ color: "#e25c5c" }}>{reportError}</p>}
              <div className="flex gap-2 mt-2">
                <button
                  onClick={submitReport}
                  disabled={reportSubmitting}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
                  style={{ backgroundColor: "#e25c5c", color: "#fff", opacity: reportSubmitting ? 0.6 : 1 }}
                >
                  {reportSubmitting ? "Submitting…" : "Submit Report"}
                </button>
                <button onClick={() => { setReporting(false); setReportReason(""); setReportError(""); }} className="px-4 py-1.5 rounded-lg text-xs font-semibold" style={{ color: "#9a9591" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function RatingsPage() {
  const [pending, setPending] = useState<PendingRating[]>([]);
  const [given, setGiven] = useState<RatingView[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [pendingRes, givenRes] = await Promise.all([
      fetch("/api/ratings/pending").then((r) => (r.ok ? r.json() : { pending: [] })),
      fetch("/api/ratings").then((r) => (r.ok ? r.json() : { ratings: [] })),
    ]);
    setPending(pendingRes.pending ?? []);
    setGiven(givenRes.ratings ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  if (loading) return null;

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <h1 className="text-xl font-bold mb-6" style={{ color: "#F4E8D2" }}>Ratings</h1>

      <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5e5c58" }}>
        Awaiting your rating {pending.length > 0 && `(${pending.length})`}
      </h2>
      {pending.length === 0 ? (
        <p className="text-sm mb-8" style={{ color: "#5e5c58" }}>Nothing to rate right now.</p>
      ) : (
        <div className="space-y-3 mb-8">
          {pending.map((item) => (
            <PendingRow key={item.venue_profile_id} item={item} onSubmitted={load} />
          ))}
        </div>
      )}

      <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5e5c58" }}>
        Ratings you&apos;ve given
      </h2>
      {given.length === 0 ? (
        <p className="text-sm" style={{ color: "#5e5c58" }}>You haven&apos;t rated anyone yet.</p>
      ) : (
        <div className="space-y-3">
          {given.map((r) => (
            <GivenRow key={r.id} rating={r} onUpdated={load} />
          ))}
        </div>
      )}
    </div>
  );
}
