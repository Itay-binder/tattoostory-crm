import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";
import { sendPowerCoupleWhatsapp, WA_CONTACTS, normalizeIsraeliPhone } from "@/lib/notify";

export const runtime = "nodejs";

interface SignerRec { role?: string; name: string; order: number; optional: boolean; token: string; contact?: string }

// POST — שליחת קישורי החתימה של מעטפה לנמענים נבחרים בווצאפ
export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const envelopeId: string = body.envelopeId || "";
  const targets: string[] = Array.isArray(body.targets) ? body.targets : []; // mik | dean | hamal | client
  const others: string[] = Array.isArray(body.others) ? body.others.filter((x: string) => x && x.trim()) : [];
  const origin = (body.origin && String(body.origin)) || new URL(req.url).origin;

  if (!envelopeId) return NextResponse.json({ error: "missing envelopeId" }, { status: 400 });
  if (!targets.length && !others.length) return NextResponse.json({ error: "לא נבחרו נמענים" }, { status: 400 });

  const { data: env } = await supa().from("contract_envelopes").select("template_name").eq("id", envelopeId).maybeSingle();
  if (!env) return NextResponse.json({ error: "מעטפה לא נמצאה" }, { status: 404 });
  const templateName: string = (env as { template_name?: string }).template_name || "הסכם";
  const { data: sgRows } = await supa().from("contract_signers").select("role,name,sign_order,optional,token,contact").eq("envelope_id", envelopeId).order("sign_order", { ascending: true });
  const signers: SignerRec[] = ((sgRows as { role?: string; name: string; sign_order: number; optional: boolean; token: string; contact?: string }[]) || []).map((s) => ({ role: s.role, name: s.name, order: s.sign_order, optional: s.optional, token: s.token, contact: s.contact }));
  const linkFor = (s: SignerRec) => `${origin}/sign/${s.token}`;

  // הודעת "כל הקישורים" — לתיאום (מיק/דין/חמל/אחר)
  const allLinksText = [
    `*הסכם לחתימה — ${templateName}*`,
    "",
    ...signers.map((s) => `חתימה ${s.order} — ${s.name}${s.optional ? " (אופציונלי)" : ""}:\n${linkFor(s)}`),
  ].join("\n").trim();

  const results: { to: string; label: string; ok: boolean; error?: string }[] = [];
  const send = async (to: string, label: string, text: string) => {
    try { await sendPowerCoupleWhatsapp({ to, text }); results.push({ to, label, ok: true }); }
    catch (e) { results.push({ to, label, ok: false, error: (e as Error).message }); }
  };

  // נמענים קבועים — מקבלים את כל הקישורים
  for (const key of ["mik", "dean", "hamal"] as const) {
    if (targets.includes(key)) await send(WA_CONTACTS[key].chatId, WA_CONTACTS[key].label, allLinksText);
  }
  // אחר / אחר נוסף
  for (const num of others) {
    const phone = normalizeIsraeliPhone(num);
    if (phone.length >= 11) await send(phone, num, allLinksText);
    else results.push({ to: num, label: num, ok: false, error: "מספר לא תקין" });
  }
  // הלקוח שחותם — כל חותם שאינו השולח ויש לו טלפון מקבל את הקישור האישי שלו
  if (targets.includes("client")) {
    for (const s of signers) {
      if (s.role === "sender") continue;
      const phone = normalizeIsraeliPhone(s.contact || "");
      if (phone.length < 11) { results.push({ to: s.name, label: `${s.name} (הלקוח)`, ok: false, error: "אין טלפון תקין לחותם" }); continue; }
      const text = `היי ${s.name},\nלחתימה על ההסכם "${templateName}":\n${linkFor(s)}`;
      await send(phone, `${s.name} (הלקוח)`, text);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: okCount > 0, sent: okCount, total: results.length, results });
}
