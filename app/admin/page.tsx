"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, setPersistence, browserLocalPersistence, signOut, firebaseAuth, googleProvider, type User } from "@/lib/authClient";
import { CLIENT_STAGES, CLIENT_STAGE_KIND, CLIENT_PACES, clientStageLabel } from "@/lib/clients";
import { phoneCore } from "@/lib/reps";
import AdminNav from "./AdminNav";

const CONTRACT_STATUSES = ["טרם הופק הסכם", "הופק הסכם", "ממתין לחתימות", "נחתם"];

interface ClientRow {
  uid: string;
  fullName: string;
  email: string;
  phone: string;
  status: string;
  stage: string;
  contractStatus: string;
  filesCount: number;
  answeredCount: number;
  totalFields: number;
  updatedAt: string;
  submittedAt: string;
  clientSince: string;
  pace: string;
  paceUpdatedAt: string;
  driveFolderLink: string;
}

// עיצוב תגית סטטוס ההסכם
function contractPill(s: string): { color: string; bg: string } {
  if (s === "נחתם") return { color: "#34d399", bg: "rgba(37,211,102,0.12)" };
  if (s === "ממתין לחתימות") return { color: "var(--gold)", bg: "rgba(255,200,87,0.12)" };
  if (s === "הופק הסכם") return { color: "#7db3ff", bg: "rgba(90,150,255,0.12)" };
  return { color: "var(--muted)", bg: "rgba(255,255,255,0.05)" }; // טרם הופק
}
interface Stats { total: number; submitted: number; drafts: number; totalFiles: number; }

function fmtDate(s: string): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }); }
  catch { return s; }
}

