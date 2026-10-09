import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { funnelStats } from "@/lib/leadsRepo";

export const runtime = "nodejs";

/**
 * GET — מוני המשפך לדשבורד בטווח תאריכים.
 * פרמטרים: from, to (YYYY-MM-DD). ברירת מחדל: מתחילת החודש הנוכחי עד היום.
 */
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const from = sp.get("from") || monthStart;
  const to = sp.get("to") || today;

  const funnel = await funnelStats(`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`);
  return NextResponse.json({ funnel, from, to });
}
