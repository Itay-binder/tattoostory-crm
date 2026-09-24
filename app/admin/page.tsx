"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, setPersistence, browserLocalPersistence, signOut, firebaseAuth, googleProvider, type User } from "@/lib/authClient";
import AdminNav from "./AdminNav";

// ── סטטוסים ──────────────────────────────────────────────────────────────────
const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  "ליד חדש":          { label: "ליד חדש",          color: "#a0877a", bg: "rgba(196,168,153,0.15)" },
  "שיחה 1 יצאה":      { label: "שיחה 1 יצאה",      color: "#5a96d6", bg: "rgba(90,150,255,0.12)"  },
  "שתי שיחות יצאו":   { label: "שתי שיחות יצאו",   color: "#5a96d6", bg: "rgba(90,150,255,0.1)"   },
  "שלוש שיחות יצאו":  { label: "שלוש שיחות יצאו",  color: "#5a96d6", bg: "rgba(90,150,255,0.08)"  },
  "4 שיחות יצאו":     { label: "4 שיחות יצאו",     color: "#6e8478", bg: "rgba(110,132,120,0.15)" },
  "אין מענה":          { label: "אין מענה",          color: "#8c8c95", bg: "rgba(155,155,160,0.12)" },
  "נשלחה הודעה":       { label: "נשלחה הודעה",       color: "#b8920e", bg: "rgba(184,146,14,0.12)"  },
  "נקבעה שיחה":        { label: "נקבעה שיחה",        color: "#9a8720", bg: "rgba(212,196,80,0.15)"  },
  "בטיפול":            { label: "בטיפול",            color: "#8B4708", bg: "rgba(139,71,8,0.15)"    },
  "מתעניינת":          { label: "מתעניינת",          color: "#b06030", bg: "rgba(176,96,48,0.14)"   },
  "פולואפ עתידי":      { label: "פולואפ עתידי",      color: "#9a8220", bg: "rgba(180,155,50,0.12)"  },
  "נסגר":              { label: "נסגר",              color: "#1a9040", bg: "rgba(26,144,64,0.12)"   },
  "לא רלוונטי":        { label: "לא רלוונטי",        color: "#d05050", bg: "rgba(208,80,80,0.1)"    },
};
const STATUSES = Object.keys(STATUS_LABELS);

// ── הגדרת עמודות ────────────────────────────────────────────────────────────
interface Column { key: string; label: string; isDate?: boolean; ltr?: boolean }

const ALL_COLUMNS: Column[] = [
  { key: "full_name",            label: "שם"              },
  { key: "phone",                label: "טלפון",  ltr: true },
  { key: "email",                label: "מייל",   ltr: true },
  { key: "status",               label: "סטטוס"            },
  { key: "source",               label: "מקור"             },
  { key: "last_call",            label: "שיחה אחרונה"      },
  { key: "notes_rep1",           label: "הערות ליהי"       },
  { key: "notes_rep2",           label: "הערות שיר"        },
  { key: "gender",               label: "מגדר"             },
  { key: "filled_questionnaire", label: "שאלון"            },
  { key: "open_day",             label: "יום פתוח"         },
  { key: "landing_page",         label: "דף נחיתה"         },
  { key: "created_at",           label: "נוצר", isDate: true },
];

const DEFAULT_VISIBLE = ["full_name", "phone", "email", "status", "source", "last_call"];

interface Lead {
  id: string; status: string; contact_id: string;
  first_name: string; last_name: string; full_name: string;
  phone: string; email: string; source: string; gender: string;
  last_call: string; notes_rep1: string; notes_rep2: string;
  filled_questionnaire: boolean; open_day: string; landing_page: string;
  created_at: string; updated_at: string;
}

function fmtDate(s: string): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }); }
  catch { return s; }
}
function getCellValue(l: Lead, key: string): string {
  switch (key) {
    case "full_name":            return l.full_name || "(ללא שם)";
    case "phone":                return l.phone || "—";
    case "email":                return l.email || "—";
    case "status":               return STATUS_LABELS[l.status]?.label || l.status || "—";
    case "source":               return l.source || "—";
    case "last_call":            return l.last_call || "—";
    case "notes_rep1":           return l.notes_rep1 || "—";
    case "notes_rep2":           return l.notes_rep2 || "—";
    case "gender":               return l.gender || "—";
    case "filled_questionnaire": return l.filled_questionnaire ? "✓" : "—";
    case "open_day":             return l.open_day || "—";
    case "landing_page":         return l.landing_page || "—";
    case "created_at":           return fmtDate(l.created_at);
    default:                     return "—";
  }
}

