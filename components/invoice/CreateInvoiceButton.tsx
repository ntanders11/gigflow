"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Venue, Invoice, VenueStage } from "@/types";
import InvoiceModal from "./InvoiceModal";

interface Props {
  venues: Venue[];
}

const STAGE_PRIORITY: Record<VenueStage, number> = {
  booked: 0,
  negotiating: 1,
  responded: 2,
  contacted: 3,
  discovered: 4,
  dormant: 5,
};

export default function CreateInvoiceButton({ venues }: Props) {
  const router = useRouter();
  const [showPicker, setShowPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);

  const sortedVenues = useMemo(
    () => [...venues].sort((a, b) => STAGE_PRIORITY[a.stage] - STAGE_PRIORITY[b.stage] || a.name.localeCompare(b.name)),
    [venues]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedVenues;
    return sortedVenues.filter(
      (v) => v.name.toLowerCase().includes(q) || (v.city ?? "").toLowerCase().includes(q)
    );
  }, [sortedVenues, query]);

  function closeAll() {
    setShowPicker(false);
    setSelectedVenue(null);
    setQuery("");
  }

  function handleInvoiceCreated() {
    router.refresh();
  }

  const rowStyle = {
    padding: "10px 12px",
    borderRadius: "8px",
    background: "none",
    border: "none",
    cursor: "pointer",
    display: "block",
    width: "100%",
    textAlign: "left" as const,
  };

  return (
    <>
      <button
        onClick={() => setShowPicker(true)}
        className="px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
        style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
      >
        + New Invoice
      </button>

      {showPicker && !selectedVenue && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
        >
          <div
            className="flex flex-col"
            style={{
              backgroundColor: "#16181c",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "14px",
              width: "420px",
              maxWidth: "95vw",
              maxHeight: "80vh",
            }}
          >
            <div
              className="flex items-center justify-between shrink-0"
              style={{ padding: "18px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
            >
              <div style={{ color: "#F4E8D2", fontWeight: 600, fontSize: "14px" }}>Select a Venue</div>
              <button
                onClick={closeAll}
                style={{ color: "#5e5c58", fontSize: "20px", cursor: "pointer", background: "none", border: "none" }}
              >
                ×
              </button>
            </div>

            <div className="shrink-0" style={{ padding: "14px 20px 0" }}>
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search venues…"
                style={{
                  backgroundColor: "#1e2128",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "#F4E8D2",
                  borderRadius: "8px",
                  padding: "8px 12px",
                  fontSize: "13px",
                  width: "100%",
                  outline: "none",
                }}
              />
            </div>

            <div className="overflow-y-auto" style={{ padding: "10px 10px 16px" }}>
              {filtered.length === 0 ? (
                <p style={{ color: "#5e5c58", fontSize: "13px", padding: "20px 10px", textAlign: "center" }}>
                  No venues found
                </p>
              ) : (
                filtered.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVenue(v)}
                    style={rowStyle}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "#1e2128")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")}
                  >
                    <div style={{ color: "#F4E8D2", fontSize: "13px", fontWeight: 500 }}>{v.name}</div>
                    <div style={{ color: "#9a9591", fontSize: "11px", marginTop: "2px" }}>
                      {[v.city, v.stage].filter(Boolean).join(" · ")}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {selectedVenue && (
        <InvoiceModal venue={selectedVenue} onClose={closeAll} onInvoiceCreated={handleInvoiceCreated} />
      )}
    </>
  );
}
