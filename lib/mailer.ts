import { GoogleAuth } from "google-auth-library";
import { env } from "@/lib/env";

// שליחת מייל מהכתובת הראשית של העסק (blog@powercouple.co.il),
// דרך אותו service account עם הרשאות דומיין ששולח את הזמנות היומן.
// דרוש scope: https://www.googleapis.com/auth/gmail.send ב-DWD.

const SCOPES = ["https://www.googleapis.com/auth/gmail.send"];
export const MAIL_FROM = "blog@powercouple.co.il";

function sa(): Record<string, unknown> | null {
  const b64 = env("GOOGLE_SA_B64");
  if (!b64) return null;
  try { return JSON.parse(Buffer.from(b64, "base64").toString("utf8")); }
  catch { return null; }
}

/** RFC 2047 — כותרת בעברית חייבת קידוד, אחרת תגיע כג'יבריש. */
function encodeHeader(s: string): string {
  return /^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

export interface MailInput {
  to: string[];
  subject: string;
  html: string;
  cc?: string[];
  fromName?: string;
}

/** שולח מייל HTML. מחזיר true אם נשלח. */
export async function sendMail(input: MailInput): Promise<boolean> {
  const creds = sa();
  const to = (input.to || []).map((e) => e.trim()).filter(Boolean);
  if (!creds || !to.length) return false;

  const auth = new GoogleAuth({ credentials: creds, scopes: SCOPES, clientOptions: { subject: MAIL_FROM } });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) return false;

  const from = `${encodeHeader(input.fromName || "פאוור קאפל")} <${MAIL_FROM}>`;
  const cc = (input.cc || []).filter(Boolean);
  const headers = [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].join("\r\n");

  const raw = `${headers}\r\n\r\n${Buffer.from(input.html, "utf8").toString("base64")}`;
  // base64url — כפי שה-API דורש
  const encoded = Buffer.from(raw, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(MAIL_FROM)}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encoded }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`שליחת מייל נכשלה (${res.status}): ${t.slice(0, 200)}`);
  }
  return true;
}
