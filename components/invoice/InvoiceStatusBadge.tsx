import { InvoiceStatus } from "@/types";

const STATUS_STYLES: Record<InvoiceStatus, { label: string; color: string; bg: string }> = {
  draft:  { label: "Draft",  color: "#9a9591", bg: "rgba(154,149,145,0.15)" },
  sent:   { label: "Sent",   color: "#5b9bd5", bg: "rgba(91,155,213,0.15)"  },
  paid:   { label: "Paid",   color: "#4caf7d", bg: "rgba(76,175,125,0.15)"  },
  void:   { label: "Void",   color: "#e25c5c", bg: "rgba(226,92,92,0.15)"   },
};

export default function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      style={{
        backgroundColor: s.bg,
        color: s.color,
        fontSize: "10px",
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: "99px",
      }}
    >
      {s.label}
    </span>
  );
}
