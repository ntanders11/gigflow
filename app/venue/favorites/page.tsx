"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import VenueNav from "@/components/venue/VenueNav";
import FavoriteButton from "@/components/venue/FavoriteButton";
import { ArtistResult } from "@/lib/venues/artist-results";

function FavoriteCard({ artist, onRemoved }: { artist: ArtistResult; onRemoved: (id: string) => void }) {
  return (
    <Link
      href={`/profile/${artist.user_id}`}
      className="relative rounded-xl p-4 flex items-center gap-3 transition-all hover:brightness-110"
      style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div className="absolute top-2 right-2">
        <FavoriteButton
          artistUserId={artist.user_id}
          initialFavorited={true}
          stopClickPropagation
          size={16}
          onToggle={(favorited) => { if (!favorited) onRemoved(artist.user_id); }}
        />
      </div>
      {artist.photo_url ? (
        <img src={artist.photo_url} alt={artist.display_name} className="w-11 h-11 rounded-full object-cover shrink-0" />
      ) : (
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-base font-bold shrink-0"
          style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}
        >
          {artist.display_name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 pr-6">
        <div className="text-sm font-semibold truncate" style={{ color: "#F4E8D2" }}>{artist.display_name}</div>
        <div className="text-xs truncate" style={{ color: "#9a9591" }}>{artist.genres.join(" · ") || "—"}</div>
        {artist.rating_count > 0 && (
          <div className="text-xs mt-0.5" style={{ color: "#D4A64F" }}>
            {"★".repeat(Math.round(artist.avg_rating ?? 0))}{"☆".repeat(5 - Math.round(artist.avg_rating ?? 0))}{" "}
            {artist.avg_rating?.toFixed(1)} ({artist.rating_count})
          </div>
        )}
      </div>
    </Link>
  );
}

export default function VenueFavoritesPage() {
  const [favorites, setFavorites] = useState<ArtistResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/venue/favorites")
      .then((r) => (r.ok ? r.json() : { favorites: [] }))
      .then((data) => setFavorites(data.favorites ?? []))
      .finally(() => setLoading(false));
  }, []);

  function handleRemoved(artistUserId: string) {
    setFavorites((prev) => prev.filter((a) => a.user_id !== artistUserId));
  }

  return (
    <>
      <VenueNav />
      <div className="min-h-screen" style={{ backgroundColor: "#0E0E10" }}>
        <div className="max-w-4xl mx-auto px-6 py-10">
          <h1 className="text-2xl font-bold mb-6" style={{ color: "#F4E8D2" }}>My Favorites</h1>

          {loading ? (
            <div className="text-center py-16">
              <p className="text-sm" style={{ color: "#5e5c58" }}>Loading…</p>
            </div>
          ) : favorites.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm font-medium mb-2" style={{ color: "#5e5c58" }}>No favorites yet.</p>
              <p className="text-sm">
                <Link href="/venue/discover" style={{ color: "#D4A64F" }}>Discover Artists →</Link>
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {favorites.map((a) => (
                <FavoriteCard key={a.user_id} artist={a} onRemoved={handleRemoved} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