// ── שמירת העדפות ────────────────────────────────────────────────────────────
const LS_VISIBLE = "ts_crm_visible";
const LS_SORT    = "ts_crm_sort";

function loadVisible(): string[] {
  try { const v = localStorage.getItem(LS_VISIBLE); if (v) return JSON.parse(v); } catch {}
  return DEFAULT_VISIBLE;
}

export default function AdminLeads() {
  const [user, setUser]         = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [denied, setDenied]     = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const [leads, setLeads]       = useState<Lead[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [statusTab, setStatusTab] = useState("all");

  const [sortKey, setSortKey]   = useState("created_at");
  const [sortDir, setSortDir]   = useState<"asc" | "desc">("desc");

  const [visible, setVisible]   = useState<string[]>(DEFAULT_VISIBLE);
  const [showCols, setShowCols] = useState(false);
  const [dragCol, setDragCol]   = useState<number | null>(null);
  const [filters, setFilters]   = useState<Record<string, string>>({});

  const [showAdd, setShowAdd]   = useState(false);
  const [newLead, setNewLead]   = useState({ first_name: "", last_name: "", phone: "", email: "", source: "" });
  const [addBusy, setAddBusy]   = useState(false);

  const PAGE_SIZE = 50;

  // שחזור העדפות
  useEffect(() => {
    try {
      const v = localStorage.getItem(LS_VISIBLE); if (v) setVisible(JSON.parse(v));
      const s = localStorage.getItem(LS_SORT);    if (s) { const p = JSON.parse(s); setSortKey(p.key); setSortDir(p.dir); }
      const pg = sessionStorage.getItem("ts_crm_page"); if (pg) setPage(Math.max(1, parseInt(pg) || 1));
      const st = sessionStorage.getItem("ts_crm_tab");  if (st) setStatusTab(st);
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem(LS_VISIBLE, JSON.stringify(visible)); } catch {} }, [visible]);
  useEffect(() => { try { localStorage.setItem(LS_SORT, JSON.stringify({ key: sortKey, dir: sortDir })); } catch {} }, [sortKey, sortDir]);
  useEffect(() => { try { sessionStorage.setItem("ts_crm_page", String(page)); } catch {} }, [page]);
  useEffect(() => { try { sessionStorage.setItem("ts_crm_tab", statusTab); } catch {} }, [statusTab]);

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);

  const colByKey = useMemo(() => Object.fromEntries(ALL_COLUMNS.map((c) => [c.key, c])), []);
  const visibleCols = useMemo(() => visible.map((k) => colByKey[k]).filter(Boolean), [visible, colByKey]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), sortKey, sortDir });
    if (statusTab !== "all") p.set("status", statusTab);
    for (const [k, v] of Object.entries(filters)) if (v.trim()) p.set(`f_${k}`, v.trim());
    return p.toString();
  }, [page, statusTab, sortKey, sortDir, filters]);

  const load = useCallback(async (q: string) => {
    if (!user) return;
    setLoading(true); setErr(null); setDenied(false);
    try {
      const t = await user.getIdToken();
      const res = await fetch(`/api/admin/leads?${q}`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 403) { setDenied(true); return; }
      if (!res.ok) throw new Error("שגיאה בטעינה");
      const d = await res.json();
      setLeads(d.leads || []);
      setTotal(d.total || 0);
      setPageCount(Math.ceil((d.total || 0) / PAGE_SIZE));
      setStatusCounts(d.statusCounts || {});
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const id = setTimeout(() => load(query), 300);
    return () => clearTimeout(id);
  }, [user, query, load]);

  const login = async () => {
    try {
      await setPersistence(firebaseAuth(), browserLocalPersistence);
      await signInWithPopup(firebaseAuth(), googleProvider);
    } catch (e: unknown) {
      const code = (e as { code?: string }).code || "";
      if (!code.includes("popup-closed") && !code.includes("cancelled")) setErr(`שגיאת כניסה — ${code}`);
    }
  };

  const addLead = async () => {
    if (!newLead.phone && !newLead.email) { setErr("צריך טלפון או מייל"); return; }
    setAddBusy(true); setErr(null);
    try {
      const t = await user!.getIdToken();
      const res = await fetch("/api/admin/leads", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify(newLead),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
      setShowAdd(false); setNewLead({ first_name: "", last_name: "", phone: "", email: "", source: "" });
      load(query);
    } catch (e) { setErr((e as Error).message); }
    finally { setAddBusy(false); }
  };

  // ניהול עמודות
  const toggleCol = (key: string) => setVisible((p) => p.includes(key) ? p.filter((k) => k !== key) : [...p, key]);
  const dropCol = (targetIdx: number) => {
    setVisible((p) => {
      if (dragCol === null || dragCol === targetIdx) return p;
      const n = [...p]; const [m] = n.splice(dragCol, 1); n.splice(targetIdx, 0, m); return n;
    });
    setDragCol(null);
  };
  const moveCol = (idx: number, dir: -1 | 1) => setVisible((p) => {
    const n = [...p]; const j = idx + dir; if (j < 0 || j >= n.length) return p;
    [n[idx], n[j]] = [n[j], n[idx]]; return n;
  });
  const setSort = (key: string) => {
    setPage(1);
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };
  const setFilter = (key: string, val: string) => { setPage(1); setFilters((p) => ({ ...p, [key]: val })); };

  const allCount = useMemo(() => Object.values(statusCounts).reduce((a, b) => a + b, 0), [statusCounts]);

  // ── מסכי אימות ────────────────────────────────────────────────────────────
  if (!authReady) return (
    <main style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div className="pcf-spin" />
    </main>
  );

  if (!user) return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div className="pcf-card" style={{ maxWidth: 380, width: "100%", margin: "0 18px", textAlign: "center", padding: "40px 32px" }}>
        <img
          src="https://tattoostoryacademy.com/wp-content/uploads/2025/03/black_logo.png"
          alt="Tattoo Story Academy"
          style={{ height: 60, objectFit: "contain", marginBottom: 24 }}
        />
        <h1 style={{ fontSize: 22, marginBottom: 8, fontWeight: 700 }}>כניסת מנהלים</h1>
        <p style={{ color: "var(--muted)", marginBottom: 28, fontSize: 15 }}>התחברו עם חשבון Google מורשה.</p>
        <button className="pcf-btn" style={{ width: "100%", gap: 10 }} onClick={login}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ flexShrink: 0 }}>
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
            <path d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          התחברות עם Google
        </button>
        {err && <div className="pcf-err" style={{ marginTop: 12 }}>{err}</div>}
      </div>
    </main>
  );

  if (denied) return (
    <main className="pcf-wrap pcf-wide">
      <div className="pcf-card" style={{ maxWidth: 400, margin: "80px auto", textAlign: "center" }}>
        <h2>אין גישה</h2>
        <p style={{ color: "var(--muted)" }}>החשבון <b>{user.email}</b> אינו מורשה.</p>
        <button className="pcf-btn ghost" style={{ marginTop: 16 }} onClick={() => signOut(firebaseAuth())}>התנתקות</button>
      </div>
    </main>
  );

  // ── מסך ראשי ───────────────────────────────────────────────────────────────
  return (
    <main className="pcf-wrap pcf-wide">
      <AdminNav />

      {/* כותרת + כפתורים */}
      <div className="pcf-admin-top">
        <div>
          <span className="pcf-badge">Tattoo Story Academy</span>
          <h1 style={{ fontSize: 26, margin: "10px 0 0", fontWeight: 800 }}>
            לידים <span style={{ fontSize: 16, color: "var(--muted)", fontWeight: 400 }}>({total.toLocaleString("he-IL")})</span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="pcf-btn ghost" style={{ padding: "10px 16px", fontSize: 14 }} onClick={() => setShowCols((s) => !s)}>⚙ עמודות</button>
          <button className="pcf-btn" style={{ padding: "10px 18px", fontSize: 14 }} onClick={() => { setShowAdd((s) => !s); setErr(null); }}>+ ליד חדש</button>
          <button className="pcf-link-btn" style={{ fontSize: 13, color: "var(--muted)" }} onClick={() => signOut(firebaseAuth())}>יציאה</button>
        </div>
      </div>

      {err && <div className="pcf-err" style={{ margin: "10px 0" }}>{err}</div>}

      {/* מנהל עמודות */}
      {showCols && (
        <div className="pcf-card" style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <b>עמודות מוצגות — סדר וגלוי</b>
            <button className="pcf-link-btn" onClick={() => setVisible(DEFAULT_VISIBLE)}>איפוס לברירת מחדל</button>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>גרור לשינוי סדר, או השתמש בחצים.</div>
          <div style={{ display: "grid", gap: 6 }}>
            {visibleCols.map((c, i) => (
              <div key={c.key}
                draggable
                onDragStart={() => setDragCol(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); dropCol(i); }}
                onDragEnd={() => setDragCol(null)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: dragCol === i ? "var(--bg-2)" : "var(--bg)",
                  border: `1px solid ${dragCol === i ? "var(--accent)" : "var(--line)"}`,
                  borderRadius: 10, padding: "6px 10px",
                  cursor: "grab", opacity: dragCol === i ? 0.6 : 1,
                }}>
                <span style={{ color: "var(--muted)", fontSize: 14 }}>⠿</span>
                <span style={{ color: "var(--muted)", fontSize: 12, minWidth: 20 }}>{i + 1}</span>
                <b style={{ flex: 1 }}>{c.label}</b>
                <button className="pcf-icon-btn" title="למעלה" disabled={i === 0} onClick={() => moveCol(i, -1)}>↑</button>
                <button className="pcf-icon-btn" title="למטה" disabled={i === visibleCols.length - 1} onClick={() => moveCol(i, 1)}>↓</button>
                <button className="pcf-icon-btn" title="הסתר" onClick={() => toggleCol(c.key)} style={{ color: "var(--accent)" }}>✕</button>
              </div>
            ))}
          </div>
          {ALL_COLUMNS.some((c) => !visible.includes(c.key)) && (
            <>
              <div style={{ margin: "14px 0 8px", color: "var(--muted)", fontSize: 13 }}>הוסף עמודה:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {ALL_COLUMNS.filter((c) => !visible.includes(c.key)).map((c) => (
                  <button key={c.key} className="pcf-pill" style={{ cursor: "pointer" }} onClick={() => toggleCol(c.key)}>+ {c.label}</button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* הוסף ליד */}
      {showAdd && (
        <div className="pcf-card" style={{ marginTop: 8 }}>
          <h3 style={{ margin: "0 0 14px", fontSize: 18 }}>ליד חדש</h3>
          <div className="pcf-form">
            {[["first_name","שם פרטי"],["last_name","שם משפחה"],["phone","טלפון"],["email","מייל"],["source","מקור"]].map(([key, label]) => (
              <div key={key} className="pcf-field">
                <label>{label}</label>
                <input
                  dir={key === "phone" || key === "email" ? "ltr" : undefined}
                  value={(newLead as Record<string, string>)[key]}
                  onChange={(e) => setNewLead((n) => ({ ...n, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button className="pcf-btn" onClick={addLead} disabled={addBusy}>{addBusy ? <span className="pcf-spin" style={{ width: 14, height: 14, borderWidth: 2 }} /> : "שמור ליד"}</button>
            <button className="pcf-btn ghost" onClick={() => setShowAdd(false)}>ביטול</button>
          </div>
        </div>
      )}

      {/* טאבי סטטוס */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 18 }}>
        <button className={`pcf-pill${statusTab === "all" ? " active" : ""}`} onClick={() => { setPage(1); setStatusTab("all"); }}>
          הכל ({allCount})
        </button>
        {STATUSES.map((s) => (
          <button key={s} className={`pcf-pill${statusTab === s ? " active" : ""}`} onClick={() => { setPage(1); setStatusTab(s); }}>
            {STATUS_LABELS[s].label} ({statusCounts[s] || 0})
          </button>
        ))}
      </div>

      {/* טבלה */}
      <div className="pcf-card" style={{ marginTop: 16, padding: 0, overflow: "hidden", position: "relative" }}>
        {loading && <div style={{ position: "absolute", inset: 0, background: "var(--bg)", opacity: 0.3, zIndex: 5, pointerEvents: "none" }} />}
        {loading && <span className="pcf-spin" style={{ position: "absolute", top: 12, insetInlineStart: 12, zIndex: 6, width: 16, height: 16, borderWidth: 2 }} />}

        <div style={{ overflowX: "auto" }}>
          <table className="pcf-table pcf-leads-table">
            <thead>
              <tr>
                {visibleCols.map((c) => (
                  <th key={c.key} onClick={() => setSort(c.key)} style={{ cursor: "pointer", whiteSpace: "nowrap" }}>
                    {c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
                <th />
              </tr>
              <tr className="pcf-filter-row">
                {visibleCols.map((c) => (
                  <th key={c.key}>
                    {c.key === "status" ? (
                      <select value={filters[c.key] || ""} onChange={(e) => setFilter(c.key, e.target.value)}>
                        <option value="">הכל</option>
                        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s].label}</option>)}
                      </select>
                    ) : c.key === "filled_questionnaire" ? (
                      <select value={filters[c.key] || ""} onChange={(e) => setFilter(c.key, e.target.value)}>
                        <option value="">הכל</option>
                        <option value="true">מילאו</option>
                        <option value="false">לא מילאו</option>
                      </select>
                    ) : (
                      <input value={filters[c.key] || ""} onChange={(e) => setFilter(c.key, e.target.value)} placeholder="סינון…" />
                    )}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} onClick={() => (window.location.href = `/admin/leads/${l.id}`)}>
                  {visibleCols.map((c) => {
                    if (c.key === "full_name") return <td key="full_name"><b>{l.full_name || "(ללא שם)"}</b></td>;
                    if (c.key === "status") return (
                      <td key="status" onClick={(e) => e.stopPropagation()}>
                        <span style={{
                          display: "inline-block", padding: "3px 10px", borderRadius: 8,
                          background: STATUS_LABELS[l.status]?.bg || "var(--surface)",
                          color: STATUS_LABELS[l.status]?.color || "var(--text)",
                          fontWeight: 600, fontSize: 13, whiteSpace: "nowrap",
                        }}>
                          {STATUS_LABELS[l.status]?.label || l.status}
                        </span>
                      </td>
                    );
                    return (
                      <td key={c.key} dir={c.ltr ? "ltr" : undefined}
                        style={{ textAlign: "right", whiteSpace: c.isDate ? "nowrap" : undefined, fontSize: c.key === "email" ? 12 : undefined }}>
                        {c.isDate ? fmtDate(getCellValue(l, c.key)) : getCellValue(l, c.key)}
                      </td>
                    );
                  })}
                  <td style={{ whiteSpace: "nowrap" }}>
                    <a href={`/admin/leads/${l.id}`} className="pcf-link-btn" style={{ fontSize: 13, color: "var(--accent)" }} onClick={(e) => e.stopPropagation()}>פתח</a>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && !loading && (
                <tr><td colSpan={visibleCols.length + 1} style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>אין לידים תואמים</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* עימוד */}
        {total > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--line)", flexWrap: "wrap" }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>
              מציג {((page - 1) * PAGE_SIZE + 1).toLocaleString("he-IL")}–{Math.min(page * PAGE_SIZE, total).toLocaleString("he-IL")} מתוך {total.toLocaleString("he-IL")}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button className="pcf-btn ghost" style={{ padding: "7px 14px", fontSize: 13 }} disabled={page <= 1 || loading} onClick={() => setPage(1)}>« ראשון</button>
              <button className="pcf-btn ghost" style={{ padding: "7px 14px", fontSize: 13 }} disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>הקודם</button>
              <span style={{ fontSize: 13, minWidth: 90, textAlign: "center" }}>עמוד <b>{page}</b> מתוך {pageCount}</span>
              <button className="pcf-btn ghost" style={{ padding: "7px 14px", fontSize: 13 }} disabled={page >= pageCount || loading} onClick={() => setPage((p) => p + 1)}>הבא</button>
              <button className="pcf-btn ghost" style={{ padding: "7px 14px", fontSize: 13 }} disabled={page >= pageCount || loading} onClick={() => setPage(pageCount)}>אחרון »</button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
