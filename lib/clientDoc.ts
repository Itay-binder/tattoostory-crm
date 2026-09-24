// מסמך Google Docs חי לכל לקוח — משקף את תשובות השאלון ומתעדכן בכל שמירה.
// נשמר בתיקיית הדרייב של הלקוח. נשאר אותו קובץ (אותו לינק) לאורך כל הדרך.

import { SECTIONS, isFieldVisible, type Answers } from "@/lib/formSchema";
import { computeProgress } from "@/lib/questionnaireNotify";
import { getClientById, updateClientFields, type ClientRow } from "@/lib/clientsRepo";
import { ensureClientFolder } from "@/lib/clientFolder";
import { uploadFile, updateFileContent } from "@/lib/googleDrive";

// ויסות: לא לעדכן את גוגל בכל הקלדה. לכל היותר פעם ב-SYNC_THROTTLE_MS,
// אלא אם force=true (הגשה / עריכת מנהל) — שם תמיד מסנכרנים.
const SYNC_THROTTLE_MS = 15_000;

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtStamp(): string {
  return new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" });
}

/** בונה את ה-HTML שיומר ל-Google Doc — עברית RTL, כל השדות, ריקים כ־"—". */
export function buildClientDocHtml(client: Pick<ClientRow, "answers" | "google_name" | "email">): string {
  const answers = (client.answers || {}) as Answers;
  const p = computeProgress(answers);
  const name = (answers.fullName || client.google_name || "").trim() || "לקוח";
  const phone = (answers.phone || "").trim();
  const email = (client.email || "").trim();

  const sections = SECTIONS.map((section) => {
    const rows = section.fields
      .filter((f) => isFieldVisible(f, answers))
      .map((f) => {
        const raw = (answers[f.key] || "").trim();
        const val = raw ? esc(raw).replace(/\n/g, "<br>") : "—";
        const color = raw ? "#111" : "#b0b0b0";
        return (
          `<tr>` +
          `<td dir="rtl" style="text-align:right;font-weight:bold;width:42%;padding:6px 10px;border:1px solid #e2e2e6;background:#f7f7f9">${esc(f.label)}</td>` +
          `<td dir="rtl" style="text-align:right;padding:6px 10px;border:1px solid #e2e2e6;color:${color}">${val}</td>` +
          `</tr>`
        );
      })
      .join("");
    const sec = p.sections.find((s) => s.title === section.title);
    const cnt = sec ? `${sec.answered}/${sec.total}` : "";
    return (
      `<h2 dir="rtl" style="text-align:right;color:#b3261e;margin:22px 0 8px;font-size:18px">${esc(section.title)} <span style="color:#999;font-size:14px;font-weight:normal">(${cnt})</span></h2>` +
      `<table style="border-collapse:collapse;width:100%">${rows}</table>`
    );
  }).join("");

  return (
    `<div dir="rtl" style="text-align:right;font-family:Arial,sans-serif;color:#111">` +
    `<h1 dir="rtl" style="text-align:right;color:#111;margin:0 0 4px;font-size:24px">שאלון פיננסי — ${esc(name)}</h1>` +
    `<p dir="rtl" style="text-align:right;color:#555;margin:0 0 2px">${phone ? "טלפון: " + esc(phone) : ""}${phone && email ? " · " : ""}${email ? "אימייל: " + esc(email) : ""}</p>` +
    `<p dir="rtl" style="text-align:right;color:#555;margin:0 0 2px">התקדמות מילוי: <b>${p.answered}/${p.total}</b> שדות</p>` +
    `<p dir="rtl" style="text-align:right;color:#999;margin:0 0 12px;font-size:13px">עודכן אוטומטית: ${esc(fmtStamp())}</p>` +
    `<hr style="border:none;border-top:2px solid #b3261e;margin:0 0 8px">` +
    sections +
    `</div>`
  );
}

/**
 * יוצר/מעדכן את מסמך ה-Docs של הלקוח בתיקיית הדרייב שלו.
 * force=true (הגשה/עריכת מנהל) עוקף את הוויסות. מחזיר את מזהה/לינק המסמך או null.
 * לעולם לא זורק — כשל בסנכרון לא חוסם שמירת שאלון.
 */
export async function upsertClientQuestionnaireDoc(
  clientId: string,
  opts: { force?: boolean } = {}
): Promise<{ id: string; link: string } | null> {
  try {
    const c = await getClientById(clientId);
    if (!c) return null;

    const row = c as ClientRow & {
      questionnaire_doc_id?: string | null;
      questionnaire_doc_link?: string | null;
      questionnaire_doc_synced_at?: string | null;
    };

    // ויסות — דלג אם סונכרן ממש עכשיו ואין force
    if (!opts.force && row.questionnaire_doc_id && row.questionnaire_doc_synced_at) {
      const age = Date.now() - new Date(row.questionnaire_doc_synced_at).getTime();
      if (age < SYNC_THROTTLE_MS) {
        return { id: row.questionnaire_doc_id, link: row.questionnaire_doc_link || docLink(row.questionnaire_doc_id) };
      }
    }

    const folder = await ensureClientFolder(clientId);
    if (!folder) return null;

    const html = Buffer.from(buildClientDocHtml(c), "utf8");
    const name = `שאלון פיננסי — ${(c.answers?.fullName || c.google_name || "לקוח").trim()}`;

    let docId = row.questionnaire_doc_id || "";
    if (docId) {
      // עדכון מסמך קיים — אותו לינק
      try {
        await updateFileContent({ fileId: docId, contentType: "text/html", data: html, importAs: "application/vnd.google-apps.document", name });
      } catch {
        // אם המסמך נמחק/לא נגיש — ניצור חדש
        docId = "";
      }
    }
    if (!docId) {
      docId = await uploadFile({ parentId: folder.id, name, contentType: "text/html", data: html, importAs: "application/vnd.google-apps.document" });
    }

    const link = docLink(docId);
    await updateClientFields(clientId, {
      questionnaire_doc_id: docId,
      questionnaire_doc_link: link,
      questionnaire_doc_synced_at: new Date().toISOString(),
    });
    return { id: docId, link };
  } catch {
    return null;
  }
}

export function docLink(docId: string): string {
  return `https://docs.google.com/document/d/${docId}/edit`;
}
