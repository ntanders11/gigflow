// Envelope icon drawn with currentColor, so it follows the surrounding text
// color. Shared by the venue tab bar and the artist's floating messages icon.
export default function MailIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 7l8.5 6.5L20.5 7" />
    </svg>
  );
}
