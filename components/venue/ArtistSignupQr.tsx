"use client";

import { useEffect, useState } from "react";
import { landingQrDataUrl } from "@/lib/qr/landing-qr";

// A "Share with artists" card on the venue's Profile page: a QR code a venue
// can download and put on a flyer, sign, or at the bar. It's the same code
// for every venue.
export default function ArtistSignupQr() {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 1024px so the downloaded image stays sharp at flyer size.
    landingQrDataUrl(1024)
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div
      className="rounded-xl p-5"
      style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div style={{ fontSize: "9px", color: "#5e5c58", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "6px" }}>
        Share with artists
      </div>
      <p className="text-sm font-semibold mb-1" style={{ color: "#F4E8D2" }}>Let artists find you on StageReach</p>
      <p className="text-xs mb-4" style={{ color: "#9a9591", lineHeight: 1.6 }}>
        Print the flyer, or download the code for your own sign or menu. When an artist scans it with their phone camera, they land on
        StageReach and can sign up for free.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="rounded-lg overflow-hidden shrink-0" style={{ width: "132px", height: "132px", backgroundColor: "#fff" }}>
          {dataUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- generated in the browser, not a file next/image can optimize
            <img src={dataUrl} alt="QR code that opens stagereach.app" width={132} height={132} />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
          {dataUrl && (
            <a
              href={dataUrl}
              download="stagereach-qr-code.png"
              className="inline-block text-xs px-3 py-2 rounded-lg font-semibold transition-all hover:brightness-110"
              style={{ backgroundColor: "rgba(212,166,79,0.12)", color: "#D4A64F", border: "1px solid rgba(212,166,79,0.3)" }}
            >
              Download image
            </a>
          )}
          <a
            href="/flyer"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs px-3 py-2 rounded-lg font-semibold transition-all hover:brightness-110"
            style={{ backgroundColor: "rgba(212,166,79,0.12)", color: "#D4A64F", border: "1px solid rgba(212,166,79,0.3)" }}
          >
            Print flyer
          </a>
          </div>
          <p className="text-xs mt-2" style={{ color: "#5e5c58" }}>Opens stagereach.app</p>
        </div>
      </div>
    </div>
  );
}
