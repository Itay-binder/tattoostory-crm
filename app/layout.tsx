import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Hebrew } from "next/font/google";
import "./globals.css";

const ibm = IBM_Plex_Sans_Hebrew({
  subsets: ["hebrew", "latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Tattoo Story Academy — CRM",
  description: "מערכת ניהול לידים ולקוחות — Tattoo Story Academy",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#081B1D",
};

// מחיל את הערכה לפני הציור הראשון — בלי הבהוב.
// ברירת המחדל כאן בהירה (המיתוג של Tattoo Story); כהה רק אם המשתמש בחר.
const NO_FLASH = `try{var t=localStorage.getItem('pcfTheme');if(t!=='dark')document.documentElement.setAttribute('data-theme','light');}catch(e){document.documentElement.setAttribute('data-theme','light');}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head><script dangerouslySetInnerHTML={{ __html: NO_FLASH }} /></head>
      <body className={ibm.className}>{children}</body>
    </html>
  );
}
