"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Venue, VenueStage, STAGES } from "@/types";
import AddVenueModal from "@/components/venue/AddVenueModal";
import PitchEmailModal from "@/components/venue/PitchEmailModal";

const KanbanBoard = dynamic(() => import("./KanbanBoard"), { ssr: false });

interface Props {
  initialVenues: Venue[];
  initialStageFilter: VenueStage | null;
  outreachMap: Record<string, { count: number; lastDate: string | null }>;
}

export default function PipelineView({ initialVenues, initialStageFilter, outreachMap }: Props) {
  const [venues, setVenues] = useState<Venue[]>(initialVenues);
  const [query, setQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [emailVenue, setEmailVenue] = useState<Venue | null>(null);
  const [fillProgress, setFillProgress] = useState<{ done: number; total: number; found: number } | null>(null);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number; found: number } | null>(null);
  const router = useRouter();

  async function fillMissingAddresses() {
    const missing = venues.filter((v) => !v.address?.trim());
    if (missing.length === 0) return;

    setFillProgress({ done: 0, total: missing.length, found: 0 });

    let found = 0;
    for (let i = 0; i < missing.length; i++) {
      const v = missing[i];
      try {
        const params = new URLSearchParams({ name: v.name });
        if (v.city) params.append("city", v.city);
        const res = await fetch(`/api/venues/lookup-address?${params}`);
        const data = await res.json();
        if (data.address) {
          found++;
          await fetch(`/api/venues/${v.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: data.address }),
          });
          setVenues((prev) =>
            prev.map((venue) => venue.id === v.id ? { ...venue, address: data.address } : venue)
          );
        }
      } catch { /* skip on error */ }
      setFillProgress({ done: i + 1, total: missing.length, found });
      // Small delay to be kind to the API
      if (i < missing.length - 1) await new Promise((r) => setTimeout(r, 120));
    }

    // Auto-dismiss after 4s
    setTimeout(() => setFillProgress(null), 4000);
  }

  async function enrichDiscoveredVenues() {
    // Target: discovered venues missing email (with or without address)
    const targets = venues.filter(
      (v) => v.stage === "discovered" && !v.contact_email?.trim()
    );
    if (targets.length === 0) return;

    setEnrichProgress({ done: 0, total: targets.length, found: 0 });
    let found = 0;

    for (let i = 0; i < targets.length; i++) {
      const v = targets[i];
      try {
        const params = new URLSearchParams({ name: v.name });
        if (v.city) params.append("city", v.city);
        if (v.website) params.append("website", v.website);

        const res = await fetch(`/api/venues/enrich?${params}`);
        const data = await res.json();

        const patch: Record<string, string | null> = {};
        if (data.email)   patch.contact_email = data.email;
        if (data.phone && !v.contact_phone) patch.contact_phone = data.phone;
        if (data.website && !v.website)     patch.website = data.website;
        if (data.address && !v.address)     patch.address = data.address;

        if (Object.keys(patch).length > 0) {
          found++;
          await fetch(`/api/venues/${v.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
          });
          setVenues((prev) =>
            prev.map((venue) => venue.id === v.id ? { ...venue, ...patch } : venue)
          );
        }
      } catch { /* skip */ }

      setEnrichProgress({ done: i + 1, total: targets.length, found });
      if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 200));
    }

    setTimeout(() => setEnrichProgress(null), 5000);
  }

  const filtered = venues.filter((v) => {
    const matchesStage = initialStageFilter ? v.stage === initialStageFilter : true;
    const matchesQuery = query.trim()
      ? [v.name, v.city, v.type, v.contact_name]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(query.toLowerCase()))
      : true;
    return matchesStage && matchesQuery;
  });

  const stageCounts = STAGES.reduce(
    (acc, { key }) => {
      acc[key] = filtered.filter((v) => v.stage === key).length;
      return acc;
    },
    {} as Record<VenueStage, number>
  );

  return (
    <div>
      {showAddModal && (
        <AddVenueModal
          onClose={() => setShowAddModal(false)}
          onAdded={(venue) => {
            setVenues((prev) => [venue, ...prev]);
            setShowAddModal(false);
          }}
        />
      )}

      {emailVenue && (
        <PitchEmailModal
          venue={emailVenue}
          onClose={() => setEmailVenue(null)}
          onSuccess={() => setEmailVenue(null)}
        />
      )}
      {/* Header — sticky on desktop, static on mobile */}
      <div
        className="md:sticky top-0 z-10 shadow-sm px-4 md:px-8 pt-6 md:pt-8 pb-0"
        style={{
          backgroundColor: "#16181c",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "#f0ede8" }}>
              Pipeline
            </h1>
            <p className="text-sm mt-1" style={{ color: "#9a9591" }}>
              {filtered.length} venues
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="text-sm px-3 py-1.5 rounded-lg w-32 md:w-52 focus:outline-none"
              style={{
                background: "#262b33",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#f0ede8",
              }}
            />
            <button
              onClick={enrichDiscoveredVenues}
              disabled={!!enrichProgress || !!fillProgress}
              className="hidden md:block text-sm px-3 py-1.5 rounded-lg shrink-0 transition-all hover:brightness-110 disabled:opacity-50"
              style={{ backgroundColor: "#1e2128", color: "#9a9591", border: "1px solid rgba(255,255,255,0.1)" }}
              title="Find missing emails and addresses for Discovered venues"
            >
              {enrichProgress ? `${enrichProgress.done}/${enrichProgress.total}…` : "🔍 Find contacts"}
            </button>
            <button
              onClick={fillMissingAddresses}
              disabled={!!fillProgress || !!enrichProgress}
              className="hidden md:block text-sm px-3 py-1.5 rounded-lg shrink-0 transition-all hover:brightness-110 disabled:opacity-50"
              style={{ backgroundColor: "#1e2128", color: "#9a9591", border: "1px solid rgba(255,255,255,0.1)" }}
              title="Auto-fill missing venue addresses"
            >
              {fillProgress ? `${fillProgress.done}/${fillProgress.total}…` : "📍 Fill addresses"}
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="text-sm px-3 py-1.5 rounded-lg font-semibold shrink-0 transition-all hover:brightness-110"
              style={{ backgroundColor: "#d4a853", color: "#0e0f11" }}
            >
              + Add
            </button>
          </div>
        </div>
        {/* Stage labels — hidden on mobile, they're on each column header instead */}
        <div className="hidden md:flex gap-3">
          {STAGES.map(({ key, label }) => (
            <div
              key={key}
              className="flex-1 min-w-36 flex items-center justify-between pb-3"
            >
              <h2 className="text-sm font-semibold" style={{ color: "#f0ede8" }}>
                {label}
              </h2>
              <span
                className="text-xs rounded-full px-2 py-0.5 font-medium"
                style={{
                  backgroundColor: "#262b33",
                  color: "#d4a853",
                }}
              >
                {stageCounts[key]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Enrich progress banner */}
      {enrichProgress && (
        <div className="px-4 md:px-8 pt-4">
          <div
            className="rounded-lg px-4 py-3 flex items-center gap-4"
            style={{ backgroundColor: "rgba(155,127,232,0.1)", border: "1px solid rgba(155,127,232,0.25)" }}
          >
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium" style={{ color: "#9b7fe8" }}>
                  {enrichProgress.done < enrichProgress.total
                    ? `Finding contact info… ${enrichProgress.done} of ${enrichProgress.total}`
                    : `Done — found info for ${enrichProgress.found} of ${enrichProgress.total} venues`}
                </span>
                <span className="text-xs" style={{ color: "#9a9591" }}>{enrichProgress.found} updated</span>
              </div>
              <div className="w-full rounded-full overflow-hidden" style={{ backgroundColor: "#262b33", height: "4px" }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((enrichProgress.done / enrichProgress.total) * 100)}%`, backgroundColor: "#9b7fe8" }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Address fill progress banner */}
      {fillProgress && (
        <div className="px-4 md:px-8 pt-4">
          <div
            className="rounded-lg px-4 py-3 flex items-center gap-4"
            style={{ backgroundColor: "rgba(212,168,83,0.1)", border: "1px solid rgba(212,168,83,0.25)" }}
          >
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium" style={{ color: "#d4a853" }}>
                  {fillProgress.done < fillProgress.total
                    ? `Looking up addresses… ${fillProgress.done} of ${fillProgress.total}`
                    : `Done — found ${fillProgress.found} of ${fillProgress.total} addresses`}
                </span>
                <span className="text-xs" style={{ color: "#9a9591" }}>
                  {fillProgress.found} filled in
                </span>
              </div>
              <div className="w-full rounded-full overflow-hidden" style={{ backgroundColor: "#262b33", height: "4px" }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((fillProgress.done / fillProgress.total) * 100)}%`, backgroundColor: "#d4a853" }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stage filter banner */}
      {initialStageFilter && (
        <div className="px-8 pt-4">
          <div
            className="flex items-center justify-between rounded-lg px-4 py-2 text-sm"
            style={{ backgroundColor: "rgba(155,127,232,0.1)", border: "1px solid rgba(155,127,232,0.3)" }}
          >
            <span style={{ color: "#9b7fe8" }}>
              Showing <strong>{STAGES.find(s => s.key === initialStageFilter)?.label}</strong> venues only
            </span>
            <button
              onClick={() => router.push("/pipeline")}
              className="text-xs underline"
              style={{ color: "#9b7fe8" }}
            >
              Clear filter
            </button>
          </div>
        </div>
      )}

      {/* Board */}
      <div className="px-4 md:px-8 pt-4 pb-8 overflow-x-auto">
        <KanbanBoard venues={filtered} setVenues={setVenues} outreachMap={outreachMap} onEmail={setEmailVenue} />
      </div>
    </div>
  );
}
