import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { supa } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/**
 * GET — פילוחי דשבורד נוספים בטווח תאריכי יצירה:
 *   platforms — לפי פלטפורמת הפרסום (Meta / TikTok / YouTube-Google / אחר / ללא ייחוס)
 *   landings  — לפי דף הנחיתה (custom->>'landingpage')
 * כל שורה: { name, cnt, compass } — סה"כ לידים + כמה הגיעו לפגישת מצפן ומעבר.
 * פרמטרים: from, to (YYYY-MM-DD, אופציונליים) — זהים ל-/leads/stats.
 */
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const p_from = from ? `${from}T00:00:00.000Z` : null;
  const p_to = to ? `${to}T23:59:59.999Z` : null;

  const [plat, land, ad] = await Promise.all([
    supa().rpc("leads_by_platform", { p_from, p_to }),
    supa().rpc("leads_by_landing", { p_from, p_to }),
    supa().rpc("leads_by_ad", { p_from, p_to }),
  ]);
  if (plat.error) return NextResponse.json({ error: plat.error.message }, { status: 500 });
  if (land.error) return NextResponse.json({ error: land.error.message }, { status: 500 });
  if (ad.error) return NextResponse.json({ error: ad.error.message }, { status: 500 });

  const platforms = ((plat.data as { platform: string; cnt: number | string; compass: number | string }[]) || [])
    .map((r) => ({ name: r.platform, cnt: Number(r.cnt), compass: Number(r.compass) }))
    .sort((a, b) => b.cnt - a.cnt);
  const landings = ((land.data as { landing: string; cnt: number | string; compass: number | string }[]) || [])
    .map((r) => ({ name: r.landing, cnt: Number(r.cnt), compass: Number(r.compass) }))
    .sort((a, b) => b.cnt - a.cnt);
  const ads = ((ad.data as { ad: string; cnt: number | string; compass: number | string }[]) || [])
    .map((r) => ({ name: r.ad, cnt: Number(r.cnt), compass: Number(r.compass) }))
    .sort((a, b) => b.cnt - a.cnt);

  return NextResponse.json({ platforms, landings, ads });
}
