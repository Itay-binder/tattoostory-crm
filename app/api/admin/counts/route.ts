import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const [leads, meetings, customers] = await Promise.all([
    supa().from("leads").select("id", { count: "exact", head: true }),
    supa().from("meetings").select("id", { count: "exact", head: true }),
    supa().from("customers").select("id", { count: "exact", head: true }),
  ]);

  return NextResponse.json({
    leads: leads.count || 0,
    meetings: meetings.count || 0,
    customers: customers.count || 0,
  });
}
