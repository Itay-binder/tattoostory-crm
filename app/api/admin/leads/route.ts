import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";

export const runtime = "nodejs";

const PAGE_SIZE = 50;

const HEBREW_STATUSES = [
  "ליד חדש", "שיחה 1 יצאה", "שתי שיחות יצאו", "שלוש שיחות יצאו",
  "4 שיחות יצאו", "אין מענה", "נשלחה הודעה", "נקבעה שיחה",
  "בטיפול", "מתעניינת", "פולואפ עתידי", "נסגר", "לא רלוונטי",
] as const;

const SORTABLE_CONTACT_FIELDS = new Set(["full_name", "phone", "email", "source", "gender"]);

export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const page       = Math.max(1, Number(sp.get("page")) || 1);
  const status     = sp.get("status") || "all";
  const sortKey    = sp.get("sortKey") || "created_at";
  const sortDir    = sp.get("sortDir") === "asc" ? true : false; // ascending = true

  // שדות פילטר per-column (prefix f_)
  const colFilters: Record<string, string> = {};
  sp.forEach((v, k) => { if (k.startsWith("f_")) colFilters[k.slice(2)] = v.trim(); });

  // מיון — רק שדות שקיימים בטבלת leads (לא contacts)
  const sortOnLead = !SORTABLE_CONTACT_FIELDS.has(sortKey);
  const orderColumn = sortOnLead ? sortKey : "created_at"; // אם מיון על contacts — fallback

  let query = supa()
    .from("leads")
    .select(`
      id, status, created_at, updated_at, last_activity_at,
      last_call, notes_rep1, notes_rep2, filled_questionnaire, open_day,
      contacts ( id, first_name, last_name, phone, email, source, gender, landing_page )
    `, { count: "exact" });

  if (status !== "all") query = query.eq("status", status);

  // פילטר per-column שעובדים על leads ישירות
  if (colFilters.status)             query = query.eq("status", colFilters.status);
  if (colFilters.filled_questionnaire !== undefined && colFilters.filled_questionnaire !== "") {
    query = query.eq("filled_questionnaire", colFilters.filled_questionnaire === "true");
  }

  const { data: rows, count, error } = await query
    .order(orderColumn, { ascending: sortDir })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let leads = (rows || []).map((r: Record<string, unknown>) => {
    const c = r.contacts as Record<string, string> | null;
    return {
      id:                  r.id,
      status:              r.status,
      created_at:          r.created_at,
      updated_at:          r.updated_at,
      last_activity_at:    r.last_activity_at,
      last_call:           r.last_call || "",
      notes_rep1:          r.notes_rep1 || "",
      notes_rep2:          r.notes_rep2 || "",
      filled_questionnaire: r.filled_questionnaire || false,
      open_day:            r.open_day || "",
      contact_id:          c?.id || "",
      first_name:          c?.first_name || "",
      last_name:           c?.last_name || "",
      full_name:           `${c?.first_name || ""} ${c?.last_name || ""}`.trim(),
      phone:               c?.phone || "",
      email:               c?.email || "",
      source:              c?.source || "",
      gender:              c?.gender || "",
      landing_page:        c?.landing_page || "",
    };
  });

  // פילטרים על שדות contacts (post-fetch)
  const cf = colFilters;
  if (cf.full_name)    leads = leads.filter((l) => l.full_name.includes(cf.full_name));
  if (cf.phone)        leads = leads.filter((l) => l.phone.includes(cf.phone));
  if (cf.email)        leads = leads.filter((l) => l.email.toLowerCase().includes(cf.email.toLowerCase()));
  if (cf.source)       leads = leads.filter((l) => l.source.toLowerCase().includes(cf.source.toLowerCase()));
  if (cf.gender)       leads = leads.filter((l) => l.gender.includes(cf.gender));
  if (cf.notes_rep1)   leads = leads.filter((l) => l.notes_rep1.includes(cf.notes_rep1));
  if (cf.notes_rep2)   leads = leads.filter((l) => l.notes_rep2.includes(cf.notes_rep2));
  if (cf.last_call)    leads = leads.filter((l) => l.last_call.includes(cf.last_call));
  if (cf.open_day)     leads = leads.filter((l) => l.open_day.includes(cf.open_day));
  if (cf.landing_page) leads = leads.filter((l) => l.landing_page.includes(cf.landing_page));

  // ספירת סטטוסים
  const statusCounts: Record<string, number> = {};
  await Promise.all(
    HEBREW_STATUSES.map(async (s) => {
      const { count: c } = await supa().from("leads").select("id", { count: "exact", head: true }).eq("status", s);
      statusCounts[s] = c || 0;
    })
  );

  return NextResponse.json({
    leads,
    total: count || 0,
    page,
    pageCount: Math.ceil((count || 0) / PAGE_SIZE),
    statusCounts,
  });
}

export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const { first_name, last_name, phone, email, source } = body;

  if (!phone && !email) return NextResponse.json({ error: "צריך לפחות טלפון או מייל" }, { status: 400 });

  const { data: contact, error: cErr } = await supa()
    .from("contacts")
    .upsert(
      { first_name: first_name || "", last_name: last_name || "", phone: phone || null, email: email || null, source: source || "manual" },
      { onConflict: "phone" }
    )
    .select()
    .single();

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  const { data: lead, error: lErr } = await supa()
    .from("leads")
    .insert({ contact_id: contact.id, status: "ליד חדש" })
    .select()
    .single();

  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, lead, contact });
}
