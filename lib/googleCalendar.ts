import { GoogleAuth } from "google-auth-library";

// יומן גוגל דרך אותו service account של הדרייב (domain-wide delegation).
// impersonate = משתמש ה-Workspace שבשם היומן שלו הפעולות מתבצעות.
const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const CAL = "https://www.googleapis.com/calendar/v3";

export function defaultImpersonateUser(): string {
  return (process.env.GOOGLE_IMPERSONATE_USER || "").trim();
}

function clientFor(user: string) {
  const sa = JSON.parse(Buffer.from((process.env.GOOGLE_SA_B64 || "").trim(), "base64").toString("utf8"));
  const subject = (user || defaultImpersonateUser()).trim();
  if (!subject) throw new Error("לא הוגדר משתמש יומן (GOOGLE_IMPERSONATE_USER)");
  const auth = new GoogleAuth({ credentials: sa, scopes: SCOPES, clientOptions: { subject } });
  return auth.getClient();
}

export interface CalendarInfo { id: string; summary: string; primary?: boolean; accessRole?: string }

export async function listCalendars(user: string): Promise<CalendarInfo[]> {
  const client = await clientFor(user);
  const r = await client.request<{ items: CalendarInfo[] }>({ url: `${CAL}/users/me/calendarList?minAccessRole=writer&fields=items(id,summary,primary,accessRole)` });
  return (r.data.items || []).map((c) => ({ id: c.id, summary: c.summary, primary: c.primary, accessRole: c.accessRole }));
}

export interface CreateEventInput {
  calendarId: string;
  summary: string;
  description?: string;
  /** שעון קיר מקומי "YYYY-MM-DDTHH:MM" (ללא אזור זמן) — נפתר לפי timeZone */
  startLocal: string;
  durationMin: number;
  attendeeEmail?: string;
  /** מוזמנים נוספים (למשל הנציג שמנהל את הפגישה) — כולם מקבלים מייל הזמנה */
  attendeeEmails?: string[];
  location?: string;
  timeZone?: string;
  /** צבע האירוע ביומן גוגל (colorId). 6 = כתום מלא (Tangerine). */
  colorId?: string;
  /** מונע יצירת אירוע זהה (אותה כותרת + אותו זמן התחלה) — ברירת מחדל: פועל. */
  dedupe?: boolean;
}

/** מזיז יום בפורמט YYYY-MM-DD (לחלון חיפוש הכפילות). */
function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** מחפש אירוע זהה קיים (אותה כותרת + אותו זמן קיר) כדי למנוע כפילות. */
async function findDuplicate(
  client: Awaited<ReturnType<typeof clientFor>>, calId: string, summary: string, startLocal: string
): Promise<{ id: string; htmlLink: string } | null> {
  const day = startLocal.slice(0, 10);
  const url = `${CAL}/calendars/${encodeURIComponent(calId)}/events?singleEvents=true&orderBy=startTime` +
    `&timeMin=${shiftDay(day, -1)}T00:00:00Z&timeMax=${shiftDay(day, 1)}T23:59:59Z` +
    `&q=${encodeURIComponent(summary.slice(0, 40))}&maxResults=50`;
  try {
    const r = await client.request<{ items: { id: string; htmlLink: string; summary?: string; status?: string; start?: { dateTime?: string } }[] }>({ url });
    const want = startLocal.slice(0, 16);
    const hit = (r.data.items || []).find(
      (e) => e.status !== "cancelled" && (e.summary || "") === summary && (e.start?.dateTime || "").slice(0, 16) === want
    );
    return hit ? { id: hit.id, htmlLink: hit.htmlLink } : null;
  } catch { return null; } // אם החיפוש נכשל — לא חוסמים יצירה
}

/** מוסיף דקות לשעון-קיר מקומי בלי המרת אזור זמן. */
function addMinutesLocal(local: string, min: number): string {
  const d = new Date(local.length === 16 ? `${local}:00Z` : `${local}Z`);
  return new Date(d.getTime() + min * 60000).toISOString().slice(0, 19);
}

/**
 * פותר את יעד היצירה כך שהמארגן = בעל היומן, כדי שגוגל ישלח מיילי הזמנה.
 * יומן אישי (מייל משתמש) → מתחזים לאותו משתמש ויוצרים ב-primary שלו.
 * יומן קבוצתי (…group.calendar.google.com) → מתחזים למשתמש עם הרשאת כתיבה.
 */
function resolveTarget(impersonateUser: string, calendarId: string): { user: string; calId: string } {
  const isPersonal = calendarId.includes("@") && !calendarId.includes(".calendar.google.com");
  if (isPersonal) return { user: calendarId, calId: "primary" };
  return { user: impersonateUser, calId: calendarId };
}

