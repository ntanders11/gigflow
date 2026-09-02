"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Invoice } from "@/types";
import DeleteInvoiceButton from "@/components/invoice/DeleteInvoiceButton";

type InvoiceWithVenue = Invoice & { venues: { name: string; city: string | null } | null };

const STATUS_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  draft: { color: "#9a9591", bg: "rgba(154,149,145,0.15)", label: "Draft" },
  sent:  { color: "#D4A64F", bg: "rgba(212,166,79,0.15)",  label: "Sent"  },
  paid:  { color: "#4caf7d", bg: "rgba(76,175,125,0.15)",  label: "Paid"  },
  void:  { color: "#5e5c58", bg: "rgba(94,92,88,0.15)",    label: "Void"  },
};

function fmt(cents: number) {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0 });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Same range logic as the venue-side VenueInvoicesList — "30d"/"90d" are
// rolling windows from today, "all" is unfiltered, anything else is a
// four-digit calendar year built dynamically from the artist's own
// invoices rather than a hardcoded list.
type RangeValue = "all" | "30d" | "90d" | string;

function isInRange(createdAt: string, range: RangeValue): boolean {
  const created = new Date(createdAt);
  if (range === "all") return true;
  if (range === "30d") return created >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (range === "90d") return created >= new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return created.getFullYear() === Number(range);
}

