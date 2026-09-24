import { NextResponse } from "next/server";
import { getLpResult } from "@/lib/cardcom";
import { markPortalPayment } from "@/lib/portalPay";

export const runtime = "nodejs";

// Webhook מ-CardCom אחרי סליקה מהפורטל (שרת-לשרת, לא תלוי בדפדפן).
// CardCom שולח את תוצאת ה-LowProfile כ-JSON. קוראים ישירות, ואם חסר — מאמתים דרך getLpResult.
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) body = await req.json().catch(() => ({}));
  else { const f = await req.formData().catch(() => null); if (f) for (const [k, v] of f.entries()) body[k] = typeof v === "string" ? v : ""; }

  let paid = body.ResponseCode === 0 || body.ResponseCode === "0";
  let returnValue = String(body.ReturnValue || "");
  const ti = body.TranzactionInfo as { Amount?: number } | null;
  let amount = Number(ti?.Amount || body.Amount || 0);
  const lpId = String(body.LowProfileId || body.LowProfileCode || body.lowprofilecode || "");

  // אם הגוף לא כלל ReturnValue/סכום — נאמת מול CardCom לפי המזהה.
  if ((!returnValue || !paid) && lpId) {
    const r = await getLpResult(lpId).catch(() => ({ paid: false, amount: 0, returnValue: "" }));
    paid = r.paid; returnValue = returnValue || r.returnValue; amount = amount || r.amount;
  }

  const res = await markPortalPayment(returnValue, paid, amount);
  return NextResponse.json({ ok: true, ...res });
}
