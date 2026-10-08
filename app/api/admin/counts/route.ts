import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";
import { FOLLOWUP_STAGES, FOLLOWUP_EXCLUDED_STAGES, FOLLOWUP_COMPASS } from "@/lib/leads";

export const runtime = "nodejs";

// ספירות קלות לתפריט העליון (לידים / לקוחות)
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const [leads, clients, followups, matching, distribution] = await Promise.all([
    supa().from("leads").select("id", { count: "exact", head: true }).eq("category", "sales"),
    supa().from("clients").select("id", { count: "exact", head: true }),
    supa().from("leads").select("id", { count: "exact", head: true }).eq("category", "sales")
      .or(`stage.in.(${FOLLOWUP_STAGES.join(",")}),compass_status.in.(${FOLLOWUP_COMPASS.join(",")})`)
      .not("stage", "in", `(${FOLLOWUP_EXCLUDED_STAGES.join(",")})`),
    supa().from("leads").select("id", { count: "exact", head: true }).eq("category", "sales").not("compass_status", "is", null),
    supa().from("leads").select("id", { count: "exact", head: true }).not("distribution_last_at", "is", null),
  ]);
  return NextResponse.json({
    leads: leads.count || 0, clients: clients.count || 0,
    followups: followups.count || 0, matching: matching.count || 0,
    distribution: distribution.count || 0,
  });
}
