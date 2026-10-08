import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { listLeadsPage, upsertLead } from "@/lib/leadsRepo";

export const runtime = "nodejs";

// GET — עמוד לידים (50 בעמוד), מסונן וממוין בצד השרת.
// פרמטרים: page, stage, sortKey, sortDir + f_<מפתח עמודה>=טקסט לפילטרי עמודות.
// מחזיר גם total ו-stageCounts, כדי שהמסך לא יצטרך את כל הרשומות כדי לספור.
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const filters: Record<string, string> = {};
  for (const [k, v] of sp.entries()) if (k.startsWith("f_") && v.trim()) filters[k.slice(2)] = v;

  const result = await listLeadsPage({
    page: Number(sp.get("page")) || 1,
    stage: sp.get("stage") || "all",
    sortKey: sp.get("sortKey") || "updatedAt",
    sortDir: sp.get("sortDir") === "asc" ? "asc" : "desc",
    category: sp.get("category") === "distribution" ? "distribution" : "sales",
    filters,
  });
  return NextResponse.json(result);
}

// POST — הוספת ליד ידנית (עם זיהוי כפילות ואיחוד)
export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  const hasContact = (body.email && String(body.email).trim()) || (body.phone && String(body.phone).trim());
  if (!hasContact) return NextResponse.json({ error: "צריך לפחות מייל או טלפון" }, { status: 400 });

  const { lead, merged } = await upsertLead(
    {
      firstName: body.firstName, lastName: body.lastName, fullName: body.fullName,
      email: body.email, phone: body.phone, idNumber: body.idNumber,
      answers: body.answers, quali: body.quali, custom: body.custom,
    },
    { source: "manual", by: admin.email }
  );
  return NextResponse.json({ ok: true, lead, merged });
}
