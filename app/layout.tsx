import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Hebrew } from "next/font/google";
import "./globals.css";

const ibm = IBM_Plex_Sans_Hebrew({
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Tattoo Story Academy — CRM",
  description: "מערכת ניהול לקוחות — Tattoo Story Academy",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#081B1D",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body className={ibm.className}>{children}</body>
    </html>
  );
}
