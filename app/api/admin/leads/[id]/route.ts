import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { getLead, updateLeadFields, addLeadActivity, deleteLeadActivity, convertLeadToClient, deleteLead, enterCompass, setCompassStatus, leaveCompass, assignLead, setPortalAccess } from "@/lib/leadsRepo";
import { buildLeadWhatsappMessage, normalizeEmail, COMPASS_STATUSES, type CompassStatus } from "@/lib/leads";
import { REPS } from "@/lib/reps";
import { sendPowerCoupleWhatsapp } from "@/lib/notify";
import { getSettings } from "@/lib/settingsRepo";
import { createEvent, checkSlot } from "@/lib/googleCalendar";
import { sendMail } from "@/lib/mailer";

export const runtime = "nodejs";

/** מנהל פגישות המצפן — מקבל הזמנה לכל פגישת מצפן שנקבעת. */
const COMPASS_HOST_EMAIL = "regev@powercouple.co.il";

// בלוק מיקום קבוע לפגישות במשרד (מצפן/פגישות פרונטליות) — מופיע בתיאור ההזמנה ביומן.
const OFFICE_MEETING_BLOCK = `==========

📍 מיקום הפגישה:

שדרות הראשונים 23, ראשון לציון

בניין מילניה - בניין בי - קומה 4

בוויז :

 https://waze.com/ul/hsv8tyz50s



😊 ניפגש 😊



📞 לשינויים / עזרה בהגעה ניתן ליצור קשר בטלפון:

053-274-1266`;

