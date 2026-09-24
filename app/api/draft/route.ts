import { NextResponse } from "next/server";
import { verifyRequest } from "@/lib/firebaseAdmin";
import { getClientByEmail, getOrCreateClient, saveClientAnswers, listClientFiles, fileRowToUploaded } from "@/lib/clientsRepo";
import { supa } from "@/lib/supabaseAdmin";
import { computeProgress, notifyQuestionnaire } from "@/lib/questionnaireNotify";
import { upsertClientQuestionnaireDoc } from "@/lib/clientDoc";

export const runtime = "nodejs";

// סף שדות מולאו שמפעיל התראת "קרוב לסיום" לצוות (פעם אחת)
const NEAR_COMPLETE_THRESHOLD = 25;

export async function GET(req: Request) {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const c = await getClientByEmail(user.email);
  // isClient — האם המשתמש מופיע כלקוח (סקשן לקוחות). מי שלא — מופנה לפורטל (אין "חור").
  if (!c) return NextResponse.json({ answers: {}, files: [], status: "new", isClient: false });
  const files = (await listClientFiles(c.id)).map(fileRowToUploaded);
  return NextResponse.json({
    answers: c.answers || {},
    files,
    status: c.status || "draft",
    submittedAt: c.submitted_at || null,
    isClient: true,
  });
}

export async function PUT(req: Request) {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const answers = body?.answers;
  if (!answers || typeof answers !== "object") {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (typeof v === "string" && k.length < 64) clean[k] = v.slice(0, 4000);
  }

  const c = await getOrCreateClient(user);
  await saveClientAnswers(c.id, clean, user);

  // מסמך ה-Docs החי בתיקיית הלקוח — מתעדכן תוך כדי מילוי (מווסת ל-15 שניות).
  // סף קטן כדי לא לפתוח קובץ דרייב למבקר שרק התחיל ולא מילא כלום.
  const prog = computeProgress(clean);
  if (prog.answered >= 3) {
    try { await upsertClientQuestionnaireDoc(c.id); } catch { /* לא חוסם שמירת טיוטה */ }
  }

  // התראת "קרוב לסיום" לצוות — פעם אחת, כשעברו את הסף וטרם הוגש
  try {
    const p = computeProgress(clean);
    if (p.answered >= NEAR_COMPLETE_THRESHOLD) {
      const { data: row } = await supa().from("clients").select("near_complete_notified, submit_notified, status").eq("id", c.id).maybeSingle();
      const r = row as { near_complete_notified?: boolean; submit_notified?: boolean; status?: string } | null;
      if (r && !r.near_complete_notified && !r.submit_notified && r.status !== "submitted") {
        const origin = new URL(req.url).origin;
        await notifyQuestionnaire({ clientName: clean.fullName || "", email: user.email, answers: clean, kind: "near", clientUrl: `${origin}/admin/${c.id}` });
        await supa().from("clients").update({ near_complete_notified: true }).eq("id", c.id);
      }
    }
  } catch { /* לא חוסם שמירת טיוטה */ }

  return NextResponse.json({ ok: true });
}
