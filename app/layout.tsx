import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: "StageReach",
  description: "CRM for gigging musicians",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geist.variable} antialiased`} style={{ backgroundColor: "#0E0E10" }}>
      <body style={{ backgroundColor: "#0E0E10", color: "#F4E8D2" }}>{children}</body>
    </html>
  );
}
