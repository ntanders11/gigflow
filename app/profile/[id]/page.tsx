import { createClient, createServiceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { ArtistProfile, Package, VideoSample, SocialLinks } from "@/types";
import RatingsSection from "@/components/ratings/RatingsSection";
import RequestToBookButton from "@/components/booking/RequestToBookButton";
import { InstagramIcon, SpotifyIcon, YouTubeIcon, WebsiteIcon } from "@/components/icons/SocialIcons";
import { getEmbedUrl } from "@/lib/embeds";

const SOCIAL_PLATFORMS: { key: keyof SocialLinks; label: string; color: string; Icon: typeof InstagramIcon }[] = [
  { key: "instagram", label: "Instagram", color: "#e1306c", Icon: InstagramIcon },
  { key: "spotify",   label: "Spotify",   color: "#1db954", Icon: SpotifyIcon },
  { key: "youtube",   label: "YouTube",   color: "#ff0000", Icon: YouTubeIcon },
  { key: "website",   label: "Website",   color: "#9a9591", Icon: WebsiteIcon },
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

  // Determine viewer type for the "Request to Book" control below. This
  // page is otherwise fully public (it only used createServiceClient()
  // before this) — adding an auth check here must not change that: a
  // logged-out visitor still renders the whole page normally, just with
  // viewerType "other".
  const authSupabase = await createClient();
  const { data: { user: viewer } } = await authSupabase.auth.getUser();
  let viewerType: "venue" | "other" = "other";
  if (viewer) {
    const { data: viewerVenueProfile } = await authSupabase
      .from("venue_profiles")
      .select("venue_name")
      .eq("user_id", viewer.id)
      .maybeSingle();
    if (viewerVenueProfile?.venue_name) viewerType = "venue";
  }

  const p = profile as ArtistProfile;
  const packages: Package[] = p.packages || [];
  const videos: VideoSample[] = p.video_samples || [];
  const social: SocialLinks = p.social_links || { instagram: "", spotify: "", youtube: "", website: "" };
  const genres: string[] = p.genres || [];
  const hasSocialLinks = Object.values(social).some(Boolean);

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0E0E10", color: "#F4E8D2" }}>
      {/* Top bar */}
      <div
        className="px-6 py-3 flex items-center justify-between"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", backgroundColor: "#16181c" }}
      >
        <div style={{ fontFamily: "serif", fontSize: "1rem", color: "#D4A64F", fontWeight: 600 }}>
          StageReach
        </div>
        <div style={{ color: "#5e5c58", fontSize: "11px" }}>Booking Profile</div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10">

        {/* Header: photo + name + phone, matching the venue profile's layout */}
        <div className="flex items-start gap-4 mb-4">
          {p.photo_url ? (
            <img
              src={p.photo_url}
              alt={p.display_name || "Artist"}
              className="w-16 h-16 rounded-xl object-cover shrink-0"
            />
          ) : (
            <div
              className="w-16 h-16 rounded-xl flex items-center justify-center text-xl font-bold shrink-0"
              style={{ background: "linear-gradient(135deg, #D4A64F 0%, #6C5CE7 100%)", color: "#fff" }}
            >
              {p.display_name ? p.display_name.charAt(0).toUpperCase() : "?"}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "#F4E8D2" }}>{p.display_name || "Artist"}</h1>
          </div>
        </div>

        {/* Genre tags */}
        {genres.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-6">
            {genres.map((g) => (
              <span
                key={g}
                className="text-xs px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "rgba(212,166,79,0.12)", color: "#D4A64F" }}
              >
                {g}
              </span>
            ))}
          </div>
        )}

        {/* Book button */}
        <div className="mb-6">
          <RequestToBookButton artistUserId={id} viewerType={viewerType} />
        </div>

        {/* Bio */}
        {p.bio && (
          <p className="text-sm mb-6" style={{ color: "#F4E8D2" }}>{p.bio}</p>
        )}

        {/* Social links */}
        {hasSocialLinks && (
          <div className="mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: "#5e5c58" }}>
              Links
            </h2>
            <div className="flex flex-col gap-1">
              {SOCIAL_PLATFORMS.map((sp) => {
                const val = social[sp.key];
                if (!val) return null;
                const href = val.startsWith("http") ? val : `https://${val}`;
                const Icon = sp.Icon;
                return (
                  <a
                    key={sp.key}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded px-2 py-1.5 transition-all hover:brightness-125"
                    style={{ backgroundColor: "#1e2128" }}
                  >
                    <span style={{ color: sp.color, width: "18px", display: "flex", justifyContent: "center" }}>
                      <Icon size={15} />
                    </span>
                    <span style={{ color: "#9a9591", fontSize: "11px" }}>{sp.label}</span>
                    <span style={{ color: "#5e5c58", fontSize: "10px", marginLeft: "auto" }}>↗</span>
                  </a>
                );
              })}
            </div>
          </div>
        )}

        {/* Video & Music Samples */}
        {videos.length > 0 && (
          <div className="mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: "#5e5c58" }}>
              Video &amp; Music
            </h2>
            <div className="flex flex-col gap-4">
              {videos.map((v) => {
                const embedUrl = getEmbedUrl(v.platform, v.url);

                if (embedUrl && v.platform === "youtube") {
                  return (
                    <div key={v.id}>
                      {v.title && (
                        <div className="text-sm font-medium mb-1.5" style={{ color: "#F4E8D2" }}>{v.title}</div>
                      )}
                      <div className="relative w-full rounded-lg overflow-hidden" style={{ aspectRatio: "16 / 9", backgroundColor: "#1e2128" }}>
                        <iframe
                          src={embedUrl}
                          title={v.title || "YouTube video"}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          className="absolute inset-0 w-full h-full"
                          style={{ border: 0 }}
                        />
                      </div>
                    </div>
                  );
                }

                if (embedUrl && v.platform === "spotify") {
                  return (
                    <div key={v.id}>
                      {v.title && (
                        <div className="text-sm font-medium mb-1.5" style={{ color: "#F4E8D2" }}>{v.title}</div>
                      )}
                      <iframe
                        src={embedUrl}
                        title={v.title || "Spotify"}
                        width="100%"
                        height="152"
                        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                        loading="lazy"
                        className="rounded-lg"
                        style={{ border: 0 }}
                      />
                    </div>
                  );
                }

                // No embeddable URL (a non-embeddable "other" platform link,
                // or a YouTube/Spotify URL that didn't match a recognized
                // pattern) — fall back to a plain link, same as before.
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
                    style={{ backgroundColor: "#1e2128" }}
                  >
                    <div
                      className="w-9 h-9 rounded flex items-center justify-center shrink-0 text-base font-bold"
                      style={{ backgroundColor: platformColor, color: "#fff" }}
                    >
                      {platformIcon}
                    </div>
                    <div>
                      <div className="text-sm font-medium" style={{ color: "#F4E8D2" }}>
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
          <div className="mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: "#5e5c58" }}>
              Rates &amp; Packages
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {packages.map((pkg) => (
                <div
                  key={pkg.id}
                  className="rounded-lg p-4"
                  style={{ backgroundColor: "#1e2128", borderTop: `2px solid ${pkg.color}` }}
                >
                  <div style={{ color: pkg.color, fontSize: "12px", fontWeight: 700, marginBottom: "6px" }}>
                    {pkg.label}
                  </div>
                  <div style={{ color: "#F4E8D2", fontSize: "20px", fontWeight: 700, lineHeight: 1, marginBottom: "6px" }}>
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

        <RatingsSection endpoint={`/api/public/artists/${id}/ratings`} reviewerLinkPrefix="/venues/profile/" />

        {/* Footer note */}
        <p className="mt-6" style={{ color: "#5e5c58", fontSize: "11px", textAlign: "center" as const }}>
          Profile powered by StageReach · All pricing is approximate and subject to change
        </p>

      </div>
    </div>
  );
}
