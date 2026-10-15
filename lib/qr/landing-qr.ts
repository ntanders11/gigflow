import QRCode from "qrcode";

// Where a scan lands: StageReach's homepage, which has the artist sign-up
// button. Fixed to the real address (not window.location.origin) so a code
// made while testing locally can never point at localhost.
export const LANDING_URL = "https://stagereach.app";

// Black on white with a quiet border: the most reliable combination for
// phone cameras, and it stays readable if printed small. Shared by the
// venue's "Share with artists" card and the printable flyer so the two can't
// drift apart.
export function landingQrDataUrl(width: number): Promise<string> {
  return QRCode.toDataURL(LANDING_URL, {
    width,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
}
