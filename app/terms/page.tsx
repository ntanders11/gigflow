import Link from "next/link";

const h2 = { color: "#F4E8D2", fontSize: "18px", fontWeight: 700, marginTop: "32px", marginBottom: "10px" };
const p  = { color: "#9a9591", fontSize: "14px", lineHeight: 1.7, marginBottom: "12px" };

export default function TermsPage() {
  return (
    <div className="min-h-screen px-6 py-12" style={{ backgroundColor: "#0E0E10" }}>
      <div className="max-w-2xl mx-auto">
        <Link href="/" style={{ color: "#D4A64F", fontSize: "13px" }}>← Back to StageReach</Link>
        <h1 className="text-2xl font-bold mt-4 mb-1" style={{ color: "#F4E8D2" }}>Terms of Service</h1>
        <p style={{ color: "#5e5c58", fontSize: "13px" }}>Last updated September 1, 2026</p>

        <p style={{ ...p, marginTop: "24px" }}>
          These terms cover your use of StageReach. By creating an account, you&apos;re agreeing to them. If
          anything here doesn&apos;t sit right with you, please don&apos;t hesitate to reach out before signing up.
        </p>

        <h2 style={h2}>What StageReach is</h2>
        <p style={p}>
          StageReach is a tool that helps musicians find and book gigs at venues, and helps venues find and
          book artists. We provide the platform — search, booking requests, invoicing, calendars, ratings —
          but we&apos;re not a party to the actual booking agreement between an artist and a venue. What you agree
          to about pay, timing, and performance details is between the two of you.
        </p>

        <h2 style={h2}>Your account</h2>
        <p style={p}>
          You&apos;re responsible for keeping your account information accurate and your login secure, and for
          anything that happens under your account. One account per person or venue, please.
        </p>

        <h2 style={h2}>Acceptable use</h2>
        <p style={p}>
          Use StageReach the way it&apos;s meant to be used: to find real gigs and real venues. Don&apos;t use it to
          spam, harass, submit fake bookings, or post dishonest ratings or reviews. We can suspend or remove
          an account that abuses the platform.
        </p>

        <h2 style={h2}>Ratings and reviews</h2>
        <p style={p}>
          Reviews you write are attributed to your name and shown publicly once both sides have rated each
          other. You&apos;re responsible for what you write — keep it honest and fair. Either side can report a
          review that seems abusive or false, and we&apos;ll look into it.
        </p>

        <h2 style={h2}>Payments</h2>
        <p style={p}>
          Invoices are processed through Stripe. StageReach doesn&apos;t hold your money or guarantee that a
          payment will go through — that&apos;s between the paying party and Stripe. Connecting a Gmail or Outlook
          account, or a Stripe account, also means you&apos;re agreeing to that company&apos;s own terms of service.
        </p>

        <h2 style={h2}>Ending your account</h2>
        <p style={p}>
          You can stop using StageReach and request account deletion at any time. We may also suspend or close
          an account that violates these terms.
        </p>

        <h2 style={h2}>No guarantees</h2>
        <p style={p}>
          We work hard to keep StageReach reliable, but it&apos;s provided as-is, without a guarantee of
          uninterrupted service. We&apos;re not liable for a gig falling through, a payment dispute between an
          artist and a venue, or similar issues that happen outside the platform itself.
        </p>

        <h2 style={h2}>Governing law</h2>
        <p style={p}>These terms are governed by the laws of the State of Oregon.</p>

        <h2 style={h2}>Changes to these terms</h2>
        <p style={p}>
          If we make meaningful changes, we&apos;ll update this page and change the date at the top.
        </p>

        <h2 style={h2}>Contact us</h2>
        <p style={p}>
          Questions about these terms? Reach out at{" "}
          <a href="mailto:hello@stagereach.app" style={{ color: "#D4A64F" }}>hello@stagereach.app</a>.
        </p>
      </div>
    </div>
  );
}