/** היסט אזור הזמן של ישראל לתאריך נתון (מטפל בשעון קיץ), בפורמט "+03:00". */
function israelOffset(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", timeZoneName: "shortOffset" }).formatToParts(d).find((x) => x.type === "timeZoneName")?.value || "GMT+3";
  const m = p.match(/GMT([+-])(\d{1,2})/);
  return m ? `${m[1]}${m[2].padStart(2, "0")}:00` : "+03:00";
}
/** מזיז שעון-קיר "HH:MM" ב-delta דקות (בתוך אותו יום). */
function shiftWall(time: string, delta: number): string {
  const [h, m] = time.split(":").map(Number);
  const t = (((h * 60 + m + delta) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
const hm = (t: number) => new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(t));

export interface SlotCheck {
  conflict: { summary: string; from: string; to: string } | null;
  before: { time: string; free: boolean };
  after: { time: string; free: boolean };
}
/** בודק אם המשבצת המבוקשת פנויה ביומן, ואם יש חפיפה — מחזיר את הפגישה הקיימת + זמינות 20 דק' לפני/אחרי. */
export async function checkSlot(user: string, calendarId: string, startLocal: string, durationMin: number, gapMin = 20): Promise<SlotCheck> {
  const target = resolveTarget(user, calendarId);
  const client = await clientFor(target.user);
  const day = startLocal.slice(0, 10);
  const time = startLocal.slice(11, 16);
  const off = israelOffset(day);
  const slotStart = new Date(`${startLocal}:00${off}`).getTime();
  const dur = durationMin * 60000, gap = gapMin * 60000;
  const url = `${CAL}/calendars/${encodeURIComponent(target.calId)}/events?singleEvents=true&orderBy=startTime` +
    `&timeMin=${shiftDay(day, -1)}T00:00:00Z&timeMax=${shiftDay(day, 2)}T00:00:00Z&maxResults=250`;
  let events: { summary: string; s: number; en: number }[] = [];
  try {
    const r = await client.request<{ items: { summary?: string; status?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }[] }>({ url });
    events = (r.data.items || [])
      .filter((e) => e.status !== "cancelled" && e.start?.dateTime && e.end?.dateTime)
      .map((e) => ({ summary: e.summary || "פגישה", s: new Date(e.start!.dateTime!).getTime(), en: new Date(e.end!.dateTime!).getTime() }));
  } catch { /* אם הקריאה נכשלת — לא חוסמים, מחזירים ללא חפיפה */ }
  const overlaps = (start: number) => events.filter((e) => e.s < start + dur && e.en > start);
  const conf = overlaps(slotStart);
  return {
    conflict: conf.length ? { summary: conf[0].summary, from: hm(conf[0].s), to: hm(conf[0].en) } : null,
    before: { time: shiftWall(time, -gapMin), free: overlaps(slotStart - gap).length === 0 },
    after: { time: shiftWall(time, gapMin), free: overlaps(slotStart + gap).length === 0 },
  };
}

export async function createEvent(user: string, input: CreateEventInput): Promise<{ id: string; htmlLink: string; duplicate?: boolean }> {
  const target = resolveTarget(user, input.calendarId);
  const client = await clientFor(target.user);
  const tz = input.timeZone || "Asia/Jerusalem";
  const startLocal = input.startLocal.length === 16 ? `${input.startLocal}:00` : input.startLocal;
  const endLocal = addMinutesLocal(input.startLocal, input.durationMin);

  // מניעת כפילות: אם כבר קיים אירוע זהה (כותרת + זמן) — מחזירים אותו ולא יוצרים שוב
  if (input.dedupe !== false) {
    const dup = await findDuplicate(client, target.calId, input.summary, startLocal);
    if (dup) return { ...dup, duplicate: true };
  }

  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description || "",
    start: { dateTime: startLocal, timeZone: tz },
    end: { dateTime: endLocal, timeZone: tz },
  };
  if (input.location) body.location = input.location;
  if (input.colorId) body.colorId = input.colorId;
  const guests = [...(input.attendeeEmail ? [input.attendeeEmail] : []), ...(input.attendeeEmails || [])]
    .map((e) => e.trim().toLowerCase()).filter(Boolean);
  const unique = [...new Set(guests)];
  if (unique.length) body.attendees = unique.map((email) => ({ email }));
  // sendUpdates=all: שליחת מיילי הזמנה למוזמנים
  const r = await client.request<{ id: string; htmlLink: string }>({
    url: `${CAL}/calendars/${encodeURIComponent(target.calId)}/events?sendUpdates=all&conferenceDataVersion=0`,
    method: "POST",
    data: body,
  });
  return { id: r.data.id, htmlLink: r.data.htmlLink };
}
