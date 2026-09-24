import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const [leads, contacts, cycles, enrollments] = await Promise.all([
    supa().from("leads").select("id", { count: "exact", head: true }),
    supa().from("contacts").select("id", { count: "exact", head: true }),
    supa().from("cycles").select("id", { count: "exact", head: true }),
    supa().from("enrollments").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);

  return NextResponse.json({
    leads: leads.count || 0,
    contacts: contacts.count || 0,
    cycles: cycles.count || 0,
    enrollments: enrollments.count || 0,
  });
}
