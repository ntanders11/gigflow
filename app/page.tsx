import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const h2 = { color: "#F4E8D2", fontSize: "18px", fontWeight: 700, marginBottom: "10px" };
const p = { color: "#9a9591", fontSize: "14px", lineHeight: 1.7 };

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen px-6 py-12" style={{ backgroundColor: "#0E0E10" }}>
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-center mb-8">
          <Image
            src="/stagereach-logo.png"
            alt="StageReach"
            width={300}
            height={100}
            className="rounded-lg"
            style={{ objectFit: "contain" }}
            priority
          />
        </div>

        <h1 className="text-3xl font-bold text-center mb-4" style={{ color: "#F4E8D2" }}>
          Booking, simplified for gigging musicians and the venues that book them
        </h1>
        <p className="text-center mb-8" style={p}>
          StageReach is a booking CRM for independent artists: track every venue you&apos;re pitching,
          send pitch and follow-up emails from your own email address, manage your gig calendar, and
          get paid with built-in invoicing. Venues get a free account to discover local artists, send
          booking requests, and keep track of who they&apos;ve booked.
        </p>

        <div className="flex flex-wrap gap-3 justify-center mb-12">
          <Link
            href="/login"
            className="px-6 py-3 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
            style={{ backgroundColor: "#D4A64F", color: "#0E0E10" }}
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="px-6 py-3 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
            style={{ color: "#F4E8D2", border: "1px solid rgba(255,255,255,0.2)" }}
          >
            Artist sign up
          </Link>
          <Link
            href="/venues"
            className="px-6 py-3 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
            style={{ color: "#F4E8D2", border: "1px solid rgba(255,255,255,0.2)" }}
          >
            I&apos;m a venue
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-12">
          <div className="rounded-xl p-5" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
            <h2 style={h2}>For artists</h2>
            <p style={p}>
              A pipeline for every venue you&apos;re reaching out to, automatic follow-ups when a venue
              goes quiet, a shareable public profile, gig prep checklists, and invoicing with a
              one-click pay link.
            </p>
          </div>
          <div className="rounded-xl p-5" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
            <h2 style={h2}>For venues</h2>
            <p style={p}>
              Find local artists that match your genres, send booking requests in one click, see
              ratings from other venues, and keep your bookings and invoices in one place.
            </p>
          </div>
        </div>

        <div className="rounded-xl p-5 mb-12" style={{ backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" }}>
          <h2 style={h2}>How StageReach uses your Google account</h2>
          <p style={p}>
            Artists can optionally connect their Gmail account so pitch and follow-up emails go out
            from their own address instead of a generic one. StageReach asks for one Google
            permission for this: sending email on your behalf. It cannot read, search, or access
            anything in your inbox, and only sends messages that you write or approve inside the app.
            You can disconnect Gmail at any time from your profile. See our{" "}
            <Link href="/privacy" className="underline" style={{ color: "#D4A64F" }}>Privacy Policy</Link>{" "}
            for details.
          </p>
        </div>

        <p className="text-center text-xs" style={{ color: "#5e5c58" }}>
          <Link href="/terms" className="underline">Terms</Link>
          {" "}·{" "}
          <Link href="/privacy" className="underline">Privacy Policy</Link>
          {" "}·{" "}
          <a href="mailto:booking@taylorandersonmusic.com" className="underline">Contact</a>
        </p>
      </div>
    </div>
  );
}