// Same quoting rule the venue CSV export (app/api/venues/export/route.ts)
// already uses — quote a field only if it actually needs it.
function csvField(value: string | null | undefined): string {
  const s = value ?? "";
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const RANGE_FILENAME: Record<string, string> = { all: "all-time", "30d": "last-30-days", "90d": "last-90-days" };

// Exports exactly what's currently on screen — the same range filter
// already applied to the list above, not a separate query. A tax record
// for "2026" should mean exactly the rows the 2026 filter shows.
function downloadInvoicesCSV(invoices: InvoiceWithVenue[], range: RangeValue) {
  const header = "Venue,City,Package,Payment Type,Event Date,Amount,Status,Invoice Date";
  const rows = invoices.map((i) =>
    [
      csvField(i.venues?.name ?? "Unknown venue"),
      csvField(i.venues?.city),
      csvField(i.package_label),
      csvField(i.payment_type === "deposit" ? "Deposit" : "Full payment"),
      csvField(i.event_date ? fmtDate(i.event_date) : ""),
      csvField((i.amount_cents / 100).toFixed(2)),
      csvField(STATUS_STYLE[i.status]?.label ?? i.status),
      csvField(fmtDate(i.created_at)),
    ].join(",")
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stagereach-invoices-${RANGE_FILENAME[range] ?? range}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ArtistInvoicesList({ initialInvoices }: { initialInvoices: InvoiceWithVenue[] }) {
  const [invoices, setInvoices] = useState(initialInvoices);
  const [range, setRange] = useState<RangeValue>("all");

  // CreateInvoiceButton triggers a server refresh (router.refresh()) after
  // adding an invoice, which re-runs the page and passes a fresh
  // initialInvoices prop down — but useState's initializer only runs once
  // on mount, so without this effect a newly created invoice would never
  // appear without a full page reload. This keeps local state (used for
  // the instant delete below) in sync with the server on every refresh.
  useEffect(() => {
    setInvoices(initialInvoices);
  }, [initialInvoices]);

  const years = useMemo(() => {
    const set = new Set(invoices.map((i) => new Date(i.created_at).getFullYear()));
    return Array.from(set).sort((a, b) => b - a);
  }, [invoices]);

  const filtered = useMemo(
    () => invoices.filter((i) => isInRange(i.created_at, range)),
    [invoices, range]
  );

  function handleDeleted(invoiceId: string) {
    setInvoices((prev) => prev.filter((i) => i.id !== invoiceId));
  }

  const unpaid = filtered.filter((i) => i.status === "sent" || i.status === "draft");
  const unpaidTotal = unpaid.reduce((sum, i) => sum + i.amount_cents, 0);
  const paidTotal = filtered.filter((i) => i.status === "paid").reduce((sum, i) => sum + i.amount_cents, 0);

  return (
    <div>
      {/* Range filter + export */}
      <div className="flex justify-end items-center gap-2 mb-4 max-w-4xl">
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="text-sm px-3 py-2 rounded-lg outline-none"
          style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.1)", color: "#F4E8D2" }}
        >
          <option value="all">All Time</option>
          <option value="30d">Last 30 Days</option>
          <option value="90d">Last 90 Days</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>All of {y}</option>
          ))}
        </select>
        <button
          onClick={() => downloadInvoicesCSV(filtered, range)}
          disabled={filtered.length === 0}
          className="text-sm px-3 py-2 rounded-lg transition-all hover:brightness-110 disabled:opacity-50"
          style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.1)", color: "#D4A64F" }}
        >
          Download CSV
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 max-w-4xl">
        <div className="rounded-xl p-5" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#9a9591" }}>Outstanding</p>
          <p className="text-4xl font-bold leading-none mb-1" style={{ color: "#e09b50" }}>{fmt(unpaidTotal)}</p>
          <p className="text-xs" style={{ color: "#9a9591" }}>{unpaid.length} unpaid invoice{unpaid.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="rounded-xl p-5" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#9a9591" }}>Collected</p>
          <p className="text-4xl font-bold leading-none mb-1" style={{ color: "#4caf7d" }}>{fmt(paidTotal)}</p>
          <p className="text-xs" style={{ color: "#9a9591" }}>{filtered.filter((i) => i.status === "paid").length} paid</p>
        </div>
        <div className="rounded-xl p-5" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#9a9591" }}>Total Invoices</p>
          <p className="text-4xl font-bold leading-none mb-1" style={{ color: "#F4E8D2" }}>{filtered.length}</p>
          <p className="text-xs" style={{ color: "#9a9591" }}>{range === "all" ? "all time" : "in this range"}</p>
        </div>
      </div>

      {/* Invoice list */}
      <div className="max-w-4xl">
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
          {filtered.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-medium mb-1" style={{ color: "#5e5c58" }}>
                {invoices.length === 0 ? "No invoices yet" : "No invoices in this range"}
              </p>
              <p className="text-xs" style={{ color: "#5e5c58" }}>
                {invoices.length === 0
                  ? "Create your first invoice, or open a venue's detail page once a gig is booked."
                  : "Try a different date range."}
              </p>
            </div>
          ) : (
            filtered.map((invoice, idx) => {
              const style = STATUS_STYLE[invoice.status] ?? STATUS_STYLE.draft;
              const isLast = idx === filtered.length - 1;

              return (
                <div
                  key={invoice.id}
                  className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-center md:gap-4"
                  style={{ borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)" }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-medium truncate" style={{ color: "#F4E8D2" }}>
                        {invoice.venues?.name ?? "Unknown venue"}
                      </p>
                      {invoice.package_label && (
                        <span className="text-xs flex-shrink-0" style={{ color: "#5e5c58" }}>· {invoice.package_label}</span>
                      )}
                    </div>
                    <p className="text-xs" style={{ color: "#9a9591" }}>
                      {[
                        invoice.venues?.city,
                        invoice.payment_type === "deposit" ? "Deposit" : "Full payment",
                        invoice.event_date ? `Event ${fmtDate(invoice.event_date)}` : null,
                      ].filter(Boolean).join(" · ")}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap md:flex-nowrap md:gap-4">
                    <p className="text-sm font-semibold flex-shrink-0" style={{ color: "#F4E8D2" }}>{fmt(invoice.amount_cents)}</p>
                    <p className="text-xs flex-shrink-0 md:w-24 md:text-right" style={{ color: "#9a9591" }}>{fmtDate(invoice.created_at)}</p>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 w-14 text-center"
                      style={{ backgroundColor: style.bg, color: style.color }}
                    >
                      {style.label}
                    </span>
                    {invoice.stripe_invoice_url && (
                      <a
                        href={invoice.stripe_invoice_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs flex-shrink-0 transition-all hover:brightness-125"
                        style={{ color: "#D4A64F" }}
                      >
                        View ↗
                      </a>
                    )}
                    <Link
                      href={`/venues/${invoice.venue_id}`}
                      className="text-xs flex-shrink-0 transition-all hover:brightness-125"
                      style={{ color: "#9a9591" }}
                    >
                      Venue →
                    </Link>
                    <DeleteInvoiceButton
                      invoiceId={invoice.id}
                      status={invoice.status}
                      onDeleted={() => handleDeleted(invoice.id)}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
