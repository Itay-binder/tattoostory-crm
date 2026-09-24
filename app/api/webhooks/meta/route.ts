import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { getMcSettings, igPrivateReply, fbPrivateReply, fbReplyToComment } from "@/lib/metaGraph";

export const runtime = "nodejs";

// אימות Webhook של מטא (GET) — מחזיר את hub.challenge אם ה-verify token תואם.
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const verify = process.env.META_WEBHOOK_VERIFY_TOKEN || "";
  if (u.get("hub.mode") === "subscribe" && u.get("hub.verify_token") === verify) {
    return new Response(u.get("hub.challenge") || "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

interface Automation { id: string; channel: string; enabled: boolean; trigger: { postId?: string; keywords?: string[]; matchType?: string }; action: { dmText: string; publicReply?: string }; stats?: Record<string, number> }

function matches(text: string, t: Automation["trigger"]): boolean {
  const kws = (t.keywords || []).map((k) => k.toLowerCase().trim()).filter(Boolean);
  if (!kws.length) return true; // בלי מילות מפתch — כל תגובה
  const low = (text || "").toLowerCase();
  if (t.matchType === "exact") return kws.includes(low.trim());
  if (t.matchType === "all") return kws.every((k) => low.includes(k));
  return kws.some((k) => low.includes(k)); // any
}

async function bumpStat(id: string, key: string, cur: Record<string, number> = {}) {
  await supa().from("mc_automations").update({ stats: { ...cur, [key]: (cur[key] || 0) + 1 } }).eq("id", id);
}

// קליטת אירועים (POST) — תגובות IG/FB → DM, והודעות WABA נכנסות → Inbox.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const settings = await getMcSettings();
    const { data: autosRaw } = await supa().from("mc_automations").select("*").eq("enabled", true);
    const autos = (autosRaw as Automation[]) || [];

    for (const entry of body.entry || []) {
      // ── אינסטגרם ──
      for (const ch of entry.changes || []) {
        if (ch.field === "comments" && ch.value) {
          const v = ch.value; const commentId = v.id; const text = v.text || ""; const mediaId = v.media?.id || "";
          for (const a of autos.filter((x) => x.channel === "ig")) {
            if (a.trigger.postId && a.trigger.postId !== mediaId) continue;
            if (!matches(text, a.trigger)) continue;
            if (settings.ig_user_id) {
              try { await igPrivateReply(settings.ig_user_id, commentId, a.action.dmText); await bumpStat(a.id, "sent", a.stats); } catch { await bumpStat(a.id, "failed", a.stats); }
            }
          }
        }
        // ── פייסבוק (feed comment) ──
        if (ch.field === "feed" && ch.value?.item === "comment" && ch.value?.verb === "add") {
          const v = ch.value; const commentId = v.comment_id; const text = v.message || ""; const postId = v.post_id || "";
          for (const a of autos.filter((x) => x.channel === "fb")) {
            if (a.trigger.postId && !postId.includes(a.trigger.postId)) continue;
            if (!matches(text, a.trigger)) continue;
            if (settings.fb_page_id) {
              try {
                await fbPrivateReply(settings.fb_page_id, commentId, a.action.dmText);
                if (a.action.publicReply) await fbReplyToComment(commentId, a.action.publicReply);
                await bumpStat(a.id, "sent", a.stats);
              } catch { await bumpStat(a.id, "failed", a.stats); }
            }
          }
        }
        // ── WABA הודעות נכנסות → Inbox ──
        if (ch.field === "messages" && ch.value?.messages) {
          for (const m of ch.value.messages) {
            const from = m.from; const text = m.text?.body || `[${m.type}]`;
            const contact = (ch.value.contacts || [])[0];
            const name = contact?.profile?.name || from;
            const { data: conv } = await supa().from("mc_conversations").upsert(
              { channel: "wa", external_id: from, name, phone: from, last_message_at: new Date().toISOString(), last_text: text },
              { onConflict: "channel,external_id" }).select("id").single();
            if (conv) {
              await supa().from("mc_messages").insert({ conversation_id: (conv as { id: string }).id, direction: "in", type: m.type || "text", text, wamid: m.id, at: new Date().toISOString() });
            }
          }
        }
      }
    }
  } catch { /* לא מחזירים שגיאה למטא כדי שלא ינסה שוב אינסופית */ }
  return NextResponse.json({ received: true });
}
