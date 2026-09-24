import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { env } from "@/lib/env";
import { signerIndexOf, clientDataKeyOf, type ContractField } from "@/lib/contracts";
import { generateSignedPdf, todayDDMMYYYY } from "@/lib/signedPdf";
import { uploadFile, shareAnyoneReader } from "@/lib/googleDrive";
import { getClientById } from "@/lib/clientsRepo";
import { signedReadUrl, saveFile } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

interface SignerObj {
  index: number; role: string; name: string; contact: string; clientUid: string | null; order: number;
  optional: boolean; token: string; status: string; values: Record<string, string>; signaturePaths: Record<string, string>;
  openedAt: string | null; signedAt: string | null; ip: string;
}
interface EnvObj {
  id: string; storagePath: string; templateName: string; pageCount: number; fields: ContractField[];
  senderValues: Record<string, string>; clientData: Record<string, string>; primaryClientUid: string | null;
  status: string; signedPdfPath?: string; signedDriveId?: string; signedDriveLink?: string; signers: SignerObj[];
}

/** מוצא את המעטפה + כל החותמים לפי טוקן, בצורה שתואמת ללוגיקה הקיימת. */
async function resolve(token: string): Promise<{ envelopeId: string; signerIndex: number; envelope: EnvObj } | null> {
  const { data: sg } = await supa().from("contract_signers").select("envelope_id, signer_index").eq("token", token).maybeSingle();
  if (!sg) return null;
  const envelopeId = (sg as { envelope_id: string }).envelope_id;
  const signerIndex = (sg as { signer_index: number }).signer_index;

  const { data: env } = await supa().from("contract_envelopes").select("*").eq("id", envelopeId).maybeSingle();
  if (!env) return null;
  const { data: signers } = await supa().from("contract_signers").select("*").eq("envelope_id", envelopeId).order("signer_index", { ascending: true });
  const e = env as Record<string, unknown>;
  const envelope: EnvObj = {
    id: envelopeId,
    storagePath: (e.storage_path as string) || "",
    templateName: (e.template_name as string) || "",
    pageCount: (e.page_count as number) || 1,
    fields: (e.fields as ContractField[]) || [],
    senderValues: (e.sender_values as Record<string, string>) || {},
    clientData: (e.client_data as Record<string, string>) || {},
    primaryClientUid: (e.primary_client_id as string) || null,
    status: (e.status as string) || "sent",
    signers: ((signers as Record<string, unknown>[]) || []).map((s) => ({
      index: s.signer_index as number, role: (s.role as string) || "", name: (s.name as string) || "",
      contact: (s.contact as string) || "", clientUid: (s.client_id as string) || null, order: (s.sign_order as number) || 1,
      optional: !!s.optional, token: s.token as string, status: (s.status as string) || "sent",
      values: (s.values as Record<string, string>) || {}, signaturePaths: (s.signature_paths as Record<string, string>) || {},
      openedAt: (s.opened_at as string) || null, signedAt: (s.signed_at as string) || null, ip: (s.ip as string) || "",
    })),
  };
  return { envelopeId, signerIndex, envelope };
}

// GET — נתונים לרינדור דף החתימה
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await resolve(token);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  const e = r.envelope;
  const me = e.signers.find((s) => s.index === r.signerIndex)!;
  const myRole = me.role || `signer${r.signerIndex + 1}`;

  let pdfUrl = "";
  try { pdfUrl = await signedReadUrl(e.storagePath); } catch { /* ignore */ }

  const primaryIdx = Math.max(0, e.signers.findIndex((s) => s.clientUid && s.clientUid === e.primaryClientUid));
  const fields = e.fields.map((f) => {
    const k = clientDataKeyOf(f.source);
    const editableByMe = k ? r.signerIndex === primaryIdx : f.source === myRole;
    let value = "";
    if (f.source === "auto:today") value = todayDDMMYYYY();
    else if (f.source === "sender") value = e.senderValues?.[f.id] || "";
    else if (k) value = e.clientData?.[k] || "";
    else { const si = signerIndexOf(f.source); if (si) value = e.signers.find((s) => s.index === si - 1)?.values?.[f.id] || ""; }
    return { id: f.id, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, type: f.type, label: f.label, required: f.required, editableByMe, value };
  });

  if (me.status === "sent") {
    await supa().from("contract_signers").update({ status: "opened", opened_at: new Date().toISOString() }).eq("token", token);
    me.status = "opened";
  }

  return NextResponse.json({ templateName: e.templateName, pageCount: e.pageCount, pdfUrl, signerName: me.name, status: me.status, fields });
}

