// מודול מטא (Graph API) לסקשן מאניצ'אט — WABA + IG/FB.
// הטוקן (System User של פאוור קאפל) ב-env: PC_META_SYSTEM_TOKEN. עסק: PC_META_BUSINESS_ID.
import { supa } from "@/lib/supabaseAdmin";

const GRAPH = "https://graph.facebook.com/v21.0";

function token(): string {
  const t = process.env.PC_META_SYSTEM_TOKEN || "";
  if (!t) throw new Error("חסר PC_META_SYSTEM_TOKEN (טוקן מטא)");
  return t;
}
function businessId(): string {
  return process.env.PC_META_BUSINESS_ID || "228809944490505";
}

async function graph<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token() });
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const d = await res.json();
  if (!res.ok || d.error) throw new Error(d.error?.message || `Graph ${res.status}`);
  return d as T;
}

export interface WabaAccount { id: string; name: string }
export interface WabaPhone { id: string; display: string; name: string; quality?: string }

/** כל חשבונות ה-WABA שבבעלות העסק. */
export async function listWabas(): Promise<WabaAccount[]> {
  const d = await graph<{ data: { id: string; name: string }[] }>(`${businessId()}/owned_whatsapp_business_accounts`, { fields: "id,name", limit: "100" });
  return (d.data || []).map((w) => ({ id: w.id, name: w.name || w.id }));
}

/** מספרי הטלפון תחת חשבון WABA. */
export async function listPhoneNumbers(wabaId: string): Promise<WabaPhone[]> {
  const d = await graph<{ data: { id: string; display_phone_number: string; verified_name: string; quality_rating?: string }[] }>(
    `${wabaId}/phone_numbers`, { fields: "id,display_phone_number,verified_name,quality_rating", limit: "100" });
  return (d.data || []).map((p) => ({ id: p.id, display: p.display_phone_number, name: p.verified_name || "", quality: p.quality_rating }));
}

export interface FbPage { id: string; name: string; ig?: { id: string; username: string } | null }

/** עמודי פייסבוק בבעלות העסק + חשבון IG מחובר (אם יש). */
export async function listPages(): Promise<FbPage[]> {
  const d = await graph<{ data: { id: string; name: string; instagram_business_account?: { id: string; username?: string } }[] }>(
    `${businessId()}/owned_pages`, { fields: "id,name,instagram_business_account{id,username}", limit: "50" });
  return (d.data || []).map((p) => ({ id: p.id, name: p.name || p.id, ig: p.instagram_business_account ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username || "" } : null }));
}

export interface McSettings {
  waba_id: string | null; waba_name: string | null;
  phone_number_id: string | null; phone_display: string | null;
  ig_user_id: string | null; ig_username: string | null;
  fb_page_id: string | null; fb_page_name: string | null;
  connected_at: string | null; connected_by: string | null;
}

/** מחזיר את החיבור הנבחר (mc_settings). */
export async function getMcSettings(): Promise<McSettings> {
  const { data } = await supa().from("mc_settings").select("*").eq("id", 1).maybeSingle();
  return (data as McSettings) || {
    waba_id: null, waba_name: null, phone_number_id: null, phone_display: null,
    ig_user_id: null, ig_username: null, fb_page_id: null, fb_page_name: null, connected_at: null, connected_by: null,
  };
}

/** שומר בחירת חיבור. */
export async function saveMcSettings(patch: Partial<McSettings>, by: string): Promise<McSettings> {
  await supa().from("mc_settings").update({ ...patch, connected_at: new Date().toISOString(), connected_by: by, updated_at: new Date().toISOString() }).eq("id", 1);
  return getMcSettings();
}

// ── אינסטגרם / פייסבוק — אוטומציות תגובה→DM ──

/** מחזיר Page Access Token לעמוד (נדרש לפעולות פרטיות בפייסבוק). */
export async function getPageToken(pageId: string): Promise<string> {
  const d = await graph<{ access_token: string }>(`${pageId}`, { fields: "access_token" });
  return d.access_token;
}

/** תשובה פרטית (DM) למגיב בפוסט פייסבוק. */
export async function fbPrivateReply(pageId: string, commentId: string, message: string): Promise<void> {
  const pageToken = await getPageToken(pageId);
  const res = await fetch(`${GRAPH}/${commentId}/private_replies`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, access_token: pageToken }),
  });
  const d = await res.json();
  if (!res.ok || d.error) throw new Error(d.error?.message || `FB private reply ${res.status}`);
}

/** DM למגיב בפוסט אינסטגרם (private reply לפי comment_id). */
export async function igPrivateReply(igUserId: string, commentId: string, text: string): Promise<void> {
  const res = await fetch(`${GRAPH}/${igUserId}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
  });
  const d = await res.json();
  if (!res.ok || d.error) throw new Error(d.error?.message || `IG private reply ${res.status}`);
}

/** תגובה ציבורית לתגובה (אופציונלי — "עניתי לך בפרטי"). */
export async function fbReplyToComment(commentId: string, message: string): Promise<void> {
  await fetch(`${GRAPH}/${commentId}/comments`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ message }),
  }).catch(() => {});
}

/** מנוי העמוד/IG לאפליקציה (Webhooks). */
export async function subscribePageToApp(pageId: string): Promise<void> {
  const pageToken = await getPageToken(pageId);
  await fetch(`${GRAPH}/${pageId}/subscribed_apps`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscribed_fields: "feed,messages,messaging_postbacks", access_token: pageToken }),
  });
}

/** שליחת הודעת טקסט (session) ב-WABA — לתשובות ב-Inbox. */
export async function sendWabaText(phoneNumberId: string, to: string, text: string): Promise<string> {
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to: String(to).replace(/\D/g, ""), type: "text", text: { body: text } }),
  });
  const d = await res.json();
  if (!res.ok || d.error) throw new Error(d.error?.message || `WABA text ${res.status}`);
  return d.messages?.[0]?.id || "";
}

/** רשימת טמפלייטים מאושרים מחשבון WABA. */
export async function listTemplates(wabaId: string): Promise<{ name: string; status: string; category: string; language: string; components: unknown[] }[]> {
  const d = await graph<{ data: { name: string; status: string; category: string; language: string; components: unknown[] }[] }>(
    `${wabaId}/message_templates`, { fields: "name,status,category,language,components", limit: "200" });
  return d.data || [];
}

/** שולח הודעת טמפלייט WABA. (משמש בשלב השליחה/דיוור.) */
export async function sendTemplateMessage(phoneNumberId: string, to: string, templateName: string, language: string, components?: unknown[]): Promise<string> {
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to: String(to).replace(/\D/g, ""), type: "template",
      template: { name: templateName, language: { code: language }, ...(components ? { components } : {}) } }),
  });
  const d = await res.json();
  if (!res.ok || d.error) throw new Error(d.error?.message || `WABA send ${res.status}`);
  return d.messages?.[0]?.id || "";
}
