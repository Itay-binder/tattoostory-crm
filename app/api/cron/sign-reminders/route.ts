import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { env } from "@/lib/env";
import { verifyAdmin } from "@/lib/admin";
import { sendMail, MAIL_FROM } from "@/lib/mailer";

export const runtime = "nodejs";
export const maxDuration = 60;

const BASE_URL = "https://powercouple-finance.vercel.app";
const TEAM_CC = ["blog@powercouple.co.il"];

interface SignerLite { name: string; role: string; token: string; status: string; client_id: string | null; contact: string | null }
interface EnvLite { id: string; template_name: string; created_at: string; status: string; contract_signers: SignerLite[] }

function reminderHtml(name: string, templateName: string, link: string): string {
  return `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;text-align:right;color:#222;max-width:560px">
  <p dir="rtl" style="text-align:right;font-size:16px">שלום ${name || ""},</p>
  <p dir="rtl" style="text-align:right;font-size:16px">רצינו להזכיר שההסכם <b>${templateName}</b> ממתין לחתימתך.</p>
  <p dir="rtl" style="text-align:right;font-size:16px">אפשר לחתום דיגיטלית, בכמה שניות, מהקישור הבא:</p>
  <p dir="rtl" style="text-align:right;margin:18px 0">
    <a href="${link}" style="background:#b3261e;color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-size:16px">חתימה על ההסכם</a>
  </p>
  <p dir="rtl" style="text-align:right;font-size:14px;color:#666">אם כבר חתמת, אפשר להתעלם מהודעה זו.</p>
  <p dir="rtl" style="text-align:right;font-size:15px">אוהבים,<br>דין ומיק</p>
</div>`;
}

async function run(): Promise<{ checked: number; sent: number; details: string[] }> {
  const details: string[] = [];
  let checked = 0, sent = 0;
  const cutoff = new Date(Date.now() - 3 * 86400_000).toISOString();

  const { data } = await supa().from("contract_envelopes")
    .select("id, template_name, created_at, status, sign_reminder_sent_at, contract_signers(name, role, token, status, client_id, contact)")
    .neq("status", "signed")
    .lte("created_at", cutoff)
    .is("sign_reminder_sent_at", null);

  const envs = (data as unknown as EnvLite[]) || [];
  // איסוף מיילי לקוחות לפי client_id
  const clientIds = [...new Set(envs.flatMap((e) => (e.contract_signers || []).map((s) => s.client_id).filter(Boolean) as string[]))];
  const emailById = new Map<string, string>();
  if (clientIds.length) {
    const { data: cl } = await supa().from("clients").select("id, email").in("id", clientIds);
    for (const c of (cl as { id: string; email: string | null }[]) || []) if (c.email) emailById.set(c.id, c.email);
  }

  for (const e of envs) {
    checked++;
    const pending = (e.contract_signers || []).filter((s) => s.role !== "sender" && s.status !== "signed" && s.token);
    let anySent = false;
    for (const s of pending) {
      const email = (s.client_id && emailById.get(s.client_id)) || (s.contact && s.contact.includes("@") ? s.contact : "");
      if (!email) { details.push(`⏭ ${e.template_name} / ${s.name} — אין מייל`); continue; }
      const link = `${BASE_URL}/sign/${s.token}`;
      try {
        await sendMail({ to: [email], cc: TEAM_CC, subject: `תזכורת לחתימה — ${e.template_name}`, html: reminderHtml(s.name, e.template_name, link) });
        anySent = true; sent++;
        details.push(`✓ ${e.template_name} → ${email}`);
      } catch (err) { details.push(`❌ ${e.template_name} / ${email} — ${(err as Error).message}`); }
    }
    // מסמנים שנשלחה תזכורת כדי לא לשלוח שוב (גם אם לא נמצא מייל — לא ננסה כל יום)
    await supa().from("contract_envelopes").update({ sign_reminder_sent_at: new Date().toISOString() }).eq("id", e.id);
    void anySent;
  }
  return { checked, sent, details };
}

// מופעל ע"י Vercel Cron (יומי). מאפשר גם הפעלה ידנית ע"י מנהל מחובר — לבדיקה.
export async function GET(req: Request) {
  const secret = env("CRON_SECRET");
  const auth = req.headers.get("authorization") || "";
  const isCron = secret && auth === `Bearer ${secret}`;
  const admin = isCron ? null : await verifyAdmin(req);
  if (!isCron && !admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  try {
    const r = await run();
    return NextResponse.json({ ok: true, from: MAIL_FROM, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
