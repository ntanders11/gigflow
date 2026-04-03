import { createServiceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { ArtistProfile, Package, VideoSample, SocialLinks } from "@/types";

const SOCIAL_PLATFORMS: { key: keyof SocialLinks; label: string; color: string; icon: string }[] = [
  { key: "instagram", label: "Instagram", color: "#e1306c", icon: "IG" },
  { key: "spotify",   label: "Spotify",   color: "#1db954", icon: "SP" },
  { key: "youtube",   label: "YouTube",   color: "#ff0000", icon: "YT" },
  { key: "website",   label: "Website",   color: "#9a9591", icon: "🌐" },
];

function formatPrice(min: number | null, max: number | null): string {
  if (min && max) return `$${min.toLocaleString()}–$${max.toLocaleString()}`;
  if (min) return `$${min.toLocaleString()}+`;
  if (max) return `Up to $${max.toLocaleString()}`;
  return "Contact for pricing";
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createServiceClient();

  const { data: profile } = await supabase
    .from("artist_profiles")
    .select("*")
    .eq("user_id", id)
    .single();

  if (!profile) notFound();

  const p = profile as ArtistProfile;
  const packages: Package[] = p.packages || [];
  const videos: VideoSample[] = p.video_samples || [];
  const social: SocialLinks = p.social_links || { instagram: "", spotify: "", youtube: "", website: "" };
  const genres: string[] = p.genres || [];
  const hasSocialLinks = Object.values(social).some(Boolean);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0e0f11", color: "#f0ede8" }}>
      {/* Top bar */}
      <div
        className="px-6 py-3 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", backgroundColor: "#16181c" }}
      >
        <div style={{ fontFamily: "serif", fontSize: "1rem", color: "#d4a853", fontWeight: 600 }}>
          GigFlow
        </div>
        <div style={{ color: "#5e5c58", fontSize: "11px" }}>Booking Profile</div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10 flex gap-8 items-start">

        {/* ── LEFT SIDEBAR ── */}
        <div className="w-56 shrink-0 flex flex-col gap-4 sticky top-10">

          {/* Avatar + Name */}
          <div className="text-center">
            {p.photo_url ? (
              <img
                src={p.photo_url}
                alt="Taylor Anderson"
                className="w-28 h-28 rounded-full object-cover mx-auto mb-4"
              />
            ) : (
              <div
                className="w-28 h-28 rounded-full flex items-center justify-center text-3xl font-bold mx-auto mb-4"
                style={{ background: "linear-gradient(135deg, #d4a853 0%, #8b5cf6 100%)", color: "#fff" }}
              >
                TA
              </div>
            )}
            <h1 style={{ color: "#f0ede8", fontSize: "18px", fontWeight: 700, marginBottom: "2px" }}>
              Taylor Anderson
            </h1>
            <p style={{ color: "#9a9591", fontSize: "12px", marginBottom: "12px" }}>Newberg, OR</p>

            {/* Genre tags */}
            {genres.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1.5 mb-4">
                {genres.map((g) => (
                  <span
                    key={g}
                    className="rounded-full px-2.5 py-0.5 text-xs"
                    style={{ backgroundColor: "#1e2128", color: "#9a9591" }}
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Social links */}
          {hasSocialLinks && (
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
                Links
              </div>
              <div className="flex flex-col gap-1">
                {SOCIAL_PLATFORMS.map((sp) => {
                  const val = social[sp.key];
                  if (!val) return null;
                  const href = val.startsWith("http") ? val : `https://${val}`;
                  return (
                    <a
                      key={sp.key}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded px-2 py-1.5 transition-all hover:brightness-125"
                      style={{ backgroundColor: "#1e2128" }}
                    >
                      <span style={{ color: sp.color, fontSize: "11px", width: "18px", textAlign: "center" }}>
                        {sp.icon}
                      </span>
                      <span style={{ color: "#9a9591", fontSize: "11px" }}>{sp.label}</span>
                      <span style={{ color: "#5e5c58", fontSize: "10px", marginLeft: "auto" }}>↗</span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* Book button */}
          <a
            href={`mailto:?subject=Booking Inquiry — Taylor Anderson`}
            className="block w-full text-center rounded-lg py-2.5 text-sm font-bold transition-all hover:brightness-110"
            style={{ backgroundColor: "#d4a853", color: "#0e0f11" }}
          >
            Send Booking Inquiry
          </a>
        </div>

        {/* ── RIGHT MAIN ── */}
        <div className="flex-1 flex flex-col gap-6">

          {/* Bio */}
          {p.bio && (
            <div
              className="rounded-xl p-6"
              style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <div
                style={{
                  fontSize: "9px", color: "#5e5c58", textTransform: "uppercase",
                  letterSpacing: "0.1em", marginBottom: "10px",
                }}
              >
                About
              </div>
              <p style={{ color: "#9a9591", fontSize: "14px", lineHeight: 1.7 }}>{p.bio}</p>
            </div>
          )}

          {/* Video & Music Samples */}
          {videos.length > 0 && (
            <div
              className="rounded-xl p-6"
              style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
            >
              <div
                style={{
                  fontSize: "9px", color: "#5e5c58", textTransform: "uppercase",
                  letterSpacing: "0.1em", marginBottom: "12px",
                }}
              >
                Video &amp; Music
              </div>
              <div className="flex flex-wrap gap-3">
                {videos.map((v) => {
                  const isYT = v.platform === "youtube";
                  const isSP = v.platform === "spotify";
                  const platformColor = isYT ? "#ff0000" : isSP ? "#1db954" : "#9a9591";
                  const platformIcon = isYT ? "▶" : isSP ? "♪" : "♫";
                  return (
                    <a
                      key={v.id}
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg px-4 py-3 transition-all hover:brightness-125"
                      style={{ backgroundColor: "#1e2128", minWidth: "200px" }}
                    >
                      <div
                        className="w-9 h-9 rounded flex items-center justify-center shrink-0 text-base font-bold"
                        style={{ backgroundColor: platformColor, color: "#fff" }}
                      >
                        {platformIcon}
                      </div>
                      <div>
                        <div className="text-sm font-medium" style={{ color: "#f0ede8" }}>
                          {v.title || "Watch / Listen"}
                        </div>
                        <div style={{ color: "#5e5c58", fontSize: "10px" }}>Open ↗</div>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {/* Rates & Packages */}
          {packages.length > 0 && (
            <div
              className="rounded-xl p-6"
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
              <div className="grid grid-cols-3 gap-4">
                {packages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className="rounded-lg p-4"
                    style={{ backgroundColor: "#1e2128", borderTop: `2px solid ${pkg.color}` }}
                  >
                    <div style={{ color: pkg.color, fontSize: "12px", fontWeight: 700, marginBottom: "6px" }}>
                      {pkg.label}
                    </div>
                    <div style={{ color: "#f0ede8", fontSize: "20px", fontWeight: 700, lineHeight: 1, marginBottom: "6px" }}>
                      {formatPrice(pkg.price_min, pkg.price_max)}
                    </div>
                    {pkg.duration && (
                      <div style={{ color: "#9a9591", fontSize: "11px", marginBottom: "6px" }}>
                        {pkg.duration}
                      </div>
                    )}
                    {pkg.description && (
                      <div style={{ color: "#5e5c58", fontSize: "11px", lineHeight: 1.5 }}>
                        {pkg.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer note */}
          <p style={{ color: "#5e5c58", fontSize: "11px", textAlign: "center" as const }}>
            Profile powered by GigFlow · All pricing is approximate and subject to change
          </p>

        </div>
      </div>
    </div>
  );
}
