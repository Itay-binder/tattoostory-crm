import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { listLeadsPage, lastNotesFor } from "@/lib/leadsRepo";

export const runtime = "nodejs";

// GET — מסך הפולואפים. אותו מנגנון של מסך הלידים (עימוד, מיון, פילטרי עמודות),
// אבל מוגבל למאגר הפולואפים: ליד חי שיצרנו איתו קשר וטרם נסגר/נפסל, או ליד
// שהיתה לו פגישת התאמה והוא טרם התקדם. מצורף גם התיעוד האחרון של כל ליד.
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const filters: Record<string, string> = {};
  for (const [k, v] of sp.entries()) if (k.startsWith("f_") && v.trim()) filters[k.slice(2)] = v;

  const result = await listLeadsPage({
    page: Number(sp.get("page")) || 1,
    stage: sp.get("stage") || "all",
    sortKey: sp.get("sortKey") || "custom.followup_at",
    sortDir: sp.get("sortDir") === "asc" ? "asc" : "desc",
    scope: "followups",
    filters,
  });
  const lastNotes = await lastNotesFor(result.leads.map((l) => l.id));
  return NextResponse.json({ ...result, lastNotes });
}
