// סוכן תזכורות פגישות — "סוכן רגב"
// סורק את הפגישות של היום ביומן regev@powercouple.co.il, מוצא את הטלפון של איש הקשר
// לפי המייל (במערכת הפיננסית), ושולח תזכורת ווצאפ דרך GreenAPI (instance סוכן רגב).
//
// מצבי הרצה:
//   node scripts/regev-meeting-reminders.mjs            → סריקה בלבד (Dry-run, לא שולח)
//   node scripts/regev-meeting-reminders.mjs --test     → שולח הודעת מבחן אחת לאיתי (972526660006)
//   node scripts/regev-meeting-reminders.mjs --send     → שליחה חיה לכל אנשי הקשר של פגישות היום

import fs from "fs";
import { GoogleAuth } from "google-auth-library";
import pg from "pg";

const MODE = process.argv.includes("--send") ? "send" : process.argv.includes("--backfill") ? "backfill" : process.argv.includes("--test") ? "test" : "dry";
const REGEV_CAL = "regev@powercouple.co.il";
const ITAY_TEST = "972526660006";
const TZ = "Asia/Jerusalem";

// ── env — לוקלית מ-.env.local, בענן (GitHub Actions) מ-process.env ──
let fileEnv = {};
try {
  fileEnv = Object.fromEntries(
    fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
  );
} catch { /* בענן אין .env.local — קוראים מ-process.env */ }
const env = { ...fileEnv, ...process.env };
const GA_INSTANCE = env.PC_GREENAPI_REGEV_INSTANCE;
const GA_TOKEN = env.PC_GREENAPI_REGEV_TOKEN;

// ── עזרי זמן/פורמט ──
const fmtDateIL = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);       // YYYY-MM-DD
const fmtTimeIL = (d) => new Intl.DateTimeFormat("he-IL", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const firstName = (name) => (name || "").trim().split(/\s+/)[0] || "";

function buildMessage(name, time) {
  return `היי ${name},
מזכיר לך שהיום מתקיימת הפגישה שלנו בשעה ${time}

המשרדים שלנו ממוקמים בשדרות הראשונים 23, ראשון לציון בניין מילניה B.
יש חניית אפר בסמוך למתחם:
https://maps.app.goo.gl/TtgHo97a2BEeXGLS9

במידה והפגישה נקבעה בזום אין למה להתייחס לכתובת המשרדים.

לכל שינוי או עזרה זמין כאן בווצאפ,
רגב.`;
}

// ── יומן: פגישות היום של regev ──
async function todaysEvents() {
  const sa = JSON.parse(Buffer.from((env.GOOGLE_SA_B64 || "").trim(), "base64").toString("utf8"));
  const auth = new GoogleAuth({ credentials: sa, scopes: ["https://www.googleapis.com/auth/calendar"], clientOptions: { subject: REGEV_CAL } });
  const client = await auth.getClient();
  const timeMin = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 36 * 3600 * 1000).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(REGEV_CAL)}/events` +
    `?singleEvents=true&orderBy=startTime&timeMin=${timeMin}&timeMax=${timeMax}&maxResults=50`;
  const r = await client.request({ url });
  const today = fmtDateIL(new Date());
  return (r.data.items || []).filter((e) => {
    if (!e.start?.dateTime) return false;                         // מדלגים על אירועי יום-שלם
    if (e.status === "cancelled") return false;
    return fmtDateIL(new Date(e.start.dateTime)) === today;
  });
}

// מוצא את איש הקשר (הלקוח) באירוע — המוזמן שאינו צוות פאוור קאפל
function clientEmailOf(ev) {
  const atts = ev.attendees || [];
  const ext = atts.find((a) => a.email && !a.resource && !/@powercouple\.co\.il$/i.test(a.email) && !/@group\.calendar\.google\.com$/i.test(a.email));
  if (ext) return { email: ext.email, name: ext.displayName || "" };
  // גיבוי: מייל בתיאור האירוע
  const m = (ev.description || "").match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m ? { email: m[0], name: "" } : null;
}

// ── חיפוש טלפון+שם לפי מייל במערכת הפיננסית ──
async function lookupPhone(db, email) {
  const q = `select phone, full_name from leads where lower(email)=lower($1) and phone is not null and phone<>'' order by updated_at desc limit 1`;
  let r = await db.query(q, [email]);
  if (r.rows[0]) return r.rows[0];
  // גיבוי: טבלת לקוחות (אין טלפון ישיר → answers.phone)
  r = await db.query(`select answers->>'phone' phone, coalesce(google_name, answers->>'fullName') full_name from clients where lower(email)=lower($1) limit 1`, [email]);
  return r.rows[0]?.phone ? r.rows[0] : null;
}

// ── שליחת ווצאפ דרך GreenAPI (סוכן רגב) ──
async function sendWhatsapp(phone, message) {
  const chatId = `${String(phone).replace(/\D/g, "")}@c.us`;
  const res = await fetch(`https://api.green-api.com/waInstance${GA_INSTANCE}/sendMessage/${GA_TOKEN}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.idMessage) throw new Error(`GreenAPI נכשל: ${res.status} ${JSON.stringify(d)}`);
  return d.idMessage;
}

