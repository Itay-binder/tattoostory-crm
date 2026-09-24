import { env } from "@/lib/env";
import { findChildFolder, createFolder, shareAnyoneReader, folderLink } from "@/lib/googleDrive";
import { getClientById, updateClientFields, type ClientRow } from "@/lib/clientsRepo";

/** שם התיקייה של לקוח — שם מלא + ת.ז אם יש, אחרת שם/מייל. */
export function clientFolderName(c: Pick<ClientRow, "answers" | "google_name" | "email" | "id">): string {
  const a = c.answers || {};
  const name = (a.fullName || c.google_name || c.email || "לקוח").trim();
  const id = (a.idNumber || "").trim();
  return (id ? `${name} - ${id}` : name).slice(0, 120) || "לקוח";
}

/**
 * מוודא שללקוח יש תיקיית דרייב — יוצר אם אין (בלי תלות בשאלון/קבצים).
 * מחזיר את מזהה התיקייה והלינק, או null אם הדרייב לא מוגדר.
 * בטוח לקריאה חוזרת: אם כבר קיימת — לא יוצר שוב.
 */
export async function ensureClientFolder(clientId: string): Promise<{ id: string; link: string } | null> {
  const parentId = env("DRIVE_PARENT_FOLDER_ID");
  if (!parentId) return null;

  const c = await getClientById(clientId);
  if (!c) return null;
  if (c.drive_folder_id) return { id: c.drive_folder_id, link: c.drive_folder_link || folderLink(c.drive_folder_id) };

  const name = clientFolderName(c);
  // שימוש חוזר בתיקייה קיימת בעלת אותו שם (אם נוצרה בעבר), אחרת יוצרים חדשה
  let folderId = await findChildFolder(parentId, name);
  if (!folderId) folderId = await createFolder(parentId, name);

  const link = folderLink(folderId);
  try { await shareAnyoneReader(folderId); } catch { /* לינק צפייה — לא קריטי אם נכשל */ }
  await updateClientFields(clientId, { drive_folder_id: folderId, drive_folder_link: link });
  return { id: folderId, link };
}
