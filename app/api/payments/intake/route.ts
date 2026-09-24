import { NextResponse } from "next/server";
import { validateApiKey } from "@/lib/settingsRepo";
import { findLeadForClient, upsertLead, addLeadActivity, convertLeadToClient } from "@/lib/leadsRepo";
import { normalizeIsraeliPhone } from "@/lib/leads";
import { sendMail } from "@/lib/mailer";

export const runtime = "nodejs";

// קליטת סליקה מ-CardCom (דרך תרחיש Make "לקוחות פגישת מצפן דרך הוובינר").
// מזהה את הליד לפי טלפון/מייל מנורמל → מתעד את הרכישה בכרטיס → מסמן WON והופך ללקוח
// (נכנס אוטומטית לצינור פגישות מצפן) → שולח מייל התראה ל-blog@powercouple.co.il.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
};

const BY = "סליקת CardCom (וובינר מצפן)";
const NOTIFY_TO = "blog@powercouple.co.il";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(req: Request) {
  // תומך גם ב-JSON וגם ב-x-www-form-urlencoded (כך Make יכול לשלוח form-fields כמו במודול הקיים).
  let body: Record<string, unknown> = {};
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    body = await req.json().catch(() => ({}));
  } else {
    const form = await req.formData().catch(() => null);
    if (form) for (const [k, v] of form.entries()) body[k] = typeof v === "string" ? v : "";
    else body = await req.json().catch(() => ({}));
  }

  // שרת-לשרת (Make/CardCom) — חובה מפתח API.
  const key = req.headers.get("x-api-key") || (body.apiKey as string) || "";
  if (!(await validateApiKey(key))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: CORS });
  }

  const s = (v: unknown) => (v == null ? "" : String(v).trim().slice(0, 300));
  // תמיכה גם בשמות השדות של CardCom (ProdPrice/CardOwnerName וכו') וגם בשמות פשוטים.
  const fullName = s(body.fullName) || s(body.name) || s(body.CardOwnerName);
  const phoneRaw = s(body.phone) || s(body.CardOwnerPhone) || s(body.InvMobile);
  const email = s(body.email) || s(body.UserEmail);
  const amountRaw = s(body.amount) || s(body.ProdPrice) || s(body.sum);
  const transactionId = s(body.transactionId) || s(body.dealNumber) || s(body.InternalDealNumber);
  const receiptNumber = s(body.receiptNumber) || s(body.invoiceNumber) || s(body.InvoiceNumber);
  const receiptUrl = s(body.receiptUrl) || s(body.invoiceUrl) || s(body.InvoiceLink);
  const product = s(body.product) || "פגישת מצפן";

  const phone = normalizeIsraeliPhone(phoneRaw);
  if (!phone && !email) {
    return NextResponse.json({ error: "צריך טלפון או מייל לזיהוי הרוכש" }, { status: 400, headers: CORS });
  }

  const amountNum = Number(String(amountRaw).replace(/[^\d.]/g, ""));
  const amountText = amountNum ? `₪${amountNum.toLocaleString("he-IL")}` : amountRaw;

  // 1) זיהוי הליד לפי טלפון/מייל מנורמל. אם אין — יוצרים ליד כדי לא לאבד רכישה.
  let lead = await findLeadForClient({ email, phone });
  let created = false;
  if (!lead) {
    const r = await upsertLead({ fullName, email, phone, custom: {} }, { source: "api", by: BY });
    lead = r.lead;
    created = true;
  }

  // 2) תיעוד הרכישה בכרטיס הליד (סכום + מספר עסקה/קבלה + קישור).
  const parts = [`💳 בוצעה סליקה — ${amountText || "סכום לא ידוע"}`, product];
  if (transactionId) parts.push(`עסקה ${transactionId}`);
  if (receiptNumber) parts.push(`קבלה ${receiptNumber}`);
  let purchaseText = parts.join(" — ");
  if (receiptUrl) purchaseText += `\n${receiptUrl}`;
  await addLeadActivity(lead.id, { type: "system", source: "api", by: BY, text: purchaseText });

  // 3) סימון WON → לקוח + כניסה אוטומטית לצינור פגישות מצפן (זהה לכפתור "סמן WON").
  //    convertLeadToClient אידמפוטנטי — אם כבר לקוח, לא ייווצר כפל.
  const conv = await convertLeadToClient(lead.id, { email: NOTIFY_TO, name: "סליקה אוטומטית (וובינר מצפן)" });

  // 4) מייל התראה ל-blog@ שהרוכש קנה.
  const displayName = fullName || lead.fullName || phone || email;
  const rows = [
    ["שם", displayName],
    ["טלפון", phone || "—"],
    ["מייל", email || "—"],
    ["סכום", amountText || "—"],
    ["מוצר", product],
    ["מספר עסקה", transactionId || "—"],
    ["מספר קבלה", receiptNumber || "—"],
  ].map(([k, v]) => `<p dir="rtl" style="margin:4px 0"><b>${k}:</b> ${esc(v || "")}</p>`).join("");
  const html = `<div dir="rtl" style="text-align:right;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a">
    <h2 style="margin:0 0 12px">💳 רכישה חדשה — פגישת מצפן (וובינר)</h2>
    ${rows}
    ${receiptUrl ? `<p dir="rtl"><a href="${esc(receiptUrl)}">קישור לקבלה/חשבונית</a></p>` : ""}
    <p dir="rtl" style="color:#666;margin-top:10px">הליד סומן כ-WON והומר ללקוח, ונכנס לצינור פגישות מצפן.${created ? " (נוצר ליד חדש — לא נמצא ליד קיים מתאים)" : ""}</p>
    <p dir="rtl"><a href="https://powercouple-finance.vercel.app/admin/leads/${lead.id}">פתח את כרטיס הליד ←</a></p>
  </div>`;
  let mailed = false;
  try {
    mailed = await sendMail({
      to: [NOTIFY_TO],
      subject: `רכישת פגישת מצפן — ${displayName}${amountText ? ` — ${amountText}` : ""}`,
      html,
    });
  } catch {
    mailed = false;
  }

  return NextResponse.json(
    { ok: true, leadId: lead.id, clientUid: conv?.clientUid || null, created, mailed },
    { headers: CORS }
  );
}
