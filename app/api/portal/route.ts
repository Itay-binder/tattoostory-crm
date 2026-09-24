import { NextResponse } from "next/server";
import { verifyRequest } from "@/lib/firebaseAdmin";
import { verifyAdmin } from "@/lib/admin";
import { supa } from "@/lib/supabaseAdmin";
import { getClientByEmail, getClientById } from "@/lib/clientsRepo";
import { findLeadForClient, getLead } from "@/lib/leadsRepo";
import { computeProgress } from "@/lib/questionnaireNotify";
import { buildJourney, stagesFromReached, type JourneyInput } from "@/lib/journey";
import { normalizeEmail } from "@/lib/leads";
import { signedReadUrl } from "@/lib/storage";

export const runtime = "nodejs";

// גישה תמידית (בדיקות). מעבר לזה — הגישה נפתחת ידנית ע"י איש מכירות ("פתח פורטל" בכרטיס הליד),
// שמדליק את הדגל portal_access על הליד. זה הטריגר היחיד לפתיחת הגישה ללקוח.
const ALWAYS_ALLOWED = ["itay.bin111@gmail.com"];

export async function GET(req: Request) {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const asId = new URL(req.url).searchParams.get("as");
  let email: string;
  let lead: Awaited<ReturnType<typeof getLead>> = null;
  let client: Awaited<ReturnType<typeof getClientByEmail>> = null;
  let adminView = false;

  if (asId) {
    // אדמין צופה בפורטל של לקוח מסוים (read-only) — "לראות מה הלקוח רואה".
    const admin = await verifyAdmin(req);
    if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    lead = await getLead(asId);
    if (!lead) return NextResponse.json({ allowed: false }, { status: 200 });
    email = (lead.email || "").toLowerCase().trim();
    client = email ? await getClientByEmail(email) : null;
    if (!client && lead.convertedClientUid) client = await getClientById(lead.convertedClientUid);
    adminView = true;
  } else {
    // אבטחה: הכל scoped למייל המאומת בלבד — לעולם לא מפרמטר.
    email = (user.email || "").toLowerCase().trim();
    lead = await findLeadForClient({ email });
    client = await getClientByEmail(email);
    // גישה: איתי (בדיקות) או ליד שנפתחה לו גישה ידנית דרך "פתח פורטל".
    if (!ALWAYS_ALLOWED.includes(email) && !lead?.portalAccess) {
      return NextResponse.json({ allowed: false }, { status: 200 });
    }
  }

  // ── סטטוס הסכם + חותמים (כפתורי חתימה) ──
  // מקור אמת יחיד: המעטפה האחרונה שהופקה. סטטוס והכפתורים תמיד עקביים איתה.
  // נחתם → תג ✓ בלי כפתור. לא הופק כלום → אין כפתור בכלל.
  let contractSigned = false;
  let contractStatus = "טרם הופק";
  let contractSigners: { name: string; token: string; signed: boolean }[] = [];
  if (client) {
    const { data: envs } = await supa().from("contract_envelopes")
      .select("id,status,created_at").eq("primary_client_id", client.id).order("created_at", { ascending: false }).limit(1);
    const active = ((envs as { id: string; status: string }[]) || [])[0];
    if (active) {
      contractSigned = active.status === "signed";
      contractStatus = contractSigned ? "נחתם" : "ממתין לחתימה";
      const { data: signers } = await supa().from("contract_signers")
        .select("name,token,status,signed_at,sign_order").eq("envelope_id", active.id).order("sign_order", { ascending: true });
      contractSigners = ((signers as { name: string; token: string; status: string; signed_at: string | null }[]) || [])
        .map((s) => ({ name: s.name || "חותם", token: s.token, signed: s.status === "signed" || !!s.signed_at }));
    }
  }

  // ── אחוז מילוי שאלון ──
  const answers = (client?.answers as Record<string, string>) || {};
  const prog = computeProgress(answers);
  const questionnairePct = prog.total ? Math.round((prog.answered / prog.total) * 100) : 0;

  // ── מצב מצפן + סיכום פגישה ──
  const compassStatus = lead?.compassStatus || null;
  let compassSummary: string | null = null;
  if (lead) {
    const { data: acts } = await supa().from("lead_activity")
      .select("text,by_actor,at").eq("lead_id", lead.id).eq("type", "note")
      .order("at", { ascending: false }).limit(50);
    const summary = ((acts as { text: string | null; by_actor: string }[]) || [])
      .find((a) => a.text && /מצפן|סיכום|פגיש/.test(a.text) && !/רשימת תפוצה/.test(a.text));
    compassSummary = summary?.text || null;
  }

  // ── היסטוריית השארת פרטים (שלב 0) ──
  const submissions: { date: string; landingpage: string }[] = [];
  if (lead) {
    const { data: intakes } = await supa().from("lead_activity")
      .select("at,fields").eq("lead_id", lead.id).eq("type", "intake").order("at", { ascending: true });
    for (const r of (intakes as { at: string; fields: Record<string, string> | null }[]) || []) {
      submissions.push({ date: r.at, landingpage: (r.fields?.["דף נחיתה"] || r.fields?.landingpage || lead.custom?.landingpage || "") });
    }
  }

  // ── עסקה + תשלומי משכנתא + תכנית עסקית (שלבים 5-8, read-side) ──
  let payments: { dueDate: string; amount: number; status: string; note: string }[] = [];
  let businessPlan: string | null = null;
  let bizPlanFileUrl: string | null = null;
  let bizPlanFileName: string | null = null;
  if (client) {
    // עסקה של הלקוח — כלקוח ראשי (linked_client_id) או דרך שיבוץ (deal_clients)
    const sel = "id,business_plan,business_plan_file,business_plan_file_name";
    type DealRow = { id: string; business_plan: string | null; business_plan_file: string | null; business_plan_file_name: string | null };
    let deal: DealRow | undefined;
    const { data: primary } = await supa().from("deals").select(sel).eq("linked_client_id", client.id).order("updated_at", { ascending: false }).limit(1);
    deal = (primary as DealRow[])?.[0];
    if (!deal) {
      const { data: dc } = await supa().from("deal_clients").select("deal_id").eq("client_id", client.id).limit(1);
      const dealId = (dc as { deal_id: string }[])?.[0]?.deal_id;
      if (dealId) {
        const { data: d2 } = await supa().from("deals").select(sel).eq("id", dealId).limit(1);
        deal = (d2 as DealRow[])?.[0];
      }
    }
    if (deal) {
      businessPlan = deal.business_plan || null;
      if (deal.business_plan_file) {
        try { bizPlanFileUrl = await signedReadUrl(deal.business_plan_file, 3600); bizPlanFileName = deal.business_plan_file_name || "תכנית עסקית.pdf"; } catch { /* */ }
      }
      const { data: pays } = await supa().from("deal_payments").select("due_date,amount,status,note").eq("deal_id", deal.id).order("due_date", { ascending: true });
      payments = ((pays as { due_date: string; amount: number; status: string; note: string | null }[]) || [])
        .map((p) => ({ dueDate: p.due_date, amount: Number(p.amount) || 0, status: p.status, note: p.note || "" }));
    }
  }

  const isWon = !!(lead?.compassStatus || lead?.stage === "won" || lead?.convertedClientUid || client);
  const compassProgressed = compassStatus === "progressed";
  const clientStage = client?.stage || null;

  const jin: JourneyInput = {
    hasLead: !!lead || !!client,
    isWon,
    compassProgressed,
    questionnairePct,
    contractSigned,
    clientStage,
  };
  let journey = buildJourney(jin);
  let effIsWon = isWon;
  let effProgressed = compassProgressed;

  // תצוגה מקדימה (רק למורשים) — ?preview=0..8 מכריח שלב, כדי לראות איך כל שלב נראה.
  const pv = new URL(req.url).searchParams.get("preview");
  const preview = pv != null && !isNaN(Number(pv)) ? Math.max(0, Math.min(8, Math.floor(Number(pv)))) : null;
  if (preview != null) {
    journey = { reachedMax: preview, stages: stagesFromReached(preview) };
    effIsWon = preview >= 1;
    effProgressed = preview >= 2;
  }

  return NextResponse.json({
    allowed: true,
    email,
    adminView,
    canPreview: adminView || ALWAYS_ALLOWED.includes(email),
    preview: preview != null,
    name: (answers.fullName || lead?.fullName || (adminView ? "" : user.name) || "").trim(),
    ...journey,
    isWon: effIsWon, compassProgressed: effProgressed, clientStage, questionnairePct, contractSigned, contractStatus, compassStatus,
    content: {
      lead: { submitCount: submissions.length || Number(lead?.custom?.submit_count) || 1, submissions, lastLandingpage: lead?.custom?.landingpage || "" },
      compass: { status: compassStatus, summary: compassSummary },
      process: { questionnairePct, contractSigned, contractStatus, signers: contractSigners },
      banking: { notes: [] as string[] },
      bizplan: { plan: businessPlan, fileUrl: bizPlanFileUrl, fileName: bizPlanFileName },
      mortgage: { payments },
    },
    whatsapp: "972532484618",
  });
}
