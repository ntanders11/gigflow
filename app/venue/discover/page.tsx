"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import VenueNav from "@/components/venue/VenueNav";

type ArtistResult = {
  user_id: string;
  display_name: string;
  genres: string[];
  photo_url: string | null;
  avg_rating: number | null;
  rating_count: number;
};

const inputStyle = {
  background: "#1e2128",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#F4E8D2",
};

function ArtistCard({ artist }: { artist: ArtistResult }) {
  return (
    <Link
      href={`/profile/${artist.user_id}`}
      className="rounded-xl p-4 flex items-center gap-3 transition-all hover:brightness-110"
      style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
    >
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
      <div className="min-w-0">
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

export default function VenueDiscoverPage() {
  const [city, setCity] = useState("");
  const [radius, setRadius] = useState(30);
  const [matchingGenre, setMatchingGenre] = useState<ArtistResult[]>([]);
  const [other, setOther] = useState<ArtistResult[]>([]);
  const [venueHasGenres, setVenueHasGenres] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  const runSearch = useCallback(async (searchCity: string, searchRadius: number) => {
    if (!searchCity.trim()) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ city: searchCity.trim(), radius: String(searchRadius) });
      const res = await fetch(`/api/venues/discover-artists?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't search right now — please try again.");
        return;
      }
      const data = await res.json();
      setMatchingGenre(data.matchingGenre ?? []);
      setOther(data.other ?? []);
      setVenueHasGenres(!!data.venueHasGenres);
      setSearched(true);
    } catch {
      setError("Couldn't search right now — please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-search on mount using the venue's own city, same pattern the
  // artist-side Discover Venues page already uses with the artist's home
  // zone.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/venue-profile");
        if (res.ok) {
          const profile = await res.json();
          if (profile?.city) {
            setCity(profile.city);
            runSearch(profile.city, 30);
          }
        }
      } catch {
        // No connectivity to check — venue can still search manually.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    runSearch(city, radius);
  }

  const combined = venueHasGenres ? null : [...matchingGenre, ...other];

  return (
    <>
      <VenueNav />
      <div className="min-h-screen" style={{ backgroundColor: "#0E0E10" }}>
        <div className="max-w-4xl mx-auto px-6 py-10">
          <h1 className="text-2xl font-bold mb-6" style={{ color: "#F4E8D2" }}>Discover Artists</h1>

          <form onSubmit={handleSearch} className="rounded-xl p-5 mb-6" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex gap-3 mb-4">
              <div className="flex-1">
                <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5e5c58" }}>Location</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="City, state or zip code"
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={inputStyle}
                />
              </div>
              <div style={{ width: "130px" }}>
                <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5e5c58" }}>Radius: {radius} mi</label>
                <input
                  type="range"
                  min={2}
                  max={50}
                  value={radius}
                  onChange={(e) => setRadius(Number(e.target.value))}
                  className="w-full mt-1"
                  style={{ accentColor: "#D4A64F", marginTop: "10px" }}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
              style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: loading ? 0.7 : 1 }}
            >
              {loading ? "Searching…" : "Search Artists"}
            </button>
            {error && <p className="mt-3 text-sm" style={{ color: "#e25c5c" }}>{error}</p>}
          </form>

          {loading && (
            <div className="text-center py-16">
              <p className="text-sm" style={{ color: "#5e5c58" }}>Searching for artists…</p>
            </div>
          )}

          {searched && !loading && (
            <>
              {matchingGenre.length === 0 && other.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-sm font-medium" style={{ color: "#5e5c58" }}>No artists found in this area yet.</p>
                </div>
              ) : combined ? (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#9a9591" }}>
                    Artists in your area
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {combined.map((a) => <ArtistCard key={a.user_id} artist={a} />)}
                  </div>
                </div>
              ) : (
                <>
                  {matchingGenre.length > 0 && (
                    <div className="mb-8">
                      <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#9a9591" }}>
                        Matches your genres
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {matchingGenre.map((a) => <ArtistCard key={a.user_id} artist={a} />)}
                      </div>
                    </div>
                  )}
                  {other.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5e5c58" }}>
                        Other artists nearby
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {other.map((a) => <ArtistCard key={a.user_id} artist={a} />)}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
