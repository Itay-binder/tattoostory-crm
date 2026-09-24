import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";

export const runtime = "nodejs";

// ספירות קלות לתפריט העליון (לידים / לקוחות)
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const [leads, clients, compass, deals, financing, distribution] = await Promise.all([
    supa().from("leads").select("id", { count: "exact", head: true }).eq("category", "sales"),
    supa().from("clients").select("id", { count: "exact", head: true }),
    supa().from("leads").select("id", { count: "exact", head: true }).eq("category", "sales").not("compass_status", "is", null),
    supa().from("deals").select("id", { count: "exact", head: true }),
    supa().from("financing_cases").select("id", { count: "exact", head: true }),
    supa().from("leads").select("id", { count: "exact", head: true }).not("distribution_last_at", "is", null),
  ]);
  return NextResponse.json({
    leads: leads.count || 0, clients: clients.count || 0, compass: compass.count || 0,
    deals: deals.count || 0, financing: financing.count || 0, distribution: distribution.count || 0,
  });
}
