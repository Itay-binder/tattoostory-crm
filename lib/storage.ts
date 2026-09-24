import { supa } from "@/lib/supabaseAdmin";

// דלי אחד פרטי לכל הקבצים, עם אותם prefixes של Firebase:
// finance-form/, contract-templates/, contract-signatures/, contract-signed/
export const BUCKET = "files";

export async function downloadFile(path: string): Promise<Buffer> {
  const { data, error } = await supa().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(error?.message || "download failed");
  return Buffer.from(await data.arrayBuffer());
}

export async function saveFile(path: string, buf: Buffer, contentType: string): Promise<void> {
  const { error } = await supa().storage.from(BUCKET).upload(path, buf, { contentType, upsert: true });
  if (error) throw new Error(error.message);
}

/** URL זמני לקריאה (ברירת מחדל שעה). */
export async function signedReadUrl(path: string, expiresSec = 3600): Promise<string> {
  const { data, error } = await supa().storage.from(BUCKET).createSignedUrl(path, expiresSec);
  if (error || !data) throw new Error(error?.message || "sign read failed");
  return data.signedUrl;
}

/** URL חתום להעלאה ישירה מהדפדפן (PUT). */
export async function signedUploadUrl(path: string): Promise<{ uploadUrl: string; token: string; path: string }> {
  const { data, error } = await supa().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message || "sign upload failed");
  return { uploadUrl: data.signedUrl, token: data.token, path: data.path };
}

export async function fileExists(path: string): Promise<boolean> {
  const { data } = await supa().storage.from(BUCKET).createSignedUrl(path, 60);
  return !!data?.signedUrl;
}

export async function deleteFile(path: string): Promise<void> {
  await supa().storage.from(BUCKET).remove([path]).catch(() => {});
}
