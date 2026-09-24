import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { supa } from "@/lib/supabaseAdmin";
import { getMcSettings, sendWabaText } from "@/lib/metaGraph";

export const runtime = "nodejs";

// GET → רשימת שיחות | GET ?id= → הודעות בשיחה
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const { data: msgs } = await supa().from("mc_messages").select("*").eq("conversation_id", id).order("at", { ascending: true });
    await supa().from("mc_conversations").update({ unread: 0 }).eq("id", id);
    return NextResponse.json({ messages: msgs || [] });
  }
  const { data } = await supa().from("mc_conversations").select("*").order("last_message_at", { ascending: false }).limit(200);
  return NextResponse.json({ conversations: data || [] });
}

// POST { conversation_id, text } → שליחת תשובה (WABA session)
export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const { data: conv } = await supa().from("mc_conversations").select("*").eq("id", b.conversation_id).single();
  const c = conv as { id: string; channel: string; phone: string | null; external_id: string } | null;
  if (!c) return NextResponse.json({ error: "שיחה לא נמצאה" }, { status: 404 });
  const text = String(b.text || "").trim();
  if (!text) return NextResponse.json({ error: "הודעה ריקה" }, { status: 400 });

  if (c.channel !== "wa") return NextResponse.json({ error: "תשובות נתמכות כרגע רק ב-WABA" }, { status: 400 });
  const settings = await getMcSettings();
  if (!settings.phone_number_id) return NextResponse.json({ error: "לא מחובר מספר WABA" }, { status: 400 });
  try {
    const wamid = await sendWabaText(settings.phone_number_id, c.phone || c.external_id, text);
    await supa().from("mc_messages").insert({ conversation_id: c.id, direction: "out", type: "text", text, wamid, at: new Date().toISOString() });
    await supa().from("mc_conversations").update({ last_message_at: new Date().toISOString(), last_text: text }).eq("id", c.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
