import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { metaInsights } from "@/lib/metaInsights";

export const runtime = "nodejs";

/**
 * GET — נתוני חשבון המודעות של Tattoo Story לטווח תאריכים.
 * פרמטרים: from, to (YYYY-MM-DD). ברירת מחדל: מתחילת החודש הנוכחי עד היום.
 * מחזיר סיכום חשבון + שורה לכל קמפיין שהוציא תקציב בטווח.
 */
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const from = sp.get("from") || monthStart;
  const to = sp.get("to") || today;

  const meta = await metaInsights(from, to);
  if (!meta) {
    return NextResponse.json({
      meta: null,
      from, to,
      reason: process.env.META_ACCESS_TOKEN || process.env.META_SYSTEM_TOKEN
        ? "הקריאה למטא נכשלה — ייתכן שהטוקן פג או שאין הרשאה לחשבון"
        : "חסר META_ACCESS_TOKEN בהגדרות הסביבה",
    });
  }
  return NextResponse.json({ meta, from, to });
}
