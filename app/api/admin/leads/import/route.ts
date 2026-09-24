import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { getSettings } from "@/lib/settingsRepo";
import { buildIntakeFromFlat, upsertLead } from "@/lib/leadsRepo";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST — ייבוא לידים מ-CSV (שורות שנותחו בצד לקוח)
export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return NextResponse.json({ error: "אין שורות" }, { status: 400 });
  if (rows.length > 2000) return NextResponse.json({ error: "מקסימום 2000 שורות בייבוא אחד" }, { status: 400 });

  const settings = await getSettings();
  const customFieldIds = settings.customFields.map((f) => f.id);

  let created = 0, merged = 0, skipped = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const flat = rows[i] || {};
    const hasContact = (flat.email && String(flat.email).trim()) || (flat.phone && String(flat.phone).trim());
    if (!hasContact) { skipped++; continue; }
    try {
      const intake = buildIntakeFromFlat(flat, { fieldMap: settings.fieldMap, customFieldIds });
      const r = await upsertLead(intake, { source: "csv", by: `CSV (${admin.email})` });
      if (r.merged) merged++; else created++;
    } catch (e) {
      errors.push(`שורה ${i + 1}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ ok: true, created, merged, skipped, errors: errors.slice(0, 20) });
}
