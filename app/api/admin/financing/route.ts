import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { listFinancingCases, financingStats, addClientToFinancing } from "@/lib/financingRepo";

export const runtime = "nodejs";

// GET — רשימת תיקי מימון + סטטיסטיקות למסך הראשי
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  try {
    const [cases, stats] = await Promise.all([listFinancingCases(), financingStats()]);
    return NextResponse.json({ cases, stats });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

// POST — הוספת לקוח לסקשן מימון
export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (body.action === "add-client") {
    const clientId = String(body.clientId || "").trim();
    if (!clientId) return NextResponse.json({ error: "חסר לקוח" }, { status: 400 });
    try {
      const c = await addClientToFinancing(clientId, admin.email);
      if (!c) return NextResponse.json({ error: "הלקוח לא נמצא" }, { status: 404 });
      return NextResponse.json({ ok: true, case: c });
    } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
