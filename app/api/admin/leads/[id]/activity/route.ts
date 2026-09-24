import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { listLeadActivity, countLeadActivity, ACTIVITY_PAGE_SIZE } from "@/lib/leadsRepo";

export const runtime = "nodejs";

/**
 * GET — חלון נוסף מיומן התיעוד של ליד ("טען עוד 50").
 * כרטיס הליד נפתח עם 50 הרשומות האחרונות; מכאן נמשכות הבאות.
 * פרמטרים: offset (ברירת מחדל 0), limit (ברירת מחדל 50, מקסימום 200).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;

  const sp = new URL(req.url).searchParams;
  const offset = Math.max(0, Number(sp.get("offset")) || 0);
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit")) || ACTIVITY_PAGE_SIZE));

  const [activity, total] = await Promise.all([
    listLeadActivity(id, offset, limit),
    countLeadActivity(id),
  ]);
  return NextResponse.json({ activity, total, offset, limit });
}
