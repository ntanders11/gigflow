"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InvoiceStatus } from "@/types";

interface Props {
  invoiceId: string;
  status: InvoiceStatus;
  onDeleted?: () => void;
}

export default function DeleteInvoiceButton({ invoiceId, status, onDeleted }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setDeleting(true);
    setError("");
    const res = await fetch(`/api/invoices/${invoiceId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to delete invoice");
      setDeleting(false);
      return;
    }
    if (onDeleted) {
      onDeleted();
    } else {
      router.refresh();
    }
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2 flex-wrap">
        <span className="text-xs" style={{ color: "#e25c5c" }}>
          {status === "paid" ? "Already paid — delete anyway?" : "Delete invoice?"}
        </span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="text-xs font-semibold transition-all hover:brightness-125"
          style={{ color: "#e25c5c" }}
        >
          {deleting ? "…" : "Yes, delete"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={deleting}
          className="text-xs transition-all hover:brightness-125"
          style={{ color: "#9a9591" }}
        >
          Cancel
        </button>
        {error && (
          <span className="text-xs" style={{ color: "#e25c5c" }}>
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="text-xs flex-shrink-0 transition-all hover:brightness-125"
      style={{ color: "#5e5c58" }}
      title="Delete this invoice"
    >
      Delete
    </button>
  );
}
