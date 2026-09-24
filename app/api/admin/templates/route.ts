import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";
import { signedUploadUrl, fileExists } from "@/lib/storage";

export const runtime = "nodejs";

function rowToTemplate(r: Record<string, unknown>) {
  return {
    id: r.id as string,
    name: (r.name as string) || "",
    storagePath: (r.storage_path as string) || "",
    pageCount: (r.page_count as number) || 1,
    signerCount: (r.signer_count as number) || 1,
    fields: (r.fields as unknown[]) || [],
    createdAt: (r.created_at as string) || "",
  };
}

// GET — רשימת תבניות
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { data } = await supa().from("contract_templates").select("*").order("created_at", { ascending: false });
  return NextResponse.json({ templates: ((data as Record<string, unknown>[]) || []).map(rowToTemplate) });
}

// POST — שלב א': URL חתום להעלאת PDF; שלב ב': יצירת התבנית אחרי העלאה
export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const body = await req.json();

  if (body.action === "sign-upload") {
    const id = randomUUID();
    const storagePath = `contract-templates/${id}.pdf`;
    try { const { uploadUrl } = await signedUploadUrl(storagePath); return NextResponse.json({ id, storagePath, uploadUrl }); }
    catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
  }

  if (body.action === "create") {
    const { id, name, storagePath, pageCount } = body;
    if (!id || !name || !storagePath) return NextResponse.json({ error: "missing fields" }, { status: 400 });
    if (!(await fileExists(storagePath))) return NextResponse.json({ error: "PDF לא הועלה" }, { status: 400 });
    await supa().from("contract_templates").insert({
      id, name: String(name).slice(0, 200), storage_path: storagePath,
      page_count: Number(pageCount) || 1, signer_count: 1, fields: [],
    });
    return NextResponse.json({ ok: true, id });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
