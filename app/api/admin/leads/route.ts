import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";

export const runtime = "nodejs";

const PAGE_SIZE = 50;

const STATUSES = ["new", "contacted", "qualified", "interested", "follow_up", "enrolled", "closed_lost"] as const;

export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const statusFilter = sp.get("status") || "all";
  const search = (sp.get("q") || "").trim().toLowerCase();

  let query = supa()
    .from("leads")
    .select(`
      id, status, created_at, updated_at, last_activity_at,
      last_call, notes_rep1, notes_rep2, filled_questionnaire, open_day,
      contacts ( id, first_name, last_name, phone, email, source, gender, landing_page )
    `, { count: "exact" });

  if (statusFilter !== "all") query = query.eq("status", statusFilter);

  const { data: rows, count, error } = await query
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let leads = (rows || []).map((r: Record<string, unknown>) => {
    const c = r.contacts as Record<string, string> | null;
    return {
      id: r.id,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      last_activity_at: r.last_activity_at,
      last_call: r.last_call || "",
      notes_rep1: r.notes_rep1 || "",
      notes_rep2: r.notes_rep2 || "",
      filled_questionnaire: r.filled_questionnaire || false,
      open_day: r.open_day || "",
      contact_id: c?.id || "",
      first_name: c?.first_name || "",
      last_name: c?.last_name || "",
      full_name: `${c?.first_name || ""} ${c?.last_name || ""}`.trim(),
      phone: c?.phone || "",
      email: c?.email || "",
      source: c?.source || "",
      gender: c?.gender || "",
      landing_page: c?.landing_page || "",
    };
  });

  if (search) {
    leads = leads.filter((l) =>
      l.full_name.toLowerCase().includes(search) ||
      l.phone.includes(search) ||
      l.email.toLowerCase().includes(search)
    );
  }

  const statusCounts = await Promise.all(
    STATUSES.map(async (s) => {
      const { count: c } = await supa().from("leads").select("id", { count: "exact", head: true }).eq("status", s);
      return [s, c || 0] as [string, number];
    })
  );

  return NextResponse.json({
    leads,
    total: count || 0,
    page,
    pageCount: Math.ceil((count || 0) / PAGE_SIZE),
    statusCounts: Object.fromEntries(statusCounts),
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
    .upsert({ first_name: first_name || "", last_name: last_name || "", phone: phone || null, email: email || null, source: source || "manual" }, { onConflict: "phone" })
    .select()
    .single();

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  const { data: lead, error: lErr } = await supa()
    .from("leads")
    .insert({ contact_id: contact.id, status: "new" })
    .select()
    .single();

  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, lead, contact });
}
