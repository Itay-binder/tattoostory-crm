import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { getFinancingCase, addBank, removeBank, setBankStatus, setSubmissionAmount, unifiedClientDocs, addFinancingNote } from "@/lib/financingRepo";
import { BANK_STATUSES } from "@/lib/financing";

export const runtime = "nodejs";

// GET — תיק מימון בודד + כל התיעוד המאוחד של הלקוח (ליד + לקוח + עסקאות + מימון)
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;
  const c = await getFinancingCase(id);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });
  const docs = await unifiedClientDocs(c.clientId);
  return NextResponse.json({ case: c, docs });
}

// POST — פעולות על תיק המימון
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const c0 = await getFinancingCase(id);
  if (!c0) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    if (body.action === "add-bank") {
      const c = await addBank(id, String(body.bankName || ""), admin.email);
      return NextResponse.json({ ok: true, case: c });
    }
    if (body.action === "remove-bank") {
      const c = await removeBank(id, String(body.bankId || ""));
      return NextResponse.json({ ok: true, case: c });
    }
    if (body.action === "set-bank-status") {
      const status = String(body.status || "");
      if (!BANK_STATUSES.some((s) => s.key === status)) return NextResponse.json({ error: "סטטוס לא תקין" }, { status: 400 });
      const c = await setBankStatus(id, String(body.bankId || ""), status, admin.email);
      return NextResponse.json({ ok: true, case: c });
    }
    if (body.action === "set-amount") {
      const raw = body.amount;
      const amount = raw === "" || raw == null ? null : Number(String(raw).replace(/[^\d.]/g, ""));
      if (amount != null && isNaN(amount)) return NextResponse.json({ error: "סכום לא תקין" }, { status: 400 });
      const c = await setSubmissionAmount(id, amount);
      return NextResponse.json({ ok: true, case: c });
    }
    // תיעוד מימון — מסתנכרן לכל המקומות (נכתב לפעילות הליד המקושר; מוצג בליד/לקוח/מימון)
    if (body.action === "add-note") {
      const text = String(body.text || "").trim();
      if (!text) return NextResponse.json({ error: "ההערה ריקה" }, { status: 400 });
      await addFinancingNote(c0.clientId, text, { email: admin.email, name: admin.name || admin.email });
      return NextResponse.json({ ok: true, docs: await unifiedClientDocs(c0.clientId) });
    }
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
