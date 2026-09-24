import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { getLead } from "@/lib/leadsRepo";
import { createCallRequest, getLatestCallRequest, cancelCallRequest } from "@/lib/callRequestsRepo";

export const runtime = "nodejs";

// GET ?leadId= — בקשת החיוג האחרונה לליד (לתצוגת סטטוס חי)
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const leadId = new URL(req.url).searchParams.get("leadId") || "";
  if (!leadId) return NextResponse.json({ error: "leadId חסר" }, { status: 400 });
  const request = await getLatestCallRequest(leadId);
  return NextResponse.json({ request });
}

// POST — יצירת בקשת חיוג ({leadId}) או ביטול ({action:"cancel", id})
export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  if (body.action === "cancel") {
    await cancelCallRequest(String(body.id || ""));
    return NextResponse.json({ ok: true });
  }

  const leadId = String(body.leadId || "");
  const lead = await getLead(leadId);
  if (!lead) return NextResponse.json({ error: "הליד לא נמצא" }, { status: 404 });
  if (!lead.phone) return NextResponse.json({ error: "לליד אין מספר טלפון לחיוג" }, { status: 400 });

  const request = await createCallRequest({
    leadId, leadName: lead.fullName || "", leadPhone: lead.phone,
    byEmail: admin.email, byName: admin.name || admin.email, deviceId: body.deviceId || undefined,
  });
  return NextResponse.json({ ok: true, request });
}
