import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({ subsets: ["hebrew", "latin"], weight: ["400", "600", "700", "800", "900"] });

export const metadata: Metadata = {
  title: "שאלון פיננסי — פאוור קאפל",
  description: "שאלון היכרות פיננסי ללקוחות דין ומיק — פאוור קאפל",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0d12",
};

// מחיל את הערכה לפני הציור הראשון — בלי הבהוב של רקע כהה
const NO_FLASH = `try{var t=localStorage.getItem('pcfTheme');if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head><script dangerouslySetInnerHTML={{ __html: NO_FLASH }} /></head>
      <body className={heebo.className}>{children}</body>
    </html>
  );
}
