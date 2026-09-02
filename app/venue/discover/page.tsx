"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import VenueNav from "@/components/venue/VenueNav";
import FavoriteButton from "@/components/venue/FavoriteButton";
import { ArtistResult } from "@/lib/venues/artist-results";

const inputStyle = {
  background: "#1e2128",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#F4E8D2",
};

function ArtistCard({ artist, onUnfavorited }: { artist: ArtistResult; onUnfavorited?: (userId: string) => void }) {
  return (
    <Link
      href={`/profile/${artist.user_id}`}
      className="relative rounded-xl p-4 flex items-center gap-3 transition-all hover:brightness-110"
      style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div className="absolute top-2 right-2">
        <FavoriteButton
          artistUserId={artist.user_id}
          initialFavorited={artist.favorited}
          stopClickPropagation
          size={16}
          onToggle={onUnfavorited ? (favorited) => { if (!favorited) onUnfavorited(artist.user_id); } : undefined}
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

export default function VenueDiscoverPage() {
  const [city, setCity] = useState("");
  const [radius, setRadius] = useState(30);
  const [matchingGenre, setMatchingGenre] = useState<ArtistResult[]>([]);
  const [other, setOther] = useState<ArtistResult[]>([]);
  const [venueHasGenres, setVenueHasGenres] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [favorites, setFavorites] = useState<ArtistResult[]>([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);

  // Loads quietly in the background on mount, same as the notification
  // bell's own unread count does on every page — this is the venue's own
  // saved list, not a paid external search, so there's no "why did it
  // search without me asking" concern the location-field auto-search had.
  useEffect(() => {
    fetch("/api/venue/favorites")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setFavorites(data?.favorites ?? []))
      .catch(() => {})
      .finally(() => setFavoritesLoaded(true));
  }, []);

  function handleUnfavorited(artistUserId: string) {
    setFavorites((prev) => prev.filter((a) => a.user_id !== artistUserId));
  }

  // Accepts either a typed city/zip or coordinates straight from the
  // browser's own geolocation (see handleUseLocation below) — mirrors the
  // artist-side Discover Venues page (components/discover/DiscoverView.tsx).
  const runSearch = useCallback(async (searchCity: string, searchRadius: number, searchCoords: { lat: number; lon: number } | null) => {
    if (!searchCoords && !searchCity.trim()) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ radius: String(searchRadius) });
      if (searchCoords) {
        params.set("lat", String(searchCoords.lat));
        params.set("lon", String(searchCoords.lon));
      } else {
        params.set("city", searchCity.trim());
      }
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

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    runSearch(city, radius, coords);
  }

  // Same pattern as the artist side's "Use my current location" — an
  // explicit click + browser permission grant, so searching immediately on
  // success is the point of the button, not a surprise auto-search.
  function handleUseLocation() {
    if (!navigator.geolocation) {
      setError("Your browser doesn't support location lookup — try typing a city or zip instead.");
      return;
    }
    setLocating(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setLocating(false);
        setCoords(c);
        setCity("Current location");
        runSearch("", radius, c);
      },
      (err) => {
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location access was denied — you can still search by typing a city or zip code."
            : "Couldn't get your location — try typing a city or zip code instead."
        );
      },
      { timeout: 10000 }
    );
  }

  const combined = venueHasGenres ? null : [...matchingGenre, ...other];

  return (
    <>
      <VenueNav />
      <div className="min-h-screen pb-28 md:pb-0" style={{ backgroundColor: "#0E0E10" }}>
        <div className="max-w-4xl mx-auto px-6 py-10">
          <h1 className="text-2xl font-bold mb-6" style={{ color: "#F4E8D2" }}>Discover Artists</h1>

          {/* Favorites — replaced the standalone "Favorites" nav tab/page;
              everything lives here now, one tap from search. */}
          <div className="mb-6">
            <button
              type="button"
              onClick={() => setFavoritesOpen((o) => !o)}
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-lg transition-all hover:brightness-110"
              style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)", color: "#D4A64F" }}
            >
              ★ Favorites{favoritesLoaded ? ` (${favorites.length})` : ""}
              <span style={{ fontSize: "10px", color: "#9a9591" }}>{favoritesOpen ? "▲" : "▼"}</span>
            </button>

            {favoritesOpen && (
              <div className="mt-3 rounded-xl p-4" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
                {!favoritesLoaded ? (
                  <p className="text-sm text-center py-4" style={{ color: "#5e5c58" }}>Loading…</p>
                ) : favorites.length === 0 ? (
                  <p className="text-sm text-center py-4" style={{ color: "#5e5c58" }}>
                    No favorites yet — tap the heart on any artist below to save them here.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {favorites.map((a) => (
                      <ArtistCard key={a.user_id} artist={a} onUnfavorited={handleUnfavorited} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <form onSubmit={handleSearch} className="rounded-xl p-5 mb-6" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex gap-3 mb-4">
              <div className="flex-1">
                <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5e5c58" }}>Location</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => { setCity(e.target.value); setCoords(null); }}
                  placeholder="Look up a zip code or city name"
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={handleUseLocation}
                  disabled={locating}
                  className="mt-2 text-xs font-medium transition-all hover:brightness-125 disabled:opacity-50"
                  style={{ color: "#D4A64F" }}
                >
                  {locating ? "Getting your location…" : "📍 Use my current location"}
                </button>
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
