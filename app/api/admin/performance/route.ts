import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";
import { metaInsights } from "@/lib/metaInsights";

export const runtime = "nodejs";
export const maxDuration = 30;

// לידים שיובאו מגיליון פגישות המצפן (ואינם Optione) — מוחרגים מספירת הקליטות האמיתיות
const EXCL = "(l.id in (select lead_id from lead_activity where by_actor='ייבוא גיליון') and coalesce(l.custom->>'lead_source_system','') <> 'Optione')";

function isoDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function monthStart(): string { const d = isoDate(new Date()); return d.slice(0, 8) + "01"; }

async function q(sql: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supa().rpc("admin_readonly_query", { q: sql });
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown>[]) || [];
}

export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("from") || "") ? sp.get("from")! : monthStart();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("to") || "") ? sp.get("to")! : isoDate(new Date());
  // חלון: last_lead_at בין from ל-to (כולל)
  const win = `(l.last_lead_at at time zone 'Asia/Jerusalem') >= '${from}' and (l.last_lead_at at time zone 'Asia/Jerusalem') < ('${to}'::date + 1)`;
  const base = `from leads l where ${win} and not ${EXCL}`;

  const aggSql = (expr: string) => `select ${expr} as label, count(*)::int as c ${base} group by 1 order by 2 desc`;

  try {
    const [summary, bySource, byCampaign, byAd, byPage, names, meta] = await Promise.all([
      q(`select count(*)::int total,
           count(*) filter (where (l.created_at at time zone 'Asia/Jerusalem') >= '${from}')::int as new,
           count(*) filter (where (l.created_at at time zone 'Asia/Jerusalem') <  '${from}')::int as returning ${base}`),
      q(aggSql(`coalesce(nullif(l.custom->>'utm_source',''), nullif(l.quali->>'source',''), 'לא ידוע')`)),
      q(aggSql(`coalesce(nullif(l.custom->>'utm_campaign',''), 'לא ידוע')`)),
      q(aggSql(`coalesce(nullif(l.custom->>'utm_content',''), 'לא ידוע')`)),
      q(aggSql(`coalesce(nullif(l.custom->>'landingpage',''), 'לא ידוע')`)),
      q(`select coalesce(nullif(l.full_name,''), nullif(trim(coalesce(l.first_name,'')||' '||coalesce(l.last_name,'')),''), '(ללא שם)') as name,
           ((l.created_at at time zone 'Asia/Jerusalem') >= '${from}') as is_new,
           to_char(l.last_lead_at at time zone 'Asia/Jerusalem','DD/MM') as last
         ${base} order by is_new desc, l.last_lead_at desc`),
      metaInsights(from, to),
    ]);

    return NextResponse.json({
      from, to,
      summary: summary[0] || { total: 0, new: 0, returning: 0 },
      bySource, byCampaign, byAd, byPage, names, meta,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
