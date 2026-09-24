import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { supa } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { data } = await supa().from("mc_automations").select("*").order("created_at", { ascending: false });
  return NextResponse.json({ automations: data || [] });
}

export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  if (!b.channel || !b.action?.dmText) return NextResponse.json({ error: "חסר ערוץ או טקסט DM" }, { status: 400 });
  const { data, error } = await supa().from("mc_automations").insert({
    name: b.name || "אוטומציה", channel: b.channel,
    trigger: b.trigger || { keywords: [], matchType: "any", postId: "" },
    action: b.action, enabled: b.enabled !== false, created_by: admin.name || admin.email,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, automation: data });
}

export async function PATCH(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  const b = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "חסר id" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  for (const k of ["name", "channel", "trigger", "action", "enabled"]) if (k in b) patch[k] = b[k];
  const { data, error } = await supa().from("mc_automations").update(patch).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, automation: data });
}

export async function DELETE(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "חסר id" }, { status: 400 });
  await supa().from("mc_automations").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
