import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";
import { signedReadUrl, deleteFile } from "@/lib/storage";
import type { ContractField } from "@/lib/contracts";

export const runtime = "nodejs";

// GET — תבנית בודדת + URL חתום לצפייה ב-PDF
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;
  const { data: r } = await supa().from("contract_templates").select("*").eq("id", id).maybeSingle();
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  const d = r as Record<string, unknown>;
  let pdfUrl = "";
  try { pdfUrl = await signedReadUrl(d.storage_path as string); } catch { /* ignore */ }
  return NextResponse.json({
    id, name: d.name, storagePath: d.storage_path, pageCount: d.page_count,
    signerCount: d.signer_count, fields: d.fields || [], createdAt: d.created_at, pdfUrl,
  });
}

// PUT — עדכון שדות / שם
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const update: Record<string, unknown> = {};
  if (Array.isArray(body.fields)) {
    update.fields = (body.fields as ContractField[]).map((f) => ({
      id: String(f.id), page: Number(f.page) || 0,
      x: Number(f.x), y: Number(f.y), w: Number(f.w), h: Number(f.h),
      type: f.type, label: String(f.label || "").slice(0, 120), source: f.source, required: !!f.required,
    }));
  }
  if (typeof body.name === "string") update.name = body.name.slice(0, 200);
  if (typeof body.signerCount === "number") update.signer_count = Math.max(1, Math.min(6, body.signerCount));
  if (Object.keys(update).length) await supa().from("contract_templates").update(update).eq("id", id);
  return NextResponse.json({ ok: true });
}

// DELETE — מחיקת תבנית + ה-PDF
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;
  const { data: r } = await supa().from("contract_templates").select("storage_path").eq("id", id).maybeSingle();
  if (r) {
    await deleteFile((r as { storage_path: string }).storage_path);
    await supa().from("contract_templates").delete().eq("id", id);
  }
  return NextResponse.json({ ok: true });
}
