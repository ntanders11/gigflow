import Image from "next/image";
import type { Metadata } from "next";
import PrintButton from "@/components/flyer/PrintButton";
import FlyerFit from "@/components/flyer/FlyerFit";
import { landingQrDataUrl } from "@/lib/qr/landing-qr";

export const metadata: Metadata = {
  title: "StageReach flyer",
  robots: { index: false },
};

// A one-page, US Letter flyer a venue can print and put up so artists can
// sign up. Public on purpose (it only holds the stagereach.app QR code), and
// rendered on the server so the code is baked into the page. The on-screen
// preview is the same size as the printed page; the Print button and the
// instructions are hidden when printing.
export default async function FlyerPage({ searchParams }: { searchParams: Promise<{ ink?: string }> }) {
  const { ink } = await searchParams;
  // Ink-saver (white page, plain text name) is the default; ?ink=full is the
  // original dark-banner version with the logo.
  const full = ink === "full";
  const qr = await landingQrDataUrl(1200);

  return (
    <div className="flyer-wrap">
      <FlyerFit />
      <style>{`
        @page { size: letter; margin: 0; }
        .flyer-wrap { min-height: 100vh; background: #e9e7e2; padding: 24px 12px 48px; overflow-x: auto; }
        .flyer-controls { max-width: 8.5in; margin: 0 auto 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .flyer-controls p { color: #4a4743; font-size: 13px; margin: 0; }
        .flyer { zoom: var(--flyer-zoom, 1); width: 8.5in; height: 11in; margin: 0 auto; background: #fff; color: #111; position: relative; overflow: hidden; box-shadow: 0 6px 30px rgba(0,0,0,0.25); display: flex; flex-direction: column; font-family: 'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif; }
        .flyer-top { background: #0E0E10; padding: 0.4in 0 0.35in; display: flex; justify-content: center; border-bottom: 0.1in solid #D4A64F; }
        .flyer-controls a { color: #8a6a1f; text-decoration: underline; font-size: 13px; }
        .flyer-lite-top { padding: 0.75in 0 0.15in; text-align: center; }
        .flyer-wordmark { font-size: 30pt; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; color: #111; line-height: 1; }
        .flyer-tag { font-size: 10pt; letter-spacing: 0.25em; text-transform: uppercase; color: #6b6762; margin-top: 0.1in; }
        .flyer-rule { width: 1.4in; height: 0; border-top: 2px solid #D4A64F; margin: 0.22in auto 0; }
        .flyer-body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 0.7in; }
        .flyer h1 { font-size: 50pt; line-height: 1.05; font-weight: 800; margin: 0 0 0.2in; letter-spacing: -0.02em; }
        .flyer-sub { font-size: 18pt; line-height: 1.35; color: #3b3935; margin: 0 0 0.3in; max-width: 6.2in; }
        .flyer-qr { width: 3.9in; height: 3.9in; display: block; }
        .flyer-url { font-size: 28pt; font-weight: 700; margin: 0.2in 0 0; letter-spacing: -0.01em; }
        .flyer-foot { padding: 0.2in 0.7in 0.5in; text-align: center; font-size: 13pt; color: #5b5853; }
        @media print {
          html, body { background: #fff !important; padding: 0 !important; margin: 0 !important; }
          .flyer-wrap { background: #fff; padding: 0; min-height: 0; overflow: visible; }
          .flyer-controls { display: none !important; }
          .flyer { zoom: 1 !important; box-shadow: none; margin: 0; page-break-after: avoid; break-after: avoid; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="flyer-controls">
        <div>
          <p>
            This prints on one US Letter page. In the print window, choose &ldquo;Save as PDF&rdquo; if you&apos;d rather
            have a file.
          </p>
          <p style={{ marginTop: "6px" }}>
            {full ? (
              <>Full-color version (uses more ink). <a href="/flyer">Switch to the ink-saver version</a></>
            ) : (
              <>Ink-saver version (white page). <a href="/flyer?ink=full">Switch to the full-color version</a></>
            )}
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="flyer">
        {full ? (
          <div className="flyer-top">
            <Image
              src="/stagereach-logo.png"
              alt="StageReach"
              width={600}
              height={200}
              priority
              style={{ height: "1.1in", width: "auto", objectFit: "contain" }}
            />
          </div>
        ) : (
          <div className="flyer-lite-top">
            <div className="flyer-wordmark">StageReach</div>
            <div className="flyer-tag">Find your next stage</div>
            <div className="flyer-rule" />
          </div>
        )}
        <div className="flyer-body">
          <h1>Sign up on StageReach</h1>
          <p className="flyer-sub">
            Scan the code with your phone&apos;s camera to create your artist account.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- generated QR data URL, not a file next/image can optimize */}
          <img className="flyer-qr" src={qr} alt="QR code that opens stagereach.app" />
          <p className="flyer-url">stagereach.app</p>
        </div>
        <div className="flyer-foot">Find venues, send pitches, and manage your gigs in one place.</div>
      </div>
    </div>
  );
}
