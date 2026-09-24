import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;

  const { data, error } = await supa()
    .from("leads")
    .select(`*, contacts(*), notes(*, author_id)`)
    .eq("id", id)
    .single();

  if (error || !data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ lead: data });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const allowed = ["status", "stage", "assignee_id"];
  const updates: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) updates[k] = body[k];
  if (!Object.keys(updates).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  updates.updated_at = new Date().toISOString();
  updates.last_activity_at = updates.updated_at;

  const { data, error } = await supa().from("leads").update(updates).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, lead: data });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  if (body.action === "add-note") {
    const text = String(body.text || "").trim();
    if (!text) return NextResponse.json({ error: "הערה ריקה" }, { status: 400 });

    const { data: user } = await supa().from("users").select("id").eq("email", admin.email).single();
    const { data: note, error } = await supa()
      .from("notes")
      .insert({ contact_id: body.contact_id, body: text.slice(0, 5000), author_id: user?.id || null })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await supa().from("leads").update({ last_activity_at: new Date().toISOString() }).eq("id", id);
    return NextResponse.json({ ok: true, note });
  }

  if (body.action === "delete-lead") {
    if (String(body.confirm) !== "DELETE") return NextResponse.json({ error: "נדרש אישור" }, { status: 400 });
    const { error } = await supa().from("leads").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;
  const { error } = await supa().from("leads").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
