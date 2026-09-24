import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { getSettings, saveSettings, rotateApiKey, saveCalendarConfig, saveRepCalendar } from "@/lib/settingsRepo";
import { REPS } from "@/lib/reps";
import { listCalendars, defaultImpersonateUser } from "@/lib/googleCalendar";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const settings = await getSettings();
  return NextResponse.json({ settings });
}

export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  if (body.action === "rotate-key") {
    const settings = await rotateApiKey();
    return NextResponse.json({ ok: true, settings });
  }
  if (body.action === "save") {
    const settings = await saveSettings({ customFields: body.customFields, fieldMap: body.fieldMap });
    return NextResponse.json({ ok: true, settings });
  }
  // יומן גוגל — רשימת יומנים של משתמש (דרך domain-wide delegation)
  if (body.action === "calendar-list") {
    const user = String(body.impersonateUser || "").trim() || defaultImpersonateUser();
    if (!user) return NextResponse.json({ error: "לא הוגדר משתמש יומן ברירת מחדל" }, { status: 400 });
    try {
      const calendars = await listCalendars(user);
      return NextResponse.json({ ok: true, user, calendars });
    } catch (e) {
      return NextResponse.json({ error: `לא ניתן לטעון יומנים עבור ${user} — ${(e as Error).message}` }, { status: 502 });
    }
  }
  // שמירת היומן הנבחר
  if (body.action === "calendar-save") {
    const impersonateUser = String(body.impersonateUser || "").trim() || defaultImpersonateUser();
    const calendarId = String(body.calendarId || "").trim();
    const calendarName = String(body.calendarName || "").trim();
    if (!impersonateUser || !calendarId) return NextResponse.json({ error: "חסר משתמש או יומן" }, { status: 400 });
    const settings = await saveCalendarConfig({ connected: true, impersonateUser, calendarId, calendarName });
    return NextResponse.json({ ok: true, settings });
  }
  if (body.action === "calendar-disconnect") {
    const settings = await saveCalendarConfig({ connected: false, impersonateUser: "", calendarId: "", calendarName: "" });
    return NextResponse.json({ ok: true, settings });
  }

  // === יומן אישי של נציג (לפולואפים) ===
  // רשימת יומנים של נציג (מתחזים למייל שלו)
  if (body.action === "rep-calendar-list") {
    const email = String(body.email || "").trim().toLowerCase();
    if (!REPS.some((r) => r.email === email)) return NextResponse.json({ error: "נציג לא מוכר" }, { status: 400 });
    try {
      const calendars = await listCalendars(email);
      return NextResponse.json({ ok: true, email, calendars });
    } catch (e) {
      return NextResponse.json({ error: `לא ניתן לטעון יומנים עבור ${email} — ${(e as Error).message}` }, { status: 502 });
    }
  }
  // שמירת יומן אישי לנציג
  if (body.action === "rep-calendar-save") {
    const email = String(body.email || "").trim().toLowerCase();
    if (!REPS.some((r) => r.email === email)) return NextResponse.json({ error: "נציג לא מוכר" }, { status: 400 });
    const calendarId = String(body.calendarId || "").trim();
    if (!calendarId) return NextResponse.json({ error: "לא נבחר יומן" }, { status: 400 });
    const settings = await saveRepCalendar(email, { impersonateUser: email, calendarId, calendarName: String(body.calendarName || "").trim() });
    return NextResponse.json({ ok: true, settings });
  }
  if (body.action === "rep-calendar-remove") {
    const email = String(body.email || "").trim().toLowerCase();
    const settings = await saveRepCalendar(email, null);
    return NextResponse.json({ ok: true, settings });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