const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-07-07" → "July 7, 2026" */
function fmtDateEn(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return EN_MONTHS[m - 1] ? `${EN_MONTHS[m - 1]} ${day}, ${y}` : d;
}
/** "17:30" → "5:30 PM" */
function fmtTime12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${ap}`;
}

/** תיאור הפגישה ליומן: בלוק מיקום (לפגישות משרד) + פרטי הפגישה והליד הדינמיים. */
function buildMeetingDescription(opts: {
  userDesc: string; date: string; time: string; includeOffice: boolean;
  name: string; phone: string; email: string;
}): string {
  const parts: string[] = [];
  if (opts.userDesc) parts.push(opts.userDesc);
  if (opts.includeOffice) parts.push(OFFICE_MEETING_BLOCK);
  parts.push("פרטי הפגישה :");
  parts.push(` ${fmtDateEn(opts.date)}`);
  parts.push(` ${fmtTime12(opts.time)}`);
  parts.push("");
  if (opts.name) parts.push(` ${opts.name} `);
  if (opts.phone) parts.push(opts.phone);
  if (opts.email) parts.push(opts.email);
  return parts.join("\n");
}

function esc(s: string): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/** התראת מייל לרגב על כל קביעה/שינוי בפגישת מצפן. fire-and-forget — לא חוסם. */
async function notifyCompassHost(subject: string, rows: Array<[string, string]>, extraHtml = ""): Promise<void> {
  const body = rows.filter(([, v]) => v).map(([k, v]) => `<p dir="rtl" style="margin:4px 0"><b>${esc(k)}:</b> ${esc(v)}</p>`).join("");
  const html = `<div dir="rtl" style="text-align:right;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">
    <h2 style="margin:0 0 12px">🧭 פגישת מצפן</h2>${body}${extraHtml}</div>`;
  try { await sendMail({ to: [COMPASS_HOST_EMAIL], subject, html }); } catch { /* לא חוסם */ }
}

// GET — פרטי ליד
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;
  const lead = await getLead(id);
  if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ lead });
}

// POST — פעולות על ליד
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  switch (body.action) {
    case "update": {
      const lead = await updateLeadFields(id, {
        firstName: body.firstName, lastName: body.lastName, fullName: body.fullName,
        email: body.email, phone: body.phone, idNumber: body.idNumber,
        stage: body.stage, answers: body.answers, quali: body.quali, custom: body.custom,
      });
      if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, lead });
    }
    case "set-stage": {
      const lead = await getLead(id);
      if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
      await updateLeadFields(id, { stage: body.stage });
      await addLeadActivity(id, { type: "stage", source: "manual", by: admin.email, text: `שלב עודכן ל: ${body.stage}` });
      // סגירת ליד (WON) מכניסה אותו אוטומטית לצינור פגישות מצפן
      if (body.stage === "won") await enterCompass(id, admin.name || admin.email);
      return NextResponse.json({ ok: true, lead: await getLead(id) });
    }
    case "set-compass-status": {
      const status = String(body.status || "") as CompassStatus;
      if (!COMPASS_STATUSES.some((s) => s.key === status)) return NextResponse.json({ error: "סטטוס לא תקין" }, { status: 400 });
      const lead = await setCompassStatus(id, status, admin.name || admin.email);
      if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
      const statusLabel = COMPASS_STATUSES.find((s) => s.key === status)?.label || status;
      await notifyCompassHost(
        `עדכון פגישת מצפן — ${lead.fullName || "ליד"} — ${statusLabel}`,
        [["לקוח", lead.fullName || ""], ["טלפון", lead.phone || ""], ["מייל", lead.email || ""], ["סטטוס חדש", statusLabel], ["עודכן ע\"י", admin.name || admin.email]],
      );
      return NextResponse.json({ ok: true, lead });
    }
    case "portal-access": {
      const on = body.on === undefined ? true : !!body.on;
      if (on) {
        const cur = await getLead(id);
        if (!cur) return NextResponse.json({ error: "not found" }, { status: 404 });
        if (!cur.email || !cur.email.trim()) {
          return NextResponse.json({ error: "לליד אין כתובת מייל — לא ניתן לפתוח פורטל. הכניסה לפורטל היא לפי מייל (חשבון גוגל). הוסיפו מייל לליד תחילה." }, { status: 400 });
        }
      }
      const lead = await setPortalAccess(id, on, admin.name || admin.email);
      if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, lead });
    }
    case "assign": {
      const email = String(body.assignedTo || "").trim().toLowerCase();
      if (email && !REPS.some((r) => r.email === email)) return NextResponse.json({ error: "נציג לא מוכר" }, { status: 400 });
      const lead = await assignLead(id, email || null, admin.name || admin.email);
      if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, lead });
    }
    case "leave-compass": {
      if (String(body.confirm) !== "DELETE") return NextResponse.json({ error: "נדרש אישור DELETE" }, { status: 400 });
      const ok = await leaveCompass(id, admin.name || admin.email);
      return NextResponse.json({ ok });
    }
    case "enter-compass": {
      const lead = await enterCompass(id, admin.name || admin.email);
      if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, lead });
    }
    case "add-note": {
      const text = String(body.text || "").trim();
      if (!text) return NextResponse.json({ error: "ההערה ריקה" }, { status: 400 });
      const lead = await addLeadActivity(id, { type: "note", source: "manual", by: admin.email, text: text.slice(0, 5000) });
      if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, lead });
    }
    case "delete-note": {
      const lead = await deleteLeadActivity(id, String(body.activityId || ""));
      if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, lead });
    }
    case "convert": {
      const r = await convertLeadToClient(id, { email: admin.email, name: admin.name });
      if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, lead: r.lead, clientUid: r.clientUid });
    }
    case "delete-lead": {
      if (String(body.confirm) !== "DELETE") return NextResponse.json({ error: "נדרש אישור DELETE" }, { status: 400 });
      const ok = await deleteLead(id);
      return NextResponse.json({ ok });
    }
    case "send-whatsapp": {
      const lead = await getLead(id);
      if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
      const text = buildLeadWhatsappMessage(lead);
      try {
        const { idMessage } = await sendPowerCoupleWhatsapp({ to: body.to, text });
        return NextResponse.json({ ok: true, idMessage });
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 502 });
      }
    }
    case "check-slot": {
      // בדיקת חפיפה לפני קביעת פגישה — מחזיר פגישה קיימת (אם יש) + זמינות 20 דק' לפני/אחרי.
      const settings = await getSettings();
      const date = String(body.date || "").trim();
      const time = String(body.time || "").trim();
      if (!date || !time) return NextResponse.json({ error: "חסר תאריך או שעה" }, { status: 400 });
      const durationMin = Number(body.durationMin) > 0 ? Number(body.durationMin) : 30;
      const useRep = !!body.useRepCalendar;
      let calImpersonate: string, calId: string;
      if (useRep) {
        const rc = settings.repCalendars[admin.email.toLowerCase()];
        if (!rc) return NextResponse.json({ error: "לא חיברת יומן אישי" }, { status: 400 });
        calImpersonate = rc.impersonateUser; calId = rc.calendarId;
      } else {
        const cal = settings.calendar;
        if (!cal.connected || !cal.calendarId) return NextResponse.json({ error: "יומן גוגל לא מחובר" }, { status: 400 });
        calImpersonate = cal.impersonateUser; calId = cal.calendarId;
      }
      try {
        const res = await checkSlot(calImpersonate, calId, `${date}T${time}`, durationMin, 20);
        return NextResponse.json({ ok: true, ...res });
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 502 });
      }
    }
    case "schedule-meeting": {
      const lead = await getLead(id);
      if (!lead) return NextResponse.json({ error: "not found" }, { status: 404 });
      const settings = await getSettings();
      const date = String(body.date || "").trim();
      const time = String(body.time || "").trim();
      if (!date || !time) return NextResponse.json({ error: "חסר תאריך או שעה" }, { status: 400 });
      const durationMin = Number(body.durationMin) > 0 ? Number(body.durationMin) : 30;
      const title = String(body.title || "").trim() || `פגישה — ${lead.fullName || "ליד"}`;
      const location = String(body.location || "").trim();
      const meetingType = String(body.meetingType || "").trim();
      // פגישת מצפן — מזוהה לפי סוג הפגישה או הכותרת. פולואפ — יומן אישי של הנציג.
      const isCompass = /מצפן/.test(meetingType) || /מצפן/.test(title);
      const useRep = !!body.useRepCalendar && !isCompass;

      // יעד היומן: פולואפ → יומן הנציג המחובר; אחרת → יומן המצפן (רגב)
      let calImpersonate: string, calId: string;
      if (useRep) {
        const rc = settings.repCalendars[admin.email.toLowerCase()];
        if (!rc) return NextResponse.json({ error: "לא חיברת יומן אישי — כנס להגדרות → יומני נציגים וחבר את היומן שלך" }, { status: 400 });
        calImpersonate = rc.impersonateUser; calId = rc.calendarId;
      } else {
        const cal = settings.calendar;
        if (!cal.connected || !cal.calendarId) return NextResponse.json({ error: "יומן גוגל לא מחובר — חברו אותו בהגדרות" }, { status: 400 });
        calImpersonate = cal.impersonateUser; calId = cal.calendarId;
      }
      // תיאור מלא: בלוק מיקום המשרד (לפגישות מצפן/פרונטליות ביומן המשרד) + פרטי הפגישה והליד.
      // בפולואפ ביומן אישי (זום/טלפון) — בלי בלוק המשרד.
      const description = buildMeetingDescription({
        userDesc: String(body.description || "").trim(),
        date, time, includeOffice: !useRep,
        name: lead.fullName || "", phone: lead.phone || "", email: lead.email || "",
      });
      try {
        const ev = await createEvent(calImpersonate, {
          calendarId: calId,
          summary: title,
          description,
          location: location || undefined,
          startLocal: `${date}T${time}`,
          durationMin,
          attendeeEmail: normalizeEmail(lead.email) || undefined,
          // בפגישת מצפן — רגב מקבל מייל הזמנה בדיוק כמו הליד
          attendeeEmails: isCompass ? [COMPASS_HOST_EMAIL] : undefined,
          // פגישת מצפן ביומן — כתום מלא (Tangerine)
          colorId: isCompass ? "6" : undefined,
        });
        // אם זו כפילות (אותו אירוע כבר קיים) — לא מתעדים ולא משנים סטטוס פעמיים
        if (ev.duplicate) {
          return NextResponse.json({ ok: true, htmlLink: ev.htmlLink, duplicate: true, lead: await getLead(id) });
        }
        await addLeadActivity(id, {
          type: "system", source: "manual", by: admin.email,
          text: `📅 פגישה נקבעה: ${title} — ${date} ${time} (${durationMin} דק')${location ? `\n📍 ${location}` : ""}${isCompass ? `\n✉ הזמנה נשלחה ל${COMPASS_HOST_EMAIL}` : ""}\n${ev.htmlLink}`,
        });
        // פגישת מצפן → נכנס לצינור פגישות מצפן וסטטוס "תואמה פגישה" + מייל לרגב
        if (isCompass) {
          await enterCompass(id, admin.name || admin.email);
          await setCompassStatus(id, "scheduled", admin.name || admin.email);
          await notifyCompassHost(
            `פגישת מצפן נקבעה — ${lead.fullName || "ליד"} — ${date} ${time}`,
            [["לקוח", lead.fullName || ""], ["טלפון", lead.phone || ""], ["מייל", lead.email || ""], ["מועד", `${date} ${time} (${durationMin} דק')`], ["מיקום", location || ""], ["נקבע ע\"י", admin.name || admin.email]],
            `<p dir="rtl" style="margin-top:10px"><a href="${esc(ev.htmlLink)}">פתח את האירוע ביומן ←</a></p>`,
          );
        }
        return NextResponse.json({ ok: true, htmlLink: ev.htmlLink, lead: await getLead(id) });
      } catch (e) {
        return NextResponse.json({ error: `יצירת הפגישה נכשלה — ${(e as Error).message}` }, { status: 502 });
      }
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
