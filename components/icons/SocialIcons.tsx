// Simple monochrome brand glyphs, drawn with currentColor so callers can
// tint them via CSS `color` — used in place of plain text abbreviations
// ("IG", "YT") on public-facing profile pages.

type IconProps = { size?: number };

export function InstagramIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

export function SpotifyIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.59 14.41c-.19.31-.6.41-.91.22-2.5-1.53-5.64-1.87-9.34-1.03-.36.08-.71-.15-.79-.5-.08-.36.15-.71.5-.79 4.05-.93 7.52-.53 10.32 1.19.31.19.41.6.22.91zm1.22-2.72c-.24.39-.75.52-1.14.28-2.86-1.76-7.22-2.27-10.6-1.24-.44.13-.9-.11-1.03-.55-.13-.44.11-.9.55-1.03 3.86-1.17 8.66-.6 11.94 1.4.39.24.52.75.28 1.14zm.11-2.83C14.7 8.7 9.35 8.53 6.24 9.49c-.52.16-1.08-.14-1.24-.66-.16-.52.14-1.08.66-1.24 3.58-1.09 9.5-.88 13.24 1.36.47.28.62.89.34 1.36-.28.47-.89.62-1.36.34z" />
    </svg>
  );
}

export function YouTubeIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.51 3.5 12 3.5 12 3.5s-7.51 0-9.38.55A3.02 3.02 0 0 0 .5 6.19 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14C4.49 20.5 12 20.5 12 20.5s7.51 0 9.38-.55a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.81zM9.75 15.5v-7l6.5 3.5-6.5 3.5z" />
    </svg>
  );
}

export function WebsiteIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
