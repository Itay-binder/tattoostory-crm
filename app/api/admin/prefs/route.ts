import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";

export const runtime = "nodejs";

const THEMES = ["dark", "light"];

// GET — העדפות המנהל המחובר (ערכת נושא)
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { data } = await supa().from("admins").select("theme").eq("email", admin.email.toLowerCase()).maybeSingle();
  return NextResponse.json({ theme: (data as { theme?: string } | null)?.theme || "dark" });
}

// POST — שמירת ערכת נושא לחשבון (נשמרת בין מכשירים והתחברויות)
export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const theme = String(body.theme || "");
  if (!THEMES.includes(theme)) return NextResponse.json({ error: "ערכה לא תקינה" }, { status: 400 });
  const email = admin.email.toLowerCase();
  const { error } = await supa().from("admins").upsert({ email, theme }, { onConflict: "email" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, theme });
}
