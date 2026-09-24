import { randomUUID } from "crypto";
import { supa } from "@/lib/supabaseAdmin";
import { normalizeEmail } from "@/lib/leads";
import type { UploadedFile } from "@/lib/formSchema";

const nowIso = () => new Date().toISOString();

export interface ClientRow {
  id: string;
  auth_user_id: string | null;
  email: string | null;
  google_name: string;
  status: string;
  answers: Record<string, string>;
  drive_folder_id: string | null;
  drive_folder_link: string | null;
  from_lead_id: string | null;
  from_lead_source: string | null;
  converted_by_email: string | null;
  converted_by_name: string | null;
  converted_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  /** שלב הלקוח בתהליך. העמודה קיימת ב-DB ובשימוש ב-/api/admin/client/[uid]. */
  stage: string | null;
}

export interface ClientFileRow {
  id: string;
  client_id: string;
  category: string;
  name: string;
  size: number;
  content_type: string | null;
  storage_path: string;
  drive_file_id: string | null;
  uploaded_at: string;
}

export async function getClientById(id: string): Promise<ClientRow | null> {
  const { data } = await supa().from("clients").select("*").eq("id", id).maybeSingle();
  return (data as ClientRow) || null;
}

export async function getClientByEmail(email: string): Promise<ClientRow | null> {
  const key = normalizeEmail(email);
  if (!key) return null;
  const { data } = await supa().from("clients").select("*").eq("email_key", key).order("created_at", { ascending: true }).limit(1);
  return data && data.length ? (data[0] as ClientRow) : null;
}

/** מוצא לקוח לפי מייל, ואם אין — יוצר חדש עבור המשתמש המחובר. */
export async function getOrCreateClient(user: { uid?: string; email: string; name?: string }): Promise<ClientRow> {
  const existing = await getClientByEmail(user.email);
  if (existing) {
    // עדכון עדין של auth_user_id/שם אם השתנו
    if ((user.uid && existing.auth_user_id !== user.uid) || (user.name && existing.google_name !== user.name)) {
      await supa().from("clients").update({ auth_user_id: user.uid || existing.auth_user_id, google_name: user.name || existing.google_name, updated_at: nowIso() }).eq("id", existing.id);
    }
    return (await getClientById(existing.id))!;
  }
  const id = randomUUID();
  const now = nowIso();
  const { data, error } = await supa().from("clients").insert({
    id, auth_user_id: user.uid || null, email: user.email || null, google_name: user.name || "",
    status: "draft", answers: {}, created_at: now, updated_at: now,
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data as ClientRow;
}

export async function saveClientAnswers(id: string, answers: Record<string, string>, user: { email: string; name?: string }): Promise<void> {
  await supa().from("clients").update({
    answers, email: user.email || null, google_name: user.name || "", updated_at: nowIso(),
  }).eq("id", id);
}

export async function markSubmitted(id: string): Promise<void> {
  const now = nowIso();
  await supa().from("clients").update({ status: "submitted", submitted_at: now, updated_at: now }).eq("id", id);
}

export async function listClientFiles(clientId: string): Promise<ClientFileRow[]> {
  const { data } = await supa().from("client_files").select("*").eq("client_id", clientId).order("uploaded_at", { ascending: true });
  return (data as ClientFileRow[]) || [];
}

export function fileRowToUploaded(f: ClientFileRow): UploadedFile {
  return { category: f.category, name: f.name, size: f.size || 0, contentType: f.content_type || "application/octet-stream", storagePath: f.storage_path, uploadedAt: f.uploaded_at, driveFileId: f.drive_file_id || undefined };
}

export async function addClientFile(clientId: string, f: Omit<ClientFileRow, "id" | "client_id" | "uploaded_at"> & { uploaded_at?: string }): Promise<void> {
  await supa().from("client_files").insert({
    client_id: clientId, category: f.category, name: f.name, size: f.size || 0,
    content_type: f.content_type || null, storage_path: f.storage_path, drive_file_id: f.drive_file_id || null,
    uploaded_at: f.uploaded_at || nowIso(),
  });
  await supa().from("clients").update({ updated_at: nowIso() }).eq("id", clientId);
}

export async function updateClientFields(id: string, patch: Record<string, unknown>): Promise<void> {
  await supa().from("clients").update({ ...patch, updated_at: nowIso() }).eq("id", id);
}

export async function setClientFileDriveId(clientId: string, storagePath: string, driveId: string): Promise<void> {
  await supa().from("client_files").update({ drive_file_id: driveId }).eq("client_id", clientId).eq("storage_path", storagePath);
}

export async function removeClientFileByPath(clientId: string, storagePath: string): Promise<void> {
  await supa().from("client_files").delete().eq("client_id", clientId).eq("storage_path", storagePath);
  await supa().from("clients").update({ updated_at: nowIso() }).eq("id", clientId);
}

/** נתיב אחסון בטוח (ASCII) — Supabase Storage לא מקבל עברית/תווי בקרה במפתח. */
export function safeStorageName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext = (dot >= 0 ? fileName.slice(dot) : "").replace(/[^A-Za-z0-9.]+/g, "");
  let base = (dot >= 0 ? fileName.slice(0, dot) : fileName).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!base || base.replace(/[_.-]/g, "").length < 2) base = "file_" + randomUUID().slice(0, 8);
  return base.slice(0, 80) + ext;
}
