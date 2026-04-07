"use client";

import { useState } from "react";
import { Venue, VenueStage, ConfidenceLevel, STAGES } from "@/types";

interface Props {
  onClose: () => void;
  onAdded: (venue: Venue) => void;
}

const inputStyle = {
  backgroundColor: "#1e2128",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#f0ede8",
  borderRadius: "8px",
  padding: "8px 12px",
  fontSize: "13px",
  width: "100%",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  color: "#5e5c58",
  fontSize: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  marginBottom: "5px",
  display: "block",
};

export default function AddVenueModal({ onClose, onAdded }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [city, setCity] = useState("");
  const [website, setWebsite] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [stage, setStage] = useState<VenueStage>("discovered");
  const [confidence, setConfidence] = useState<ConfidenceLevel>("MEDIUM");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!name.trim()) {
      setError("Venue name is required.");
      return;
    }
    setSaving(true);
    setError("");

    const res = await fetch("/api/venues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        type: type.trim() || null,
        city: city.trim() || null,
        website: website.trim() || null,
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
        stage,
        confidence,
        notes: notes.trim() || null,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to add venue.");
      setSaving(false);
      return;
    }

    onAdded(data);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
      <div
        className="flex flex-col max-h-[90vh] w-full"
        style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", maxWidth: "480px" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{ padding: "18px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          <span style={{ color: "#f0ede8", fontWeight: 600, fontSize: "14px" }}>Add Venue</span>
          <button onClick={onClose} style={{ color: "#5e5c58", fontSize: "20px", background: "none", border: "none", cursor: "pointer" }}>×</button>
        </div>

        {/* Form */}
        <div className="overflow-y-auto flex-1" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>

          <div>
            <label style={labelStyle}>Venue Name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="The Barrel Room" style={inputStyle} autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle}>Type</label>
              <input type="text" value={type} onChange={e => setType(e.target.value)} placeholder="Winery, Bar, Restaurant…" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>City</label>
              <input type="text" value={city} onChange={e => setCity(e.target.value)} placeholder="McMinnville" style={inputStyle} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Website</label>
            <input type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://venue.com" style={inputStyle} />
          </div>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "14px" }}>
            <label style={{ ...labelStyle, marginBottom: "10px" }}>Contact Info</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <input type="text" value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Contact name" style={inputStyle} />
              <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="Email" style={inputStyle} />
              <input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} placeholder="Phone" style={inputStyle} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle}>Stage</label>
              <select value={stage} onChange={e => setStage(e.target.value as VenueStage)} style={inputStyle}>
                {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Confidence</label>
              <select value={confidence} onChange={e => setConfidence(e.target.value as ConfidenceLevel)} style={inputStyle}>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything worth remembering about this venue…" rows={3}
              style={{ ...inputStyle, resize: "none" }} />
          </div>

          {error && <p style={{ color: "#e25c5c", fontSize: "12px" }}>{error}</p>}
        </div>

        {/* Footer */}
        <div
          className="shrink-0 flex gap-2"
          style={{ padding: "16px 20px", borderTop: "1px solid rgba(255,255,255,0.07)" }}
        >
          <button onClick={onClose} style={{ flex: 1, backgroundColor: "#1e2128", color: "#9a9591", borderRadius: "8px", padding: "10px", fontSize: "13px", cursor: "pointer", border: "1px solid rgba(255,255,255,0.1)" }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 2, backgroundColor: "#d4a853", color: "#0e0f11", borderRadius: "8px", padding: "10px", fontWeight: 700, fontSize: "13px", cursor: "pointer", opacity: saving ? 0.6 : 1, border: "none" }}>
            {saving ? "Adding…" : "Add Venue →"}
          </button>
        </div>
      </div>
    </div>
  );
}
