import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: "GigFlow",
  description: "CRM for gigging musicians",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geist.variable} antialiased`} style={{ backgroundColor: "#0e0f11" }}>
      <body style={{ backgroundColor: "#0e0f11", color: "#f0ede8" }}>{children}</body>
    </html>
  );
}
