"use client";

import { useState } from "react";

type Photo = { id: string; file_name: string; url: string; download_url: string };

// Shown under an ACCEPTED booking on the venue's Calendar page. Loads only
// when opened, and only works while the venue has an accepted booking with
// the artist (the server enforces that — a 403 shows as a plain message).
export default function PromoPhotosForVenue({ artistUserId, artistName }: { artistUserId: string; artistName: string }) {
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && photos === null) {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/venue/artists/${artistUserId}/promo-photos`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        setPhotos(data.photos ?? []);
      } catch {
        setError("Couldn't load the photos — please try again.");
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="mt-2">
      <button
        onClick={toggle}
        className="text-xs font-medium transition-all hover:brightness-125"
        style={{ color: "#D4A64F" }}
      >
        {open ? "▾" : "▸"} Promo photos from {artistName}
      </button>
      {open && (
        <div className="mt-2 rounded-xl p-4" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
          {loading && <p className="text-xs" style={{ color: "#5e5c58" }}>Loading…</p>}
          {error && <p className="text-xs" style={{ color: "#e25c5c" }}>{error}</p>}
          {photos && photos.length === 0 && (
            <p className="text-xs" style={{ color: "#9a9591" }}>
              {artistName} hasn&apos;t added any promo photos yet.
            </p>
          )}
          {photos && photos.length > 0 && (
            <>
              <p className="text-xs mb-3" style={{ color: "#9a9591", lineHeight: 1.6 }}>
                {artistName} shared these so you can promote your show together. Tap Download to save a full-size copy.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {photos.map((p) => (
                  <div key={p.id}>
                    <div className="aspect-square rounded-lg overflow-hidden" style={{ backgroundColor: "#1e2128" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL, not optimizable by next/image */}
                      <img src={p.url} alt={p.file_name} loading="lazy" className="w-full h-full object-cover" />
                    </div>
                    <a
                      href={p.download_url}
                      download
                      className="block text-center text-xs mt-1.5 py-1.5 rounded-lg transition-all hover:brightness-125"
                      style={{ backgroundColor: "rgba(212,166,79,0.12)", color: "#D4A64F", border: "1px solid rgba(212,166,79,0.25)" }}
                    >
                      Download
                    </a>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
