"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Step = 1 | 2 | 3 | 4;

interface FormData {
  // Step 1
  displayName: string;
  phone: string;
  // Step 2
  city: string;
  zipCode: string;
  radiusMi: number;
  // Step 3
  website: string;
  youtube: string;
  instagram: string;
  // Step 4
  bio: string;
  photoFile: File | null;
  photoPreview: string | null;
}

const INITIAL: FormData = {
  displayName: "", phone: "",
  city: "", zipCode: "", radiusMi: 30,
  website: "", youtube: "", instagram: "",
  bio: "", photoFile: null, photoPreview: null,
};

function ProgressBar({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {[1, 2, 3, 4].map((s) => (
        <div
          key={s}
          className="h-1 flex-1 rounded-full transition-colors duration-300"
          style={{ backgroundColor: s <= step ? "#9b7fe8" : "#262b33" }}
        />
      ))}
      <span className="text-xs ml-3 shrink-0" style={{ color: "#9a9591" }}>
        Step {step} of 4
      </span>
    </div>
  );
}

const inputStyle = {
  background: "#1e2128",
  border: "1px solid rgba(255,255,255,0.07)",
  color: "#f0ede8",
};

const labelStyle = { color: "#9a9591" };

export default function OnboardingPage() {
  const router  = useRouter();
  const [step, setStep]   = useState<Step>(1);
  const [form, setForm]   = useState<FormData>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function update(fields: Partial<FormData>) {
    setForm((prev) => ({ ...prev, ...fields }));
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Photo must be under 5MB.");
      return;
    }
    if (form.photoPreview) {
      URL.revokeObjectURL(form.photoPreview);
    }
    update({
      photoFile: file,
      photoPreview: URL.createObjectURL(file),
    });
  }

  async function finish() {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      router.push("/login");
      return;
    }

    // Upload photo if provided
    let photoUrl: string | null = null;
    if (form.photoFile) {
      const mimeToExt: Record<string, string> = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
      };
      const ext = mimeToExt[form.photoFile.type] ?? "jpg";
      const path = `${user.id}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("artist-photos")
        .upload(path, form.photoFile, { upsert: true });
      if (uploadError) {
        setError("Photo upload failed: " + uploadError.message);
        setSaving(false);
        return;
      }
      const { data: urlData } = supabase.storage.from("artist-photos").getPublicUrl(path);
      photoUrl = urlData.publicUrl;
    }

    // Upsert artist_profiles
    const socialLinks: Record<string, string> = {};
    if (form.website)   socialLinks.website   = form.website;
    if (form.youtube)   socialLinks.youtube   = form.youtube;
    if (form.instagram) socialLinks.instagram = form.instagram;

    const { error: profileError } = await supabase
      .from("artist_profiles")
      .upsert({
        user_id:      user.id,
        display_name: form.displayName.trim(),
        phone:        form.phone.trim() || null,
        bio:          form.bio.trim()   || null,
        social_links: socialLinks,
        ...(photoUrl ? { photo_url: photoUrl } : {}),
      }, { onConflict: "user_id" });

    if (profileError) {
      setError("Failed to save profile: " + profileError.message);
      setSaving(false);
      return;
    }

    // Upsert zone — the unique(user_id, name) constraint lets us safely
    // insert or update based on the city name. Existing zones with different
    // names are preserved, so re-submitting onboarding never deletes venue data.
    const { error: zoneError } = await supabase
      .from("zones")
      .upsert({
        user_id:   user.id,
        name:      form.city.trim(),
        zip_code:  form.zipCode.trim() || null,
        radius_mi: form.radiusMi,
      }, { onConflict: "user_id,name" });

    if (zoneError) {
      setError("Failed to save region: " + zoneError.message);
      setSaving(false);
      return;
    }

    router.push("/dashboard");
  }

  const card = {
    backgroundColor: "#16181c",
    border: "1px solid rgba(255,255,255,0.07)",
  };

  const continueBtn = {
    backgroundColor: "#9b7fe8",
    color: "#ffffff",
  };

  const backBtn = {
    backgroundColor: "#262b33",
    color: "#9a9591",
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#0e0f11" }}>
      <div className="rounded-xl p-8 w-full max-w-sm" style={card}>
        <div className="mb-6">
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: "1.5rem", color: "#d4a853" }}>
            GigFlow
          </h1>
        </div>

        <ProgressBar step={step} />

        {/* ── Step 1 ── */}
        {step === 1 && (
          <div>
            <h2 className="text-base font-semibold mb-1" style={{ color: "#f0ede8" }}>Tell us about you</h2>
            <p className="text-xs mb-5" style={{ color: "#9a9591" }}>This shows up in your pitch emails.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={labelStyle}>Artist / Stage Name</label>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => update({ displayName: e.target.value })}
                  placeholder="Taylor Anderson"
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={labelStyle}>Phone Number</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update({ phone: e.target.value })}
                  placeholder="(503) 555-0123"
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={inputStyle}
                />
              </div>
            </div>
            <button
              onClick={() => { if (!form.displayName.trim()) return; setStep(2); }}
              disabled={!form.displayName.trim()}
              className="w-full mt-6 rounded-lg py-2 text-sm font-semibold disabled:opacity-40"
              style={continueBtn}
            >
              Continue →
            </button>
          </div>
        )}

        {/* ── Step 2 ── */}
        {step === 2 && (
          <div>
            <h2 className="text-base font-semibold mb-1" style={{ color: "#f0ede8" }}>Where are you based?</h2>
            <p className="text-xs mb-5" style={{ color: "#9a9591" }}>We&apos;ll use this to find venues near you.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={labelStyle}>Home City</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => update({ city: e.target.value })}
                  placeholder="Newberg, OR"
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={inputStyle}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1" style={labelStyle}>Zip Code</label>
                  <input
                    type="text"
                    value={form.zipCode}
                    onChange={(e) => update({ zipCode: e.target.value })}
                    placeholder="97132"
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                    style={inputStyle}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1" style={labelStyle}>Radius (miles)</label>
                  <select
                    value={form.radiusMi}
                    onChange={(e) => update({ radiusMi: Number(e.target.value) })}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                    style={inputStyle}
                  >
                    {[10, 20, 30, 50, 75, 100].map((r) => (
                      <option key={r} value={r}>{r} mi</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(1)} className="flex-1 rounded-lg py-2 text-sm" style={backBtn}>← Back</button>
              <button
                onClick={() => { if (!form.city.trim()) return; setStep(3); }}
                disabled={!form.city.trim()}
                className="flex-[2] rounded-lg py-2 text-sm font-semibold disabled:opacity-40"
                style={continueBtn}
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3 ── */}
        {step === 3 && (
          <div>
            <h2 className="text-base font-semibold mb-1" style={{ color: "#f0ede8" }}>Your links</h2>
            <p className="text-xs mb-5" style={{ color: "#9a9591" }}>Added to your pitch emails automatically. All optional.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={labelStyle}>Website</label>
                <input type="url" value={form.website} onChange={(e) => update({ website: e.target.value })} placeholder="https://yourname.com" className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none" style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={labelStyle}>YouTube (sample video link)</label>
                <input type="url" value={form.youtube} onChange={(e) => update({ youtube: e.target.value })} placeholder="https://youtube.com/watch?v=..." className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none" style={inputStyle} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={labelStyle}>Instagram</label>
                <input type="text" value={form.instagram} onChange={(e) => update({ instagram: e.target.value })} placeholder="@yourhandle" className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none" style={inputStyle} />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(2)} className="flex-1 rounded-lg py-2 text-sm" style={backBtn}>← Back</button>
              <button onClick={() => setStep(4)} className="flex-[2] rounded-lg py-2 text-sm font-semibold" style={continueBtn}>Continue →</button>
            </div>
            <button onClick={() => setStep(4)} className="w-full mt-3 text-xs" style={{ color: "#5e5c58" }}>Skip for now</button>
          </div>
        )}

        {/* ── Step 4 ── */}
        {step === 4 && (
          <div>
            <h2 className="text-base font-semibold mb-1" style={{ color: "#f0ede8" }}>Almost there — bio &amp; photo</h2>
            <p className="text-xs mb-5" style={{ color: "#9a9591" }}>Shows on your public profile page. Both optional.</p>

            {/* Photo upload */}
            <div className="mb-4">
              <label className="block text-xs font-medium mb-2" style={labelStyle}>Profile Photo</label>
              <div className="flex items-center gap-4">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
                  style={{ background: "#262b33", border: "2px dashed rgba(255,255,255,0.15)" }}
                >
                  {form.photoPreview
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={form.photoPreview} alt="Preview" className="w-full h-full object-cover" />
                    : <span className="text-2xl">🎸</span>
                  }
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg px-3 py-1.5 text-xs"
                    style={{ background: "#1e2128", border: "1px solid rgba(255,255,255,0.1)", color: "#9a9591" }}
                  >
                    {form.photoFile ? "Change photo" : "Upload photo"}
                  </button>
                  <p className="text-xs mt-1" style={{ color: "#5e5c58" }}>JPG or PNG, up to 5MB</p>
                </div>
              </div>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhotoChange} />
            </div>

            {/* Bio */}
            <div className="mb-5">
              <label className="block text-xs font-medium mb-1" style={labelStyle}>Bio</label>
              <textarea
                value={form.bio}
                onChange={(e) => update({ bio: e.target.value })}
                placeholder="I'm a singer-songwriter based in the Pacific Northwest…"
                rows={3}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                style={inputStyle}
              />
            </div>

            {error && (
              <p className="text-xs rounded-lg px-3 py-2 mb-4" style={{ color: "#e25c5c", backgroundColor: "rgba(226,92,92,0.1)", border: "1px solid rgba(226,92,92,0.2)" }}>
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep(3)} className="flex-1 rounded-lg py-2 text-sm" style={backBtn}>← Back</button>
              <button
                onClick={finish}
                disabled={saving}
                className="flex-[2] rounded-lg py-2 text-sm font-semibold disabled:opacity-50"
                style={{ backgroundColor: "#d4a853", color: "#0e0f11" }}
              >
                {saving ? "Saving…" : "Let's go! 🎸"}
              </button>
            </div>
            <button onClick={finish} disabled={saving} className="w-full mt-3 text-xs disabled:opacity-50" style={{ color: "#5e5c58" }}>Skip for now</button>
          </div>
        )}
      </div>
    </div>
  );
}
