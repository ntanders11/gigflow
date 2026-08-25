"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { VenueProfile } from "@/types";
import VenueNav from "@/components/venue/VenueNav";
import PushToggle from "@/components/notifications/PushToggle";

const inputStyle = {
  background: "#1e2128",
  border: "1px solid rgba(255,255,255,0.07)",
  color: "#F4E8D2",
};
const labelStyle = { color: "#9a9591" };

export default function VenueProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<VenueProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="min-h-screen" style={{ backgroundColor: "#0E0E10" }}>
      <VenueNav />
      <div className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold" style={{ color: "#F4E8D2" }}>{profile.venue_name}</h1>
          <button onClick={handleSignOut} className="text-xs" style={labelStyle}>Sign out</button>
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
