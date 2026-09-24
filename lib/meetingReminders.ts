// לוגיקת סוכן רגב — תזכורות פגישות. משותפת ל-Vercel Cron (הפרודקשן) ולבדיקה ידנית.
// סורק את פגישות היום ביומן regev@, מוצא טלפון לפי מייל, ושולח ווצאפ (GreenAPI סוכן רגב).
import { GoogleAuth } from "google-auth-library";
import { supa } from "@/lib/supabaseAdmin";
import { normalizeEmail } from "@/lib/leads";

const REGEV_CAL = "regev@powercouple.co.il";
const TZ = "Asia/Jerusalem";

const fmtDateIL = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const fmtTimeIL = (d: Date) => new Intl.DateTimeFormat("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const firstName = (name: string) => (name || "").trim().split(/\s+/)[0] || "";

export function buildReminderMessage(name: string, time: string): string {
  return `היי ${name},
מזכיר לך שהיום מתקיימת הפגישה שלנו בשעה ${time}

המשרדים שלנו ממוקמים בשדרות הראשונים 23, ראשון לציון בניין מילניה B.
יש חניית אפר בסמוך למתחם:
https://maps.app.goo.gl/TtgHo97a2BEeXGLS9

במידה והפגישה נקבעה בזום אין למה להתייחס לכתובת המשרדים.

לכל שינוי או עזרה זמין כאן בווצאפ,
רגב.`;
}

interface CalEvent {
  id: string;
  summary?: string;
  status?: string;
  description?: string;
  start?: { dateTime?: string };
  attendees?: { email?: string; displayName?: string; resource?: boolean }[];
}

async function todaysEvents(): Promise<CalEvent[]> {
  const sa = JSON.parse(Buffer.from((process.env.GOOGLE_SA_B64 || "").trim(), "base64").toString("utf8"));
  const auth = new GoogleAuth({ credentials: sa, scopes: ["https://www.googleapis.com/auth/calendar"], clientOptions: { subject: REGEV_CAL } });
  const client = await auth.getClient();
  const timeMin = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 36 * 3600 * 1000).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(REGEV_CAL)}/events` +
    `?singleEvents=true&orderBy=startTime&timeMin=${timeMin}&timeMax=${timeMax}&maxResults=50`;
  const r = await client.request<{ items: CalEvent[] }>({ url });
  const today = fmtDateIL(new Date());
  return (r.data.items || []).filter((e) => e.start?.dateTime && e.status !== "cancelled" && fmtDateIL(new Date(e.start.dateTime!)) === today);
}

function clientContactOf(ev: CalEvent): { email: string; name: string } | null {
  const ext = (ev.attendees || []).find((a) => a.email && !a.resource && !/@powercouple\.co\.il$/i.test(a.email) && !/@group\.calendar\.google\.com$/i.test(a.email));
  if (ext?.email) return { email: ext.email, name: ext.displayName || "" };
  const m = (ev.description || "").match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? { email: m[0], name: "" } : null;
}

async function lookupPhone(email: string): Promise<{ phone: string; name: string } | null> {
  const key = normalizeEmail(email);
  const { data: leads } = await supa().from("leads").select("phone, full_name").eq("email_key", key).not("phone", "is", null).order("updated_at", { ascending: false }).limit(1);
  const l = (leads as { phone: string | null; full_name: string | null }[] | null)?.[0];
  if (l?.phone) return { phone: l.phone, name: l.full_name || "" };
  const { data: cls } = await supa().from("clients").select("answers, google_name").eq("email_key", key).limit(1);
  const c = (cls as { answers: Record<string, string> | null; google_name: string | null }[] | null)?.[0];
  const phone = c?.answers?.phone;
  return phone ? { phone, name: c?.google_name || c?.answers?.fullName || "" } : null;
}

async function sendWhatsapp(phone: string, message: string): Promise<string> {
  const inst = process.env.PC_GREENAPI_REGEV_INSTANCE, tok = process.env.PC_GREENAPI_REGEV_TOKEN;
  if (!inst || !tok) throw new Error("חסרים פרטי GreenAPI סוכן רגב (env)");
  const chatId = `${String(phone).replace(/\D/g, "")}@c.us`;
  const url = `https://api.green-api.com/waInstance${inst}/sendMessage/${tok}`;
  // 3 ניסיונות — תקלת רשת רגעית מ-Vercel ל-GreenAPI לא תפיל תזכורת
  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, message }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.idMessage) throw new Error(`GreenAPI ${res.status} ${JSON.stringify(d)}`);
      return d.idMessage as string;
    } catch (e) {
      lastErr = (e as Error).message;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  throw new Error(lastErr || "שליחה נכשלה");
}

export interface ReminderResult { line: string; ok: boolean }

/** מריץ את מחזור התזכורות. mode "dry" = לא שולח. מחזיר סיכום שורות + מונים. */
export async function runMeetingReminders(mode: "dry" | "send"): Promise<{ mode: string; sent: number; skipped: number; lines: string[] }> {
  const events = await todaysEvents();
  const lines: string[] = [];
  const nowMs = Date.now();
  const todayIL = fmtDateIL(new Date());
  let sent = 0, skipped = 0;
  for (const ev of events) {
    const start = new Date(ev.start!.dateTime!);
    const time = fmtTimeIL(start);
    if (start.getTime() < nowMs - 5 * 60 * 1000) { lines.push(`⏭️ "${ev.summary || ""}" (${time}) — הפגישה כבר עברה`); skipped++; continue; }
    const c = clientContactOf(ev);
    if (!c) { lines.push(`⏭️ "${ev.summary || ""}" (${time}) — אין מייל איש קשר`); skipped++; continue; }
    const rec = await lookupPhone(c.email);
    if (!rec) { lines.push(`⏭️ "${ev.summary || ""}" (${time}) — ${c.email}: אין טלפון במערכת`); skipped++; continue; }
    const name = firstName(rec.name || c.name) || "לקוח יקר";
    const { data: dup } = await supa().from("meeting_reminder_log").select("event_id").eq("event_id", ev.id).eq("day", todayIL).limit(1);
    if (dup && dup.length) { lines.push(`⏭️ ${name} (${time}) — כבר נשלחה תזכורת`); skipped++; continue; }
    if (mode === "send") {
      try {
        const id = await sendWhatsapp(rec.phone, buildReminderMessage(name, time));
        await supa().from("meeting_reminder_log").upsert({ event_id: ev.id, day: todayIL, phone: rec.phone }, { onConflict: "event_id,day" });
        lines.push(`✅ ${name} (${rec.phone}) — ${time} — id ${id}`); sent++;
      } catch (e) { lines.push(`❌ ${name} (${rec.phone}): ${(e as Error).message}`); skipped++; }
    } else {
      lines.push(`📤 [DRY] ${name} <${c.email}> → ${rec.phone} | ${time}`); sent++;
    }
  }
  return { mode, sent, skipped, lines };
}
