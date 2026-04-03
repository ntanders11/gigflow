"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export default function ImportPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleImport() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/venues/import", {
      method: "POST",
      body: formData,
    });

    const json = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(json.error ?? "Import failed");
    } else {
      setSuccess(`Imported ${json.inserted} venues successfully.`);
      setTimeout(() => router.push("/pipeline"), 1500);
    }
  }

  return (
    <div className="p-8 max-w-lg">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Import Venues</h1>
      <p className="text-slate-500 text-sm mb-8">
        Upload the venues CSV from your research. All venues will start in the{" "}
        <strong>Discovered</strong> stage.
      </p>

      <div
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-slate-200 rounded-xl p-10 text-center cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors"
      >
        {file ? (
          <div>
            <p className="font-medium text-slate-900">{file.name}</p>
            <p className="text-sm text-slate-500 mt-1">
              {(file.size / 1024).toFixed(1)} KB
            </p>
          </div>
        ) : (
          <div>
            <p className="text-slate-500 text-sm">
              Click to select your CSV file
            </p>
            <p className="text-slate-400 text-xs mt-1">venues-all-30mi.csv</p>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      {error && (
        <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      {success && (
        <p className="mt-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          {success} Redirecting to pipeline...
        </p>
      )}

      <button
        onClick={handleImport}
        disabled={!file || loading}
        className="mt-6 w-full bg-slate-900 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-slate-700 disabled:opacity-40 transition-colors"
      >
        {loading ? "Importing..." : "Import Venues"}
      </button>
    </div>
  );
}
