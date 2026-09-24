import { SECTIONS, isFieldVisible, type Answers } from "@/lib/formSchema";
import { sendMail } from "@/lib/mailer";

const TEAM_TO = ["blog@powercouple.co.il"];

export interface Progress {
  total: number;
  answered: number;
  sections: { title: string; answered: number; total: number; filled: [string, string][]; missing: string[] }[];
}

/** מחשב כמה שדות (גלויים) מולאו וכמה נותרו, לפי הסקשנים. */
export function computeProgress(answers: Answers): Progress {
  const sections = SECTIONS.map((s) => {
    const visible = s.fields.filter((f) => isFieldVisible(f, answers));
    const filled = visible.filter((f) => (answers[f.key] || "").trim()).map((f) => [f.label, answers[f.key]] as [string, string]);
    const missing = visible.filter((f) => !(answers[f.key] || "").trim()).map((f) => f.label);
    return { title: s.title, answered: filled.length, total: visible.length, filled, missing };
  });
  return {
    total: sections.reduce((a, s) => a + s.total, 0),
    answered: sections.reduce((a, s) => a + s.answered, 0),
    sections,
  };
}

function esc(s: string): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function html(clientName: string, email: string, kind: "submitted" | "near", p: Progress, clientUrl: string): string {
  const title = kind === "submitted" ? "לקוח סיים למלא את שאלון ההתקשרות" : "לקוח קרוב לסיום שאלון ההתקשרות";
  const filledBlocks = p.sections.filter((s) => s.filled.length).map((s) =>
    `<h3 dir="rtl" style="text-align:right;color:#b3261e;margin:16px 0 6px">${esc(s.title)} (${s.answered}/${s.total})</h3>
     <table dir="rtl" style="border-collapse:collapse;width:100%">
     ${s.filled.map(([k, v]) => `<tr><td style="padding:7px 10px;border:1px solid #e3e3e3;background:#fafafa;font-weight:bold;text-align:right;width:38%">${esc(k)}</td><td style="padding:7px 10px;border:1px solid #e3e3e3;text-align:right">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("")}
     </table>`).join("");
  const missing = p.sections.flatMap((s) => s.missing);
  const missingBlock = missing.length
    ? `<h3 dir="rtl" style="text-align:right;color:#8a6d00;margin:16px 0 6px">מה נשאר למלא (${missing.length})</h3>
       <ul dir="rtl" style="text-align:right;padding-right:20px;font-size:15px">${missing.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`
    : `<p dir="rtl" style="text-align:right;color:#137333;font-weight:bold">מולאו כל השדות 🎉</p>`;

  return `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;text-align:right;color:#222;max-width:640px">
  <h2 dir="rtl" style="text-align:right;color:#1a1a2e">${esc(title)}</h2>
  <p dir="rtl" style="text-align:right;font-size:16px"><b>${esc(clientName || "לקוח")}</b>${email ? ` · ${esc(email)}` : ""}</p>
  <p dir="rtl" style="text-align:right;font-size:16px">התקדמות: <b>${p.answered}/${p.total}</b> שדות מולאו.</p>
  ${filledBlocks}
  ${missingBlock}
  <p dir="rtl" style="text-align:right;margin-top:18px"><a href="${esc(clientUrl)}" style="background:#b3261e;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">פתיחת כרטיס הלקוח</a></p>
</div>`;
}

/** שולח מייל לצוות על סיום/התקרבות לסיום שאלון. מחזיר true אם נשלח. */
export async function notifyQuestionnaire(input: {
  clientName: string; email: string; answers: Answers; kind: "submitted" | "near"; clientUrl: string;
}): Promise<boolean> {
  const p = computeProgress(input.answers);
  const subject = input.kind === "submitted"
    ? `שאלון הושלם — ${input.clientName || "לקוח"} (${p.answered}/${p.total})`
    : `לקוח קרוב לסיום שאלון — ${input.clientName || "לקוח"} (${p.answered}/${p.total})`;
  try {
    return await sendMail({ to: TEAM_TO, subject, html: html(input.clientName, input.email, input.kind, p, input.clientUrl) });
  } catch { return false; }
}
