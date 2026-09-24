import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const { data, error } = await supa()
    .from("enrollments")
    .select("id, status, enrolled_at, total_price_ils, contacts(id, first_name, last_name, phone, email), cycles(id, name)")
    .order("enrolled_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const customers = (data || []).map((e: any) => ({
    id: e.id,
    enrollment_status: e.status,
    enrolled_at: e.enrolled_at,
    total_price_ils: e.total_price_ils,
    first_name: e.contacts?.first_name || "",
    last_name: e.contacts?.last_name || "",
    phone: e.contacts?.phone || "",
    email: e.contacts?.email || "",
    cycle_name: e.cycles?.name || "",
    cycle_id: e.cycles?.id || "",
  }));

  return NextResponse.json({ customers });
}
