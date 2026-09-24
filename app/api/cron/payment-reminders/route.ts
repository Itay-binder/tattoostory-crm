import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { env } from "@/lib/env";
import { verifyAdmin } from "@/lib/admin";
import { sendMail, MAIL_FROM } from "@/lib/mailer";

export const runtime = "nodejs";
export const maxDuration = 60;

const TEAM_CC = ["blog@powercouple.co.il"];

/** תאריך היום בישראל בפורמט YYYY-MM-DD (לא UTC — אחרת נטעה ביום). */
function israelDate(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const KINDS = [
  { kind: "week_before", flag: "notify_week_before", offset: 7, label: "בעוד שבוע" },
  { kind: "day_before", flag: "notify_day_before", offset: 1, label: "מחר" },
  { kind: "same_day", flag: "notify_same_day", offset: 0, label: "היום" },
];

function money(a: number | null): string {
  return a == null ? "" : `₪${Number(a).toLocaleString("he-IL")}`;
}

function emailHtml(p: { title: string; amount: number | null; due_date: string; note: string | null }, dealTitle: string, when: string): string {
  const rows = [
    ["תשלום", p.title],
    ...(p.amount != null ? [["סכום", money(p.amount)]] : []),
    ["תאריך יעד", new Date(p.due_date).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })],
    ["עסקה", dealTitle],
  ];
  return `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;text-align:right;color:#222;max-width:560px">
  <p dir="rtl" style="text-align:right;font-size:16px">שלום,</p>
  <p dir="rtl" style="text-align:right;font-size:16px">תזכורת ידידותית לתשלום שמועד הפירעון שלו <b>${when}</b>.</p>
  <table dir="rtl" style="border-collapse:collapse;width:100%;margin:18px 0">
    ${rows.map(([k, v]) => `<tr><td style="padding:9px 12px;border:1px solid #e3e3e3;background:#fafafa;font-weight:bold;text-align:right;width:35%">${k}</td><td style="padding:9px 12px;border:1px solid #e3e3e3;text-align:right">${v}</td></tr>`).join("")}
  </table>
  ${p.note ? `<p dir="rtl" style="text-align:right;font-size:15px">${p.note}</p>` : ""}
  <p dir="rtl" style="text-align:right;font-size:15px">לכל שאלה אנחנו כאן.</p>
  <p dir="rtl" style="text-align:right;font-size:15px">אוהבים,<br>דין ומיק</p>
</div>`;
}

async function run(): Promise<{ checked: number; sent: number; details: string[] }> {
  const details: string[] = [];
  let checked = 0, sent = 0;

  for (const k of KINDS) {
    const target = israelDate(k.offset);
    const { data: payments } = await supa()
      .from("deal_payments")
      .select("id, deal_id, title, amount, due_date, note, notify_week_before, notify_day_before, notify_same_day, deal_payment_clients(client_id), deal_payment_sends(kind), deals(title)")
      .eq("status", "pending").eq("due_date", target);

    for (const raw of (payments || []) as Record<string, unknown>[]) {
      checked++;
      if (!raw[k.flag]) continue;
      const already = ((raw.deal_payment_sends as { kind: string }[]) || []).some((s) => s.kind === k.kind);
      if (already) continue;

      const clientIds = ((raw.deal_payment_clients as { client_id: string }[]) || []).map((c) => c.client_id);
      let to: string[] = [];
      if (clientIds.length) {
        const { data: cl } = await supa().from("clients").select("email").in("id", clientIds);
        to = ((cl as { email: string | null }[]) || []).map((c) => c.email || "").filter(Boolean);
      }
      // בלי לקוחות/מיילים — התזכורת עדיין מגיעה לצוות
      const recipients = to.length ? to : TEAM_CC;
      const cc = to.length ? TEAM_CC : [];

      const p = raw as unknown as { id: string; title: string; amount: number | null; due_date: string; note: string | null };
      const dealTitle = ((raw.deals as { title?: string } | null)?.title) || "עסקה";
      try {
        await sendMail({
          to: recipients,
          cc,
          subject: `תזכורת תשלום — ${p.title} (${k.label})`,
          html: emailHtml(p, dealTitle, k.label),
        });
        await supa().from("deal_payment_sends").insert({ payment_id: p.id, kind: k.kind, recipients: [...recipients, ...cc].join(", ") });
        sent++;
        details.push(`${k.kind}: ${p.title} → ${recipients.join(", ")}`);
      } catch (e) {
        details.push(`❌ ${k.kind}: ${p.title} — ${(e as Error).message}`);
      }
    }
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