export default function AdminDashboard() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  // סינון מהיר לפי שלב + חיפוש פר-עמודה
  const [stageTab, setStageTab] = useState<string>("all");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [savingStage, setSavingStage] = useState<string | null>(null);
  const [savingPace, setSavingPace] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<"clientSince" | "updatedAt">("clientSince");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const PAGE_SIZE = 50;

  const toggleSort = (k: "clientSince" | "updatedAt") => {
    if (sortKey === k) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(k); setSortDir("desc"); }
  };

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null); setDenied(false);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch("/api/admin/clients", { headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 403) { setDenied(true); return; }
      if (!res.ok) throw new Error("load failed");
      const data = await res.json();
      setStats(data.stats); setClients(data.clients);
    } catch { setErr("שגיאה בטעינת הנתונים"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (user) load(); }, [user, load]);

  const stageCounts = useMemo(() => {
    const c: Record<string, number> = { all: clients.length };
    for (const s of CLIENT_STAGES) c[s.key] = 0;
    for (const cl of clients) c[cl.stage] = (c[cl.stage] || 0) + 1;
    return c;
  }, [clients]);

  const setFilter = (k: string, v: string) => setFilters((p) => ({ ...p, [k]: v }));

  const rows = useMemo(() => {
    let out = clients;
    if (stageTab !== "all") out = out.filter((c) => c.stage === stageTab);
    const get: Record<string, (c: ClientRow) => string> = {
      fullName: (c) => c.fullName,
      phone: (c) => c.phone,
      email: (c) => c.email,
      stage: (c) => clientStageLabel(c.stage),
      status: (c) => (c.status === "submitted" ? "נשלח" : c.status === "manual" ? "לקוח ידני" : "טיוטה"),
      contractStatus: (c) => c.contractStatus,
    };
    for (const [k, v] of Object.entries(filters)) {
      if (!v.trim()) continue;
      const g = get[k]; if (!g) continue;
      // טלפון — התאמה רחבה: 0526660006 / 972526660006 / +972-52-666-0006 מוצאים אותו דבר
      if (k === "phone") {
        const core = phoneCore(v);
        if (!core) continue;
        out = out.filter((c) => phoneCore(c.phone).includes(core));
        continue;
      }
      const q = v.trim().toLowerCase();
      out = out.filter((c) => (g(c) || "").toLowerCase().includes(q));
    }
    // מיון לפי העמודה הנבחרת (תאריך)
    const dir = sortDir === "desc" ? -1 : 1;
    out = [...out].sort((a, b) => String(a[sortKey] || "").localeCompare(String(b[sortKey] || "")) * dir);
    return out;
  }, [clients, stageTab, filters, sortKey, sortDir]);

  // עימוד — 50 בעמוד. חזרה לעמוד 1 בכל שינוי סינון/מיון.
  useEffect(() => { setPage(1); }, [stageTab, filters, sortKey, sortDir]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pagedRows = useMemo(() => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [rows, page]);

  /** עדכון שלב ישירות מהטבלה — בלי להיכנס לכרטיס. עדכון אופטימי + החזרה במקרה כשל. */
  const changeStage = async (uid: string, stage: string) => {
    const prev = clients.find((c) => c.uid === uid)?.stage;
    setClients((p) => p.map((c) => (c.uid === uid ? { ...c, stage } : c)));
    setSavingStage(uid); setErr(null);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch(`/api/admin/client/${uid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ action: "set-stage", stage }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
    } catch (e) {
      setClients((p) => p.map((c) => (c.uid === uid ? { ...c, stage: prev || "new" } : c)));
      setErr(`עדכון השלב נכשל — ${(e as Error).message}`);
    } finally { setSavingStage(null); }
  };

  /** עדכון קצב הלקוח מהטבלה — עם תאריך עדכון אוטומטי. */
  const changePace = async (uid: string, pace: string) => {
    const prev = clients.find((c) => c.uid === uid);
    const now = new Date().toISOString();
    setClients((p) => p.map((c) => (c.uid === uid ? { ...c, pace, paceUpdatedAt: pace ? now : "" } : c)));
    setSavingPace(uid); setErr(null);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch(`/api/admin/client/${uid}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ action: "set-pace", pace }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
    } catch (e) {
      setClients((p) => p.map((c) => (c.uid === uid ? { ...c, pace: prev?.pace || "", paceUpdatedAt: prev?.paceUpdatedAt || "" } : c)));
      setErr(`עדכון הקצב נכשל — ${(e as Error).message}`);
    } finally { setSavingPace(null); }
  };

  const deleteClient = async (uid: string, name: string) => {
    const confirm = window.prompt(`מחיקת "${name || "הלקוח"}" היא לצמיתות. הקלד DELETE לאישור:`);
    if (confirm !== "DELETE") return;
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch(`/api/admin/client/${uid}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ action: "delete-client", confirm }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
      load();
    } catch (e) { setErr(`מחיקה נכשלה — ${(e as Error).message}`); }
  };

  const login = async () => {
    try {
      await setPersistence(firebaseAuth(), browserLocalPersistence);
      await signInWithPopup(firebaseAuth(), googleProvider);
    } catch (e: unknown) {
      const code = (e as { code?: string }).code || "";
      if (!code.includes("popup-closed") && !code.includes("cancelled")) setErr(`התחברות נכשלה — ${code}`);
    }
  };

  if (!authReady) return <main className="pcf-wrap pcf-wide"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;

  if (!user) {
    return (
      <main className="pcf-wrap pcf-wide">
        <header className="pcf-hero"><span className="pcf-badge">ניהול • פאוור קאפל</span><h1>כניסת מנהלים</h1></header>
        <div className="pcf-card pcf-login">
          <p className="lead" style={{ textAlign: "center" }}>התחברו עם חשבון מנהל מורשה.</p>
          <button className="pcf-btn white" onClick={login}>התחברות עם Google</button>
          {err && <div className="pcf-err">{err}</div>}
        </div>
      </main>
    );
  }

  if (denied) {
    return (
      <main className="pcf-wrap pcf-wide">
        <header className="pcf-hero"><span className="pcf-badge">ניהול • פאוור קאפל</span><h1>אין הרשאת גישה</h1></header>
        <div className="pcf-card" style={{ textAlign: "center" }}>
          <p style={{ color: "var(--muted)" }}>החשבון <b>{user.email}</b> אינו מורשה לממשק הניהול.</p>
          <button className="pcf-btn ghost" style={{ marginTop: 16 }} onClick={() => signOut(firebaseAuth())}>התנתקות</button>
        </div>
      </main>
    );
  }

  return (
    <main className="pcf-wrap pcf-wide">
      <AdminNav />
      <div className="pcf-admin-top">
        <div>
          <span className="pcf-badge">ניהול • פאוור קאפל</span>
          <h1 style={{ fontSize: 28, margin: "12px 0 0" }}>לקוחות</h1>
        </div>
        <div className="pcf-user">
          <a className="pcf-btn ghost" href="/admin/templates" style={{ padding: "8px 16px", fontSize: 14 }}>📄 תבניות הסכם</a>
          <span>{user.email}</span>
          <button className="pcf-link-btn" onClick={() => signOut(firebaseAuth())}>התנתקות</button>
        </div>
      </div>

      {loading && <div className="pcf-spin" style={{ margin: "40px auto" }} />}
      {err && <div className="pcf-err">{err}</div>}

      {stats && (
        <div className="pcf-stats">
          <div className="pcf-stat"><div className="num">{stats.total}</div><div className="lbl">סה"כ לקוחות</div></div>
          <div className="pcf-stat"><div className="num" style={{ color: "var(--green)" }}>{stats.submitted}</div><div className="lbl">הגישו שאלון</div></div>
          <div className="pcf-stat"><div className="num" style={{ color: "var(--gold)" }}>{stats.drafts}</div><div className="lbl">טיוטות (לא הוגש)</div></div>
          <div className="pcf-stat"><div className="num">{stats.totalFiles}</div><div className="lbl">קבצים שהועלו</div></div>
        </div>
      )}

      {stats && (
        <>
          {/* טאבים לסינון מהיר לפי שלב */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18, padding: "12px 14px", background: "var(--surface-2,rgba(255,255,255,.03))", border: "1px solid var(--line)", borderRadius: 14, alignItems: "center" }}>
            <button className={`pcf-pill sm${stageTab === "all" ? " active" : ""}`} onClick={() => setStageTab("all")}>הכל ({stageCounts.all})</button>
            {CLIENT_STAGES.map((s) => (
              <button key={s.key} className={`pcf-pill sm${stageTab === s.key ? " active" : ""}`} onClick={() => setStageTab(s.key)}>{s.label} ({stageCounts[s.key] || 0})</button>
            ))}
          </div>

          <div className="pcf-card" style={{ marginTop: 14, padding: 0, overflow: "hidden" }}>
            <div className="pcf-admin-tabhead">ניהול לקוחות ({rows.length}{rows.length !== clients.length ? ` מתוך ${clients.length}` : ""})</div>
            <div style={{ overflowX: "auto" }}>
              <table className="pcf-table pcf-leads-table">
                <thead>
                  <tr><th>שם</th><th>טלפון</th><th>אימייל</th><th>שלב</th><th>סטטוס</th><th>הסכם</th><th>התקדמות</th><th>קבצים</th><th>⚡ קצב</th><th>עדכון קצב</th>
                    <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("clientSince")}>קליטה כלקוח {sortKey === "clientSince" ? (sortDir === "desc" ? "▼" : "▲") : ""}</th>
                    <th style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => toggleSort("updatedAt")}>עודכן {sortKey === "updatedAt" ? (sortDir === "desc" ? "▼" : "▲") : ""}</th>
                    <th></th></tr>
                  <tr className="pcf-filter-row">
                    <th><input value={filters.fullName || ""} onChange={(e) => setFilter("fullName", e.target.value)} placeholder="סינון…" /></th>
                    <th><input value={filters.phone || ""} onChange={(e) => setFilter("phone", e.target.value)} placeholder="סינון…" /></th>
                    <th><input value={filters.email || ""} onChange={(e) => setFilter("email", e.target.value)} placeholder="סינון…" /></th>
                    <th>
                      <select value={filters.stage || ""} onChange={(e) => setFilter("stage", e.target.value)}>
                        <option value="">הכל</option>
                        {CLIENT_STAGES.map((s) => <option key={s.key} value={s.label}>{s.label}</option>)}
                      </select>
                    </th>
                    <th>
                      <select value={filters.status || ""} onChange={(e) => setFilter("status", e.target.value)}>
                        <option value="">הכל</option>
                        {["נשלח", "טיוטה", "לקוח ידני"].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </th>
                    <th>
                      <select value={filters.contractStatus || ""} onChange={(e) => setFilter("contractStatus", e.target.value)}>
                        <option value="">הכל</option>
                        {CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </th>
                    <th /><th /><th /><th /><th /><th />
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((c) => (
                    <tr key={c.uid} onClick={() => (window.location.href = `/admin/${c.uid}`)}>
                      <td><b>{c.fullName || "(ללא שם)"}</b></td>
                      <td dir="ltr" style={{ textAlign: "right" }}>{c.phone || "—"}</td>
                      <td dir="ltr" style={{ textAlign: "right" }}>{c.email}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select
                          className={`pcf-stage-sel ${CLIENT_STAGE_KIND[c.stage] || "draft"}`}
                          value={c.stage}
                          disabled={savingStage === c.uid}
                          onChange={(e) => changeStage(c.uid, e.target.value)}
                          title="שינוי שלב"
                        >
                          {CLIENT_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      </td>
                      <td>{c.status === "submitted" ? <span className="pcf-pill-status done">נשלח ✓</span> : c.status === "manual" ? <span className="pcf-pill-status draft">לקוח ידני</span> : <span className="pcf-pill-status draft">טיוטה</span>}</td>
                      <td><span className="pcf-pill-status" style={{ color: contractPill(c.contractStatus).color, background: contractPill(c.contractStatus).bg, whiteSpace: "nowrap" }}>{c.contractStatus}</span></td>
                      <td>{c.answeredCount}/{c.totalFields}</td>
                      <td>{c.filesCount}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <select className="pcf-stage-sel" value={c.pace || ""} disabled={savingPace === c.uid} onChange={(e) => changePace(c.uid, e.target.value)} title="קצב הלקוח">
                          <option value="">—</option>
                          {CLIENT_PACES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </td>
                      <td style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap" }}>{c.paceUpdatedAt ? fmtDate(c.paceUpdatedAt) : "—"}</td>
                      <td style={{ fontSize: 13, color: "var(--muted)" }}>{fmtDate(c.clientSince)}</td>
                      <td style={{ fontSize: 13, color: "var(--muted)" }}>{fmtDate(c.updatedAt)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <button className="pcf-link-btn" style={{ fontSize: 12, color: "var(--accent)" }} onClick={() => deleteClient(c.uid, c.fullName)}>מחק</button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={13} style={{ textAlign: "center", padding: 30, color: "var(--muted)" }}>אין לקוחות תואמים</td></tr>}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "12px 0" }}>
                <button className="pcf-btn ghost" style={{ padding: "6px 14px", fontSize: 13 }} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>← הקודם</button>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>עמוד {page} מתוך {pageCount}</span>
                <button className="pcf-btn ghost" style={{ padding: "6px 14px", fontSize: 13 }} disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>הבא →</button>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
