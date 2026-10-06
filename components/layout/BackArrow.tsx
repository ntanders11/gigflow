"use client";

import { useRouter } from "next/navigation";

// A back arrow that returns to whatever page the person was just on (so a
// venue that came from Discover Artists goes back to Discover Artists, not
// somewhere fixed). If there's no previous page — they opened the link
// directly — it goes to the fallback instead.
export default function BackArrow({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
      aria-label="Go back"
      className="flex items-center justify-center rounded-lg transition-all hover:brightness-125"
      style={{ color: "#D4A64F", fontSize: "1.25rem", minWidth: "44px", minHeight: "44px" }}
    >
      ←
    </button>
  );
}
