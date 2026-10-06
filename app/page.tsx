import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const GOLD = "#D4A64F";
const CREAM = "#F4E8D2";
const MUTED = "#9a9591";
const CARD = { backgroundColor: "#16181c", border: "1px solid rgba(255,255,255,0.07)" };

const h2 = { color: CREAM, fontSize: "18px", fontWeight: 700, marginBottom: "10px" };
const p = { color: MUTED, fontSize: "14px", lineHeight: 1.7 };

const pillars = [
  {
    label: "Save time",
    title: "Let the busywork run itself",
    body: "Pitch and follow-up emails go out from your own Gmail or Outlook. When a venue goes quiet, StageReach follows up for you.",
  },
  {
    label: "Stay organized",
    title: "Every venue and gig in one place",
    body: "A pipeline from first contact to booked, a booking calendar, gig prep checklists, and day-of reminders.",
  },
  {
    label: "Get booked and paid",
    title: "From request to paycheck",
    body: "Venues can send booking requests straight to your profile, and you can invoice with a one-click pay link.",
  },
];

const features = [
  "Venue pipeline",
  "Automatic follow-ups",
  "Send from your own email",
  "Booking calendar",
  "Blackout dates",
  "Gig prep checklists",
  "Day-of reminders",
  "Venue discovery",
  "Public artist profile",
  "Booking requests",
  "Invoices and pay links",
  "Mutual ratings",
];

const artistPoints = [
  "Track every venue you're pitching, from first contact to booked",
  "Find new venues near you and add them to your pipeline",
  "Share a public profile venues can book you from",
  "Invoice venues and get paid with a pay link",
];

const venuePoints = [
  "Free account, no commission on bookings",
  "Find local artists that match your genres",
  "Send booking requests in one click",
  "See ratings from other venues, and keep bookings and invoices together",
];

function Check({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((t) => (
        <li key={t} className="flex gap-2" style={p}>
          <span style={{ color: GOLD }}>✓</span>
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#0E0E10" }}>
      {/* Header */}
      <header className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
        <Image
          src="/stagereach-logo.png"
          alt="StageReach"
          width={150}
          height={50}
          className="rounded-lg"
          style={{ objectFit: "contain" }}
          priority
        />
        <Link
          href="/login"
          className="px-4 py-2 rounded-lg text-sm font-semibold hover:brightness-110"
          style={{ color: CREAM, border: "1px solid rgba(255,255,255,0.2)" }}
        >
          Sign in
        </Link>
      </header>

      <main className="max-w-5xl mx-auto px-6">
        {/* Hero */}
        <section className="text-center pt-10 pb-16">
          <p className="text-xs font-semibold tracking-widest uppercase mb-4" style={{ color: GOLD }}>
            Now in beta
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold mb-5 max-w-3xl mx-auto" style={{ color: CREAM, lineHeight: 1.15 }}>
            Your booking manager, for gigging musicians and the venues that book them
          </h1>
          <p className="mb-8 max-w-2xl mx-auto" style={{ ...p, fontSize: "16px" }}>
            StageReach helps independent artists find venues, pitch them, keep track of every
            conversation, and get paid. Venues get a free account to discover local artists and
            book them directly.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link
              href="/signup"
              className="px-6 py-3 rounded-lg text-sm font-semibold hover:brightness-110"
              style={{ backgroundColor: GOLD, color: "#0E0E10" }}
            >
              I&apos;m an artist
            </Link>
            <Link
              href="/venues"
              className="px-6 py-3 rounded-lg text-sm font-semibold hover:brightness-110"
              style={{ color: CREAM, border: "1px solid rgba(255,255,255,0.2)" }}
            >
              I&apos;m a venue
            </Link>
          </div>
        </section>

        {/* Pillars */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-16">
          {pillars.map((x) => (
            <div key={x.label} className="rounded-xl p-6" style={CARD}>
              <p className="text-xs font-semibold tracking-widest uppercase mb-3" style={{ color: GOLD }}>
                {x.label}
              </p>
              <h2 style={h2}>{x.title}</h2>
              <p style={p}>{x.body}</p>
            </div>
          ))}
        </section>

        {/* Feature grid */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-center mb-2" style={{ color: CREAM }}>
            Everything you need to stay booked
          </h2>
          <p className="text-center mb-8" style={p}>
            One place instead of a spreadsheet, a calendar, and a pile of email threads.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {features.map((f) => (
              <div
                key={f}
                className="rounded-lg px-4 py-3 text-sm text-center"
                style={{ ...CARD, color: CREAM }}
              >
                {f}
              </div>
            ))}
          </div>
        </section>

        {/* Audiences */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-16">
          <div className="rounded-xl p-6" style={CARD}>
            <h2 style={h2}>For artists</h2>
            <div className="mb-5"><Check items={artistPoints} /></div>
            <Link href="/signup" className="text-sm font-semibold" style={{ color: GOLD }}>
              Sign up as an artist →
            </Link>
          </div>
          <div className="rounded-xl p-6" style={CARD}>
            <h2 style={h2}>For venues</h2>
            <div className="mb-5"><Check items={venuePoints} /></div>
            <Link href="/venues" className="text-sm font-semibold" style={{ color: GOLD }}>
              Create a venue account →
            </Link>
          </div>
        </section>

        {/* Beta note (placeholder for testimonials later) */}
        <section className="rounded-xl p-8 text-center mb-16" style={CARD}>
          <h2 className="text-xl font-bold mb-2" style={{ color: CREAM }}>
            Join the first artists and venues on StageReach
          </h2>
          <p className="mb-5 max-w-xl mx-auto" style={p}>
            We&apos;re in beta and building alongside the musicians and venues using it. Your
            feedback shapes what comes next.
          </p>
          <Link
            href="/signup"
            className="inline-block px-6 py-3 rounded-lg text-sm font-semibold hover:brightness-110"
            style={{ backgroundColor: GOLD, color: "#0E0E10" }}
          >
            Get started
          </Link>
        </section>

        {/* Google account disclosure (required for OAuth verification) */}
        <section className="rounded-xl p-5 mb-12" style={CARD}>
          <h2 style={h2}>How StageReach uses your Google account</h2>
          <p style={p}>
            Artists can optionally connect their Gmail account so pitch and follow-up emails go out
            from their own address instead of a generic one. StageReach asks for one Google
            permission for this: sending email on your behalf. It cannot read, search, or access
            anything in your inbox, and only sends messages that you write or approve inside the app.
            You can disconnect Gmail at any time from your profile. See our{" "}
            <Link href="/privacy" className="underline" style={{ color: GOLD }}>Privacy Policy</Link>{" "}
            for details.
          </p>
        </section>
      </main>

      <footer className="pb-12 text-center text-xs" style={{ color: "#5e5c58" }}>
        <Link href="/terms" className="underline">Terms</Link>
        {" "}·{" "}
        <Link href="/privacy" className="underline">Privacy Policy</Link>
        {" "}·{" "}
        <a href="mailto:booking@taylorandersonmusic.com" className="underline">Contact</a>
      </footer>
    </div>
  );
}
