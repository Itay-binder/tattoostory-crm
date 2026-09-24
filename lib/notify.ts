import { SECTIONS, isFieldVisible, type Answers } from "@/lib/formSchema";
import { env } from "@/lib/firebaseAdmin";
import { normalizeIsraeliPhone } from "@/lib/leads";

export { normalizeIsraeliPhone };

// יעד ברירת מחדל — מיק (פאוור קאפל). ניתן לעקיפה דרך env.
const DEFAULT_TO = "972542226289";

// נמענים קבועים לשליחת קישורי חתימה / התראות
export const WA_CONTACTS = {
  mik: { label: "מיק", chatId: "972542226289@c.us" },
  dean: { label: "דין", chatId: "972528777824@c.us" },
  hamal: { label: "חמל פאוור", chatId: "120363408113059883@g.us" },
} as const;

/** ממיר קלט יעד ל-chatId של GreenAPI: קבוצה (@g.us) כמו שהיא, אחרת טלפון מנורמל + @c.us. */
export function toChatId(raw: string): string {
  const t = (raw || "").trim();
  if (/@(g|c)\.us$/i.test(t)) return t;                 // כבר chatId מלא
  const phone = normalizeIsraeliPhone(t);
  return phone.length >= 11 ? `${phone}@c.us` : "";
}

/** בונה הודעת ווצאפ מפרטי השאלון: כותרת מודגשת + כל השדות שמולאו, מקובצים לפי סעיף. */
export function buildClientWhatsappMessage(opts: {
  answers: Answers;
  email?: string;
  status?: string;
  clientUrl?: string;
}): string {
  const { answers, email, status, clientUrl } = opts;
  const name = (answers.fullName || "").trim() || "לקוח ללא שם";
  const lines: string[] = [];

  // כותרת מודגשת (עיצוב ווצאפ *bold*)
  lines.push(`*שאלון פיננסי חדש — ${name}*`);
  lines.push("");

  // שורת קשר מהירה בראש ההודעה
  const quick: string[] = [];
  if (answers.phone?.trim()) quick.push(`טלפון: ${answers.phone.trim()}`);
  if (email?.trim()) quick.push(`מייל: ${email.trim()}`);
  if (answers.idNumber?.trim()) quick.push(`ת.ז: ${answers.idNumber.trim()}`);
  if (quick.length) { lines.push(quick.join("\n")); lines.push(""); }

  // כל הסעיפים — רק שדות שמולאו וגלויים
  for (const section of SECTIONS) {
    const rows: string[] = [];
    for (const f of section.fields) {
      if (!isFieldVisible(f, answers)) continue;
      const v = (answers[f.key] || "").trim();
      if (!v) continue;
      rows.push(`${f.label}: ${v}`);
    }
    if (rows.length) {
      lines.push(`*${section.icon} ${section.title}*`);
      lines.push(...rows);
      lines.push("");
    }
  }

  if (status) lines.push(status === "submitted" ? "סטטוס: הוגש ✓" : "סטטוס: טיוטה (טרם הוגש)");
  if (clientUrl) lines.push(`צפייה מלאה: ${clientUrl}`);

  return lines.join("\n").trim();
}

/** שולח הודעת טקסט דרך GreenAPI של פאוור קאפל. מחזיר את מזהה ההודעה. */
export async function sendPowerCoupleWhatsapp(input: { to?: string; text: string }): Promise<{ idMessage: string }> {
  const instance = env("PC_GREENAPI_INSTANCE");
  const token = env("PC_GREENAPI_TOKEN");
  const base = (env("PC_GREENAPI_BASE") || "https://api.green-api.com").replace(/\/+$/, "");
  if (!instance || !token) throw new Error("GreenAPI של פאוור קאפל לא מוגדר (PC_GREENAPI_INSTANCE / PC_GREENAPI_TOKEN)");

  const chatId = toChatId(input.to || env("WHATSAPP_NOTIFY_TO") || DEFAULT_TO);
  const text = input.text.trim();
  if (!chatId) throw new Error("מספר יעד לא תקין");
  if (!text) throw new Error("טקסט ההודעה ריק");

  const url = `${base}/waInstance${instance}/sendMessage/${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message: text }),
  });
  const json = (await res.json().catch(() => ({}))) as { idMessage?: string; error?: string; message?: string };
  if (!res.ok || !json.idMessage) {
    throw new Error(json.error || json.message || `GreenAPI נכשל (${res.status})`);
  }
  return { idMessage: json.idMessage };
}
