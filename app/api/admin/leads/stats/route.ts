import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { leadsStats } from "@/lib/leadsRepo";

export const runtime = "nodejs";

/**
 * GET — אגרגציה לדשבורד: מטריצת (מקור × שלב) בטווח תאריכי יצירה.
 * מחליפה את המצב הקודם, שבו הדשבורד שאב את כל הלידים וספר אותם בדפדפן.
 * גם עם עשרות אלפי לידים התשובה נשארת עשרות שורות.
 * פרמטרים: from, to (YYYY-MM-DD, אופציונליים).
 */
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const from = sp.get("from");
  const to = sp.get("to");

  const stats = await leadsStats(
    from ? `${from}T00:00:00.000Z` : undefined,
    to ? `${to}T23:59:59.999Z` : undefined
  );
  const total = stats.reduce((sum, r) => sum + r.cnt, 0);
  return NextResponse.json({ stats, total });
}
