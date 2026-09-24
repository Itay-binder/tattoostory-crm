import { NextResponse } from "next/server";
import { verifyRequest } from "@/lib/firebaseAdmin";
import { FILE_CATEGORIES } from "@/lib/formSchema";
import { getOrCreateClient, addClientFile, removeClientFileByPath, listClientFiles, fileRowToUploaded, safeStorageName } from "@/lib/clientsRepo";
import { signedUploadUrl, fileExists, deleteFile } from "@/lib/storage";

export const runtime = "nodejs";

const MAX_SIZE = 50 * 1024 * 1024; // 50MB לקובץ

// action: "sign" — URL חתום להעלאה ישירה ל-Storage
// action: "complete" — רישום הקובץ אחרי העלאה מוצלחת
// action: "delete" — מחיקת קובץ
export async function POST(req: Request) {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const c = await getOrCreateClient(user);
  const prefix = `finance-form/${c.id}/`;

  const body = await req.json();
  const action = body?.action;

  if (action === "sign") {
    const { category, fileName, contentType, size } = body;
    if (!FILE_CATEGORIES.some((x) => x.key === category)) return NextResponse.json({ error: "bad category" }, { status: 400 });
    if (!fileName || !contentType || typeof size !== "number" || size <= 0 || size > MAX_SIZE) {
      return NextResponse.json({ error: "קובץ גדול מ-50MB או פרטים חסרים" }, { status: 400 });
    }
    const storagePath = `${prefix}${category}/${Date.now()}_${safeStorageName(fileName)}`;
    try {
      const { uploadUrl } = await signedUploadUrl(storagePath);
      return NextResponse.json({ uploadUrl, storagePath });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (action === "complete") {
    const { category, fileName, contentType, size, storagePath } = body;
    if (!storagePath?.startsWith(prefix)) return NextResponse.json({ error: "bad path" }, { status: 400 });
    if (!(await fileExists(storagePath))) return NextResponse.json({ error: "הקובץ לא נמצא באחסון" }, { status: 400 });
    const name = String(fileName || "קובץ").slice(0, 200);
    await addClientFile(c.id, { category, name, size: size || 0, content_type: contentType || null, storage_path: storagePath, drive_file_id: null });
    const files = (await listClientFiles(c.id)).map(fileRowToUploaded);
    const file = files.find((f) => f.storagePath === storagePath);
    return NextResponse.json({ ok: true, file });
  }

  if (action === "delete") {
    const { storagePath } = body;
    if (!storagePath?.startsWith(prefix)) return NextResponse.json({ error: "bad path" }, { status: 400 });
    await removeClientFileByPath(c.id, storagePath);
    await deleteFile(storagePath);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
