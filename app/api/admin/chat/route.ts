import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { env } from "@/lib/env";
import { verifyAdmin } from "@/lib/admin";
import { DB_SCHEMA } from "@/lib/chatSchema";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-sonnet-5";
const MAX_ROUNDS = 6; // כמה סבבי שאילתה מותרים לשאלה אחת

const SYSTEM = `אתה עוזר הנתונים של ה-CRM של פאוור קאפל (חברת ליווי למשקיעי נדל"ן).
אתה עונה למנהלים בעברית, בקצרה ולעניין, על סמך נתונים אמיתיים מהמערכת.

כדי לענות אתה חייב לשאול את הדאטהבייס בעזרת הכלי query_database.
לעולם אל תמציא מספרים — כל מספר שאתה אומר חייב להגיע משאילתה שהרצת.
אם השאלה לא ברורה, שאל שאלת הבהרה אחת קצרה.

כללי SQL:
- Postgres. רק SELECT. משפט אחד. בלי נקודה-פסיק בסוף.
- לתאריכים: (created_at AT TIME ZONE 'Asia/Jerusalem')::date
- אל תשלוף אלפי שורות — אגרגציה (count/sum/group by) עדיפה.
- כשמבקשים רשימה של אנשים — הגבל ל-20 והצג שם/טלפון/מייל.

סגנון התשובה:
- ישיר ותכליתי. מספר קודם, הסבר אחריו.
- אם רלוונטי, הצע שאלת המשך שתעזור למנהל.
- זכור את ההקשר של השאלות הקודמות (למשל "וכמה מתוכם חדשים?").

${DB_SCHEMA}`;

const TOOLS = [{
  name: "query_database",
  description: "מריץ שאילתת SELECT על ה-CRM ומחזיר את התוצאות כ-JSON. לקריאה בלבד.",
  input_schema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "שאילתת SELECT יחידה בפוסטגרס" },
      why: { type: "string", description: "משפט קצר בעברית: מה השאילתה בודקת" },
    },
    required: ["sql"],
  },
}];

interface Block { type: string; text?: string; id?: string; name?: string; input?: { sql?: string; why?: string } }
interface Msg { role: "user" | "assistant"; content: string | unknown[] }

/** מריץ את השאילתה דרך הפונקציה המוגנת (קריאה בלבד, תקרת 500 שורות). */
async function runSql(sql: string): Promise<{ ok: boolean; rows?: unknown; error?: string }> {
  const { data, error } = await supa().rpc("admin_readonly_query", { q: sql });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: data };
}

async function callClaude(apiKey: string, messages: Msg[]) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system: SYSTEM, tools: TOOLS, messages }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`שגיאת AI (${res.status}): ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const apiKey = env("ANTHROPIC_API_KEY");
  if (!apiKey) return NextResponse.json({ error: "הצ'אט לא מוגדר — חסר מפתח AI" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const history: Msg[] = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  if (!history.length) return NextResponse.json({ error: "אין שאלה" }, { status: 400 });

  const messages: Msg[] = [...history];
  const queries: { sql: string; why: string; rows: number }[] = [];

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const reply = await callClaude(apiKey, messages);
      const blocks: Block[] = reply.content || [];

      // אין קריאת כלי → זו התשובה הסופית
      if (reply.stop_reason !== "tool_use") {
        const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        return NextResponse.json({ answer: text || "לא הצלחתי לענות על זה.", queries });
      }

      messages.push({ role: "assistant", content: blocks });

      // מריצים כל שאילתה שהמודל ביקש ומחזירים לו את התוצאות
      const results = [];
      for (const b of blocks.filter((x) => x.type === "tool_use")) {
        const sql = (b.input?.sql || "").trim().replace(/;\s*$/, "");
        const r = await runSql(sql);
        const rows = Array.isArray(r.rows) ? r.rows.length : 0;
        queries.push({ sql, why: b.input?.why || "", rows });
        results.push({
          type: "tool_result",
          tool_use_id: b.id,
          is_error: !r.ok,
          content: r.ok ? JSON.stringify(r.rows).slice(0, 20000) : `שגיאה: ${r.error}`,
        });
      }
      messages.push({ role: "user", content: results });
    }
    return NextResponse.json({ answer: "השאלה מורכבת מדי — נסה לפצל אותה.", queries });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
