"use client";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="px-5 py-2.5 rounded-lg text-sm font-semibold"
      style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
    >
      Print flyer
    </button>
  );
}
