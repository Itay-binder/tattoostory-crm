import { env } from "@/lib/env";

// נתוני ביצועים ממטא (Graph API) לחשבון המודעות של Tattoo Story.
// מחזיר סיכום חשבון + שורה לכל קמפיין שהוציא תקציב בטווח המבוקש.
const GRAPH = "https://graph.facebook.com/v21.0";

export interface MetaCampaign {
  id: string;
  name: string;
  objective: string;        // תווית בעברית
  objectiveRaw: string;
  status: string;           // effective_status מהחשבון (ACTIVE / PAUSED / …)
  statusLabel: string;
  spend: number;
  impressions: number;      // חשיפות
  reach: number;            // תפוצה (אנשים ייחודיים)
  frequency: number;
  clicks: number;
  linkClicks: number;       // קליקים על קישור
  ctr: number;
  cpc: number;
  cpm: number;
  leads: number;            // לידים מהקמפיין (רק בקמפייני לידים)
  costPerLead: number;
  landingPageViews: number;
}

export interface MetaData {
  account: string;
  currency: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  ctr: number;
  cpc: number;
  leads: number;
  costPerLead: number;
  campaigns: MetaCampaign[];
}

const num = (v: unknown) => Number(v || 0);

/** סכימת פעולות מטא לפי סוג. מטא מחזיר מערך של {action_type, value}. */
function actionSum(actions: unknown, types: string[]): number {
  if (!Array.isArray(actions)) return 0;
  let best = 0;
  for (const t of types) {
    const hit = (actions as { action_type?: string; value?: string }[]).find((a) => a.action_type === t);
    if (hit) best = Math.max(best, num(hit.value));   // סוגים שונים מדווחים על אותו ליד — לוקחים את הגבוה
  }
  return best;
}

const LEAD_ACTIONS = ["lead", "offsite_conversion.fb_pixel_lead", "onsite_web_lead", "leadgen_grouped"];

const OBJ_LABEL: Record<string, string> = {
  OUTCOME_LEADS: "לידים",
  LEAD_GENERATION: "לידים",
  OUTCOME_TRAFFIC: "תנועה",
  LINK_CLICKS: "תנועה",
  OUTCOME_ENGAGEMENT: "מעורבות",
  POST_ENGAGEMENT: "מעורבות",
  OUTCOME_AWARENESS: "מודעות",
  BRAND_AWARENESS: "מודעות",
  REACH: "תפוצה",
  OUTCOME_SALES: "מכירות",
  CONVERSIONS: "המרות",
  VIDEO_VIEWS: "צפיות בסרטון",
};
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "פעיל",
  PAUSED: "מושהה",
  CAMPAIGN_PAUSED: "מושהה",
  ADSET_PAUSED: "סדרה מושהית",
  ARCHIVED: "בארכיון",
  DELETED: "נמחק",
  IN_PROCESS: "בבדיקה",
  WITH_ISSUES: "יש בעיה",
  PENDING_REVIEW: "ממתין לאישור",
  DISAPPROVED: "נדחה",
};

/**
 * נתוני מטא לטווח תאריכים (YYYY-MM-DD), או null אם אין טוקן/חשבון או שהקריאה נכשלה.
 * מוחזרים רק קמפיינים שהוציאו תקציב בטווח — אלה היחידים שרלוונטיים לדיווח.
 */
export async function metaInsights(since: string, until: string): Promise<MetaData | null> {
  const token = env("META_ACCESS_TOKEN") || env("META_SYSTEM_TOKEN");
  const act = env("META_AD_ACCOUNT");
  if (!token || !act) return null;

  const tr = encodeURIComponent(JSON.stringify({ since, until }));
  const auth = `access_token=${encodeURIComponent(token)}`;
  const ACC_FIELDS = "spend,impressions,reach,clicks,inline_link_clicks,ctr,cpc,actions";
  const CAMP_FIELDS = "campaign_id,campaign_name,objective,spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpc,cpm,actions";

  try {
    const [accRes, campRes, listRes, meRes] = await Promise.all([
      fetch(`${GRAPH}/${act}/insights?fields=${ACC_FIELDS}&time_range=${tr}&${auth}`, { signal: AbortSignal.timeout(20000) }),
      fetch(`${GRAPH}/${act}/insights?level=campaign&fields=${CAMP_FIELDS}&time_range=${tr}&limit=200&${auth}`, { signal: AbortSignal.timeout(20000) }),
      fetch(`${GRAPH}/${act}/campaigns?fields=id,effective_status&limit=200&${auth}`, { signal: AbortSignal.timeout(20000) }),
      fetch(`${GRAPH}/${act}?fields=name,currency&${auth}`, { signal: AbortSignal.timeout(15000) }),
    ]);
    if (!accRes.ok) return null;

    const acc = (await accRes.json())?.data?.[0] || {};
    const campData: Record<string, unknown>[] = campRes.ok ? ((await campRes.json())?.data || []) : [];
    const statusById: Record<string, string> = {};
    if (listRes.ok) {
      for (const c of ((await listRes.json())?.data || []) as { id: string; effective_status: string }[]) {
        statusById[c.id] = c.effective_status;
      }
    }
    const me = meRes.ok ? await meRes.json() : {};

    const campaigns: MetaCampaign[] = campData
      .map((c): MetaCampaign => {
        const leads = actionSum(c.actions, LEAD_ACTIONS);
        const spend = num(c.spend);
        const status = statusById[String(c.campaign_id || "")] || "";
        const objectiveRaw = String(c.objective || "");
        return {
          id: String(c.campaign_id || ""),
          name: String(c.campaign_name || "קמפיין"),
          objective: OBJ_LABEL[objectiveRaw] || "אחר",
          objectiveRaw,
          status,
          statusLabel: STATUS_LABEL[status] || status || "—",
          spend,
          impressions: num(c.impressions),
          reach: num(c.reach),
          frequency: num(c.frequency),
          clicks: num(c.clicks),
          linkClicks: num(c.inline_link_clicks),
          ctr: num(c.ctr),
          cpc: num(c.cpc),
          cpm: num(c.cpm),
          leads,
          costPerLead: leads > 0 ? spend / leads : 0,
          landingPageViews: actionSum(c.actions, ["landing_page_view"]),
        };
      })
      .filter((c) => c.spend > 0)
      .sort((a, b) => b.spend - a.spend);

    const accLeads = actionSum(acc.actions, LEAD_ACTIONS);
    const accSpend = num(acc.spend);
    return {
      account: String(me.name || act),
      currency: String(me.currency || "ILS"),
      spend: accSpend,
      impressions: num(acc.impressions),
      reach: num(acc.reach),
      clicks: num(acc.clicks),
      linkClicks: num(acc.inline_link_clicks),
      ctr: num(acc.ctr),
      cpc: num(acc.cpc),
      leads: accLeads,
      costPerLead: accLeads > 0 ? accSpend / accLeads : 0,
      campaigns,
    };
  } catch {
    return null;
  }
}
