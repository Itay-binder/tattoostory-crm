import { GoogleAuth } from "google-auth-library";

let cachedClient: Awaited<ReturnType<GoogleAuth["getClient"]>> | null = null;

async function driveClient() {
  if (cachedClient) return cachedClient;
  const sa = JSON.parse(Buffer.from((process.env.GOOGLE_SA_B64 || "").trim(), "base64").toString("utf8"));
  // Domain-wide delegation: פעולות הדרייב מתבצעות בשם המשתמש (קבצים בבעלותו, לא של חשבון השירות)
  const subject = (process.env.GOOGLE_IMPERSONATE_USER || "").trim() || undefined;
  const auth = new GoogleAuth({
    credentials: sa,
    scopes: ["https://www.googleapis.com/auth/drive"],
    clientOptions: subject ? { subject } : undefined,
  });
  cachedClient = await auth.getClient();
  return cachedClient;
}

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export async function findChildFolder(parentId: string, name: string): Promise<string | null> {
  const client = await driveClient();
  const q = `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false`;
  const r = await client.request<{ files: { id: string }[] }>({
    url: `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  });
  return r.data.files?.[0]?.id || null;
}

export async function createFolder(parentId: string, name: string): Promise<string> {
  const client = await driveClient();
  const r = await client.request<{ id: string }>({
    url: `${DRIVE}/files?supportsAllDrives=true`,
    method: "POST",
    data: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
  });
  return r.data.id;
}

/** העלאת קובץ (buffer) לדרייב. importAs מאפשר המרה ל-Google Doc וכו'. */
export async function uploadFile(opts: {
  parentId: string;
  name: string;
  contentType: string;
  data: Buffer;
  importAs?: string;
}): Promise<string> {
  const client = await driveClient();
  const metadata: Record<string, unknown> = { name: opts.name, parents: [opts.parentId] };
  if (opts.importAs) metadata.mimeType = opts.importAs;

  const boundary = "pc_finance_boundary_7391";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${opts.contentType}\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const body = Buffer.concat([head, opts.data, tail]);

  const r = await client.request<{ id: string }>({
    url: `${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id`,
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return r.data.id;
}

/** מעדכן את תוכן קובץ קיים (למשל HTML → Google Doc). שומר על אותו fileId ולינק. */
export async function updateFileContent(opts: {
  fileId: string;
  contentType: string;
  data: Buffer;
  importAs?: string;
  name?: string;
}): Promise<void> {
  const client = await driveClient();
  const metadata: Record<string, unknown> = {};
  if (opts.importAs) metadata.mimeType = opts.importAs;
  if (opts.name) metadata.name = opts.name;

  const boundary = "pc_finance_boundary_upd";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${opts.contentType}\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const body = Buffer.concat([head, opts.data, tail]);

  await client.request({
    url: `${UPLOAD}/files/${opts.fileId}?uploadType=multipart&supportsAllDrives=true&fields=id`,
    method: "PATCH",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
}

export async function exportFile(fileId: string, mimeType: string): Promise<Buffer> {
  const client = await driveClient();
  const r = await client.request<ArrayBuffer>({
    url: `${DRIVE}/files/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`,
    responseType: "arraybuffer",
  });
  return Buffer.from(r.data as ArrayBuffer);
}

export async function deleteFile(fileId: string): Promise<void> {
  const client = await driveClient();
  await client.request({ url: `${DRIVE}/files/${fileId}?supportsAllDrives=true`, method: "DELETE" }).catch(() => {});
}

/** הרשאת צפייה לכל מי שיש לו את הלינק */
export async function shareAnyoneReader(fileId: string): Promise<void> {
  const client = await driveClient();
  await client.request({
    url: `${DRIVE}/files/${fileId}/permissions?supportsAllDrives=true`,
    method: "POST",
    data: { role: "reader", type: "anyone" },
  });
}

export function folderLink(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}
