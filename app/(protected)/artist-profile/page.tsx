"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { ArtistProfile, Package, VideoSample, SocialLinks } from "@/types";
import PhotoCropModal from "@/components/profile/PhotoCropModal";

const DEFAULT_PACKAGES: Package[] = [
  { id: "solo", label: "Solo", price_min: null, price_max: null, description: "", duration: "", color: "#d4a853" },
  { id: "trio", label: "Trio", price_min: null, price_max: null, description: "", duration: "", color: "#9b7fe8" },
  { id: "five_piece", label: "Five Piece Band", price_min: null, price_max: null, description: "", duration: "", color: "#4caf7d" },
];

const DEFAULT_SOCIAL: SocialLinks = { instagram: "", spotify: "", youtube: "", website: "" };

const SOCIAL_PLATFORMS: { key: keyof SocialLinks; label: string; color: string; icon: string }[] = [
  { key: "instagram", label: "Instagram", color: "#e1306c", icon: "IG" },
  { key: "spotify",   label: "Spotify",   color: "#1db954", icon: "SP" },
  { key: "youtube",   label: "YouTube",   color: "#ff0000", icon: "YT" },
  { key: "website",   label: "Website",   color: "#9a9591", icon: "🌐" },
];

function detectPlatform(url: string): VideoSample["platform"] {
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  if (url.includes("spotify.com")) return "spotify";
  return "other";
}

function formatPrice(min: number | null, max: number | null): string {
  if (min && max) return `$${min.toLocaleString()}–$${max.toLocaleString()}`;
  if (min) return `$${min.toLocaleString()}+`;
  if (max) return `Up to $${max.toLocaleString()}`;
  return "";
}

