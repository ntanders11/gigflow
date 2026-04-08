import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Invoice } from "@/types";

const STATUS_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  draft:  { color: "#9a9591", bg: "rgba(154,149,145,0.15)", label: "Draft"  },
  sent:   { color: "#d4a853", bg: "rgba(212,168,83,0.15)",  label: "Sent"   },
  paid:   { color: "#4caf7d", bg: "rgba(76,175,125,0.15)",  label: "Paid"   },
  void:   { color: "#5e5c58", bg: "rgba(94,92,88,0.15)",    label: "Void"   },
};

function fmt(cents: number) {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0 });
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function InvoicesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: invoices } = await supabase
    .from("invoices")
    .select("*, venues(name, city)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const allInvoices = (invoices ?? []) as (Invoice & { venues: { name: string; city: string | null } | null })[];

  const unpaid = allInvoices.filter((i) => i.status === "sent" || i.status === "draft");
  const unpaidTotal = unpaid.reduce((sum, i) => sum + i.amount_cents, 0);
  const paidTotal = allInvoices
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + i.amount_cents, 0);

  return (
    <div className="min-h-screen p-4 md:p-8" style={{ backgroundColor: "#0e0f11", color: "#f0ede8" }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-8 max-w-4xl">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#f0ede8" }}>
          Invoices
        </h1>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 max-w-4xl">
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#9a9591" }}>
            Outstanding
          </p>
          <p className="text-4xl font-bold leading-none mb-1" style={{ color: "#e09b50" }}>
            {fmt(unpaidTotal)}
          </p>
          <p className="text-xs" style={{ color: "#9a9591" }}>
            {unpaid.length} unpaid invoice{unpaid.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#9a9591" }}>
            Collected
          </p>
          <p className="text-4xl font-bold leading-none mb-1" style={{ color: "#4caf7d" }}>
            {fmt(paidTotal)}
          </p>
          <p className="text-xs" style={{ color: "#9a9591" }}>
            {allInvoices.filter((i) => i.status === "paid").length} paid
          </p>
        </div>

        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#9a9591" }}>
            Total Invoices
          </p>
          <p className="text-4xl font-bold leading-none mb-1" style={{ color: "#f0ede8" }}>
            {allInvoices.length}
          </p>
          <p className="text-xs" style={{ color: "#9a9591" }}>
            all time
          </p>
        </div>
      </div>

      {/* Invoice list */}
      <div className="max-w-4xl">
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          {allInvoices.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-medium mb-1" style={{ color: "#5e5c58" }}>
                No invoices yet
              </p>
              <p className="text-xs" style={{ color: "#5e5c58" }}>
                Invoices are created from a venue&apos;s detail page once a gig is booked.
              </p>
            </div>
          ) : (
            allInvoices.map((invoice, idx) => {
              const style = STATUS_STYLE[invoice.status] ?? STATUS_STYLE.draft;
              const isLast = idx === allInvoices.length - 1;

              return (
                <div
                  key={invoice.id}
                  className="flex items-center gap-4 px-5 py-4"
                  style={{
                    borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  {/* Venue + details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-medium truncate" style={{ color: "#f0ede8" }}>
                        {invoice.venues?.name ?? "Unknown venue"}
                      </p>
                      {invoice.package_label && (
                        <span className="text-xs flex-shrink-0" style={{ color: "#5e5c58" }}>
                          · {invoice.package_label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs" style={{ color: "#9a9591" }}>
                      {[
                        invoice.venues?.city,
                        invoice.payment_type === "deposit" ? "Deposit" : "Full payment",
                        invoice.event_date ? `Event ${fmtDate(invoice.event_date)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>

                  {/* Amount */}
                  <p className="text-sm font-semibold flex-shrink-0" style={{ color: "#f0ede8" }}>
                    {fmt(invoice.amount_cents)}
                  </p>

                  {/* Date */}
                  <p className="text-xs flex-shrink-0 w-24 text-right" style={{ color: "#9a9591" }}>
                    {fmtDate(invoice.created_at)}
                  </p>

                  {/* Status badge */}
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 w-14 text-center"
                    style={{ backgroundColor: style.bg, color: style.color }}
                  >
                    {style.label}
                  </span>

                  {/* Stripe link */}
                  {invoice.stripe_invoice_url && (
                    <a
                      href={invoice.stripe_invoice_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs flex-shrink-0 transition-all hover:brightness-125"
                      style={{ color: "#d4a853" }}
                    >
                      View ↗
                    </a>
                  )}

                  {/* Venue link */}
                  <Link
                    href={`/venues/${invoice.venue_id}`}
                    className="text-xs flex-shrink-0 transition-all hover:brightness-125"
                    style={{ color: "#9a9591" }}
                  >
                    Venue →
                  </Link>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
