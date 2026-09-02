import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: "StageReach",
  description: "CRM for gigging musicians",
  appleWebApp: {
    title: "StageReach",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0E0E10",
  // Lets content (and the fixed mobile bottom nav below) know about the
  // iPhone's safe areas via the env(safe-area-inset-*) CSS variables —
  // without this, those variables silently resolve to 0 and fixed UI can
  // sit flush against the home-indicator gesture zone, especially when
  // running as an installed home-screen PWA with a translucent status bar
  // (required for push notifications — see PushToggle).
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geist.variable} antialiased`} style={{ backgroundColor: "#0E0E10" }}>
      <body
        style={{
          backgroundColor: "#0E0E10",
          color: "#F4E8D2",
          // "black-translucent" (above) makes the iPhone status bar an
          // overlay on top of the page instead of its own separate bar —
          // without this, whatever sits at the very top of every page
          // (a heading, a button) renders underneath the clock/battery
          // icons instead of below them. Mirrors the bottom safe-area
          // handling the mobile nav bars already do.
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        {children}
      </body>
    </html>
  );
}
