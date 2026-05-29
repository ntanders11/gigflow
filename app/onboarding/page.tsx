"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import PhotoCropModal from "@/components/profile/PhotoCropModal";

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
  const [step, setStep]     = useState<Step>(1);
  const [form, setForm]     = useState<FormData>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Crop modal state
  const [cropSrc, setCropSrc]         = useState<string | null>(null);
  const [cropFileName, setCropFileName] = useState("");
  const [cropFileType, setCropFileType] = useState("");

  function update(fields: Partial<FormData>) {
    setForm((prev) => ({ ...prev, ...fields }));
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    // Open crop modal instead of uploading directly
    const objectUrl = URL.createObjectURL(file);
    setCropSrc(objectUrl);
    setCropFileName(file.name);
    setCropFileType(file.type || "image/jpeg");
    // Reset input so same file can be re-selected
    e.target.value = "";
  }

  function handleCropSave(croppedFile: File) {
    setCropSrc(null);
    if (form.photoPreview) URL.revokeObjectURL(form.photoPreview);
    update({
      photoFile: croppedFile,
      photoPreview: URL.createObjectURL(croppedFile),
    });
  }

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      await doFinish();
    } catch (err) {
      console.error("Onboarding finish error:", err);
      setError("Something went wrong — please try again.");
      setSaving(false);
    }
  }

  async function doFinish() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      router.push("/login");
      return;
    }

    // ── 1. Upload photo via service-role API route ─────────────────────────
    let photoUrl: string | null = null;
    if (form.photoFile) {
      const res = await fetch("/api/upload-photo", {
        method: "POST",
        headers: {
          "Content-Type": "image/jpeg",
          "x-file-name": "avatar.jpg",
        },
        body: form.photoFile,
        signal: AbortSignal.timeout(20000), // 20 s max — don't hang forever
      });

      let uploadData: { url?: string; error?: string } = {};
      try { uploadData = await res.json(); } catch { /* ignore */ }

      if (!res.ok || !uploadData.url) {
        setError("Photo upload failed — please try again or skip the photo for now.");
        setSaving(false);
        return;
      }
      photoUrl = uploadData.url;
    }

    // ── 2. Save artist profile via API route ─────────────────────────────
    const socialLinks: Record<string, string> = {};
    if (form.website)   socialLinks.website   = form.website;
    if (form.youtube)   socialLinks.youtube   = form.youtube;
    if (form.instagram) socialLinks.instagram = form.instagram;

    const profileRes = await fetch("/api/artist-profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        display_name: form.displayName.trim(),
        phone:        form.phone.trim() || null,
        bio:          form.bio.trim()   || null,
        social_links: socialLinks,
        ...(photoUrl ? { photo_url: photoUrl } : {}),
      }),
      signal: AbortSignal.timeout(15000), // 15 s max
    });

    if (!profileRes.ok) {
      const d = await profileRes.json().catch(() => ({})) as { error?: string };
      setError("Failed to save profile: " + (d.error ?? "Please try again."));
      setSaving(false);
      return;
    }

    // ── 3. Save zone (no unique-constraint dependency) ─────────────────────
    // Check if the user already has a zone; update it if so, insert if not.
    // Avoids relying on a UNIQUE(user_id, name) constraint in the DB.
    const { data: existingZone } = await supabase
      .from("zones")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingZone?.id) {
      await supabase
        .from("zones")
        .update({
          name:      form.city.trim(),
          zip_code:  form.zipCode.trim() || null,
          radius_mi: form.radiusMi,
        })
        .eq("id", existingZone.id);
    } else {
      const { error: zoneError } = await supabase
        .from("zones")
        .insert({
          user_id:   user.id,
          name:      form.city.trim(),
          zip_code:  form.zipCode.trim() || null,
          radius_mi: form.radiusMi,
        });

      if (zoneError) {
        setError("Failed to save region: " + zoneError.message);
        setSaving(false);
        return;
      }
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
      {/* Crop modal — shown when user picks a photo */}
      {cropSrc && (
        <PhotoCropModal
          imageSrc={cropSrc}
          fileName={cropFileName}
          fileType={cropFileType}
          onSave={handleCropSave}
          onCancel={() => setCropSrc(null)}
        />
      )}

      <div className="rounded-xl p-8 w-full max-w-sm" style={card}>
        <div className="mb-6">
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: "1.5rem", color: "#d4a853" }}>
            StageReach
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
                  <p className="text-xs mt-1" style={{ color: "#5e5c58" }}>Any size — we&apos;ll crop it</p>
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
