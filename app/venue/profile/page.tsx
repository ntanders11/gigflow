"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { VenueProfile } from "@/types";
import VenueNav from "@/components/venue/VenueNav";
import PushToggle from "@/components/notifications/PushToggle";
import PhotoCropModal from "@/components/profile/PhotoCropModal";
import RatingsSummaryCard from "@/components/ratings/RatingsSummaryCard";

const inputStyle = {
  background: "#1e2128",
  border: "1px solid rgba(255,255,255,0.07)",
  color: "#F4E8D2",
};
const labelStyle = { color: "#9a9591" };

export default function VenueProfilePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<VenueProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropFileName, setCropFileName] = useState("");
  const [cropFileType, setCropFileType] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/venue-profile");
        setProfile(res.ok ? await res.json() : null);
      } catch {
        setProfile(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError("");
    // Show crop modal instead of uploading directly — same flow the
    // artist side's profile photo upload uses.
    const objectUrl = URL.createObjectURL(file);
    setCropSrc(objectUrl);
    setCropFileName(file.name);
    setCropFileType(file.type || "image/jpeg");
    e.target.value = "";
  }

  async function handleCropSave(croppedFile: File) {
    setCropSrc(null);
    const res = await fetch("/api/upload-photo", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "x-file-name": "avatar.jpg" },
      body: croppedFile,
      signal: AbortSignal.timeout(20000),
    });

    let data: { url?: string; error?: string } = {};
    try {
      data = await res.json();
    } catch {
      setPhotoError("Upload failed — the photo may be too large. Try a smaller image.");
      return;
    }

    if (!res.ok || !data.url) {
      setPhotoError(data.error ?? "Upload failed");
      return;
    }

    const patchRes = await fetch("/api/venue-profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photo_url: data.url }),
    });
    if (patchRes.ok) {
      setProfile(await patchRes.json());
    } else {
      setPhotoError("Photo uploaded, but saving it to your profile failed — try again.");
    }
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/venues");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const res = await fetch("/api/venue-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venue_name: profile.venue_name,
          city: profile.city,
          address: profile.address,
          venue_type: profile.venue_type,
          description: profile.description,
          genres: profile.genres,
          stage_equipment: profile.stage_equipment,
          contact_email: profile.contact_email,
          contact_phone: profile.contact_phone,
        }),
      });

      if (res.ok) {
        setProfile(await res.json());
        setSaved(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Couldn't save your changes — please try again.");
      }
    } catch {
      setError("Couldn't save your changes — please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;
  if (!profile) return <div className="p-8" style={{ color: "#9a9591" }}>Couldn&apos;t load your profile.</div>;

  return (
    <div className="min-h-screen pb-28 md:pb-0" style={{ backgroundColor: "#0E0E10" }}>
      {cropSrc && (
        <PhotoCropModal
          imageSrc={cropSrc}
          fileName={cropFileName}
          fileType={cropFileType}
          onSave={handleCropSave}
          onCancel={() => setCropSrc(null)}
        />
      )}
      <VenueNav />
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold" style={{ color: "#F4E8D2" }}>{profile.venue_name}</h1>
          <button onClick={handleSignOut} className="text-xs" style={labelStyle}>Sign out</button>
        </div>

        {/* Photo + Ratings */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div
            className="rounded-xl p-4 text-center sm:w-52 sm:shrink-0"
            style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="w-20 h-20 mx-auto mb-3">
              {profile.photo_url ? (
                <img
                  src={`${profile.photo_url}?t=${new Date(profile.updated_at ?? "").getTime()}`}
                  alt="Venue"
                  className="w-20 h-20 rounded-full object-cover"
                />
              ) : (
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold"
                  style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}
                >
                  {profile.venue_name ? profile.venue_name.charAt(0).toUpperCase() : "?"}
                </div>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md px-3 py-1 text-xs font-medium transition-all hover:brightness-125"
              style={{ backgroundColor: "rgba(212,166,79,0.12)", border: "1px solid rgba(212,166,79,0.3)", color: "#D4A64F" }}
            >
              {profile.photo_url ? "Change photo" : "Upload photo"}
            </button>
            {photoError && (
              <p style={{ color: "#e25c5c", fontSize: "10px", marginTop: "6px" }}>{photoError}</p>
            )}
          </div>

          <div className="flex-1">
            <RatingsSummaryCard endpoint={`/api/public/venues/${profile.id}/ratings`} viewAllHref="/venue/ratings" />
          </div>
        </div>

        <div
          className="rounded-xl p-4 mb-6"
          style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <PushToggle />
        </div>

        {error && (
          <p className="text-sm mb-4 px-3 py-2 rounded-lg" style={{ backgroundColor: "rgba(226,92,92,0.1)", color: "#e25c5c" }}>
            {error}
          </p>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs mb-1.5" style={labelStyle}>Venue name</label>
            <input required value={profile.venue_name ?? ""} onChange={(e) => setProfile({ ...profile, venue_name: e.target.value })}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>City</label>
              <input value={profile.city ?? ""} onChange={(e) => setProfile({ ...profile, city: e.target.value })}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Venue type</label>
              <input value={profile.venue_type ?? ""} onChange={(e) => setProfile({ ...profile, venue_type: e.target.value })}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={labelStyle}>Address</label>
            <input value={profile.address ?? ""} onChange={(e) => setProfile({ ...profile, address: e.target.value })}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={labelStyle}>Description</label>
            <textarea rows={3} value={profile.description ?? ""} onChange={(e) => setProfile({ ...profile, description: e.target.value })}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none" style={inputStyle} />
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={labelStyle}>Genres you book</label>
            <input value={profile.genres.join(", ")} onChange={(e) => setProfile({ ...profile, genres: e.target.value.split(",").map((g) => g.trim()).filter(Boolean) })}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
          </div>
          <div>
            <label className="block text-xs mb-1.5" style={labelStyle}>Stage & equipment</label>
            <textarea rows={2} value={profile.stage_equipment ?? ""} onChange={(e) => setProfile({ ...profile, stage_equipment: e.target.value })}
              className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none" style={inputStyle} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Contact email</label>
              <input type="email" value={profile.contact_email ?? ""} onChange={(e) => setProfile({ ...profile, contact_email: e.target.value })}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={labelStyle}>Contact phone</label>
              <input value={profile.contact_phone ?? ""} onChange={(e) => setProfile({ ...profile, contact_phone: e.target.value })}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none" style={inputStyle} />
            </div>
          </div>
          <button type="submit" disabled={saving}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
            style={{ backgroundColor: "#D4A64F", color: "#0E0E10", opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
          {saved && <span className="text-xs ml-3" style={{ color: "#4caf7d" }}>Saved</span>}
        </form>
      </div>
    </div>
  );
}
