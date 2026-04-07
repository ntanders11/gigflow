"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Venue, Interaction, VenueStage, STAGES, STAGE_COLORS, CONFIDENCE_COLORS, InteractionType } from "@/types";
import { cn } from "@/lib/utils";
import PitchEmailModal from "@/components/venue/PitchEmailModal";
import TimePicker from "@/components/ui/TimePicker";
import InvoiceModal from "@/components/invoice/InvoiceModal";
import InvoiceStatusBadge from "@/components/invoice/InvoiceStatusBadge";
import { Invoice } from "@/types";

interface Props {
  venue: Venue;
  interactions: Interaction[];
}

const INTERACTION_LABELS: Record<InteractionType, string> = {
  email: "Email",
  call: "Call",
  in_person: "In Person",
  note: "Note",
};

export default function VenueDetail({ venue: initialVenue, interactions: initialInteractions }: Props) {
  const [venue, setVenue] = useState(initialVenue);
  const [interactions, setInteractions] = useState(initialInteractions);
  const [notes, setNotes] = useState(initialVenue.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [showLogForm, setShowLogForm] = useState(false);
  const [logType, setLogType] = useState<InteractionType>("call");
  const [logNotes, setLogNotes] = useState("");
  const [loggingInteraction, setLoggingInteraction] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Editable contact fields
  const [contactName, setContactName] = useState(initialVenue.contact_name ?? "");
  const [contactEmail, setContactEmail] = useState(initialVenue.contact_email ?? "");
  const [contactPhone, setContactPhone] = useState(initialVenue.contact_phone ?? "");
  const [website, setWebsite] = useState(initialVenue.website ?? "");
  const [savingContact, setSavingContact] = useState(false);

  // Gig date, time, address
  const [gigDate, setGigDate] = useState(initialVenue.follow_up_date ?? "");
  const [gigTime, setGigTime] = useState(initialVenue.gig_time ?? "");
  const [gigEndTime, setGigEndTime] = useState(initialVenue.gig_end_time ?? "");
  const [address, setAddress] = useState(initialVenue.address ?? "");
  const [savingGigDate, setSavingGigDate] = useState(false);
  const [lookingUpAddress, setLookingUpAddress] = useState(false);

  useEffect(() => {
    fetch(`/api/invoices?venue_id=${venue.id}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setInvoices(data); });
  }, [venue.id]);

  async function updateStage(newStage: VenueStage) {
    const res = await fetch(`/api/venues/${venue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: newStage }),
    });
    if (res.ok) {
      const updated = await res.json();
      setVenue(updated);
    }
  }

  async function saveNotes() {
    setSavingNotes(true);
    await fetch(`/api/venues/${venue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setSavingNotes(false);
  }

  async function saveGigDate(value: string) {
    setSavingGigDate(true);
    await fetch(`/api/venues/${venue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ follow_up_date: value || null }),
    });
    setSavingGigDate(false);
  }

  async function saveGigTime(value: string) {
    await fetch(`/api/venues/${venue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gig_time: value || null }),
    });
  }

  async function saveGigEndTime(value: string) {
    await fetch(`/api/venues/${venue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gig_end_time: value || null }),
    });
  }

  async function saveAddress(value: string) {
    await fetch(`/api/venues/${venue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: value || null }),
    });
  }

  async function lookUpAddress() {
    setLookingUpAddress(true);
    const params = new URLSearchParams({ name: venue.name });
    if (venue.city) params.append("city", venue.city);
    const res = await fetch(`/api/venues/lookup-address?${params}`);
    const data = await res.json();
    if (data.address) {
      setAddress(data.address);
      await saveAddress(data.address);
    }
    setLookingUpAddress(false);
  }

  async function saveContact() {
    setSavingContact(true);
    await fetch(`/api/venues/${venue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact_name: contactName || null,
        contact_email: contactEmail || null,
        contact_phone: contactPhone || null,
        website: website || null,
      }),
    });
    setSavingContact(false);
  }

  async function logInteraction() {
    if (!logNotes.trim() && logType === "note") return;
    setLoggingInteraction(true);

    const res = await fetch("/api/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue_id: venue.id,
        type: logType,
        notes: logNotes,
      }),
    });

    if (res.ok) {
      const newInteraction = await res.json();
      setInteractions((prev) => [newInteraction, ...prev]);
      setLogNotes("");
      setShowLogForm(false);
    }
    setLoggingInteraction(false);
  }

  async function archiveVenue() {
    await fetch(`/api/venues/${venue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: "dormant" }),
    });
    setVenue((v) => ({ ...v, stage: "dormant" }));
  }

  async function deleteVenue() {
    setDeleting(true);
    const res = await fetch(`/api/venues/${venue.id}`, { method: "DELETE" });
    if (res.ok) {
      window.location.href = "/pipeline";
    } else {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  return (
    <>
    {showDeleteConfirm && (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.7)" }}>
        <div className="rounded-xl p-6 w-80" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="font-semibold mb-1" style={{ color: "#f0ede8" }}>Delete {venue.name}?</p>
          <p className="text-sm mb-5" style={{ color: "#9a9591" }}>
            This permanently removes the venue and all its interactions. This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 text-sm py-2 rounded-lg"
              style={{ backgroundColor: "#1e2128", color: "#9a9591", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              Cancel
            </button>
            <button
              onClick={deleteVenue}
              disabled={deleting}
              className="flex-1 text-sm py-2 rounded-lg font-semibold"
              style={{ backgroundColor: "#e25c5c", color: "#fff", opacity: deleting ? 0.6 : 1 }}
            >
              {deleting ? "Deleting…" : "Yes, Delete"}
            </button>
          </div>
        </div>
      </div>
    )}
    {showInvoiceModal && (
      <InvoiceModal
        venue={venue}
        onClose={() => setShowInvoiceModal(false)}
        onInvoiceCreated={(inv) => {
          setInvoices(prev => [inv, ...prev.filter(i => i.id !== inv.id)]);
        }}
      />
    )}
    {showEmailModal && (
      <PitchEmailModal
        venue={venue}
        onClose={() => setShowEmailModal(false)}
        onSuccess={(interaction) => {
          setInteractions((prev) => [interaction, ...prev]);
          setShowEmailModal(false);
        }}
      />
    )}
    <div className="p-8 max-w-3xl">
      {/* Back link */}
      <Link href="/pipeline" className="text-sm mb-6 inline-block" style={{ color: "#9a9591" }}>
        ← Pipeline
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#ffffff" }}>{venue.name}</h1>
          <p className="text-sm mt-1" style={{ color: "#9a9591" }}>
            {[venue.type, venue.city].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn("text-xs px-2 py-1 rounded-full font-medium", STAGE_COLORS[venue.stage])}>
            {STAGES.find((s) => s.key === venue.stage)?.label}
          </span>
          {venue.stage !== "dormant" && (
            <button
              onClick={archiveVenue}
              className="text-xs px-2 py-1 rounded-lg transition-all hover:brightness-125"
              style={{ backgroundColor: "rgba(255,255,255,0.06)", color: "#9a9591", border: "1px solid rgba(255,255,255,0.1)" }}
            >
              Archive
            </button>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="text-xs px-2 py-1 rounded-lg transition-all hover:brightness-125"
            style={{ backgroundColor: "rgba(226,92,92,0.1)", color: "#e25c5c", border: "1px solid rgba(226,92,92,0.2)" }}
          >
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* Contact info */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#5e5c58" }}>Contact</h2>
            {savingContact && <span className="text-xs" style={{ color: "#5e5c58" }}>Saving...</span>}
          </div>
          {[
            { label: "Name", value: contactName, set: setContactName, type: "text", placeholder: "Contact name" },
            { label: "Email", value: contactEmail, set: setContactEmail, type: "email", placeholder: "booking@venue.com" },
            { label: "Phone", value: contactPhone, set: setContactPhone, type: "tel", placeholder: "(503) 555-0000" },
            { label: "Website", value: website, set: setWebsite, type: "url", placeholder: "https://venue.com" },
          ].map(({ label, value, set, type, placeholder }) => (
            <div key={label}>
              <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>{label}</label>
              <input
                type={type}
                value={value}
                onChange={(e) => set(e.target.value)}
                onBlur={saveContact}
                placeholder={placeholder}
                className="w-full text-sm rounded-lg px-2 py-1.5 focus:outline-none"
                style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.1)", color: "#f0ede8" }}
              />
            </div>
          ))}
        </div>

        {/* Stage + confidence */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#5e5c58" }}>Pipeline</h2>
          <div>
            <label className="text-xs mb-1 block" style={{ color: "#9a9591" }}>Stage</label>
            <select
              value={venue.stage}
              onChange={(e) => updateStage(e.target.value as VenueStage)}
              className="text-sm rounded-lg px-2 py-1.5 focus:outline-none w-full"
              style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.1)", color: "#f0ede8" }}
            >
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs mb-1 flex items-center justify-between" style={{ color: "#9a9591" }}>
              <span>Gig Date &amp; Time</span>
              {savingGigDate && <span style={{ color: "#5e5c58" }}>Saving…</span>}
            </label>
            <div className="flex gap-2">
              <input
                type="date"
                value={gigDate}
                onChange={(e) => setGigDate(e.target.value)}
                onBlur={(e) => saveGigDate(e.target.value)}
                className="text-sm rounded-lg px-2 py-1.5 focus:outline-none flex-1"
                style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.1)", color: gigDate ? "#f0ede8" : "#5e5c58" }}
              />
            </div>
            <div className="flex gap-3 items-start">
              <div>
                <label className="text-xs mb-2 block" style={{ color: "#5e5c58" }}>Start</label>
                <TimePicker
                  value={gigTime}
                  onChange={(v) => setGigTime(v)}
                  onBlur={() => saveGigTime(gigTime)}
                />
              </div>
              <div>
                <label className="text-xs mb-2 block" style={{ color: "#5e5c58" }}>End</label>
                <TimePicker
                  value={gigEndTime}
                  onChange={(v) => setGigEndTime(v)}
                  onBlur={() => saveGigEndTime(gigEndTime)}
                />
              </div>
            </div>
            {gigDate && (
              <button
                onClick={() => { setGigDate(""); setGigTime(""); setGigEndTime(""); saveGigDate(""); saveGigTime(""); saveGigEndTime(""); }}
                className="text-xs mt-1"
                style={{ color: "#5e5c58" }}
              >
                Clear
              </button>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs" style={{ color: "#9a9591" }}>Venue Address</label>
              <button
                onClick={lookUpAddress}
                disabled={lookingUpAddress}
                className="text-xs transition-all hover:brightness-125"
                style={{ color: "#d4a853", opacity: lookingUpAddress ? 0.5 : 1 }}
              >
                {lookingUpAddress ? "Looking up…" : "Look up ↗"}
              </button>
            </div>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onBlur={(e) => saveAddress(e.target.value)}
              placeholder="123 Main St, McMinnville, OR"
              className="text-sm rounded-lg px-2 py-1.5 focus:outline-none w-full"
              style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.1)", color: "#f0ede8" }}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: "#9a9591" }}>Confidence:</span>
            <span className={cn("text-xs px-1.5 py-0.5 rounded border font-medium", CONFIDENCE_COLORS[venue.confidence])}>
              {venue.confidence}
            </span>
          </div>
          {venue.live_music_details && (
            <p className="text-xs" style={{ color: "#9a9591" }}>{venue.live_music_details}</p>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "#5e5c58" }}>Notes</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          rows={4}
          placeholder="Add notes about this venue..."
          className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
          style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.1)", color: "#f0ede8" }}
        />
        {savingNotes && <p className="text-xs mt-1" style={{ color: "#5e5c58" }}>Saving...</p>}
      </div>

      {/* Interactions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#5e5c58" }}>Interactions</h2>
          <div className="flex gap-2">
            <button
              onClick={() => setShowInvoiceModal(true)}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
              style={{ background: "#d4a853", color: "#0e0f11" }}
            >
              Create Invoice
            </button>
            <button
              onClick={() => setShowEmailModal(true)}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
              style={{ background: "#4a9d7a", color: "#fff" }}
            >
              Send Pitch Email
            </button>
            <button
              onClick={() => setShowLogForm(!showLogForm)}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors"
              style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.1)", color: "#f0ede8" }}
            >
              + Log interaction
            </button>
          </div>
        </div>

        {showLogForm && (
          <div className="rounded-lg p-4 mb-4 space-y-3" style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="flex gap-2">
              {(["call", "email", "in_person", "note"] as InteractionType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setLogType(t)}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                  style={logType === t
                    ? { background: "#4a9d7a", color: "#fff" }
                    : { background: "#262b33", border: "1px solid rgba(255,255,255,0.08)", color: "#9a9591" }}
                >
                  {INTERACTION_LABELS[t]}
                </button>
              ))}
            </div>
            <textarea
              value={logNotes}
              onChange={(e) => setLogNotes(e.target.value)}
              rows={3}
              placeholder="What happened?"
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
              style={{ background: "#262b33", border: "1px solid rgba(255,255,255,0.08)", color: "#f0ede8" }}
            />
            <div className="flex gap-2">
              <button
                onClick={logInteraction}
                disabled={loggingInteraction}
                className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                style={{ background: "#4a9d7a", color: "#fff" }}
              >
                {loggingInteraction ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setShowLogForm(false)}
                className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                style={{ color: "#9a9591" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {interactions.length === 0 ? (
          <p className="text-sm" style={{ color: "#5e5c58" }}>No interactions logged yet.</p>
        ) : (
          <div className="space-y-3">
            {interactions.map((interaction) => (
              <div key={interaction.id} className="flex gap-3">
                <div className="w-16 shrink-0">
                  <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: "#1e2128", color: "#9a9591" }}>
                    {INTERACTION_LABELS[interaction.type]}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  {interaction.notes && (
                    <p className="text-sm" style={{ color: "#f0ede8" }}>{interaction.notes}</p>
                  )}
                  <p className="text-xs mt-0.5" style={{ color: "#5e5c58" }}>
                    {new Date(interaction.occurred_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {invoices.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "#5e5c58" }}>Invoices</h2>
          <div className="space-y-2">
            {invoices.map(inv => (
              <div key={inv.id} className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: "#1e2128" }}>
                <div>
                  <span style={{ color: "#f0ede8", fontSize: "13px", fontWeight: 500 }}>${(inv.amount_cents / 100).toFixed(2)}</span>
                  <span style={{ color: "#5e5c58", fontSize: "11px", marginLeft: "8px" }}>{inv.package_label} · {inv.payment_type === "deposit" ? "Deposit" : "Full"}</span>
                </div>
                <div className="flex items-center gap-2">
                  {inv.stripe_invoice_url && (
                    <a href={inv.stripe_invoice_url} target="_blank" rel="noopener noreferrer" style={{ color: "#5b9bd5", fontSize: "11px" }}>View ↗</a>
                  )}
                  <InvoiceStatusBadge status={inv.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    </>
  );
}
