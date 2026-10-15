export type InstallPlatform = "ios" | "android" | null;

// Which "add to home screen" instructions apply. iPadOS reports itself as a
// Mac, so a Mac with a touch screen is treated as an iPad. Returns null for
// desktops and for anyone who already opened StageReach from the home screen
// (nothing left to install).
export function detectInstallPlatform(
  userAgent: string,
  maxTouchPoints: number,
  standalone: boolean
): InstallPlatform {
  if (standalone) return null;
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return null;
}
