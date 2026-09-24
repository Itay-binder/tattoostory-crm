"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, signInWithPopup, setPersistence, browserLocalPersistence, firebaseAuth, googleProvider, type User } from "@/lib/authClient";
import { COMPASS_STATUSES, compassStatusLabel, type CompassStatus, type Lead } from "@/lib/leads";
import AdminNav from "../AdminNav";
import ActivityText from "../ActivityText";

function fmtDate(s: string): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }); }
  catch { return s; }
}

const ACT_ICON: Record<string, string> = { intake: "📥", note: "🗒️", stage: "🔀", system: "⚙️" };
const ACT_LABEL: Record<string, string> = { intake: "קליטת ליד", note: "הערה", stage: "שינוי שלב", system: "מערכת" };
// צבע כרטיס לפי סטטוס פגישה
const STATUS_PILL: Record<string, string> = { not_scheduled: "draft", scheduled: "sent", met_no_progress: "wait", progressed: "done" };

export default function CompassPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [meetings, setMeetings] = useState<Lead[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<CompassStatus | "all">("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;
  const defaultApplied = useRef(false);

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);

  // ברירת מחדל פר-משתמש: לבלוג פאוור מתחילים ב"תואמה פגישה" ולא ב"הכל"
  useEffect(() => {
    if (!user || defaultApplied.current) return;
    defaultApplied.current = true;
    if ((user.email || "").toLowerCase() === "blog@powercouple.co.il") setFilter("scheduled");
  }, [user]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null); setDenied(false);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch("/api/admin/compass", { headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 403) { setDenied(true); return; }
      if (!res.ok) throw new Error();
      setMeetings((await res.json()).meetings || []);
    } catch { setErr("שגיאה בטעינת פגישות המצפן"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  const login = async () => { await setPersistence(firebaseAuth(), browserLocalPersistence); await signInWithPopup(firebaseAuth(), googleProvider).catch(() => {}); };

  const setStatus = async (id: string, status: CompassStatus) => {
    setMsg(null);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch(`/api/admin/leads/${id}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ action: "set-compass-status", status }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה");
      setMeetings((prev) => prev.map((m) => (m.id === id ? d.lead : m)));
      setMsg("הסטטוס עודכן ✓");
    } catch (e) { setMsg(`נכשל — ${(e as Error).message}`); }
  };

  /** מסיר את הליד מלוח פגישות המצפן. הליד עצמו נשאר במערכת. */
  const removeFromBoard = async (id: string, name: string) => {
    const confirm = window.prompt(`הסרת "${name || "הליד"}" מלוח פגישות המצפן. (הליד עצמו יישאר במערכת)\n\nהקלד DELETE לאישור:`);
    if (confirm !== "DELETE") return;
    setMsg(null);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch(`/api/admin/leads/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ action: "leave-compass", confirm }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
      setMeetings((prev) => prev.filter((m) => m.id !== id));
      setMsg("הוסר מהלוח ✓");
    } catch (e) { setMsg(`נכשל — ${(e as Error).message}`); }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: meetings.length };
    for (const s of COMPASS_STATUSES) c[s.key] = 0;
    for (const m of meetings) if (m.compassStatus) c[m.compassStatus] = (c[m.compassStatus] || 0) + 1;
    return c;
  }, [meetings]);

  const shown = filter === "all" ? meetings : meetings.filter((m) => m.compassStatus === filter);
  // עימוד — 30 כרטיסים בעמוד. חזרה לעמוד 1 בכל שינוי פילטר.
  useEffect(() => { setPage(1); }, [filter]);
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const pagedShown = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (!authReady) return <main className="pcf-wrap pcf-wide"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return <main className="pcf-wrap pcf-wide"><header className="pcf-hero"><span className="pcf-badge">ניהול • פאוור קאפל</span><h1>כניסת מנהלים</h1></header><div className="pcf-card pcf-login"><button className="pcf-btn white" onClick={login}>התחברות עם Google</button></div></main>;
  if (denied) return <main className="pcf-wrap pcf-wide"><AdminNav /><div className="pcf-card" style={{ textAlign: "center" }}><p>החשבון <b>{user.email}</b> אינו מורשה.</p></div></main>;

  return (
    <main className="pcf-wrap pcf-wide">
      <AdminNav />
      <div className="pcf-admin-top">
        <div>
          <span className="pcf-badge">ניהול • פאוור קאפל</span>
          <h1 style={{ fontSize: 28, margin: "12px 0 0" }}>🧭 פגישות מצפן <span style={{ fontSize: 16, color: "var(--muted)", fontWeight: 400 }}>({shown.length}{shown.length !== meetings.length ? ` מתוך ${meetings.length}` : ""})</span></h1>
          <p style={{ color: "var(--muted)", margin: "6px 0 0", fontSize: 14 }}>לידים שנסגרו ונכנסו לתהליך פגישת המצפן. עדכנו סטטוס וצפו בכל התיעוד.</p>
        </div>
      </div>

      {/* פילטר סטטוס */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        <button className={`pcf-pill${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>הכל ({counts.all})</button>
        {COMPASS_STATUSES.map((s) => (
          <button key={s.key} className={`pcf-pill${filter === s.key ? " active" : ""}`} onClick={() => setFilter(s.key)}>{s.label} ({counts[s.key] || 0})</button>
        ))}
      </div>

      {msg && <div className={msg.includes("✓") ? "pcf-ok" : "pcf-err"} style={{ marginTop: 10 }}>{msg}</div>}
      {loading && <div className="pcf-spin" style={{ margin: "40px auto" }} />}
      {err && <div className="pcf-err">{err}</div>}

      {!loading && (
        <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
          {pagedShown.map((m) => {
            const isOpen = expanded[m.id];
            return (
              <div className="pcf-card" key={m.id} style={{ padding: 0, overflow: "hidden" }}>
                {/* כותרת הכרטיס */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, padding: "16px 18px", flexWrap: "wrap" }}>
                  <div style={{ minWidth: 220 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span className={`pcf-pill-status ${STATUS_PILL[m.compassStatus || "not_scheduled"] || "draft"}`}>{compassStatusLabel(m.compassStatus || "not_scheduled")}</span>
                      <Link href={`/admin/leads/${m.id}`} style={{ fontSize: 19, fontWeight: 700, color: "inherit", textDecoration: "none" }}>{m.fullName || "(ליד ללא שם)"}</Link>
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: 14, marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
                      {m.phone && <span dir="ltr">📞 {m.phone}</span>}
                      {m.email && <span dir="ltr">✉ {m.email}</span>}
                      <span>נכנס: {fmtDate(m.compassEnteredAt || "")}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <select value={m.compassStatus || "not_scheduled"} onChange={(e) => setStatus(m.id, e.target.value as CompassStatus)}
                      style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit", fontSize: 14 }}>
                      {COMPASS_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                    {m.convertedClientUid && <Link className="pcf-btn ghost" style={{ padding: "9px 14px", fontSize: 13 }} href={`/admin/${m.convertedClientUid}`}>👥 לקוח</Link>}
                    <Link className="pcf-btn ghost" style={{ padding: "9px 14px", fontSize: 13 }} href={`/admin/leads/${m.id}`}>🎯 ליד מלא</Link>
                    <button className="pcf-link-btn" style={{ fontSize: 13, color: "var(--accent)" }} onClick={() => removeFromBoard(m.id, m.fullName)}>מחק מהלוח</button>
                  </div>
                </div>

                {/* תיעוד */}
                <div style={{ borderTop: "1px solid var(--line)" }}>
                  <button className="pcf-link-btn" style={{ width: "100%", textAlign: "right", padding: "12px 18px", fontSize: 14, color: "var(--muted)", cursor: "pointer" }}
                    onClick={() => setExpanded((p) => ({ ...p, [m.id]: !p[m.id] }))}>
                    {isOpen ? "▲ הסתר תיעוד" : `▼ הצג תיעוד (${m.activity.length})`}
                  </button>
                  {isOpen && (
                    <div style={{ padding: "0 18px 18px", display: "grid", gap: 10 }}>
                      {m.activity.map((a) => (
                        <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", background: "var(--bg)" }}>
                          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginBottom: 4 }}>
                            {ACT_ICON[a.type] || "•"} {ACT_LABEL[a.type] || a.type} · {a.source === "api" ? "API" : a.source === "csv" ? "CSV" : a.by} · {fmtDate(a.at)}
                          </div>
                          {a.text && <ActivityText text={a.text} />}
                          {a.fields && Object.keys(a.fields).length > 0 && (
                            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                              {Object.entries(a.fields).map(([k, v]) => <div key={k}><b>{k}:</b> {v}</div>)}
                            </div>
                          )}
                        </div>
                      ))}
                      {m.activity.length === 0 && <p style={{ color: "var(--muted)" }}>אין תיעוד עדיין.</p>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {shown.length === 0 && <div className="pcf-card" style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>אין פגישות מצפן {filter !== "all" ? "בסטטוס זה" : "עדיין"}. ליד נכנס לכאן ברגע שסוגרים אותו (WON).</div>}
          {pageCount > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "6px 0 12px" }}>
              <button className="pcf-btn ghost" style={{ padding: "6px 14px", fontSize: 13 }} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← הקודם</button>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>עמוד {page} מתוך {pageCount}</span>
              <button className="pcf-btn ghost" style={{ padding: "6px 14px", fontSize: 13 }} disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>הבא →</button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