// ── main ──
(async () => {
  console.log(`\n🤖 סוכן רגב — תזכורות פגישות | מצב: ${MODE} | ${new Intl.DateTimeFormat("he-IL", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date())}\n`);
  if (!GA_INSTANCE || !GA_TOKEN) { console.log("❌ חסרים פרטי GreenAPI (env)"); process.exit(1); }

  // מצב test — שולח הודעת מבחן אחת לאיתי ומסיים
  if (MODE === "test") {
    const msg = buildMessage("איתי", "15:00");
    const id = await sendWhatsapp(ITAY_TEST, msg);
    console.log(`✅ הודעת מבחן נשלחה לאיתי (${ITAY_TEST}) — idMessage: ${id}\n--- תוכן ההודעה ---\n${msg}`);
    return;
  }

  const events = await todaysEvents();
  console.log(`📅 נמצאו ${events.length} פגישות עם שעה היום ביומן של רגב\n`);
  if (!events.length) { console.log("אין פגישות להיום — לא נשלח כלום."); return; }

  const db = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const nowMs = Date.now();
  const todayIL = fmtDateIL(new Date());
  let sent = 0, skipped = 0;
  for (const ev of events) {
    const startMs = new Date(ev.start.dateTime).getTime();
    const time = fmtTimeIL(new Date(ev.start.dateTime));
    // דילוג על פגישות שכבר התחילו/עברו (חלון חסד 5 דק') — כדי לא לשלוח תזכורת מיותרת אם ה-cron איחר
    if (startMs < nowMs - 5 * 60 * 1000) { console.log(`⏭️  "${ev.summary}" (${time}) — הפגישה כבר עברה. דילוג.`); skipped++; continue; }
    const c = clientEmailOf(ev);
    if (!c) { console.log(`⏭️  "${ev.summary}" (${time}) — לא נמצא מייל של איש קשר. דילוג.`); skipped++; continue; }
    const rec = await lookupPhone(db, c.email);
    if (!rec) { console.log(`⏭️  "${ev.summary}" (${time}) — ${c.email}: לא נמצא טלפון במערכת. דילוג.`); skipped++; continue; }
    const name = firstName(rec.full_name || c.name) || "לקוח יקר";
    // דדופ — כבר נשלחה תזכורת לפגישה הזו? (מונע כפילות בין ריצות בוקר מרובות)
    const already = (await db.query(`select 1 from meeting_reminder_log where event_id=$1`, [ev.id])).rows.length > 0;
    if (already) { console.log(`⏭️  ${name} (${time}) — כבר נשלחה תזכורת היום. דילוג.`); skipped++; continue; }
    const msg = buildMessage(name, time);
    if (MODE === "send") {
      try {
        const id = await sendWhatsapp(rec.phone, msg);
        await db.query(`insert into meeting_reminder_log(event_id,day,phone) values($1,$2,$3) on conflict (event_id,day) do nothing`, [ev.id, todayIL, rec.phone]);
        console.log(`✅ נשלח ל${name} (${rec.phone}) — פגישה ${time} — id ${id}`); sent++;
      } catch (e) { console.log(`❌ ${name} (${rec.phone}): ${e.message}`); skipped++; }
    } else if (MODE === "backfill") {
      // רישום ללוג בלבד ללא שליחה — לסימון תזכורות שכבר יצאו ידנית, כדי למנוע שליחה כפולה
      await db.query(`insert into meeting_reminder_log(event_id,day,phone) values($1,$2,$3) on conflict (event_id,day) do nothing`, [ev.id, todayIL, rec.phone]);
      console.log(`🗂️  נרשם ללוג (ללא שליחה) ל${name} (${rec.phone}) — פגישה ${time}`); sent++;
    } else {
      console.log(`📤 [DRY] היה נשלח ל${name} <${c.email}> → ${rec.phone} | פגישה ${time}`);
      sent++;
    }
  }
  await db.end();
  console.log(`\nסיכום: ${MODE === "send" ? "נשלחו" : "לשליחה"} ${sent} | דילוגים ${skipped}`);
})().catch((e) => { console.error("שגיאה:", e.message); process.exit(1); });