export default function ArtistProfilePage() {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<ArtistProfile | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropFileName, setCropFileName] = useState("");
  const [cropFileType, setCropFileType] = useState("");

  // Name + phone editing
  const [editingContact, setEditingContact] = useState(false);
  const [nameText, setNameText] = useState("");
  const [phoneText, setPhoneText] = useState("");

  // Bio editing
  const [editingBio, setEditingBio] = useState(false);
  const [bioText, setBioText] = useState("");

  // Social links editing
  const [editingSocial, setEditingSocial] = useState(false);
  const [socialEdits, setSocialEdits] = useState<SocialLinks>(DEFAULT_SOCIAL);

  // Genre editing
  const [newGenre, setNewGenre] = useState("");
  const [showGenreInput, setShowGenreInput] = useState(false);

  // Video samples
  const [showVideoForm, setShowVideoForm] = useState(false);
  const [newVideoUrl, setNewVideoUrl] = useState("");
  const [newVideoTitle, setNewVideoTitle] = useState("");

  // Package editing — tracks which package is in edit mode + its edits
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [packageEdits, setPackageEdits] = useState<Partial<Package>>({});

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const res = await fetch("/api/artist-profile");
      if (res.ok) {
        const data: ArtistProfile = await res.json();
        setProfile(data);
        setNameText(data.display_name || "");
        setPhoneText(data.phone || "");
        setBioText(data.bio || "");
        setSocialEdits(data.social_links || DEFAULT_SOCIAL);
      }
      setLoading(false);
    }
    load();
  }, []);

  async function save(updates: Partial<ArtistProfile>) {
    setSaving(true);
    const res = await fetch("/api/artist-profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const data: ArtistProfile = await res.json();
      setProfile(data);
      setSocialEdits(data.social_links || DEFAULT_SOCIAL);
    }
    setSaving(false);
  }

  function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError("");
    // Show crop modal instead of uploading directly
    const objectUrl = URL.createObjectURL(file);
    setCropSrc(objectUrl);
    setCropFileName(file.name);
    setCropFileType(file.type || "image/jpeg");
    // Reset input so same file can be re-selected
    e.target.value = "";
  }

  async function handleCropSave(croppedFile: File) {
    setCropSrc(null);
    const res = await fetch("/api/upload-photo", {
      method: "POST",
      headers: {
        "Content-Type": croppedFile.type || "image/jpeg",
        "x-file-name": croppedFile.name,
      },
      body: croppedFile,
    });

    let data: { url?: string; error?: string } = {};
    try {
      data = await res.json();
    } catch {
      setPhotoError("Server error — check that the dev server is running");
      return;
    }

    if (res.ok && data.url) {
      await save({ photo_url: data.url });
    } else {
      setPhotoError(data.error ?? "Upload failed");
    }
  }

  function copyShareLink() {
    if (!userId) return;
    navigator.clipboard.writeText(`${window.location.origin}/profile/${userId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function startEditPackage(pkg: Package) {
    setEditingPackageId(pkg.id);
    setPackageEdits({
      price_min: pkg.price_min,
      price_max: pkg.price_max,
      description: pkg.description,
      duration: pkg.duration,
    });
  }

  function savePackage(pkgId: string) {
    const updated = packages.map((p) =>
      p.id === pkgId ? { ...p, ...packageEdits } : p
    );
    save({ packages: updated });
    setEditingPackageId(null);
    setPackageEdits({});
  }

  function cancelEditPackage() {
    setEditingPackageId(null);
    setPackageEdits({});
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#0e0f11" }}>
        <div style={{ color: "#5e5c58", fontSize: "13px" }}>Loading…</div>
      </div>
    );
  }

  const packages = profile?.packages?.length ? profile.packages : DEFAULT_PACKAGES;
  const genres = profile?.genres || [];
  const videos = profile?.video_samples || [];
  const social = profile?.social_links || DEFAULT_SOCIAL;

  return (
    <div className="min-h-screen p-8" style={{ backgroundColor: "#0e0f11", color: "#f0ede8" }}>
      {cropSrc && (
        <PhotoCropModal
          imageSrc={cropSrc}
          fileName={cropFileName}
          fileType={cropFileType}
          onSave={handleCropSave}
          onCancel={() => setCropSrc(null)}
        />
      )}
      {/* Header */}
      <div className="flex items-center justify-between mb-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#f0ede8" }}>
            My Artist Profile
          </h1>
          <p className="text-xs mt-1" style={{ color: "#5e5c58" }}>
            Your EPK and booking profile — fill it in, then share the link with venues.
          </p>
        </div>
        {saving && <span style={{ color: "#5e5c58", fontSize: "11px" }}>Saving…</span>}
      </div>

      {/* Two-column layout */}
      <div className="flex gap-5 max-w-5xl items-start">

        {/* ── LEFT SIDEBAR ── */}
        <div className="w-52 shrink-0 flex flex-col gap-3 sticky top-8">

          {/* Photo + Name */}
          <div
            className="rounded-xl p-4 text-center"
            style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="w-20 h-20 mx-auto mb-3">
              {profile?.photo_url ? (
                <img
                  src={`${profile.photo_url}?t=${new Date(profile.updated_at ?? "").getTime()}`}
                  alt="Profile"
                  className="w-20 h-20 rounded-full object-cover"
                />
              ) : (
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold"
                  style={{ background: "linear-gradient(135deg, #d4a853 0%, #8b5cf6 100%)", color: "#fff" }}
                >
                  TA
                </div>
              )}
            </div>
            <div style={{ color: "#f0ede8", fontSize: "13px", fontWeight: 700, marginBottom: "2px" }}>
              Taylor Anderson
            </div>
            <div style={{ color: "#9a9591", fontSize: "10px", marginBottom: "12px" }}>
              Newberg, OR
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handlePhotoUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md px-3 py-1 text-xs font-medium transition-all hover:brightness-125"
              style={{
                backgroundColor: "rgba(212,168,83,0.12)",
                border: "1px solid rgba(212,168,83,0.3)",
                color: "#d4a853",
              }}
            >
              {profile?.photo_url ? "Change photo" : "Upload photo"}
            </button>
            {photoError && (
              <p style={{ color: "#e25c5c", fontSize: "10px", marginTop: "6px" }}>
                {photoError}
              </p>
            )}
          </div>

          {/* Genre & Style */}
          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div
              style={{
                fontSize: "9px", color: "#5e5c58", textTransform: "uppercase",
                letterSpacing: "0.1em", marginBottom: "8px",
              }}
            >
              Genre &amp; Style
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {genres.map((g) => (
                <span key={g} className="flex items-center gap-1">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs"
                    style={{ backgroundColor: "#1e2128", color: "#9a9591" }}
                  >
                    {g}
                  </span>
                  <button
                    onClick={() => save({ genres: genres.filter((x) => x !== g) })}
                    style={{ color: "#5e5c58", fontSize: "12px", lineHeight: 1, cursor: "pointer" }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            {showGenreInput ? (
              <input
                autoFocus
                value={newGenre}
                onChange={(e) => setNewGenre(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newGenre.trim()) {
                    save({ genres: [...genres, newGenre.trim()] });
                    setNewGenre("");
                    setShowGenreInput(false);
                  } else if (e.key === "Escape") {
                    setNewGenre("");
                    setShowGenreInput(false);
                  }
                }}
                onBlur={() => {
                  if (newGenre.trim()) {
                    save({ genres: [...genres, newGenre.trim()] });
                  }
                  setNewGenre("");
                  setShowGenreInput(false);
                }}
                placeholder="e.g. Folk"
                className="w-full rounded px-2 py-1 text-xs outline-none"
                style={{ backgroundColor: "#1e2128", color: "#f0ede8", border: "1px solid rgba(212,168,83,0.3)" }}
              />
            ) : (
              <button
                onClick={() => setShowGenreInput(true)}
                className="rounded-full px-2 py-0.5 text-xs transition-all hover:brightness-125"
                style={{
                  backgroundColor: "rgba(212,168,83,0.1)",
                  color: "#d4a853",
                  border: "1px dashed rgba(212,168,83,0.4)",
                }}
              >
                + Add
              </button>
            )}
          </div>

          {/* Social Links */}
          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="flex items-center justify-between mb-2">
              <div
                style={{
                  fontSize: "9px", color: "#5e5c58", textTransform: "uppercase", letterSpacing: "0.1em",
                }}
              >
                Social Links
              </div>
              {!editingSocial && (
                <button
                  onClick={() => { setSocialEdits(social); setEditingSocial(true); }}
                  style={{ color: "#d4a853", fontSize: "10px", cursor: "pointer" }}
                >
                  Edit
                </button>
              )}
            </div>

            {editingSocial ? (
              <div className="flex flex-col gap-1.5">
                {SOCIAL_PLATFORMS.map((p) => (
                  <div key={p.key} className="flex items-center gap-1.5">
                    <span style={{ color: p.color, fontSize: "10px", width: "18px", textAlign: "center" }}>
                      {p.icon}
                    </span>
                    <input
                      value={socialEdits[p.key] || ""}
                      onChange={(e) => setSocialEdits((s) => ({ ...s, [p.key]: e.target.value }))}
                      placeholder={p.label}
                      className="flex-1 rounded px-2 py-1 text-xs outline-none"
                      style={{ backgroundColor: "#1e2128", color: "#f0ede8", border: "1px solid rgba(255,255,255,0.1)" }}
                    />
                  </div>
                ))}
                <div className="flex gap-1.5 mt-1">
                  <button
                    onClick={() => { save({ social_links: socialEdits }); setEditingSocial(false); }}
                    className="flex-1 rounded py-1 text-xs font-semibold transition-all hover:brightness-110"
                    style={{ backgroundColor: "#d4a853", color: "#0e0f11", cursor: "pointer" }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingSocial(false)}
                    className="flex-1 rounded py-1 text-xs transition-all hover:brightness-125"
                    style={{ backgroundColor: "#1e2128", color: "#9a9591", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {SOCIAL_PLATFORMS.map((p) => {
                  const val = social[p.key];
                  if (!val) return null;
                  const href = val.startsWith("http") ? val : `https://${val}`;
                  return (
                    <a
                      key={p.key}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded px-2 py-1.5 transition-all hover:brightness-125"
                      style={{ backgroundColor: "#1e2128" }}
                    >
                      <span style={{ color: p.color, fontSize: "10px", width: "18px", textAlign: "center" }}>
                        {p.icon}
                      </span>
                      <span className="flex-1 truncate" style={{ color: "#9a9591", fontSize: "10px" }}>
                        {p.label}
                      </span>
                      <span style={{ color: "#5e5c58", fontSize: "9px" }}>↗</span>
                    </a>
                  );
                })}
                {!Object.values(social).some(Boolean) && (
                  <p style={{ color: "#5e5c58", fontSize: "10px" }}>No links yet. Click Edit to add.</p>
                )}
              </div>
            )}
          </div>

          {/* Share button */}
          <button
            onClick={copyShareLink}
            className="w-full rounded-lg py-2 text-xs font-bold transition-all hover:brightness-110"
            style={{ backgroundColor: "#d4a853", color: "#0e0f11", cursor: "pointer" }}
          >
            {copied ? "Link copied! ✓" : "Share Public Profile ↗"}
          </button>
        </div>

        {/* ── RIGHT MAIN CONTENT ── */}
        <div className="flex-1 flex flex-col gap-4">

          {/* Contact Info */}
          <div
            className="rounded-xl p-5"
            style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="flex items-center justify-between mb-3">
              <div style={{ fontSize: "9px", color: "#5e5c58", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Contact Info
              </div>
              {editingContact ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => { save({ display_name: nameText, phone: phoneText }); setEditingContact(false); }}
                    className="text-xs px-2.5 py-0.5 rounded font-semibold transition-all hover:brightness-110"
                    style={{ backgroundColor: "#d4a853", color: "#0e0f11", cursor: "pointer" }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setNameText(profile?.display_name || ""); setPhoneText(profile?.phone || ""); setEditingContact(false); }}
                    className="text-xs px-2.5 py-0.5 rounded transition-all hover:brightness-125"
                    style={{ backgroundColor: "#1e2128", color: "#9a9591", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button onClick={() => setEditingContact(true)} style={{ color: "#d4a853", fontSize: "11px", cursor: "pointer" }}>
                  Edit
                </button>
              )}
            </div>
            {editingContact ? (
              <div className="flex flex-col gap-2">
                <input
                  autoFocus
                  value={nameText}
                  onChange={(e) => setNameText(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={{ backgroundColor: "#1e2128", color: "#f0ede8", border: "1px solid rgba(212,168,83,0.3)" }}
                />
                <input
                  value={phoneText}
                  onChange={(e) => setPhoneText(e.target.value)}
                  placeholder="Phone number"
                  className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                  style={{ backgroundColor: "#1e2128", color: "#f0ede8", border: "1px solid rgba(212,168,83,0.3)" }}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1 cursor-text" onClick={() => setEditingContact(true)}>
                <p style={{ color: profile?.display_name ? "#f0ede8" : "#5e5c58", fontSize: "13px", fontWeight: 500 }}>
                  {profile?.display_name || "Add your name"}
                </p>
                <p style={{ color: profile?.phone ? "#9a9591" : "#5e5c58", fontSize: "12px" }}>
                  {profile?.phone || "Add your phone number"}
                </p>
              </div>
            )}
          </div>

          {/* Bio */}
          <div
            className="rounded-xl p-5"
            style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="flex items-center justify-between mb-3">
              <div style={{ fontSize: "9px", color: "#5e5c58", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Bio
              </div>
              {editingBio ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => { save({ bio: bioText }); setEditingBio(false); }}
                    className="text-xs px-2.5 py-0.5 rounded font-semibold transition-all hover:brightness-110"
                    style={{ backgroundColor: "#d4a853", color: "#0e0f11", cursor: "pointer" }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setBioText(profile?.bio || ""); setEditingBio(false); }}
                    className="text-xs px-2.5 py-0.5 rounded transition-all hover:brightness-125"
                    style={{ backgroundColor: "#1e2128", color: "#9a9591", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setEditingBio(true)}
                  style={{ color: "#d4a853", fontSize: "11px", cursor: "pointer" }}
                >
                  Edit
                </button>
              )}
            </div>
            {editingBio ? (
              <textarea
                autoFocus
                value={bioText}
                onChange={(e) => setBioText(e.target.value)}
                rows={5}
                className="w-full rounded-lg px-3 py-2.5 text-sm outline-none resize-none"
                style={{
                  backgroundColor: "#1e2128",
                  color: "#f0ede8",
                  border: "1px solid rgba(212,168,83,0.3)",
                  lineHeight: 1.6,
                }}
                placeholder="Tell venues who you are, what you play, and what makes your performances special…"
              />
            ) : (
              <p
                className="cursor-text"
                onClick={() => setEditingBio(true)}
                style={{
                  color: profile?.bio ? "#9a9591" : "#5e5c58",
                  fontSize: "13px",
                  lineHeight: 1.7,
                  fontStyle: profile?.bio ? "normal" : "italic",
                }}
              >
                {profile?.bio || "Click Edit to add your bio…"}
              </p>
            )}
          </div>

          {/* Video & Music Samples */}
          <div
            className="rounded-xl p-5"
            style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="flex items-center justify-between mb-3">
              <div style={{ fontSize: "9px", color: "#5e5c58", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Video &amp; Music Samples
              </div>
              {!showVideoForm && (
                <button
                  onClick={() => setShowVideoForm(true)}
                  style={{ color: "#d4a853", fontSize: "11px", cursor: "pointer" }}
                >
                  + Add
                </button>
              )}
            </div>

            {/* Existing samples */}
            {videos.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {videos.map((v) => {
                  const isYT = v.platform === "youtube";
                  const isSP = v.platform === "spotify";
                  const platformColor = isYT ? "#ff0000" : isSP ? "#1db954" : "#9a9591";
                  const platformIcon = isYT ? "▶" : isSP ? "♪" : "♫";
                  return (
                    <div
                      key={v.id}
                      className="flex items-center gap-2 rounded-lg px-3 py-2"
                      style={{ backgroundColor: "#1e2128", maxWidth: "240px" }}
                    >
                      <div
                        className="w-8 h-8 rounded flex items-center justify-center shrink-0 text-sm font-bold"
                        style={{ backgroundColor: platformColor, color: "#fff" }}
                      >
                        {platformIcon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate" style={{ color: "#f0ede8" }}>
                          {v.title || "Untitled"}
                        </div>
                        <a
                          href={v.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs hover:underline"
                          style={{ color: "#5e5c58" }}
                        >
                          Open ↗
                        </a>
                      </div>
                      <button
                        onClick={() => save({ video_samples: videos.filter((x) => x.id !== v.id) })}
                        style={{ color: "#5e5c58", fontSize: "16px", lineHeight: 1, cursor: "pointer" }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add video form */}
            {showVideoForm && (
              <div
                className="rounded-lg p-3 flex flex-col gap-2"
                style={{ backgroundColor: "#1e2128", border: "1px solid rgba(255,255,255,0.07)" }}
              >
                <input
                  value={newVideoUrl}
                  onChange={(e) => setNewVideoUrl(e.target.value)}
                  placeholder="Paste a YouTube or Spotify URL"
                  className="rounded px-3 py-2 text-sm outline-none"
                  style={{ backgroundColor: "#16181c", color: "#f0ede8", border: "1px solid rgba(255,255,255,0.1)" }}
                />
                <input
                  value={newVideoTitle}
                  onChange={(e) => setNewVideoTitle(e.target.value)}
                  placeholder='Label (e.g. "Live at Stoller Winery")'
                  className="rounded px-3 py-2 text-sm outline-none"
                  style={{ backgroundColor: "#16181c", color: "#f0ede8", border: "1px solid rgba(255,255,255,0.1)" }}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (!newVideoUrl.trim()) return;
                      const sample: VideoSample = {
                        id: crypto.randomUUID(),
                        title: newVideoTitle.trim() || newVideoUrl.trim(),
                        url: newVideoUrl.trim(),
                        platform: detectPlatform(newVideoUrl),
                      };
                      save({ video_samples: [...videos, sample] });
                      setNewVideoUrl("");
                      setNewVideoTitle("");
                      setShowVideoForm(false);
                    }}
                    className="flex-1 rounded py-1.5 text-xs font-semibold transition-all hover:brightness-110"
                    style={{ backgroundColor: "#d4a853", color: "#0e0f11", cursor: "pointer" }}
                  >
                    Add Sample
                  </button>
                  <button
                    onClick={() => { setNewVideoUrl(""); setNewVideoTitle(""); setShowVideoForm(false); }}
                    className="flex-1 rounded py-1.5 text-xs transition-all hover:brightness-125"
                    style={{ backgroundColor: "#16181c", color: "#9a9591", cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {videos.length === 0 && !showVideoForm && (
              <p style={{ color: "#5e5c58", fontSize: "12px", fontStyle: "italic" }}>
                No samples yet. Add a YouTube or Spotify link so venues can hear what you sound like.
              </p>
            )}
          </div>

          {/* Rates & Packages */}
          <div
            className="rounded-xl p-5"
            style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div
              style={{
                fontSize: "9px", color: "#5e5c58", textTransform: "uppercase",
                letterSpacing: "0.1em", marginBottom: "14px",
              }}
            >
              Rates &amp; Packages
            </div>
            <div className="grid grid-cols-3 gap-3">
              {packages.map((pkg) => {
                const isEditing = editingPackageId === pkg.id;
                const current = isEditing ? { ...pkg, ...packageEdits } : pkg;

                return (
                  <div
                    key={pkg.id}
                    className="rounded-lg p-4 flex flex-col gap-2"
                    style={{ backgroundColor: "#1e2128", borderTop: `2px solid ${pkg.color}` }}
                  >
                    <div style={{ color: pkg.color, fontSize: "11px", fontWeight: 700 }}>
                      {pkg.label}
                    </div>

                    {isEditing ? (
                      <>
                        {/* Price range inputs */}
                        <div className="flex items-center gap-1 flex-wrap">
                          <span style={{ color: "#5e5c58", fontSize: "11px" }}>$</span>
                          <input
                            type="number"
                            value={packageEdits.price_min ?? ""}
                            onChange={(e) =>
                              setPackageEdits((p) => ({
                                ...p,
                                price_min: e.target.value ? Number(e.target.value) : null,
                              }))
                            }
                            placeholder="Min"
                            className="w-16 rounded px-2 py-1 text-xs outline-none"
                            style={{ backgroundColor: "#16181c", color: "#f0ede8", border: "1px solid rgba(255,255,255,0.1)" }}
                          />
                          <span style={{ color: "#5e5c58", fontSize: "11px" }}>– $</span>
                          <input
                            type="number"
                            value={packageEdits.price_max ?? ""}
                            onChange={(e) =>
                              setPackageEdits((p) => ({
                                ...p,
                                price_max: e.target.value ? Number(e.target.value) : null,
                              }))
                            }
                            placeholder="Max"
                            className="w-16 rounded px-2 py-1 text-xs outline-none"
                            style={{ backgroundColor: "#16181c", color: "#f0ede8", border: "1px solid rgba(255,255,255,0.1)" }}
                          />
                        </div>
                        <input
                          value={(packageEdits.duration as string) ?? ""}
                          onChange={(e) => setPackageEdits((p) => ({ ...p, duration: e.target.value }))}
                          placeholder="Duration (e.g. 2hr set)"
                          className="rounded px-2 py-1 text-xs outline-none"
                          style={{ backgroundColor: "#16181c", color: "#f0ede8", border: "1px solid rgba(255,255,255,0.1)" }}
                        />
                        <textarea
                          value={(packageEdits.description as string) ?? ""}
                          onChange={(e) => setPackageEdits((p) => ({ ...p, description: e.target.value }))}
                          placeholder="Describe what's included…"
                          rows={3}
                          className="rounded px-2 py-1.5 text-xs outline-none resize-none"
                          style={{ backgroundColor: "#16181c", color: "#f0ede8", border: "1px solid rgba(255,255,255,0.1)" }}
                        />
                        <div className="flex gap-1.5 mt-1">
                          <button
                            onClick={() => savePackage(pkg.id)}
                            className="flex-1 rounded py-1 text-xs font-semibold transition-all hover:brightness-110"
                            style={{ backgroundColor: "#d4a853", color: "#0e0f11", cursor: "pointer" }}
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEditPackage}
                            className="flex-1 rounded py-1 text-xs transition-all hover:brightness-125"
                            style={{ backgroundColor: "#16181c", color: "#9a9591", cursor: "pointer" }}
                          >
                            Cancel
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ color: "#f0ede8", fontSize: "18px", fontWeight: 700, lineHeight: 1 }}>
                          {formatPrice(current.price_min, current.price_max) || (
                            <span style={{ color: "#5e5c58", fontSize: "12px", fontStyle: "italic" }}>
                              Set a price
                            </span>
                          )}
                        </div>
                        {current.duration && (
                          <div style={{ color: "#9a9591", fontSize: "10px" }}>{current.duration}</div>
                        )}
                        <div
                          style={{
                            color: current.description ? "#9a9591" : "#5e5c58",
                            fontSize: "11px",
                            lineHeight: 1.5,
                            flex: 1,
                            fontStyle: current.description ? "normal" : "italic",
                          }}
                        >
                          {current.description || "No description yet."}
                        </div>
                        <button
                          onClick={() => startEditPackage(pkg)}
                          className="mt-auto text-xs px-2 py-1 rounded transition-all hover:brightness-125"
                          style={{ backgroundColor: "rgba(255,255,255,0.04)", color: "#9a9591", cursor: "pointer", textAlign: "left" as const }}
                        >
                          Edit
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
