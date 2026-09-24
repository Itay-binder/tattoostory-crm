import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { supa } from "@/lib/supabaseAdmin";
import { getMcSettings, sendTemplateMessage } from "@/lib/metaGraph";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST { name, template_name, template_language, contacts:[{contact_type,contact_id,phone,name}] }
// שולח טמפלייט WABA לכל הקהל. דורש חיבור WABA.
export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const settings = await getMcSettings();
  if (!settings.phone_number_id) return NextResponse.json({ error: "לא מחובר מספר WABA (הגדרות)" }, { status: 400 });

  const b = await req.json().catch(() => ({}));
  const contacts: { contact_type?: string; contact_id?: string; phone: string; name?: string }[] = (b.contacts || []).filter((c: { phone?: string }) => c.phone);
  if (!b.template_name || !contacts.length) return NextResponse.json({ error: "חסר טמפלייט או קהל" }, { status: 400 });
  const lang = b.template_language || "he";

  const { data: bc } = await supa().from("mc_broadcasts").insert({
    name: b.name || b.template_name, template_name: b.template_name, template_language: lang,
    audience: { count: contacts.length }, status: "sending", total: contacts.length, created_by: admin.name || admin.email,
  }).select("id").single();
  const bcId = (bc as { id: string } | null)?.id;

  let sent = 0, failed = 0;
  for (const c of contacts) {
    try {
      const wamid = await sendTemplateMessage(settings.phone_number_id, c.phone, b.template_name, lang, b.components);
      sent++;
      if (bcId) await supa().from("mc_broadcast_recipients").insert({ broadcast_id: bcId, contact_type: c.contact_type || null, contact_id: c.contact_id || null, phone: c.phone, status: "sent", wamid, sent_at: new Date().toISOString() });
    } catch (e) {
      failed++;
      if (bcId) await supa().from("mc_broadcast_recipients").insert({ broadcast_id: bcId, contact_type: c.contact_type || null, contact_id: c.contact_id || null, phone: c.phone, status: "failed", error: (e as Error).message });
    }
  }
  if (bcId) await supa().from("mc_broadcasts").update({ status: "done", sent, failed }).eq("id", bcId);
  return NextResponse.json({ ok: true, sent, failed });
}
