import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { listWabas, listPhoneNumbers, listPages, getMcSettings, saveMcSettings } from "@/lib/metaGraph";

export const runtime = "nodejs";

// GET → { settings, wabas }  |  GET ?waba=<id> → { phones }
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const waba = new URL(req.url).searchParams.get("waba");
  try {
    if (waba) return NextResponse.json({ phones: await listPhoneNumbers(waba) });
    const [settings, wabas, pages] = await Promise.all([getMcSettings(), listWabas(), listPages().catch(() => [])]);
    return NextResponse.json({ settings, wabas, pages });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

// POST { waba_id, waba_name, phone_number_id, phone_display } → שמירת החיבור
export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  // שמירה חלקית — רק השדות שנשלחו (מאפשר לשמור WABA ו-IG/FB בנפרד)
  const patch: Record<string, string | null> = {};
  for (const k of ["waba_id", "waba_name", "phone_number_id", "phone_display", "fb_page_id", "fb_page_name", "ig_user_id", "ig_username"]) {
    if (k in b) patch[k] = b[k] || null;
  }
  try {
    const settings = await saveMcSettings(patch, admin.name || admin.email);
    return NextResponse.json({ ok: true, settings });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
