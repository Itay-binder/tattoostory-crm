import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/settingsRepo";
import { upsertLead, updateLeadFields, addLeadActivity } from "@/lib/leadsRepo";
import { supa } from "@/lib/supabaseAdmin";
import type { LeadStage } from "@/lib/leads";

export const runtime = "nodejs";

// תיאום פגישה עצמי מהאתר (Cal.com בדף vsltnx): מתעד את מועד הפגישה בכרטיס הליד
// ומעדכן את השלב ל"תיאם פגישה". יוצר ליד אם עוד לא קיים (דדופ לפי מייל/טלפון).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

const MAX_PER_MIN = 12;

// שלבים מוקדמים שמותר לקדם מהם ל"תיאם פגישה" — לא מורידים ליד שכבר התקדם במשפך.
const EARLY_STAGES = new Set(["new", "contacted", "no_answer_1", "no_answer_2", "no_answer_3", "followup", "watching", "relevant", "dormant"]);

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function browserSource(req: Request): string {
  return req.headers.get("origin") || req.headers.get("referer") || "";
}
function originAllowed(src: string): boolean {
  try {
    const host = new URL(src).hostname.toLowerCase();
    return host === "powercouple.co.il" || host.endsWith(".powercouple.co.il") || host === "vercel.app" || host.endsWith(".vercel.app");
  } catch {
    return /(^|\/\/|\.)(powercouple\.co\.il|vercel\.app)([/:]|$)/i.test(src);
  }
}

async function rateOk(ip: string): Promise<boolean> {
  if (!ip) return true;
  const minute = Math.floor(Date.now() / 60000);
  const bucket = `${ip.replace(/[^\dA-Fa-f:.]/g, "")}_${minute}`;
  try {
    const { data } = await supa().from("intake_rate").select("c").eq("bucket", bucket).maybeSingle();
    const c = (((data as { c?: number } | null)?.c) || 0) + 1;
    await supa().from("intake_rate").upsert({ bucket, c, at: new Date().toISOString() });
    return c <= MAX_PER_MIN;
  } catch { return true; }
}

/** מועד הפגישה בפורמט קריא, שעון ישראל: 24/07/2026 בשעה 16:00 */
function formatMeeting(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const date = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  const time = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${date} בשעה ${time}`;
}

export async function POST(req: Request) {
  const src = browserSource(req);
  const isBrowser = !!src;

  if (isBrowser && !originAllowed(src)) {
    return NextResponse.json({ error: "forbidden origin" }, { status: 403, headers: CORS });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const key = req.headers.get("x-api-key") || (body.apiKey as string) || "";

  // שרת-לשרת (Make וכו') חייב מפתח; דפדפן מהאתר מוגן ע"י Origin + קצב.
  if (!isBrowser && !(await validateApiKey(key))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: CORS });
  }
  if (isBrowser) {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    if (!(await rateOk(ip))) {
      return NextResponse.json({ error: "rate limited" }, { status: 429, headers: CORS });
    }
  }

  const s = (v: unknown) => (v == null ? "" : String(v).trim().slice(0, 300));
  const fullName = s(body.fullName) || s(body.fname) || s(body.name);
  const email = s(body.email);
  const phone = s(body.phone);
  const meetingStart = s(body.meetingStart) || s(body.start);
  const meetingTitle = s(body.meetingTitle) || s(body.title);

  if (!email && !phone) {
    return NextResponse.json({ error: "צריך לפחות מייל או טלפון" }, { status: 400, headers: CORS });
  }

  // UTM אם הגיע מהדף (sessionStorage) — נשמר בכרטיס הליד
  const custom: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
    const v = s((body as Record<string, unknown>)[k]);
    if (v) custom[k] = v;
  }

  // יוצר/מאתר את הליד (דדופ לפי מייל/טלפון מנורמל)
  const { lead } = await upsertLead(
    { fullName, email, phone, custom },
    { source: "site", by: "יומן תיאום באתר (Cal.com)" }
  );

  const when = meetingStart ? formatMeeting(meetingStart) : "";
  const title = meetingTitle || "פגישת תכנית נדל\"ן";

  // תיעוד ביומן הפעילות של הליד — מתי הפגישה שתואמה
  await addLeadActivity(lead.id, {
    type: "system",
    source: "site",
    by: "יומן תיאום באתר (Cal.com)",
    text: when ? `הלקוח תיאם פגישה — ${title} — לתאריך ${when}` : `הלקוח תיאם פגישה — ${title}`,
  });

  // עדכון שלב ל"תיאם פגישה" — רק אם הליד עדיין בשלב מוקדם (לא מורידים ליד מתקדם)
  let stageChanged = false;
  if (EARLY_STAGES.has(lead.stage)) {
    await updateLeadFields(lead.id, { stage: "meeting_scheduled" as LeadStage });
    await addLeadActivity(lead.id, {
      type: "stage",
      source: "site",
      by: "יומן תיאום באתר (Cal.com)",
      text: "שלב עודכן: תיאם פגישה",
    });
    stageChanged = true;
  }

  return NextResponse.json({ ok: true, leadId: lead.id, stageChanged }, { headers: CORS });
}
