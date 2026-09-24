import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";
import { uploadFile } from "@/lib/googleDrive";
import { FILE_CATEGORIES } from "@/lib/formSchema";
import { buildClientWhatsappMessage, sendPowerCoupleWhatsapp } from "@/lib/notify";
import { findLeadForClient } from "@/lib/leadsRepo";
import { stageLabel } from "@/lib/leads";
import { CLIENT_STAGES, CLIENT_PACES, clientStageLabel } from "@/lib/clients";
import { getClientById, listClientFiles, addClientFile, setClientFileDriveId, safeStorageName } from "@/lib/clientsRepo";
import { listLinkedClients, linkClients, unlinkClients } from "@/lib/clientLinks";
import { ensureClientFolder } from "@/lib/clientFolder";
import { signedReadUrl, signedUploadUrl, fileExists, downloadFile } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60; // העלאות דרייב של קבצים גדולים — לא לחתוך באמצע

/** העלאה לדרייב עם 3 ניסיונות (כשל חולף לא ישאיר קובץ בלי גיבוי בדרייב). */
async function uploadWithRetry(folderId: string, name: string, contentType: string, data: Buffer): Promise<string | null> {
  for (let a = 0; a < 3; a++) {
    try { return await uploadFile({ parentId: folderId, name, contentType, data }); }
    catch { if (a < 2) await new Promise((r) => setTimeout(r, 1200)); }
  }
  return null;
}

/** ריפוי-עצמי: מעלה לדרייב קבצים שנכשלו בעבר (עד 8 בטעינה, best-effort). */
async function healMissingDriveFiles(uid: string, folderId: string): Promise<void> {
  const files = await listClientFiles(uid);
  const missing = files.filter((f) => !f.drive_file_id).slice(0, 8);
  for (const f of missing) {
    try {
      const buf = await downloadFile(f.storage_path);
      const id = await uploadWithRetry(folderId, f.name, f.content_type || "application/octet-stream", buf);
      if (id) await setClientFileDriveId(uid, f.storage_path, id);
    } catch { /* דילוג — ננסה שוב בטעינה הבאה */ }
  }
}

interface SignerRec { name: string; role: string; sign_order: number; optional: boolean; token: string; status: string; signed_at?: string; client_id?: string }

