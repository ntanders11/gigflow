"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PROMO_BUCKET, MAX_PROMO_PHOTOS, validatePromoDeclaration } from "@/lib/promo-photos/rules";

type Photo = { id: string; file_name: string; url: string };

// Used on the Artist Profile page and as a step in artist setup. Photos go
// straight from the browser to private storage, then get registered with the
// server, which re-checks what was actually uploaded.
export default function PromoPhotosEditor() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/promo-photos")
      .then((r) => (r.ok ? r.json() : { photos: [] }))
      .then((d) => setPhotos(d.photos ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const slotsLeft = MAX_PROMO_PHOTOS - photos.length - uploading;

  async function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError("");
    const files = Array.from(fileList);
    const allowed = files.slice(0, Math.max(slotsLeft, 0));
    if (files.length > allowed.length) {
      setError(`You can add up to ${MAX_PROMO_PHOTOS} photos — only the first ${allowed.length} were added.`);
    }
    if (inputRef.current) inputRef.current.value = "";

    for (const file of allowed) {
      const check = validatePromoDeclaration(file.type, file.size);
      if (!check.ok) { setError(`${file.name}: ${check.error}`); continue; }
      setUploading((n) => n + 1);
      try {
        const prep = await fetch("/api/promo-photos/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
        });
        const prepJson = await prep.json();
        if (!prep.ok) throw new Error(prepJson.error ?? "Couldn't upload that photo.");

        const { error: upErr } = await createClient()
          .storage.from(PROMO_BUCKET)
          .uploadToSignedUrl(prepJson.path, prepJson.token, file, { contentType: file.type });
        if (upErr) throw new Error("Couldn't upload that photo. Try again.");

        const reg = await fetch("/api/promo-photos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: prepJson.path, name: file.name }),
        });
        const regJson = await reg.json();
        if (!reg.ok) throw new Error(regJson.error ?? "Couldn't save that photo.");
        setPhotos((prev) => [...prev, regJson.photo]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't add that photo.");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this photo?")) return;
    setError("");
    const res = await fetch(`/api/promo-photos/${id}`, { method: "DELETE" });
    if (res.ok) setPhotos((prev) => prev.filter((p) => p.id !== id));
    else setError("Couldn't remove that photo — please try again.");
  }

  return (
    <div>
      <p className="text-xs mb-3" style={{ color: "#9a9591", lineHeight: 1.6 }}>
        {`Add up to ${MAX_PROMO_PHOTOS} photos venues can use to promote your shows.`}{" "} They&apos;re private: only a venue you&apos;ve
        booked can see and download them, and they never appear on your public profile. By adding them you&apos;re
        okay with that venue using them to promote the show.
      </p>

      {loading ? (
        <p className="text-xs" style={{ color: "#5e5c58" }}>Loading…</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative aspect-square rounded-lg overflow-hidden" style={{ backgroundColor: "#1e2128" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL, not optimizable by next/image */}
              <img src={p.url} alt={p.file_name} loading="lazy" className="w-full h-full object-cover" />
              <button
                onClick={() => remove(p.id)}
                aria-label={`Remove ${p.file_name}`}
                className="absolute top-1 right-1 w-6 h-6 rounded-full text-xs flex items-center justify-center"
                style={{ backgroundColor: "rgba(14,14,16,0.8)", color: "#F4E8D2" }}
              >
                ✕
              </button>
            </div>
          ))}
          {Array.from({ length: uploading }).map((_, i) => (
            <div
              key={`up-${i}`}
              className="aspect-square rounded-lg flex items-center justify-center text-xs"
              style={{ backgroundColor: "#1e2128", color: "#9a9591" }}
            >
              Uploading…
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 mt-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={slotsLeft <= 0}
          className="text-xs px-3 py-2 rounded-lg font-semibold transition-all hover:brightness-110 disabled:opacity-40"
          style={{ backgroundColor: "rgba(212,166,79,0.12)", color: "#D4A64F", border: "1px solid rgba(212,166,79,0.3)" }}
        >
          + Add photos
        </button>
        <span className="text-xs" style={{ color: "#5e5c58" }}>{photos.length} of {MAX_PROMO_PHOTOS}</span>
      </div>
      {error && <p className="text-xs mt-2" style={{ color: "#e25c5c" }}>{error}</p>}
    </div>
  );
}