// POST — שמירת מילוי+חתימה, וסיום אם כולם חתמו
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await resolve(token);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  const e = r.envelope;
  const me = e.signers.find((s) => s.index === r.signerIndex)!;
  if (me.status === "signed") return NextResponse.json({ ok: true, already: true });

  const body = await req.json();
  const values: Record<string, string> = body.values || {};
  const signatures: Record<string, string> = body.signatures || {};

  const myRole = me.role || `signer${r.signerIndex + 1}`;
  const primaryIdx = Math.max(0, e.signers.findIndex((s) => s.clientUid && s.clientUid === e.primaryClientUid));
  const isMine = (f: ContractField) => { const k = clientDataKeyOf(f.source); return k ? r.signerIndex === primaryIdx : f.source === myRole; };
  const myFields = e.fields.filter(isMine);

  for (const f of myFields) {
    if (!f.required) continue;
    if (f.type === "signature") { if (!signatures[f.id]) return NextResponse.json({ error: `נדרשת חתימה: ${f.label}` }, { status: 400 }); }
    else if (!values[f.id]?.trim()) return NextResponse.json({ error: `שדה חובה: ${f.label}` }, { status: 400 });
  }

  // שמירת חתימות ל-Storage
  const sigPaths: Record<string, string> = {};
  for (const [fid, dataUrl] of Object.entries(signatures)) {
    const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
    if (!m) continue;
    const path = `contract-signatures/${r.envelopeId}/${r.signerIndex}-${fid}.png`;
    await saveFile(path, Buffer.from(m[1], "base64"), "image/png");
    sigPaths[fid] = path;
  }

  const cleanValues: Record<string, string> = {};
  const clientData: Record<string, string> = { ...(e.clientData || {}) };
  for (const f of myFields) {
    if (f.type === "signature" || typeof values[f.id] !== "string") continue;
    const k = clientDataKeyOf(f.source);
    if (k) clientData[k] = values[f.id].slice(0, 2000);
    else cleanValues[f.id] = values[f.id].slice(0, 2000);
  }
  e.clientData = clientData;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  // עדכון החותם הנוכחי בטבלה + בזיכרון
  const signedAtIso = new Date().toISOString();
  await supa().from("contract_signers").update({ values: cleanValues, signature_paths: sigPaths, status: "signed", signed_at: signedAtIso, ip }).eq("token", token);
  Object.assign(me, { values: cleanValues, signaturePaths: sigPaths, status: "signed", signedAt: signedAtIso });

  const allDone = e.signers.every((s) => s.optional || s.status === "signed");
  let folderLinkOut = "";
  const envPatch: Record<string, unknown> = { client_data: clientData, status: allDone ? "signed" : "partial" };

  if (allDone) {
    try {
      const pdfBuf = await generateSignedPdf(e as unknown as Parameters<typeof generateSignedPdf>[0]);
      let parentId = env("DRIVE_PARENT_FOLDER_ID");
      if (e.primaryClientUid) {
        const c = await getClientById(e.primaryClientUid);
        if (c?.drive_folder_id) parentId = c.drive_folder_id;
      }
      const names = e.signers.map((s) => s.name).join(" + ");
      const driveId = await uploadFile({ parentId, name: `הסכם חתום - ${e.templateName} - ${names}.pdf`, contentType: "application/pdf", data: pdfBuf });
      const signedPath = `contract-signed/${r.envelopeId}.pdf`;
      await saveFile(signedPath, pdfBuf, "application/pdf");
      await shareAnyoneReader(driveId).catch(() => {});
      folderLinkOut = `https://drive.google.com/file/d/${driveId}/view`;
      envPatch.signed_pdf_path = signedPath; envPatch.signed_drive_id = driveId; envPatch.signed_drive_link = folderLinkOut;

      const webhookUrl = env("MAKE_WEBHOOK_URL");
      if (webhookUrl) fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "contract_signed", templateName: e.templateName, signers: e.signers.map((s) => ({ name: s.name, signedAt: s.signedAt })), signedPdf: folderLinkOut }) }).catch(() => {});
    } catch (err) {
      console.error("signed pdf error", (err as Error).message);
    }
  }

  await supa().from("contract_envelopes").update(envPatch).eq("id", r.envelopeId);
  return NextResponse.json({ ok: true, completed: allDone, signedPdf: folderLinkOut });
}
