import { randomUUID } from "crypto";
import { supa } from "@/lib/supabaseAdmin";
import { env } from "@/lib/env";
import { createFolder, shareAnyoneReader, folderLink } from "@/lib/googleDrive";

/**
 * יצירת "לקוח ידני" — רשומת לקוח לאדם שלא התחבר/מילא שאלון (למשל חותם על הסכם).
 * נפתחת לו תיקיית דרייב והוא מופיע בניהול הלקוחות.
 */
export async function createManualClient(name: string, contact?: string): Promise<{ id: string; driveFolderId: string; driveFolderLink: string }> {
  const id = randomUUID();
  const safeName = (name || "לקוח").trim().slice(0, 120);

  let driveFolderId = "";
  let driveFolderLink = "";
  try {
    const parent = env("DRIVE_PARENT_FOLDER_ID");
    driveFolderId = await createFolder(parent, `${safeName} - ${id.slice(0, 8)}`);
    await shareAnyoneReader(driveFolderId).catch(() => {});
    driveFolderLink = folderLink(driveFolderId);
  } catch {
    /* תיקיית דרייב אופציונלית */
  }

  const now = new Date().toISOString();
  await supa().from("clients").insert({
    id,
    answers: { fullName: safeName, phone: contact ? String(contact).slice(0, 60) : "" },
    email: null,
    google_name: "",
    status: "manual",
    drive_folder_id: driveFolderId || null,
    drive_folder_link: driveFolderLink || null,
    created_at: now,
    updated_at: now,
  });

  return { id, driveFolderId, driveFolderLink };
}
