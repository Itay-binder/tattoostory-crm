import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { supa } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

interface Contact { type: "lead" | "client"; id: string; name: string; phone: string; email: string; stage: string; tags: string[] }

// GET ?type=&q=&stage=&tag=&hasPhone=1 → אנשי קשר (לידים+לקוחות) מסוננים עם תגיות
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const u = new URL(req.url).searchParams;
  const type = u.get("type") || "all";
  const q = (u.get("q") || "").trim().toLowerCase();
  const stage = u.get("stage") || "";
  const tag = u.get("tag") || "";
  const hasPhone = u.get("hasPhone") === "1";

  const contacts: Contact[] = [];
  if (type === "all" || type === "lead") {
    const { data } = await supa().from("leads").select("id,full_name,phone,email,stage").limit(5000);
    for (const l of (data as { id: string; full_name: string | null; phone: string | null; email: string | null; stage: string }[]) || [])
      contacts.push({ type: "lead", id: l.id, name: l.full_name || "", phone: l.phone || "", email: l.email || "", stage: l.stage || "", tags: [] });
  }
  if (type === "all" || type === "client") {
    const { data } = await supa().from("clients").select("id,email,google_name,answers,stage").limit(5000);
    for (const c of (data as { id: string; email: string | null; google_name: string | null; answers: Record<string, string> | null; stage: string | null }[]) || [])
      contacts.push({ type: "client", id: c.id, name: c.answers?.fullName || c.google_name || "", phone: c.answers?.phone || "", email: c.email || "", stage: c.stage || "", tags: [] });
  }

  // תגיות
  const { data: ct } = await supa().from("mc_contact_tags").select("tag_id,contact_type,contact_id");
  const tagMap = new Map<string, string[]>();
  for (const r of (ct as { tag_id: string; contact_type: string; contact_id: string }[]) || []) {
    const k = `${r.contact_type}:${r.contact_id}`;
    tagMap.set(k, [...(tagMap.get(k) || []), r.tag_id]);
  }
  for (const c of contacts) c.tags = tagMap.get(`${c.type}:${c.id}`) || [];

  let out = contacts;
  if (hasPhone) out = out.filter((c) => c.phone);
  if (stage) out = out.filter((c) => c.stage === stage);
  if (tag) out = out.filter((c) => c.tags.includes(tag));
  if (q) out = out.filter((c) => `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q));

  const total = out.length;
  return NextResponse.json({ total, contacts: out.slice(0, 500) });
}

// POST { contact_type, contact_id, tag_id, action:"add"|"remove" }
export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const { contact_type, contact_id, tag_id, action } = b;
  if (!contact_type || !contact_id || !tag_id) return NextResponse.json({ error: "חסרים שדות" }, { status: 400 });
  if (action === "remove") {
    await supa().from("mc_contact_tags").delete().eq("tag_id", tag_id).eq("contact_type", contact_type).eq("contact_id", contact_id);
  } else {
    await supa().from("mc_contact_tags").upsert({ tag_id, contact_type, contact_id }, { onConflict: "tag_id,contact_type,contact_id" });
  }
  return NextResponse.json({ ok: true });
}

// PUT { tag_id, filter:{type,stage,hasPhone,q} } → תיוג המוני לכל הקהל המסונן
export async function PUT(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const tagId = b.tag_id;
  const ids: { contact_type: string; contact_id: string }[] = b.contacts || [];
  if (!tagId || !ids.length) return NextResponse.json({ error: "חסרים נתונים" }, { status: 400 });
  const rows = ids.map((c) => ({ tag_id: tagId, contact_type: c.contact_type, contact_id: c.contact_id }));
  await supa().from("mc_contact_tags").upsert(rows, { onConflict: "tag_id,contact_type,contact_id" });
  return NextResponse.json({ ok: true, tagged: rows.length });
}
