import { env } from "@/lib/env";

// נתוני ביצועים ממטא (Graph API) — הוצאה, חשיפות, קליקים לפי חשבון וקמפיין.
const GRAPH = "https://graph.facebook.com/v21.0";

export interface MetaCampaign { name: string; objective: string; spend: number; impressions: number; clicks: number; ctr: number }
export interface MetaData {
  spend: number; impressions: number; clicks: number; ctr: number; cpc: number; reach: number;
  campaigns: MetaCampaign[];
}

const num = (v: unknown) => Number(v || 0);

/** מחזיר נתוני מטא לטווח תאריכים (YYYY-MM-DD), או null אם לא מוגדר/נכשל. */
export async function metaInsights(since: string, until: string): Promise<MetaData | null> {
  const token = env("META_ACCESS_TOKEN");
  const act = env("META_AD_ACCOUNT");
  if (!token || !act) return null;
  const tr = encodeURIComponent(JSON.stringify({ since, until }));
  const auth = `access_token=${encodeURIComponent(token)}`;

  try {
    const [accRes, campRes] = await Promise.all([
      fetch(`${GRAPH}/${act}/insights?fields=spend,impressions,clicks,ctr,cpc,reach&time_range=${tr}&${auth}`, { signal: AbortSignal.timeout(15000) }),
      fetch(`${GRAPH}/${act}/insights?level=campaign&fields=campaign_name,objective,spend,impressions,clicks,ctr&time_range=${tr}&limit=100&${auth}`, { signal: AbortSignal.timeout(15000) }),
    ]);
    if (!accRes.ok) return null;
    const acc = (await accRes.json())?.data?.[0] || {};
    const campData = campRes.ok ? ((await campRes.json())?.data || []) : [];

    const OBJ: Record<string, string> = { OUTCOME_LEADS: "לידים", OUTCOME_AWARENESS: "מודעות", OUTCOME_TRAFFIC: "תנועה", OUTCOME_ENGAGEMENT: "מעורבות", LINK_CLICKS: "קליקים", LEAD_GENERATION: "לידים" };
    const campaigns: MetaCampaign[] = campData
      .map((c: Record<string, unknown>) => ({
        name: String(c.campaign_name || "קמפיין"),
        objective: OBJ[String(c.objective || "")] || "אחר",
        spend: num(c.spend), impressions: num(c.impressions), clicks: num(c.clicks), ctr: num(c.ctr),
      }))
      .filter((c: MetaCampaign) => c.spend > 0)
      .sort((a: MetaCampaign, b: MetaCampaign) => b.spend - a.spend);

    return {
      spend: num(acc.spend), impressions: num(acc.impressions), clicks: num(acc.clicks),
      ctr: num(acc.ctr), cpc: num(acc.cpc), reach: num(acc.reach), campaigns,
    };
  } catch {
    return null;
  }
}
