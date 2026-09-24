import { NextResponse } from "next/server";
import { verifyRequest } from "@/lib/firebaseAdmin";
import { env } from "@/lib/env";
import { getOrCreateClient, listClientFiles, fileRowToUploaded, updateClientFields, setClientFileDriveId } from "@/lib/clientsRepo";
import { supa } from "@/lib/supabaseAdmin";
import { notifyQuestionnaire } from "@/lib/questionnaireNotify";
import { upsertClientQuestionnaireDoc } from "@/lib/clientDoc";
import { downloadFile } from "@/lib/storage";
import {
  SECTIONS,
  FILE_CATEGORIES,
  isFieldVisible,
  isCategoryRequired,
  missingRequiredFields,
  type Answers,
  type UploadedFile,
} from "@/lib/formSchema";
import {
  findChildFolder,
  createFolder,
  uploadFile,
  exportFile,
  shareAnyoneReader,
  folderLink,
} from "@/lib/googleDrive";

export const runtime = "nodejs";
export const maxDuration = 300;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSummaryHtml(answers: Answers, files: UploadedFile[], email: string, submittedAt: string): string {
  const rows = SECTIONS.map((section) => {
    const fields = section.fields
      .filter((f) => isFieldVisible(f, answers) && answers[f.key]?.trim())
      .map(
        (f) =>
          `<tr><td style="font-weight:bold;width:40%;padding:6px 10px;border:1px solid #ddd;background:#f7f7f9">${esc(f.label)}</td>` +
          `<td style="padding:6px 10px;border:1px solid #ddd">${esc(answers[f.key]).replace(/\n/g, "<br>")}</td></tr>`
      )
      .join("");
    if (!fields) return "";
    return `<h2 style="color:#b3261e;margin:24px 0 8px">${esc(section.title)}</h2><table style="border-collapse:collapse;width:100%">${fields}</table>`;
  }).join("");

  const fileRows = FILE_CATEGORIES.map((cat) => {
    const catFiles = files.filter((f) => f.category === cat.key);
    if (!catFiles.length) return "";
    return `<tr><td style="font-weight:bold;width:40%;padding:6px 10px;border:1px solid #ddd;background:#f7f7f9">${esc(cat.label)}</td><td style="padding:6px 10px;border:1px solid #ddd">${catFiles.map((f) => esc(f.name)).join("<br>")}</td></tr>`;
  }).join("");

  return `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>שאלון פיננסי</title></head>
<body dir="rtl" style="font-family:Arial,sans-serif;direction:rtl;text-align:right;max-width:800px;margin:0 auto">
<h1 style="color:#1a1a2e;border-bottom:3px solid #b3261e;padding-bottom:8px">שאלון פיננסי — ${esc(answers.fullName || "")}</h1>
<p style="color:#666">פאוור קאפל — דין ומיק | הוגש: ${esc(submittedAt)} | מייל: ${esc(email)}</p>
${rows}
<h2 style="color:#b3261e;margin:24px 0 8px">מסמכים שצורפו</h2>
<table style="border-collapse:collapse;width:100%">${fileRows || "<tr><td style='padding:6px 10px'>—</td></tr>"}</table>
</body></html>`;
}

