"use client";

import { useState } from "react";
import { Venue, Invoice, PaymentType } from "@/types";
import InvoiceStatusBadge from "./InvoiceStatusBadge";

interface Props {
  venue: Venue;
  onClose: () => void;
  onInvoiceCreated: (invoice: Invoice) => void;
}

const PACKAGES = ["Solo", "Trio", "Five Piece Band"];

export default function InvoiceModal({ venue, onClose, onInvoiceCreated }: Props) {
  const [step, setStep] = useState<"create" | "send" | "done">("create");
  const [invoice, setInvoice] = useState<Invoice | null>(null);

  const [amountDollars, setAmountDollars] = useState("");
  const [paymentType, setPaymentType] = useState<PaymentType>("full");
  const [packageLabel, setPackageLabel] = useState(PACKAGES[0]);
  const [eventDate, setEventDate] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const [venueEmail, setVenueEmail] = useState(venue.contact_email ?? "");
  const [sending, setSending] = useState(false);

  async function handleCreate() {
    const cents = Math.round(parseFloat(amountDollars) * 100);
    if (!cents || isNaN(cents)) {
      setError("Please enter a valid amount");
      return;
    }
    setCreating(true);
    setError("");
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venue_id: venue.id,
        amount_cents: cents,
        payment_type: paymentType,
        event_date: eventDate || null,
        package_label: packageLabel,
        description: description || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to create invoice"); setCreating(false); return; }
    setInvoice(data);
    onInvoiceCreated(data);
    setStep("send");
    setCreating(false);
  }

  async function handleSend() {
    if (!invoice) return;
    if (!venueEmail.trim()) { setError("Please enter the venue's email address"); return; }
    setSending(true);
    setError("");
    const res = await fetch(`/api/invoices/${invoice.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ venue_email: venueEmail, venue_name: venue.name }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "Failed to send invoice"); setSending(false); return; }
    setInvoice(data);
    onInvoiceCreated(data);
    setStep("done");
    setSending(false);
  }

  async function handleMarkPaid() {
    if (!invoice) return;
    const res = await fetch(`/api/invoices/${invoice.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "paid" }),
    });
    const data = await res.json();
    if (res.ok) { setInvoice(data); onInvoiceCreated(data); }
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

  const labelStyle = {
    color: "#5e5c58",
    fontSize: "10px",
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em",
    marginBottom: "6px",
    display: "block",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
      <div style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", width: "420px", maxWidth: "95vw" }}>

        <div style={{ padding: "18px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ color: "#f0ede8", fontWeight: 600, fontSize: "14px" }}>
            {step === "create" ? "Create Invoice" : step === "send" ? "Send Invoice" : "Invoice Sent"}
          </div>
          <button onClick={onClose} style={{ color: "#5e5c58", fontSize: "20px", cursor: "pointer", background: "none", border: "none" }}>×</button>
        </div>

        <div style={{ padding: "20px" }}>

          {step === "create" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label style={labelStyle}>Amount</label>
                <div style={{ position: "relative" }}>
                  <span style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#9a9591" }}>$</span>
                  <input type="number" value={amountDollars} onChange={e => setAmountDollars(e.target.value)} placeholder="500.00" style={{ ...inputStyle, paddingLeft: "24px" }} />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Payment Type</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  {(["full", "deposit"] as PaymentType[]).map(t => (
                    <button key={t} onClick={() => setPaymentType(t)}
                      style={{ flex: 1, padding: "8px", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                        backgroundColor: paymentType === t ? "#d4a853" : "#1e2128",
                        color: paymentType === t ? "#0e0f11" : "#9a9591",
                        border: paymentType === t ? "none" : "1px solid rgba(255,255,255,0.1)" }}>
                      {t === "full" ? "Full Payment" : "Deposit"}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={labelStyle}>Package</label>
                <select value={packageLabel} onChange={e => setPackageLabel(e.target.value)} style={inputStyle}>
                  {PACKAGES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Event Date (optional)</label>
                <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} style={inputStyle} />
              </div>

              <div>
                <label style={labelStyle}>Note (optional)</label>
                <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Friday happy hour, 6-9 PM" style={inputStyle} />
              </div>

              {error && <p style={{ color: "#e25c5c", fontSize: "12px" }}>{error}</p>}

              <button onClick={handleCreate} disabled={creating}
                style={{ backgroundColor: "#d4a853", color: "#0e0f11", borderRadius: "8px", padding: "10px", fontWeight: 700, fontSize: "13px", cursor: "pointer", opacity: creating ? 0.6 : 1, border: "none" }}>
                {creating ? "Creating…" : "Create Invoice →"}
              </button>
            </div>
          )}

          {step === "send" && invoice && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ backgroundColor: "#1e2128", borderRadius: "10px", padding: "14px" }}>
                <div style={{ color: "#5e5c58", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px" }}>Invoice Summary</div>
                <div style={{ color: "#f0ede8", fontSize: "20px", fontWeight: 700 }}>${(invoice.amount_cents / 100).toFixed(2)}</div>
                <div style={{ color: "#9a9591", fontSize: "12px", marginTop: "4px" }}>
                  {invoice.package_label} · {invoice.payment_type === "deposit" ? "Deposit" : "Full Payment"}
                  {invoice.event_date ? ` · ${invoice.event_date}` : ""}
                </div>
                <div style={{ marginTop: "8px" }}><InvoiceStatusBadge status={invoice.status} /></div>
              </div>

              <div>
                <label style={labelStyle}>Send to (venue email)</label>
                <input type="email" value={venueEmail} onChange={e => setVenueEmail(e.target.value)} placeholder="venue@example.com" style={inputStyle} />
              </div>

              {error && <p style={{ color: "#e25c5c", fontSize: "12px" }}>{error}</p>}

              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => { onClose(); }}
                  style={{ flex: 1, backgroundColor: "#1e2128", color: "#9a9591", borderRadius: "8px", padding: "10px", fontSize: "13px", cursor: "pointer", border: "1px solid rgba(255,255,255,0.1)" }}>
                  Save as Draft
                </button>
                <button onClick={handleSend} disabled={sending}
                  style={{ flex: 2, backgroundColor: "#4a9d7a", color: "#fff", borderRadius: "8px", padding: "10px", fontWeight: 700, fontSize: "13px", cursor: "pointer", opacity: sending ? 0.6 : 1, border: "none" }}>
                  {sending ? "Sending…" : "Send via Stripe →"}
                </button>
              </div>
            </div>
          )}

          {step === "done" && invoice && (
            <div style={{ textAlign: "center", padding: "10px 0" }}>
              <div style={{ fontSize: "32px", marginBottom: "12px" }}>✉️</div>
              <div style={{ color: "#f0ede8", fontWeight: 600, fontSize: "14px", marginBottom: "6px" }}>Invoice sent!</div>
              <div style={{ color: "#9a9591", fontSize: "12px", marginBottom: "16px" }}>{venue.name} will receive it via email through Stripe.</div>
              <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
                {invoice.stripe_invoice_url && (
                  <a href={invoice.stripe_invoice_url} target="_blank" rel="noopener noreferrer"
                    style={{ backgroundColor: "#1e2128", color: "#5b9bd5", borderRadius: "8px", padding: "8px 14px", fontSize: "12px", border: "1px solid rgba(255,255,255,0.1)", textDecoration: "none" }}>
                    View Invoice ↗
                  </a>
                )}
                <button onClick={handleMarkPaid}
                  style={{ backgroundColor: invoice.status === "paid" ? "#4caf7d" : "#1e2128", color: invoice.status === "paid" ? "#fff" : "#9a9591", borderRadius: "8px", padding: "8px 14px", fontSize: "12px", cursor: "pointer", border: "1px solid rgba(255,255,255,0.1)" }}>
                  {invoice.status === "paid" ? "✓ Marked Paid" : "Mark as Paid"}
                </button>
                <button onClick={onClose}
                  style={{ backgroundColor: "#d4a853", color: "#0e0f11", borderRadius: "8px", padding: "8px 14px", fontSize: "12px", fontWeight: 700, cursor: "pointer", border: "none" }}>
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