export async function GET(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const { uid } = await params;
  let c = await getClientById(uid);
  if (!c) return NextResponse.json({ error: "not found" }, { status: 404 });

  // כל לקוח מקבל תיקיית דרייב מרגע שנפתח הכרטיס — גם בלי שאלון/קבצים
  if (!c.drive_folder_id) {
    try { await ensureClientFolder(uid); c = (await getClientById(uid)) || c; } catch { /* לא חוסם טעינת הכרטיס */ }
  }
  // ריפוי-עצמי: קבצים שלא הגיעו לדרייב (כשל חולף בעבר) — מעלים אותם עכשיו
  if (c.drive_folder_id) {
    try { await healMissingDriveFiles(uid, c.drive_folder_id); } catch { /* לא חוסם */ }
  }

  // קבצים + קישורי צפייה זמניים
  const fileRows = await listClientFiles(uid);
  const files = await Promise.all(fileRows.map(async (f) => {
    let url = "";
    try { url = await signedReadUrl(f.storage_path); } catch { /* missing */ }
    const catLabel = FILE_CATEGORIES.find((x) => x.key === f.category)?.label || f.category;
    return { category: f.category, categoryLabel: catLabel, name: f.name, size: f.size, contentType: f.content_type, url };
  }));

  // הסכמים של לקוח זה
  const { data: envs } = await supa().from("contract_envelopes")
    .select("id,template_name,status,created_at,signed_drive_link,primary_client_id, contract_signers(name,role,sign_order,optional,token,status,signed_at,client_id)");
  const contracts = ((envs as Record<string, unknown>[]) || [])
    .filter((e) => e.primary_client_id === uid || ((e.contract_signers as SignerRec[]) || []).some((s) => s.client_id === uid))
    .map((e) => ({
      id: e.id as string,
      templateName: e.template_name as string,
      status: e.status as string,
      createdAt: e.created_at as string,
      signedDriveLink: (e.signed_drive_link as string) || "",
      signers: ((e.contract_signers as SignerRec[]) || [])
        .map((s) => ({ name: s.name, role: s.role, order: s.sign_order, optional: s.optional, token: s.token, status: s.status, signedAt: s.signed_at || "" }))
        .sort((a, b) => a.order - b.order),
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  // הערות פנימיות
  const { data: notes } = await supa().from("admin_notes").select("*").eq("client_id", uid).order("created_at", { ascending: false });
  const adminNotes = ((notes as Record<string, unknown>[]) || []).map((n) => ({
    id: n.id as string, text: n.text as string, authorEmail: (n.author_email as string) || "", authorName: (n.author_name as string) || "", createdAt: n.created_at as string,
  }));

  // לקוחות מקושרים (זוג/שותפים)
  const linkedClients = await listLinkedClients(uid);

  // ליד מקושר
  const answers = c.answers || {};
  const linked = await findLeadForClient({ fromLeadId: c.from_lead_id || undefined, email: c.email || answers.email, phone: answers.phone });
  const linkedLead = linked ? {
    id: linked.id, fullName: linked.fullName, stage: linked.stage, stageLabel: stageLabel(linked.stage),
    phone: linked.phone, email: linked.email, source: linked.quali?.source || "", createdAt: linked.createdAt, activity: linked.activity,
  } : null;

  return NextResponse.json({
    uid, email: c.email || "", googleName: c.google_name || "", status: c.status || "draft",
    stage: c.stage || "new",
    pace: (c as { pace?: string }).pace || "", paceUpdatedAt: (c as { pace_updated_at?: string }).pace_updated_at || "",
    answers, files, contracts, adminNotes, linkedLead, linkedClients,
    fromLeadSource: c.from_lead_source || "", convertedByName: c.converted_by_name || "", convertedAt: c.converted_at || "",
    updatedAt: c.updated_at || "", submittedAt: c.submitted_at || "", driveFolderLink: c.drive_folder_link || "",
    questionnaireDocLink: (c as { questionnaire_doc_link?: string }).questionnaire_doc_link || "",
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { uid } = await params;
  const body = await req.json();
  const prefix = `finance-form/${uid}/`;

  if (body.action === "sign-upload") {
    const { fileName, contentType, size } = body;
    if (!fileName || typeof size !== "number" || size <= 0 || size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "קובץ גדול מ-50MB או פרטים חסרים" }, { status: 400 });
    }
    const storagePath = `${prefix}manual/${Date.now()}_${safeStorageName(fileName)}`;
    void contentType;
    try { const { uploadUrl } = await signedUploadUrl(storagePath); return NextResponse.json({ uploadUrl, storagePath }); }
    catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
  }

  if (body.action === "attach") {
    const { storagePath, fileName, displayName, contentType, size } = body;
    if (!storagePath?.startsWith(prefix)) return NextResponse.json({ error: "bad path" }, { status: 400 });
    if (!(await fileExists(storagePath))) return NextResponse.json({ error: "הקובץ לא נמצא" }, { status: 400 });
    const name = String(displayName?.trim() || fileName || "מסמך").slice(0, 200);
    const ct = contentType || "application/octet-stream";
    let driveFileId: string | null = null;
    const c = await getClientById(uid);
    if (c?.drive_folder_id) {
      try { const buf = await downloadFile(storagePath); driveFileId = await uploadWithRetry(c.drive_folder_id, name, ct, buf); }
      catch { /* אם נכשל — הריפוי-העצמי בטעינת הכרטיס יעלה אותו בהמשך */ }
    }
    await addClientFile(uid, { category: "manual", name, size: size || 0, content_type: ct, storage_path: storagePath, drive_file_id: driveFileId });
    return NextResponse.json({ ok: true, file: { category: "manual", name, size: size || 0, contentType: ct, storagePath, driveFileId }, addedToDrive: !!driveFileId });
  }

  if (body.action === "add-note") {
    const text = String(body.text || "").trim();
    if (!text) return NextResponse.json({ error: "ההערה ריקה" }, { status: 400 });
    const { data } = await supa().from("admin_notes").insert({ client_id: uid, text: text.slice(0, 5000), author_email: admin.email, author_name: admin.name || admin.email }).select("*").single();
    await supa().from("clients").update({ updated_at: new Date().toISOString() }).eq("id", uid);
    const n = data as Record<string, unknown>;
    return NextResponse.json({ ok: true, note: { id: n.id, text: n.text, authorEmail: n.author_email, authorName: n.author_name, createdAt: n.created_at } });
  }

  if (body.action === "delete-note") {
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ error: "חסר מזהה" }, { status: 400 });
    await supa().from("admin_notes").delete().eq("id", id).eq("client_id", uid);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "delete-client") {
    if (String(body.confirm) !== "DELETE") return NextResponse.json({ error: "נדרש אישור DELETE" }, { status: 400 });
    await supa().from("clients").delete().eq("id", uid);
    return NextResponse.json({ ok: true });
  }

  // שלב הלקוח בתהליך (חדש / מימון / לשיבוץ / חתמו דירה)
  if (body.action === "set-stage") {
    const stage = String(body.stage || "");
    if (!CLIENT_STAGES.some((s) => s.key === stage)) return NextResponse.json({ error: "שלב לא תקין" }, { status: 400 });
    const { error } = await supa().from("clients").update({ stage, updated_at: new Date().toISOString() }).eq("id", uid);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await supa().from("admin_notes").insert({
      client_id: uid, text: `🔀 שלב הלקוח עודכן ל: ${clientStageLabel(stage)}`,
      author_email: admin.email, author_name: admin.name || admin.email,
    });
    return NextResponse.json({ ok: true, stage });
  }

  // קישור לקוח נוסף (זוג/שותפים) — הופכים אותם למקושרים יחד
  if (body.action === "link-client") {
    const other = String(body.otherUid || "").trim();
    if (!other) return NextResponse.json({ error: "חסר לקוח לקישור" }, { status: 400 });
    if (other === uid) return NextResponse.json({ error: "אי אפשר לקשר לקוח לעצמו" }, { status: 400 });
    const target = await getClientById(other);
    if (!target) return NextResponse.json({ error: "הלקוח הנבחר לא נמצא" }, { status: 404 });
    try {
      await linkClients(uid, other, admin.email, String(body.relation || "").trim() || undefined);
      const meName = (await getClientById(uid))?.answers?.fullName || "";
      const otherName = target.answers?.fullName || target.google_name || target.email || "לקוח";
      for (const [cid, label] of [[uid, otherName], [other, meName]] as [string, string][]) {
        await supa().from("admin_notes").insert({ client_id: cid, text: `🔗 קושר ללקוח: ${label}`, author_email: admin.email, author_name: admin.name || admin.email });
      }
      return NextResponse.json({ ok: true, linkedClients: await listLinkedClients(uid) });
    } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
  }

  if (body.action === "unlink-client") {
    const other = String(body.otherUid || "").trim();
    if (!other) return NextResponse.json({ error: "חסר מזהה" }, { status: 400 });
    await unlinkClients(uid, other);
    return NextResponse.json({ ok: true, linkedClients: await listLinkedClients(uid) });
  }

  // קצב הלקוח — עם תאריך עדכון אחרון אוטומטי
  if (body.action === "set-pace") {
    const pace = String(body.pace || "");
    if (pace && !CLIENT_PACES.includes(pace as (typeof CLIENT_PACES)[number])) return NextResponse.json({ error: "קצב לא תקין" }, { status: 400 });
    const now = new Date().toISOString();
    const { error } = await supa().from("clients").update({ pace: pace || null, pace_updated_at: pace ? now : null, updated_at: now }).eq("id", uid);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, pace, paceUpdatedAt: pace ? now : "" });
  }

  if (body.action === "send-whatsapp") {
    const c = await getClientById(uid);
    if (!c) return NextResponse.json({ error: "הלקוח לא נמצא" }, { status: 404 });
    const origin = new URL(req.url).origin;
    const text = buildClientWhatsappMessage({ answers: c.answers || {}, email: c.email || "", status: c.status || "draft", clientUrl: `${origin}/admin/${uid}` });
    try { const { idMessage } = await sendPowerCoupleWhatsapp({ to: body.to, text }); return NextResponse.json({ ok: true, idMessage }); }
    catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