export async function POST(req: Request) {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parentFolderId = env("DRIVE_PARENT_FOLDER_ID");
  const webhookUrl = env("MAKE_WEBHOOK_URL");

  const c = await getOrCreateClient(user);
  const answers: Answers = c.answers || {};
  const files: UploadedFile[] = (await listClientFiles(c.id)).map(fileRowToUploaded);
  if (!Object.keys(answers).length) return NextResponse.json({ error: "אין נתונים שמורים" }, { status: 400 });

  // ולידציה
  const missing = missingRequiredFields(answers);
  if (missing.length) {
    return NextResponse.json({ error: "שדות חובה חסרים", missing }, { status: 400 });
  }
  const missingFiles = FILE_CATEGORIES.filter(
    (cat) => isCategoryRequired(cat, answers) && !files.some((f) => f.category === cat.key)
  ).map((c) => c.label);
  if (missingFiles.length) {
    return NextResponse.json({ error: "מסמכים חסרים", missingFiles }, { status: 400 });
  }

  const submittedAt = new Date().toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });

  try {
    // 1) תיקיית לקוח בדרייב (שימוש חוזר אם כבר קיימת מהגשה קודמת)
    const folderName = `${answers.fullName} - ${answers.idNumber}`.trim();
    let clientFolderId: string | null = c.drive_folder_id || null;
    if (!clientFolderId) clientFolderId = await findChildFolder(parentFolderId, folderName);
    if (!clientFolderId) clientFolderId = await createFolder(parentFolderId, folderName);

    // 2) העלאת קבצים שטרם הועלו לדרייב
    // העלאת כל הקבצים החדשים לדרייב במקביל (מהיר משמעותית מאחד-אחרי-השני)
    const updatedFiles: UploadedFile[] = await Promise.all(
      files.map(async (f) => {
        if (f.driveFileId) return f;
        const buf = await downloadFile(f.storagePath);
        const catLabel = FILE_CATEGORIES.find((c) => c.key === f.category)?.label || f.category;
        const driveFileId = await uploadFile({
          parentId: clientFolderId!,
          name: `${catLabel} - ${f.name}`,
          contentType: f.contentType || "application/octet-stream",
          data: buf,
        });
        return { ...f, driveFileId };
      })
    );

    // 3) Google Doc עם סיכום השאלון — גרסה חדשה בכל עדכון (לא דורס את הקודם)
    // חותמת תאריך בשם כדי לשמור היסטוריית גרסאות בתיקייה
    const stamp = new Date()
      .toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
      .replace(/[/,:]/g, ".").replace(/\s+/g, " ").trim();
    const html = buildSummaryHtml(answers, updatedFiles, user.email, submittedAt);
    const docId = await uploadFile({
      parentId: clientFolderId,
      name: `שאלון פיננסי - ${answers.fullName} - ${stamp}`,
      contentType: "text/html",
      data: Buffer.from(html, "utf8"),
      importAs: "application/vnd.google-apps.document",
    });

    // 4) PDF מתוך ה-Doc
    const pdfBuf = await exportFile(docId, "application/pdf");
    const pdfId = await uploadFile({
      parentId: clientFolderId!,
      name: `שאלון פיננסי - ${answers.fullName} - ${stamp}.pdf`,
      contentType: "application/pdf",
      data: pdfBuf,
    });

    // 5) הרשאת צפייה בלינק לתיקייה
    await shareAnyoneReader(clientFolderId);
    const link = folderLink(clientFolderId);

    // 6) Webhook ל-Make — כל הפרטים + הלינק
    const labeled: Record<string, string> = {};
    for (const section of SECTIONS) {
      for (const field of section.fields) {
        if (isFieldVisible(field, answers)) labeled[field.label] = answers[field.key] || "";
      }
    }
    const webhookPayload = {
      submittedAt,
      email: user.email,
      fullName: answers.fullName,
      idNumber: answers.idNumber,
      phone: answers.phone,
      answers,
      answersLabeled: labeled,
      files: updatedFiles.map((f) => ({
        category: FILE_CATEGORIES.find((c) => c.key === f.category)?.label || f.category,
        name: f.name,
        driveLink: f.driveFileId ? `https://drive.google.com/file/d/${f.driveFileId}/view` : null,
      })),
      driveFolderId: clientFolderId,
      driveFolderLink: link,
    };
    const webhookRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });

    // 7) עדכון סטטוס — מזהי דרייב לכל קובץ + סטטוס הלקוח
    await Promise.all(
      updatedFiles.filter((f) => f.driveFileId).map((f) => setClientFileDriveId(c.id, f.storagePath, f.driveFileId!))
    );
    await updateClientFields(c.id, {
      status: "submitted",
      submitted_at: new Date().toISOString(),
      drive_folder_id: clientFolderId,
      drive_folder_link: link,
    });
    void docId; void pdfId; void webhookRes;

    // סנכרון סופי של מסמך ה-Docs החי בתיקיית הלקוח (force — תמיד מעדכן)
    try { await upsertClientQuestionnaireDoc(c.id, { force: true }); } catch { /* לא חוסם הגשה */ }

    // התראת מייל לצוות על סיום השאלון — פעם אחת בלבד (submit_notified)
    try {
      const { data: notified } = await supa().from("clients").select("submit_notified").eq("id", c.id).maybeSingle();
      if (!(notified as { submit_notified?: boolean } | null)?.submit_notified) {
        const origin = new URL(req.url).origin;
        await notifyQuestionnaire({ clientName: answers.fullName || "", email: user.email, answers, kind: "submitted", clientUrl: `${origin}/admin/${c.id}` });
        await supa().from("clients").update({ submit_notified: true }).eq("id", c.id);
      }
    } catch { /* לא חוסם את ההגשה */ }

    return NextResponse.json({ ok: true, folderLink: link });
  } catch (e: unknown) {
    const err = e as { response?: { status?: number; data?: unknown }; message?: string };
    console.error("submit error", err.response?.status, JSON.stringify(err.response?.data || err.message)?.slice(0, 500));
    const driveDenied = err.response?.status === 404 || err.response?.status === 403;
    return NextResponse.json(
      {
        error: driveDenied
          ? "אין גישה לתיקיית הדרייב — נא לפנות לצוות"
          : "שגיאה בשליחה, נסו שוב או פנו לצוות",
      },
      { status: 500 }
    );
  }
}
