import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { env } from "@/lib/env";
import { verifyAdmin } from "@/lib/admin";
import { generateSignedPdf } from "@/lib/signedPdf";
import { uploadFile, deleteFile as driveDelete, shareAnyoneReader } from "@/lib/googleDrive";
import { saveFile } from "@/lib/storage";
import { getClientById } from "@/lib/clientsRepo";

export const runtime = "nodejs";
export const maxDuration = 300;

// הפקה מחדש של ה-PDF החתום — לכל המעטפות החתומות או למעטפה ספציפית
export async function POST(req: Request) {
  const secret = env("CRON_SECRET");
  const auth = req.headers.get("authorization") || "";
  const isSecret = !!secret && auth === `Bearer ${secret}`;
  const admin = isSecret ? { email: "system" } : await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const onlyId: string | undefined = body.envelopeId;

  const q = supa().from("contract_envelopes").select("*");
  const { data: envs } = onlyId ? await q.eq("id", onlyId) : await q.eq("status", "signed");
  const rows = (envs as Record<string, unknown>[]) || [];

  const results: string[] = [];
  for (const e of rows) {
    const id = e.id as string;
    if (e.status !== "signed") { results.push(`${id}: לא חתום, דילוג`); continue; }
    try {
      const { data: sgRows } = await supa().from("contract_signers").select("*").eq("envelope_id", id).order("signer_index", { ascending: true });
      const signers = ((sgRows as Record<string, unknown>[]) || []).map((s) => ({
        index: s.signer_index as number, role: (s.role as string) || "", name: (s.name as string) || "",
        signedAt: (s.signed_at as string) || null,
        values: (s.values as Record<string, string>) || {}, signaturePaths: (s.signature_paths as Record<string, string>) || {},
      }));
      const envLike = {
        storagePath: (e.storage_path as string) || "",
        fields: (e.fields as unknown) || [],
        senderValues: (e.sender_values as Record<string, string>) || {},
        clientData: (e.client_data as Record<string, string>) || {},
        signers,
      };
      const pdfBuf = await generateSignedPdf(envLike as unknown as Parameters<typeof generateSignedPdf>[0]);

      let parentId = env("DRIVE_PARENT_FOLDER_ID");
      if (e.primary_client_id) {
        const c = await getClientById(e.primary_client_id as string);
        if (c?.drive_folder_id) parentId = c.drive_folder_id;
      }
      const names = signers.map((s) => s.name).join(" + ");
      if (e.signed_drive_id) await driveDelete(e.signed_drive_id as string);
      const driveId = await uploadFile({ parentId, name: `הסכם חתום - ${e.template_name} - ${names}.pdf`, contentType: "application/pdf", data: pdfBuf });
      await saveFile(`contract-signed/${id}.pdf`, pdfBuf, "application/pdf");
      await shareAnyoneReader(driveId).catch(() => {});
      const link = `https://drive.google.com/file/d/${driveId}/view`;
      await supa().from("contract_envelopes").update({ signed_drive_id: driveId, signed_drive_link: link }).eq("id", id);
      results.push(`${e.template_name}: הופק מחדש ✓`);
    } catch (err) {
      results.push(`${id}: שגיאה — ${(err as Error).message}`);
    }
  }
  return NextResponse.json({ ok: true, results });
}
