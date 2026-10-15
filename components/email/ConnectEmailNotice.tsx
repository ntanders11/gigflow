import Link from "next/link";

// Shown wherever an artist is about to send email but has no working Gmail or
// Outlook connected. `tone` matches the surrounding screen: the pitch modal is
// light, everything else is dark.
export default function ConnectEmailNotice({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const light = tone === "light";
  return (
    <div
      className="rounded-lg px-4 py-3 text-sm"
      style={
        light
          ? { backgroundColor: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }
          : { backgroundColor: "rgba(212,166,79,0.1)", border: "1px solid rgba(212,166,79,0.25)", color: "#D4A64F" }
      }
    >
      <p className="font-semibold mb-0.5">Connect your email to send</p>
      <p className="text-xs" style={{ opacity: 0.9, lineHeight: 1.5 }}>
        StageReach sends pitches and follow-ups from your own Gmail or Outlook, so you need to connect one first. It takes
        about a minute.
      </p>
      <Link href="/artist-profile" className="inline-block mt-2 text-xs font-semibold underline">
        Connect email →
      </Link>
    </div>
  );
}
