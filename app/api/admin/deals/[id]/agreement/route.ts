import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { getDeal, setSaleAgreementFile } from "@/lib/dealsRepo";
import { signedUploadUrl, signedReadUrl, fileExists, deleteFile } from "@/lib/storage";

export const runtime = "nodejs";

const MAX_SIZE = 50 * 1024 * 1024; // 50MB

// העלאת הסכם מכר (PDF) — זרימת signed URL. ההסכם מצורף אוטומטית למסמכי כל הלקוחות המשובצים לעסקה.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;
  const deal = await getDeal(id);
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  if (action === "sign") {
    const { fileName, contentType, size } = body;
    if (contentType && contentType !== "application/pdf") return NextResponse.json({ error: "נדרש קובץ PDF" }, { status: 400 });
    if (typeof size === "number" && size > MAX_SIZE) return NextResponse.json({ error: "הקובץ גדול מדי (מקסימום 50MB)" }, { status: 400 });
    const path = `deals/${id}/sale-agreement-${Date.now()}.pdf`;
    try {
      const { uploadUrl } = await signedUploadUrl(path);
      return NextResponse.json({ uploadUrl, path, fileName: fileName || "הסכם מכר.pdf" });
    } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
  }

  if (action === "complete") {
    const path = String(body.path || "");
    if (!path.startsWith(`deals/${id}/`)) return NextResponse.json({ error: "נתיב לא תקין" }, { status: 400 });
    if (!(await fileExists(path))) return NextResponse.json({ error: "הקובץ לא נמצא באחסון" }, { status: 400 });
    if (deal.saleAgreementFile && deal.saleAgreementFile !== path) { try { await deleteFile(deal.saleAgreementFile); } catch { /* */ } }
    const updated = await setSaleAgreementFile(id, path, String(body.fileName || "הסכם מכר.pdf").slice(0, 200), admin.name || admin.email);
    const url = await signedReadUrl(path, 3600).catch(() => null);
    return NextResponse.json({ ok: true, deal: updated, saleAgreementFileUrl: url });
  }

  if (action === "delete") {
    if (deal.saleAgreementFile) { try { await deleteFile(deal.saleAgreementFile); } catch { /* */ } }
    const updated = await setSaleAgreementFile(id, null, null, admin.name || admin.email);
    return NextResponse.json({ ok: true, deal: updated });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
