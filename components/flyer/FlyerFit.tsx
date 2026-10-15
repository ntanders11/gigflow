"use client";

import { useEffect } from "react";

// Shrinks the on-screen preview of the flyer so the whole page fits a narrow
// screen (the flyer is a fixed 8.5 inches wide). Only affects what's shown on
// screen — the print styles reset it, so a printout is always full size.
export default function FlyerFit() {
  useEffect(() => {
    function fit() {
      const flyerWidthPx = 8.5 * 96;
      const zoom = Math.min(1, (window.innerWidth - 24) / flyerWidthPx);
      document.documentElement.style.setProperty("--flyer-zoom", String(zoom));
    }
    fit();
    window.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      document.documentElement.style.removeProperty("--flyer-zoom");
    };
  }, []);
  return null;
}
