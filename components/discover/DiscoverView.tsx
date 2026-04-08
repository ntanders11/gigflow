"use client";

import { useState } from "react";

const VENUE_TYPES = [
  { key: "bar",        label: "Bars & Pubs",    color: "#d4a853" },
  { key: "restaurant", label: "Restaurants",     color: "#4caf7d" },
  { key: "winery",     label: "Wineries",        color: "#c06080" },
  { key: "brewery",    label: "Breweries",       color: "#e09b50" },
  { key: "cafe",       label: "Cafés",           color: "#5b9bd5" },
  { key: "hotel",      label: "Hotels",          color: "#9b7fe8" },
  { key: "club",       label: "Clubs",           color: "#e25c5c" },
  { key: "venue",      label: "Event Venues",    color: "#9a9591" },
];

type DiscoverResult = {
  osm_id: string;
  name: string;
  type: string;
  city: string | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  already_in_pipeline: boolean;
};

export default function DiscoverView() {
  const [city, setCity]       = useState("Newberg, OR");
  const [radius, setRadius]   = useState(15);
  const [types, setTypes]     = useState<Set<string>>(new Set(VENUE_TYPES.map((t) => t.key)));
  const [results, setResults] = useState<DiscoverResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [searched, setSearched] = useState(false);
  const [adding, setAdding]   = useState<Set<string>>(new Set());
  const [added, setAdded]     = useState<Set<string>>(new Set());

  function toggleType(key: string) {
    setTypes((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function handleSearch() {
    if (!city.trim()) return;
    if (types.size === 0) { setError("Select at least one venue type."); return; }
    setLoading(true);
    setError("");
    setSearched(false);

    const params = new URLSearchParams({
      city: city.trim(),
      radius: String(radius),
      types: Array.from(types).join(","),
    });

    const res = await fetch(`/api/venues/discover?${params}`);
    const data = await res.json();
    setLoading(false);
    setSearched(true);

    if (!res.ok) { setError(data.error ?? "Search failed"); return; }
    setResults(data.results ?? []);
  }

  async function handleAdd(venue: DiscoverResult) {
    setAdding((prev) => new Set(prev).add(venue.osm_id));
    const res = await fetch("/api/venues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: venue.name,
        type: venue.type,
        city: venue.city,
        address: venue.address,
        website: venue.website,
        phone: venue.phone,
        stage: "discovered",
      }),
    });
    setAdding((prev) => { const n = new Set(prev); n.delete(venue.osm_id); return n; });
    if (res.ok) {
      setAdded((prev) => new Set(prev).add(venue.osm_id));
      setResults((prev) =>
        prev.map((r) => r.osm_id === venue.osm_id ? { ...r, already_in_pipeline: true } : r)
      );
    }
  }

  const typeColor = (type: string) => VENUE_TYPES.find((t) => t.key === type)?.color ?? "#9a9591";
  const typeLabel = (type: string) => VENUE_TYPES.find((t) => t.key === type)?.label.replace(/s$/, "").replace(/ies$/, "y") ?? type;

  const filtered = results.filter((r) => types.has(r.type) || !VENUE_TYPES.find((t) => t.key === r.type));
  const newVenues = filtered.filter((r) => !r.already_in_pipeline);
  const inPipeline = filtered.filter((r) => r.already_in_pipeline);

  return (
    <div>
      {/* Search controls */}
      <div
        className="rounded-xl p-5 mb-6"
        style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className="flex gap-3 mb-5">
          <div className="flex-1">
            <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5e5c58" }}>
              Location
            </label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="City, state or zip code"
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
              style={{ backgroundColor: "#1e2128", color: "#f0ede8", border: "1px solid rgba(255,255,255,0.1)" }}
            />
          </div>
          <div style={{ width: "130px" }}>
            <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5e5c58" }}>
              Radius: {radius} mi
            </label>
            <input
              type="range"
              min={2}
              max={50}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="w-full mt-1"
              style={{ accentColor: "#d4a853", marginTop: "10px" }}
            />
          </div>
        </div>

        {/* Type toggles */}
        <div className="mb-5">
          <label className="block text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#5e5c58" }}>
            Venue Types
          </label>
          <div className="flex flex-wrap gap-2">
            {VENUE_TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => toggleType(t.key)}
                className="px-3 py-1 rounded-full text-xs font-medium transition-all"
                style={{
                  backgroundColor: types.has(t.key) ? `${t.color}22` : "#1e2128",
                  color: types.has(t.key) ? t.color : "#5e5c58",
                  border: `1px solid ${types.has(t.key) ? t.color + "55" : "rgba(255,255,255,0.07)"}`,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
          style={{ backgroundColor: "#d4a853", color: "#0e0f11", opacity: loading ? 0.7 : 1 }}
        >
          {loading ? "Searching…" : "Search Venues"}
        </button>

        {error && <p className="mt-3 text-sm" style={{ color: "#e25c5c" }}>{error}</p>}
      </div>

      {/* Results */}
      {loading && (
        <div className="text-center py-16">
          <p className="text-sm" style={{ color: "#5e5c58" }}>Searching OpenStreetMap…</p>
        </div>
      )}

      {searched && !loading && (
        <>
          {newVenues.length === 0 && inPipeline.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm font-medium mb-1" style={{ color: "#5e5c58" }}>No venues found</p>
              <p className="text-xs" style={{ color: "#5e5c58" }}>Try a larger radius or different venue types.</p>
            </div>
          ) : (
            <>
              {newVenues.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#9a9591" }}>
                    {newVenues.length} venue{newVenues.length !== 1 ? "s" : ""} found
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    {newVenues.map((venue) => {
                      const isAdding = adding.has(venue.osm_id);
                      const isAdded  = added.has(venue.osm_id);
                      const color    = typeColor(venue.type);
                      return (
                        <div
                          key={venue.osm_id}
                          className="rounded-xl p-4 flex flex-col gap-2"
                          style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold leading-snug" style={{ color: "#f0ede8" }}>
                              {venue.name}
                            </p>
                            <span
                              className="text-xs px-2 py-0.5 rounded-full shrink-0"
                              style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}
                            >
                              {typeLabel(venue.type)}
                            </span>
                          </div>

                          {(venue.city || venue.address) && (
                            <p className="text-xs truncate" style={{ color: "#5e5c58" }}>
                              📍 {venue.address ?? venue.city}
                            </p>
                          )}

                          {venue.website && (
                            <a
                              href={venue.website.startsWith("http") ? venue.website : `https://${venue.website}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs truncate hover:brightness-125 transition-all"
                              style={{ color: "#5b9bd5" }}
                            >
                              {venue.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                            </a>
                          )}

                          <button
                            onClick={() => handleAdd(venue)}
                            disabled={isAdding || isAdded}
                            className="mt-1 w-full py-1.5 rounded-lg text-xs font-semibold transition-all hover:brightness-110"
                            style={{
                              backgroundColor: isAdded ? "rgba(76,175,125,0.15)" : "rgba(212,168,83,0.15)",
                              color: isAdded ? "#4caf7d" : "#d4a853",
                              border: `1px solid ${isAdded ? "#4caf7d44" : "#d4a85344"}`,
                              cursor: isAdded ? "default" : "pointer",
                            }}
                          >
                            {isAdding ? "Adding…" : isAdded ? "✓ Added to Pipeline" : "+ Add to Pipeline"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {inPipeline.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "#5e5c58" }}>
                    Already in your pipeline ({inPipeline.length})
                  </h3>
                  <div className="grid grid-cols-3 gap-3">
                    {inPipeline.map((venue) => (
                      <div
                        key={venue.osm_id}
                        className="rounded-xl p-4"
                        style={{ backgroundColor: "#13141700", border: "1px solid rgba(255,255,255,0.04)", opacity: 0.5 }}
                      >
                        <p className="text-sm font-medium" style={{ color: "#9a9591" }}>{venue.name}</p>
                        {venue.city && <p className="text-xs mt-0.5" style={{ color: "#5e5c58" }}>{venue.city}</p>}
                        <p className="text-xs mt-2" style={{ color: "#5e5c58" }}>✓ In pipeline</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
