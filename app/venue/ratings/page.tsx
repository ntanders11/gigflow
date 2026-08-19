// app/venue/ratings/page.tsx
"use client";

import { useState, useEffect } from "react";
import VenueNav from "@/components/venue/VenueNav";
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
    const res = await fetch("/api/venue/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artist_user_id: item.artist_user_id,
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

export default function VenueRatingsPage() {
  const [pending, setPending] = useState<PendingRating[]>([]);
  const [given, setGiven] = useState<RatingView[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [pendingRes, givenRes] = await Promise.all([
      fetch("/api/venue/ratings/pending").then((r) => (r.ok ? r.json() : { pending: [] })),
      fetch("/api/venue/ratings").then((r) => (r.ok ? r.json() : { ratings: [] })),
    ]);
    setPending(pendingRes.pending ?? []);
    setGiven(givenRes.ratings ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0E0E10" }}>
      <VenueNav />
      {!loading && (
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
                <PendingRow key={item.artist_user_id} item={item} onSubmitted={load} />
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
                <div key={r.id} className="rounded-xl p-4" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="text-sm font-semibold mb-1" style={{ color: "#F4E8D2" }}>{r.counterpart_name}</div>
                  <p className="text-xs" style={{ color: "#D4A64F" }}>
                    Your rating: {"★".repeat(r.my_stars)}{"☆".repeat(5 - r.my_stars)}
                  </p>
                  {r.revealed ? (
                    <p className="text-xs mt-1" style={{ color: "#9a9591" }}>
                      Their rating: {"★".repeat(r.their_stars ?? 0)}{"☆".repeat(5 - (r.their_stars ?? 0))}
                    </p>
                  ) : (
                    <p className="text-xs mt-1" style={{ color: "#5e5c58" }}>Awaiting their response</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
