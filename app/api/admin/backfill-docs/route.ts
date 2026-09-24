import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { env } from "@/lib/env";
import { supa } from "@/lib/supabaseAdmin";
import { upsertClientQuestionnaireDoc } from "@/lib/clientDoc";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST — יוצר/מרענן את מסמך ה-Docs החי לכל הלקוחות שכבר מילאו שאלון
 * (backfill לפיצ'ר, וגם רענון גורף אם התבנית משתנה).
 * הגנה: CRON_SECRET (Bearer) או מנהל מחובר.
 * גוף אופציונלי: { limit?: number } — לעבד עד N לקוחות (ברירת מחדל: הכל).
 */
export async function POST(req: Request) {
  const secret = env("CRON_SECRET");
  const auth = req.headers.get("authorization") || "";
  const isCron = secret && auth === `Bearer ${secret}`;
  const admin = isCron ? null : await verifyAdmin(req);
  if (!isCron && !admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => ({} as { limit?: number; minFilled?: number }));
  const limit = Number(body.limit) > 0 ? Number(body.limit) : 100000;

  // לקוחות עם תשובות אמיתיות (לפחות שדה אחד)
  const { data, error } = await supa()
    .from("clients")
    .select("id, answers")
    .not("answers", "is", null)
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // רק לקוחות שבאמת מילאו שאלון (סף שדות) — לא לידים שהומרו עם 3-4 שדות אוטומטיים.
  const MIN_FILLED = Number(body.minFilled) > 0 ? Number(body.minFilled) : 8;
  const targets = ((data as { id: string; answers: Record<string, string> | null }[]) || [])
    .filter((c) => c.answers && Object.values(c.answers).filter((v) => typeof v === "string" && v.trim()).length >= MIN_FILLED)
    .slice(0, limit);

  let ok = 0, failed = 0;
  // עיבוד בקבוצות קטנות כדי לא להעמיס על Drive ולא לחצות את מגבלת הזמן
  const BATCH = 4;
  for (let i = 0; i < targets.length; i += BATCH) {
    const chunk = targets.slice(i, i + BATCH);
    const res = await Promise.all(chunk.map((c) => upsertClientQuestionnaireDoc(c.id, { force: true })));
    res.forEach((r) => (r ? ok++ : failed++));
  }

  return NextResponse.json({ total: targets.length, ok, failed });
}
