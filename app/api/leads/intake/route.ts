import { NextResponse } from "next/server";
import { getSettings, validateApiKey } from "@/lib/settingsRepo";
import { buildIntakeFromFlat, upsertLead } from "@/lib/leadsRepo";
import { supa } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

const MAX_PER_MIN = 12; // מקסימום לידים בדקה מאותו IP — נגד הזרקה בכמות

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** מקור הבקשה: דפדפן (יש Origin/Referer) מול שרת-לשרת (PHP/Make — אין). */
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

/** הגבלת קצב פר-IP (חלון של דקה) דרך Firestore. */
async function rateOk(ip: string): Promise<boolean> {
  if (!ip) return true;
  const minute = Math.floor(Date.now() / 60000);
  const bucket = `${ip.replace(/[^\dA-Fa-f:.]/g, "")}_${minute}`;
  try {
    const { data } = await supa().from("intake_rate").select("c").eq("bucket", bucket).maybeSingle();
    const c = (((data as { c?: number } | null)?.c) || 0) + 1;
    await supa().from("intake_rate").upsert({ bucket, c, at: new Date().toISOString() });
    return c <= MAX_PER_MIN;
  } catch { return true; } // אם המונה נכשל — לא חוסמים לקוח לגיטימי
}

/**
 * קורא את גוף הבקשה לפי סוג התוכן — תומך ב-JSON, ב-x-www-form-urlencoded
 * (כמו מודול ה-HTTP של Make/Optione) וב-multipart. כך מייק יכול לשכפל את
 * המודול הקיים ולשנות רק את ה-URL, בלי לשנות את סוג הגוף.
 */
async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  try {
    if (ct.includes("application/json")) return await req.json();
    if (ct.includes("application/x-www-form-urlencoded")) {
      return Object.fromEntries(new URLSearchParams(await req.text()));
    }
    if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();
      const o: Record<string, unknown> = {};
      for (const [k, v] of fd.entries()) o[k] = typeof v === "string" ? v : "";
      return o;
    }
    // ללא content-type ברור — ננסה JSON ואז urlencoded
    const text = await req.text();
    try { return JSON.parse(text); } catch { return Object.fromEntries(new URLSearchParams(text)); }
  } catch { return {}; }
}

// POST — קליטת ליד ממקור חיצוני (API). מפתח דרך x-api-key / body.apiKey / ?key=
export async function POST(req: Request) {
  const url = new URL(req.url);
  const src = browserSource(req);
  const isBrowser = !!src; // בקשת דפדפן (VSL-V1) מול שרת-לשרת (PHP snippet/Make)

  // 1) בקשת דפדפן חייבת להגיע מ-powercouple.co.il — חוסם הזרקה מאתר זר
  if (isBrowser && !originAllowed(src)) {
    return NextResponse.json({ error: "forbidden origin" }, { status: 403, headers: CORS });
  }

  const body = await parseBody(req);
  const key = req.headers.get("x-api-key") || (body.apiKey as string) || url.searchParams.get("key") || "";

  // דפדפן מהאתר (VSL-V1 וכו') מותר גם בלי מפתח — מוגן ע"י בדיקת Origin + הגבלת קצב.
  // כך מפתח ה-API לא נחשף בקוד הציבורי של הדף. שרת-לשרת (PHP/Make) עדיין חייב מפתח.
  const keyValid = await validateApiKey(key);
  if (!keyValid && !isBrowser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: CORS });
  }

  // 2) הגבלת קצב פר-IP — רק על בקשות דפדפן (מסלול השרת PHP/Make לא מוגבל, כדי לא לאבד לידים בקמפיין)
  if (isBrowser) {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    if (!(await rateOk(ip))) {
      return NextResponse.json({ error: "rate limited" }, { status: 429, headers: CORS });
    }
  }

  // תומך גם ב-payload שטוח וגם ב-{ fields: {...} }
  const flat: Record<string, unknown> = { ...(body.fields as Record<string, unknown> || {}), ...body };
  delete flat.apiKey;
  delete flat.fields;

  // הערה: החרגת "מגנט לידים VSL2" הוסרה (09/2026). לידים לא-בשלים (VSL2/וובינר/חוברת עבודה)
  // כן נקלטים עכשיו — אבל לקטגוריית "רשימת תפוצה" (isDistributionLead ב-upsertLead),
  // כך שאינם מזהמים את פייפליין המכירות.

  const hasContact = (flat.email && String(flat.email).trim()) || (flat.phone && String(flat.phone).trim());
  if (!hasContact) {
    return NextResponse.json({ error: "צריך לפחות מייל או טלפון" }, { status: 400, headers: CORS });
  }

  const settings = await getSettings();
  const intake = buildIntakeFromFlat(flat, {
    fieldMap: settings.fieldMap,
    customFieldIds: settings.customFields.map((f) => f.id),
  });

  const { lead, merged } = await upsertLead(intake, keyValid ? { source: "api", by: "API" } : { source: "site", by: "אתר (טופס)" });
  return NextResponse.json({ ok: true, leadId: lead.id, merged }, { headers: CORS });
}
