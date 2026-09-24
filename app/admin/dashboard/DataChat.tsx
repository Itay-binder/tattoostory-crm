"use client";

import { useEffect, useRef, useState } from "react";
import { firebaseAuth } from "@/lib/authClient";

interface Turn {
  role: "user" | "assistant";
  text: string;
  queries?: { sql: string; why: string; rows: number }[];
}

const SUGGESTIONS = [
  "כמה לידים נכנסו החודש?",
  "מה פילוח הלידים לפי מקור הגעה?",
  "כמה לידים לכל נציג?",
  "כמה לקוחות חתמו דירה?",
];

export default function DataChat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSql, setShowSql] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, busy]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const next: Turn[] = [...turns, { role: "user", text }];
    setTurns(next);
    setQ("");
    setBusy(true);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      // שולחים את כל השיחה — כדי שישאלות המשך ("וכמה מתוכם חדשים?") יבינו הקשר
      const messages = next.map((x) => ({ role: x.role, content: x.text }));
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ messages }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה");
      setTurns((p) => [...p, { role: "assistant", text: d.answer, queries: d.queries }]);
    } catch (e) {
      setTurns((p) => [...p, { role: "assistant", text: `נכשל — ${(e as Error).message}` }]);
    } finally { setBusy(false); }
  };

  return (
    <div className="pcf-card" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}><span>💬</span> שאל את המערכת</h2>
        {turns.length > 0 && <button className="pcf-link-btn" style={{ fontSize: 13 }} onClick={() => setTurns([])}>שיחה חדשה</button>}
      </div>
      <p style={{ color: "var(--muted)", fontSize: 14, margin: "6px 0 0" }}>
        שאלו כל דבר על הלידים, הלקוחות והעסקאות — התשובות מגיעות מהנתונים האמיתיים.
      </p>

      {/* השיחה */}
      {turns.length > 0 && (
        <div style={{ marginTop: 16, display: "grid", gap: 10, maxHeight: 460, overflowY: "auto", paddingInlineEnd: 4 }}>
          {turns.map((t, i) => (
            <div key={i} style={{ display: "flex", justifyContent: t.role === "user" ? "flex-start" : "flex-end" }}>
              <div style={{
                maxWidth: "85%", padding: "10px 14px", borderRadius: 14,
                background: t.role === "user" ? "var(--surface-2)" : "var(--bg)",
                border: `1px solid ${t.role === "user" ? "transparent" : "var(--line)"}`,
                whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.6,
              }}>
                {t.text}
                {t.queries && t.queries.length > 0 && (
                  <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
                    <button className="pcf-link-btn" style={{ fontSize: 11, color: "var(--muted)" }}
                      onClick={() => setShowSql(showSql === i ? null : i)}>
                      {showSql === i ? "▲ הסתר" : `▼ ${t.queries.length} שאילתות שרצו`}
                    </button>
                    {showSql === i && t.queries.map((query, j) => (
                      <div key={j} style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
                        {query.why && <div>· {query.why} ({query.rows} שורות)</div>}
                        <code dir="ltr" style={{ display: "block", background: "var(--surface)", padding: "6px 8px", borderRadius: 6, marginTop: 3, whiteSpace: "pre-wrap", textAlign: "left" }}>{query.sql}</code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div style={{ padding: "10px 14px", borderRadius: 14, background: "var(--bg)", border: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 14 }}>
                <span className="pcf-spin" style={{ width: 14, height: 14, borderWidth: 2 }} /> בודק בנתונים…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {/* הצעות */}
      {turns.length === 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="pcf-pill" style={{ fontSize: 13, padding: "8px 14px" }} onClick={() => ask(s)}>{s}</button>
          ))}
        </div>
      )}

      {/* שורת השאלה */}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(q); } }}
          placeholder="למשל: כמה לידים נכנסו באפריל 2026? וכמה מתוכם חוזרים?"
          disabled={busy}
          style={{ flex: 1, padding: "12px 16px", borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface)", color: "inherit", fontSize: 15, fontFamily: "inherit" }}
        />
        <button className="pcf-btn" style={{ padding: "12px 22px", fontSize: 15 }} onClick={() => ask(q)} disabled={busy || !q.trim()}>שאל</button>
      </div>
    </div>
  );
}
