import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { supa } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

// GET → רשימת תגיות עם מונה אנשי קשר
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { data: tags } = await supa().from("mc_tags").select("*").order("created_at", { ascending: true });
  const { data: counts } = await supa().from("mc_contact_tags").select("tag_id");
  const byTag: Record<string, number> = {};
  for (const r of (counts as { tag_id: string }[]) || []) byTag[r.tag_id] = (byTag[r.tag_id] || 0) + 1;
  return NextResponse.json({ tags: ((tags as { id: string }[]) || []).map((t) => ({ ...t, count: byTag[t.id] || 0 })) });
}

// POST { name, color } → יצירת תגית
export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const name = String(b.name || "").trim();
  if (!name) return NextResponse.json({ error: "חסר שם" }, { status: 400 });
  const { data, error } = await supa().from("mc_tags").insert({ name, color: b.color || "#ff3b3b" }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, tag: data });
}

// DELETE ?id= → מחיקת תגית
export async function DELETE(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "חסר id" }, { status: 400 });
  await supa().from("mc_tags").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
