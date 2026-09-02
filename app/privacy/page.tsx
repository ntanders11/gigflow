import Link from "next/link";

const h2 = { color: "#F4E8D2", fontSize: "18px", fontWeight: 700, marginTop: "32px", marginBottom: "10px" };
const p  = { color: "#9a9591", fontSize: "14px", lineHeight: 1.7, marginBottom: "12px" };
const li = { color: "#9a9591", fontSize: "14px", lineHeight: 1.7, marginBottom: "8px" };

export default function PrivacyPage() {
  return (
    <div className="min-h-screen px-6 py-12" style={{ backgroundColor: "#0E0E10" }}>
      <div className="max-w-2xl mx-auto">
        <Link href="/" style={{ color: "#D4A64F", fontSize: "13px" }}>← Back to StageReach</Link>
        <h1 className="text-2xl font-bold mt-4 mb-1" style={{ color: "#F4E8D2" }}>Privacy Policy</h1>
        <p style={{ color: "#5e5c58", fontSize: "13px" }}>Last updated September 1, 2026</p>

        <p style={{ ...p, marginTop: "24px" }}>
          StageReach (&quot;we,&quot; &quot;us&quot;) connects gigging musicians with the venues that book them.
          This page explains what information we collect through the app, why we collect it, and — the short
          version — that we never sell your information to anyone. We only use it to run the features you&apos;re
          actually using.
        </p>

        <h2 style={h2}>Information we collect</h2>
        <p style={p}>Depending on whether you&apos;re an artist or a venue, we collect:</p>
        <ul style={{ paddingLeft: "20px", listStyle: "disc" }}>
          <li style={li}><strong style={{ color: "#F4E8D2" }}>Account info</strong> — your name, email, and phone number.</li>
          <li style={li}><strong style={{ color: "#F4E8D2" }}>Profile info</strong> — for artists: bio, photo, genres, social links, and pricing packages. For venues: venue name, address, contact info, genres booked, and photo.</li>
          <li style={li}><strong style={{ color: "#F4E8D2" }}>Booking info</strong> — gig dates, times, notes, and messages exchanged between artists and venues through the app.</li>
          <li style={li}><strong style={{ color: "#F4E8D2" }}>Ratings and reviews</strong> — written by artists and venues about each other after a gig. These are shown publicly with your name attached, same as any review site.</li>
          <li style={li}><strong style={{ color: "#F4E8D2" }}>Payment info</strong> — invoice amounts and status. Actual card numbers are handled entirely by Stripe, our payment processor — we never see or store them ourselves.</li>
          <li style={li}><strong style={{ color: "#F4E8D2" }}>Connected email accounts</strong> — if you choose to connect Gmail or Outlook, we use that connection only to send pitch and follow-up emails from your own address on your behalf. We don&apos;t read your inbox for anything beyond what&apos;s needed to send those emails, and you can disconnect it at any time.</li>
          <li style={li}><strong style={{ color: "#F4E8D2" }}>Location</strong> — only if you tap &quot;Use my current location&quot; while searching. It&apos;s used for that one search and isn&apos;t stored.</li>
          <li style={li}><strong style={{ color: "#F4E8D2" }}>Basic usage info</strong> — things like device type and push notification settings, so features like alerts work correctly.</li>
        </ul>

        <h2 style={h2}>How we use it</h2>
        <p style={p}>
          Strictly to run the app: matching artists with nearby venues, sending booking requests and invoices,
          keeping your calendar and pipeline up to date, and sending you notifications you&apos;ve asked for.
          We do not sell, rent, or share your information with advertisers or data brokers — ever.
        </p>

        <h2 style={h2}>Who we share it with</h2>
        <p style={p}>
          We use a handful of outside services to make StageReach work, and your information passes through
          them only as needed to power the features you use:
        </p>
        <ul style={{ paddingLeft: "20px", listStyle: "disc" }}>
          <li style={li}><strong style={{ color: "#F4E8D2" }}>Supabase</strong> — hosts our database and handles account sign-in.</li>
          <li style={li}><strong style={{ color: "#F4E8D2" }}>Stripe</strong> — processes payments and invoices.</li>
          <li style={li}><strong style={{ color: "#F4E8D2" }}>Resend</strong> — sends emails when you haven&apos;t connected your own Gmail/Outlook.</li>
          <li style={li}><strong style={{ color: "#F4E8D2" }}>Google and Microsoft</strong> — only if you connect a Gmail or Outlook account, to send email on your behalf.</li>
          <li style={li}><strong style={{ color: "#F4E8D2" }}>Google, Geoapify, and OpenStreetMap</strong> — power venue and artist search by location.</li>
          <li style={li}><strong style={{ color: "#F4E8D2" }}>Vercel</strong> — hosts the app itself.</li>
        </ul>
        <p style={p}>
          Each of these has its own privacy practices for the data it handles on our behalf. None of them are
          permitted to use your information for their own advertising.
        </p>

        <h2 style={h2}>What&apos;s shown publicly</h2>
        <p style={p}>
          Your artist or venue profile (name, photo, bio, genres) is visible to anyone with the link, since
          that&apos;s the point of a public booking profile. Revealed ratings and reviews are also shown publicly,
          attributed to your name — we made attribution deliberate, since it builds trust for whoever&apos;s reading
          them. Anything you mark private (like blackout-date notes) is never shown to anyone but you.
        </p>

        <h2 style={h2}>Your choices</h2>
        <p style={p}>
          You can disconnect a connected Gmail/Outlook account, turn push notifications on or off, and edit or
          delete most of your own information directly in the app at any time. To close your account entirely
          or request that we delete your data, contact us below.
        </p>

        <h2 style={h2}>Children&apos;s privacy</h2>
        <p style={p}>StageReach isn&apos;t intended for anyone under 18, and we don&apos;t knowingly collect information from children.</p>

        <h2 style={h2}>Security</h2>
        <p style={p}>
          We take reasonable steps to protect your information, but no online service can guarantee perfect
          security. Please use a strong, unique password for your account.
        </p>

        <h2 style={h2}>Changes to this policy</h2>
        <p style={p}>
          If we make meaningful changes to how we handle your information, we&apos;ll update this page and change
          the date at the top.
        </p>

        <h2 style={h2}>Contact us</h2>
        <p style={p}>
          Questions about this policy or your data? Reach out at{" "}
          <a href="mailto:hello@stagereach.app" style={{ color: "#D4A64F" }}>hello@stagereach.app</a>.
        </p>
      </div>
    </div>
  );
}
