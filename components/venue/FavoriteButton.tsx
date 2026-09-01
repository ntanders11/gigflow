"use client";

import { useState } from "react";

// A heart toggle reused in three places: Discover Artists result cards,
// the artist's public profile page (venue viewers only), and the
// Favorites list itself. `stopClickPropagation` is needed only where this
// button sits inside a whole-card <Link> (Discover Artists, Favorites
// list) — without it, tapping the heart would also navigate to the
// artist's profile.
export default function FavoriteButton({
  artistUserId,
  initialFavorited,
  onToggle,
  size = 18,
  stopClickPropagation = false,
}: {
  artistUserId: string;
  initialFavorited: boolean;
  onToggle?: (favorited: boolean) => void;
  size?: number;
  stopClickPropagation?: boolean;
}) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [saving, setSaving] = useState(false);

  async function toggle(e: React.MouseEvent) {
    if (stopClickPropagation) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (saving) return;
    setSaving(true);

    const next = !favorited;
    setFavorited(next); // optimistic — this is a low-stakes toggle, no need to wait

    try {
      const res = next
        ? await fetch("/api/venue/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ artist_user_id: artistUserId }),
          })
        : await fetch(`/api/venue/favorites/${artistUserId}`, { method: "DELETE" });

      if (!res.ok) {
        setFavorited(!next); // roll back on a failed request
        return;
      }
      onToggle?.(next);
    } catch {
      setFavorited(!next); // roll back on a network failure (offline, dropped connection)
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={favorited ? "Remove from favorites" : "Save to favorites"}
      title={favorited ? "Remove from favorites" : "Save to favorites"}
      className="flex items-center justify-center transition-all hover:brightness-125"
      style={{ width: `${size + 10}px`, height: `${size + 10}px`, opacity: saving ? 0.6 : 1 }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill={favorited ? "#D4A64F" : "none"} stroke="#D4A64F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  );
}
