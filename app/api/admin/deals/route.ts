import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { listDeals, createDeal } from "@/lib/dealsRepo";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  return NextResponse.json({ deals: await listDeals() });
}

export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!String(body.title || "").trim()) return NextResponse.json({ error: "צריך שם לעסקה" }, { status: 400 });
  const deal = await createDeal({ title: body.title, status: body.status, data: body.data, linkedLeadId: body.linkedLeadId, linkedClientUid: body.linkedClientUid }, admin.email);
  return NextResponse.json({ ok: true, deal });
}
