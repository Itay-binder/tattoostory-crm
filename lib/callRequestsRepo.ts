import { supa } from "@/lib/supabaseAdmin";
import { env } from "@/lib/env";
import type { CallRequest } from "@/lib/leads";

const nowIso = () => new Date().toISOString();

/**
 * מזניק את הסנכרון של PHONECRM מיד (RPC), כדי שהפלאפון יצלצל תוך שניות
 * במקום להמתין ל-cron של הדקה. אם נכשל — ה-cron יאסוף בכל מקרה.
 */
async function fireTrigger(): Promise<void> {
  const url = env("PHONECRM_SUPABASE_URL");
  const key = env("PHONECRM_ANON_KEY");
  if (!url || !key) return; // לא מוגדר — נשענים על ה-cron (עד דקה)
  try {
    await fetch(`${url}/rest/v1/rpc/request_call_now`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* לא חוסמים — ה-cron יאסוף */ }
}

interface CallRow {
  id: string; lead_id: string; lead_name: string | null; lead_phone: string;
  requested_by_email: string; requested_by_name: string | null; device_id: string | null;
  status: string; note: string | null; created_at: string; updated_at: string;
}

function rowTo(r: CallRow): CallRequest {
  return {
    id: r.id, leadId: r.lead_id, leadName: r.lead_name || "", leadPhone: r.lead_phone,
    requestedByEmail: r.requested_by_email, requestedByName: r.requested_by_name || "",
    deviceId: r.device_id || undefined, status: r.status, note: r.note || undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** יוצר בקשת חיוג חדשה. מבטל בקשות pending ישנות לאותו ליד קודם. */
export async function createCallRequest(input: {
  leadId: string; leadName: string; leadPhone: string; byEmail: string; byName: string; deviceId?: string;
}): Promise<CallRequest> {
  // מבטל בקשות ממתינות קודמות לאותו ליד — שלא יצטברו
  await supa().from("call_requests").update({ status: "canceled", updated_at: nowIso() })
    .eq("lead_id", input.leadId).eq("status", "pending");
  const { data, error } = await supa().from("call_requests").insert({
    lead_id: input.leadId, lead_name: input.leadName, lead_phone: input.leadPhone,
    requested_by_email: input.byEmail, requested_by_name: input.byName, device_id: input.deviceId || null,
    status: "pending",
  }).select("*").single();
  if (error) throw new Error(error.message);
  const req = rowTo(data as CallRow);
  // 1) מסנכרן מיד לענן של PHONECRM (כדי שהאפליקציה תוכל לעדכן סטטוס)
  await fireTrigger();
  // 2) שולח פוש למכשיר של הנציג — הצלצול המיידי
  const { pushCallRequest } = await import("@/lib/fcm");
  const sent = await pushCallRequest(req).catch(() => 0);
  return { ...req, note: sent ? undefined : "no_device" };
}

const ACTIVE = ["pending", "approved", "dialing"];
const PENDING_TTL_MIN = 5;   // בקשה שממתינה יותר מזה — פגה (הפלאפון לא יחייג ליד ישן)
const RESULT_TTL_MIN = 2;    // תוצאה (נדחה/בוצע) מוצגת רק לזמן קצר ואז נעלמת

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/**
 * בקשת החיוג הפעילה לליד. בקשות ישנות פגות ולא מוצגות —
 * כדי שהכרטיס לא ייתקע עם בקשה שלא רלוונטית יותר.
 */
export async function getLatestCallRequest(leadId: string): Promise<CallRequest | null> {
  // ניקוי עצמי: בקשה שממתינה יותר מדי זמן — פגה
  await supa().from("call_requests")
    .update({ status: "expired", updated_at: nowIso() })
    .eq("lead_id", leadId).eq("status", "pending").lt("created_at", minutesAgo(PENDING_TTL_MIN));

  const { data } = await supa().from("call_requests").select("*")
    .eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1);
  if (!data?.length) return null;

  const r = rowTo(data[0] as CallRow);
  const active = ACTIVE.includes(r.status) && r.createdAt > minutesAgo(PENDING_TTL_MIN + 5);
  const freshResult = !ACTIVE.includes(r.status) && r.updatedAt > minutesAgo(RESULT_TTL_MIN);
  return active || freshResult ? r : null;
}

/** מבטל בקשת חיוג ממתינה. */
export async function cancelCallRequest(id: string): Promise<void> {
  await supa().from("call_requests").update({ status: "canceled", updated_at: nowIso() }).eq("id", id).eq("status", "pending");
}
