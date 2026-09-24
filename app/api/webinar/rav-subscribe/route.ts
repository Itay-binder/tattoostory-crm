import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

// הוספת נרשם לרשימת רב מסר (Responder) — נקרא מדף ההרשמה לוובינר (client-side, origin-gated).
// ברירת מחדל: רשימה 1507875 = "נכנסו לשידור וובינר אבר גרין 28/07/26".
// OAuth 1.0a HMAC-SHA1, זהה ל-SDK הרשמי של Responder.

const BASE_URL = "https://api.responder.co.il/v1.0";
const DEFAULT_LIST = process.env.RAVMESSER_LIST_ID || "1515329"; // "נכנסו לשידור 23/09" (דף /webinar-register/ — עדכן לכל סבב)
const CLIENT_KEY = process.env.RAVMESSER_CLIENT_KEY || "";
const CLIENT_SECRET = process.env.RAVMESSER_CLIENT_SECRET || "";
const USER_KEY = process.env.RAVMESSER_USER_KEY || "";
const USER_SECRET = process.env.RAVMESSER_USER_SECRET || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function enc(s: string): string {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
function md5(s: string): string {
  return crypto.createHash("md5").update(s).digest("hex");
}
function oauthSign(method: string, url: string, allParams: Record<string, string>): string {
  const sorted = Object.keys(allParams).sort().map((k) => `${enc(k)}=${enc(allParams[k])}`).join("&");
  const baseString = [method.toUpperCase(), enc(url), enc(sorted)].join("&");
  const key = `${enc(CLIENT_SECRET)}&${enc(USER_SECRET)}`;
  return crypto.createHmac("sha1", key).update(baseString).digest("base64");
}
async function apiPost(path: string, dataParams: Record<string, string>) {
  const url = `${BASE_URL}${path}`;
  const params: Record<string, string> = {
    oauth_version: "1.0",
    oauth_nonce: md5(Date.now() + "" + Math.random()),
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_consumer_key: CLIENT_KEY,
    oauth_token: USER_KEY,
    oauth_signature_method: "HMAC-SHA1",
    ...dataParams,
  };
  params.oauth_signature = oauthSign("POST", url, params);
  const allEncoded = Object.keys(params).map((k) => `${enc(k)}=${enc(params[k])}`).join("&");
  const authHeader = "OAuth " + Object.keys(params).filter((k) => k.startsWith("oauth")).map((k) => `${enc(k)}="${enc(params[k])}"`).join(",");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader, "User-Agent": "pc-webinar/1.0", "Content-Type": "application/x-www-form-urlencoded" },
    body: allEncoded,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) throw new Error(`Responder ${res.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
  return parsed;
}

function originAllowed(src: string): boolean {
  try {
    const h = new URL(src).hostname.toLowerCase();
    return h === "powercouple.co.il" || h.endsWith(".powercouple.co.il") || h.endsWith(".vercel.app");
  } catch {
    return /(^|\/\/|\.)(powercouple\.co\.il|vercel\.app)([/:]|$)/i.test(src);
  }
}

export async function POST(req: Request) {
  const src = req.headers.get("origin") || req.headers.get("referer") || "";
  if (src && !originAllowed(src)) {
    return NextResponse.json({ error: "forbidden origin" }, { status: 403, headers: CORS });
  }

  let body: Record<string, unknown> = {};
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) body = await req.json().catch(() => ({}));
  else {
    const f = await req.formData().catch(() => null);
    if (f) for (const [k, v] of f.entries()) body[k] = typeof v === "string" ? v : "";
    else body = await req.json().catch(() => ({}));
  }

  const s = (v: unknown) => (v == null ? "" : String(v).trim().slice(0, 200));
  const name = s(body.name) || [s(body.firstName), s(body.lastName)].filter(Boolean).join(" ");
  const email = s(body.email);
  const phone = s(body.phone);
  const listId = s(body.listId) || DEFAULT_LIST;

  if (!email && !phone) {
    return NextResponse.json({ error: "צריך מייל או טלפון" }, { status: 400, headers: CORS });
  }
  if (!CLIENT_KEY || !USER_KEY) {
    return NextResponse.json({ error: "רב מסר לא מוגדר (env)" }, { status: 500, headers: CORS });
  }

  try {
    const subs = [{ EMAIL: email, NAME: name, PHONE: phone }];
    const result = await apiPost(`/lists/${listId}/subscribers`, { subscribers: JSON.stringify(subs) });
    return NextResponse.json({ ok: true, listId, result }, { headers: CORS });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 502, headers: CORS });
  }
}
