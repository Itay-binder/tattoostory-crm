import { NextResponse } from "next/server";
import { verifyRequest } from "@/lib/firebaseAdmin";
import { findLeadForClient } from "@/lib/leadsRepo";
import { getClientByEmail } from "@/lib/clientsRepo";
import { createLowProfile } from "@/lib/cardcom";

export const runtime = "nodejs";

const PORTAL_ALLOWED = ["itay.bin111@gmail.com"];
// ⚠️ בדיקות (09/2026): הסכומים הורדו ל-1₪ לצורך טסטים. לשחזר ל-500 / 1000 לפני עלייה אמיתית.
const STEPS: Record<string, { amount: number; product: string }> = {
  compass: { amount: 1, product: "פגישת מצפן — תכנית אישית עם יועץ נדל\"ן (בדיקה)" },
  process: { amount: 1, product: "התקדמות לתהליך — שאלון פיננסי + הסכם התקשרות (בדיקה)" },
};

// POST { step: 'compass' | 'process' } → יוצר דף סליקה CardCom ומחזיר URL להפניה.
export async function POST(req: Request) {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const email = (user.email || "").toLowerCase().trim();
  if (!PORTAL_ALLOWED.includes(email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const step = String(body.step || "");
  const cfg = STEPS[step];
  if (!cfg) return NextResponse.json({ error: "שלב תשלום לא תקין" }, { status: 400 });

  const lead = await findLeadForClient({ email });
  const client = await getClientByEmail(email);
  const name = (client?.answers?.fullName || lead?.fullName || user.name || "").trim();
  const refId = lead?.id || client?.id || email;

  const origin = new URL(req.url).origin;
  try {
    const { url, lowProfileId } = await createLowProfile({
      amount: cfg.amount,
      productName: cfg.product,
      returnValue: `${refId}:${step}`,
      customerName: name,
      customerEmail: email,
      successUrl: `${origin}/portal/paid`,
      failedUrl: `${origin}/portal/paid?failed=1`,
      webhookUrl: `${origin}/api/portal/pay/callback`,
    });
    return NextResponse.json({ ok: true, url, lowProfileId });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
