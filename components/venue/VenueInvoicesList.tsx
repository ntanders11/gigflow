"use client";

import { useMemo, useState } from "react";
import { VenueInvoiceView } from "@/types";

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

// "30d"/"90d" are rolling windows from today; "all" is unfiltered;
// anything else is treated as a four-digit calendar year (kept as a
// plain string, not a union of every possible year, since the actual
// list of years is built dynamically from the venue's own invoices).
type RangeValue = "all" | "30d" | "90d" | string;

function isInRange(createdAt: string, range: RangeValue): boolean {
  const created = new Date(createdAt);
  if (range === "all") return true;
  if (range === "30d") return created >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (range === "90d") return created >= new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  // A specific calendar year.
  return created.getFullYear() === Number(range);
}

export default function VenueInvoicesList({ invoices }: { invoices: VenueInvoiceView[] }) {
  const [range, setRange] = useState<RangeValue>("all");

  const years = useMemo(() => {
    const set = new Set(invoices.map((i) => new Date(i.created_at).getFullYear()));
    return Array.from(set).sort((a, b) => b - a);
  }, [invoices]);

  const filtered = useMemo(
    () => invoices.filter((i) => isInRange(i.created_at, range)),
    [invoices, range]
  );

  const outstanding = filtered.filter((i) => i.status === "sent" || i.status === "draft");
  const outstandingTotal = outstanding.reduce((sum, i) => sum + i.amount_cents, 0);
  const paid = filtered.filter((i) => i.status === "paid");
  const paidTotal = paid.reduce((sum, i) => sum + i.amount_cents, 0);

  return (
    <div>
      {/* Range filter */}
      <div className="flex justify-end mb-4">
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
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="rounded-xl p-5" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#9a9591" }}>Outstanding</p>
          <p className="text-4xl font-bold leading-none mb-1" style={{ color: "#e09b50" }}>{fmt(outstandingTotal)}</p>
          <p className="text-xs" style={{ color: "#9a9591" }}>{outstanding.length} unpaid invoice{outstanding.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="rounded-xl p-5" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#9a9591" }}>Paid</p>
          <p className="text-4xl font-bold leading-none mb-1" style={{ color: "#4caf7d" }}>{fmt(paidTotal)}</p>
          <p className="text-xs" style={{ color: "#9a9591" }}>{paid.length} paid</p>
        </div>
        <div className="rounded-xl p-5" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#9a9591" }}>Total</p>
          <p className="text-4xl font-bold leading-none mb-1" style={{ color: "#F4E8D2" }}>{filtered.length}</p>
          <p className="text-xs" style={{ color: "#9a9591" }}>{range === "all" ? "all time" : "in this range"}</p>
        </div>
      </div>

      {/* Invoice list */}
      <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium mb-1" style={{ color: "#5e5c58" }}>
              {invoices.length === 0 ? "No invoices yet" : "No invoices in this range"}
            </p>
            <p className="text-xs" style={{ color: "#5e5c58" }}>
              {invoices.length === 0
                ? "Invoices an artist sends you will show up here."
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
                    <p className="text-sm font-medium truncate" style={{ color: "#F4E8D2" }}>{invoice.artist_name}</p>
                    {invoice.package_label && (
                      <span className="text-xs flex-shrink-0" style={{ color: "#5e5c58" }}>· {invoice.package_label}</span>
                    )}
                  </div>
                  <p className="text-xs" style={{ color: "#9a9591" }}>
                    {[
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
                      {invoice.status === "paid" ? "Receipt ↗" : "View ↗"}
                    </a>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
