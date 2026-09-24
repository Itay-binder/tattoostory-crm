import { NextResponse } from "next/server";
import { getLpResult } from "@/lib/cardcom";
import { markPortalPayment } from "@/lib/portalPay";

export const runtime = "nodejs";

// POST { lowProfileId } — אימות סינכרוני של תשלום מהפורטל וסימון השלב.
// לא דורש אימות משתמש: הביטחון הוא שה-lowProfileId מאומת מול CardCom כ'שולם'
// (בלי עסקה משולמת אין מה לסמן), והסימון אידמפוטנטי מול ה-webhook.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const lpId = String(body.lowProfileId || body.lowprofilecode || "");
  if (!lpId) return NextResponse.json({ error: "missing lowProfileId" }, { status: 400 });

  const r = await getLpResult(lpId).catch(() => ({ paid: false, amount: 0, returnValue: "" }));
  if (!r.paid) return NextResponse.json({ ok: false, paid: false });

  const res = await markPortalPayment(r.returnValue, true, r.amount);
  return NextResponse.json({ ok: true, paid: true, ...res });
}
