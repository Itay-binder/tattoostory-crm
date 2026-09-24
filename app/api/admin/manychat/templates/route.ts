import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { getMcSettings, listTemplates } from "@/lib/metaGraph";

export const runtime = "nodejs";

// GET → טמפלייטים מאושרים מחשבון ה-WABA המחובר
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const settings = await getMcSettings();
  if (!settings.waba_id) return NextResponse.json({ needsWaba: true, templates: [] });
  try {
    const templates = await listTemplates(settings.waba_id);
    return NextResponse.json({ templates });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, templates: [] }, { status: 502 });
  }
}
