"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signInWithPopup, setPersistence, browserLocalPersistence, signOut, firebaseAuth, googleProvider, type User } from "@/lib/authClient";
import AdminNav from "./AdminNav";

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  "ליד חדש":          { label: "ליד חדש",          color: "#c4a899", bg: "rgba(196,168,153,0.12)" },
  "שיחה 1 יצאה":      { label: "שיחה 1 יצאה",      color: "#7db3ff", bg: "rgba(90,150,255,0.12)"  },
  "שתי שיחות יצאו":   { label: "שתי שיחות יצאו",   color: "#7db3ff", bg: "rgba(90,150,255,0.1)"   },
  "שלוש שיחות יצאו":  { label: "שלוש שיחות יצאו",  color: "#7db3ff", bg: "rgba(90,150,255,0.08)"  },
  "4 שיחות יצאו":     { label: "4 שיחות יצאו",     color: "#6e8478", bg: "rgba(110,132,120,0.12)" },
  "אין מענה":          { label: "אין מענה",          color: "#9b9ba0", bg: "rgba(155,155,160,0.12)" },
  "נשלחה הודעה":       { label: "נשלחה הודעה",       color: "#d4a853", bg: "rgba(212,168,83,0.12)"  },
  "נקבעה שיחה":        { label: "נקבעה שיחה",        color: "#EBD378", bg: "rgba(235,211,120,0.14)" },
  "בטיפול":            { label: "בטיפול",            color: "#8B4708", bg: "rgba(139,71,8,0.18)"    },
  "מתעניינת":          { label: "מתעניינת",          color: "#c8835a", bg: "rgba(200,131,90,0.14)"  },
  "פולואפ עתידי":      { label: "פולואפ עתידי",      color: "#e5c67a", bg: "rgba(229,198,122,0.12)" },
  "נסגר":              { label: "נסגר",              color: "#34d399", bg: "rgba(52,211,153,0.12)"  },
  "לא רלוונטי":        { label: "לא רלוונטי",        color: "#f87171", bg: "rgba(248,113,113,0.1)"  },
};

const STATUSES = Object.keys(STATUS_LABELS);

const COLUMN_DEFS = [
  { key: "full_name",            label: "שם",              default: true  },
  { key: "phone",                label: "טלפון",           default: true  },
  { key: "email",                label: "מייל",            default: true  },
  { key: "status",               label: "סטטוס",           default: true  },
  { key: "source",               label: "מקור",            default: true  },
  { key: "last_call",            label: "שיחה אחרונה",     default: true  },
  { key: "notes_rep1",           label: "הערות ליהי",      default: false },
  { key: "notes_rep2",           label: "הערות שיר",       default: false },
  { key: "gender",               label: "מגדר",            default: false },
  { key: "filled_questionnaire", label: "שאלון",           default: false },
  { key: "open_day",             label: "יום פתוח",        default: false },
  { key: "created_at",           label: "נוצר",            default: false },
];

interface Lead {
  id: string;
  status: string;
  contact_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string;
  email: string;
  source: string;
  gender: string;
  last_call: string;
  notes_rep1: string;
  notes_rep2: string;
  filled_questionnaire: boolean;
  open_day: string;
  landing_page: string;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

function fmtDate(s: string): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }); }
  catch { return s; }
}

function getCellValue(lead: Lead, key: string): string {
  switch (key) {
    case "full_name":            return lead.full_name || "(ללא שם)";
    case "phone":                return lead.phone || "—";
    case "email":                return lead.email || "—";
    case "status":               return STATUS_LABELS[lead.status]?.label || lead.status || "—";
    case "source":               return lead.source || "—";
    case "last_call":            return lead.last_call ? fmtDate(lead.last_call) : "—";
    case "notes_rep1":           return lead.notes_rep1 || "—";
    case "notes_rep2":           return lead.notes_rep2 || "—";
    case "gender":               return lead.gender || "—";
    case "filled_questionnaire": return lead.filled_questionnaire ? "כן" : "לא";
    case "open_day":             return lead.open_day || "—";
    case "created_at":           return fmtDate(lead.created_at);
    default:                     return "—";
  }
}

const LS_KEY = "tattoostory_crm_columns";

function loadCols(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.default]));
}

export default function AdminLeads() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [statusTab, setStatusTab] = useState("all");
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [newLead, setNewLead] = useState({ first_name: "", last_name: "", phone: "", email: "", source: "" });
  const [addBusy, setAddBusy] = useState(false);

  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>(() => {
    if (typeof window !== "undefined") return loadCols();
    return Object.fromEntries(COLUMN_DEFS.map((c) => [c.key, c.default]));
  });
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);

  const [colFilters, setColFilters] = useState<Record<string, string>>({});

  useEffect(() => {
    if (typeof window !== "undefined") setVisibleCols(loadCols());
  }, []);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(visibleCols)); } catch {}
  }, [visibleCols]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) setShowColPicker(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);

  const load = useCallback(async (pg = page) => {
    if (!user) return;
    setLoading(true); setErr(null); setDenied(false);
    try {
      const t = await user.getIdToken();
      const params = new URLSearchParams({ page: String(pg) });
      if (statusTab !== "all") params.set("status", statusTab);
      if (search) params.set("q", search);
      const res = await fetch(`/api/admin/leads?${params}`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 403) { setDenied(true); return; }
      if (!res.ok) throw new Error("שגיאה בטעינה");
      const d = await res.json();
      setLeads(d.leads);
      setTotal(d.total);
      setPageCount(d.pageCount);
      setStatusCounts(d.statusCounts || {});
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [user, statusTab, search, page]);

  useEffect(() => { if (user) { setPage(1); load(1); } }, [user, statusTab, search]);

  const changeStatus = async (id: string, status: string) => {
    const prev = leads.find((l) => l.id === id)?.status;
    setLeads((ls) => ls.map((l) => l.id === id ? { ...l, status } : l));
    setSavingId(id);
    try {
      const t = await user!.getIdToken();
      const res = await fetch(`/api/admin/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
    } catch (e) {
      setLeads((ls) => ls.map((l) => l.id === id ? { ...l, status: prev || "new" } : l));
      setErr(`עדכון סטטוס נכשל — ${(e as Error).message}`);
    } finally { setSavingId(null); }
  };

  const addLead = async () => {
    if (!newLead.phone && !newLead.email) { setErr("צריך טלפון או מייל"); return; }
    setAddBusy(true); setErr(null);
    try {
      const t = await user!.getIdToken();
      const res = await fetch("/api/admin/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify(newLead),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
      setShowAdd(false);
      setNewLead({ first_name: "", last_name: "", phone: "", email: "", source: "" });
      load(1);
    } catch (e) { setErr((e as Error).message); }
    finally { setAddBusy(false); }
  };

  const login = async () => {
    try {
      await setPersistence(firebaseAuth(), browserLocalPersistence);
      await signInWithPopup(firebaseAuth(), googleProvider);
    } catch (e: unknown) {
      const code = (e as { code?: string }).code || "";
      if (!code.includes("popup-closed") && !code.includes("cancelled")) setErr(`שגיאת כניסה — ${code}`);
    }
  };

  const allCount = useMemo(() => Object.values(statusCounts).reduce((a, b) => a + b, 0), [statusCounts]);

  const activeCols = COLUMN_DEFS.filter((c) => visibleCols[c.key]);

  const filteredLeads = useMemo(() => {
    if (!Object.values(colFilters).some(Boolean)) return leads;
    return leads.filter((lead) =>
      activeCols.every((col) => {
        const f = colFilters[col.key];
        if (!f) return true;
        return getCellValue(lead, col.key).toLowerCase().includes(f.toLowerCase());
      })
    );
  }, [leads, colFilters, activeCols]);

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
          style={{ height: 60, objectFit: "contain", marginBottom: 24, filter: "var(--logo-filter, none)" }}
        />
        <h1 style={{ fontSize: 22, marginBottom: 8, fontWeight: 700, color: "var(--text)" }}>כניסת מנהלים</h1>
        <p style={{ color: "var(--muted)", marginBottom: 28, fontSize: 15 }}>התחברו עם חשבון Google מורשה.</p>
        <button className="pcf-btn" style={{ width: "100%" }} onClick={login}>
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
        <h1 style={{ fontSize: 22 }}>אין גישה</h1>
        <p style={{ color: "var(--muted)" }}>החשבון <b>{user.email}</b> אינו מורשה.</p>
        <button className="pcf-btn ghost" style={{ marginTop: 16 }} onClick={() => signOut(firebaseAuth())}>התנתקות</button>
      </div>
    </main>
  );

  return (
    <main className="pcf-wrap pcf-wide">
      <AdminNav />

      <div className="pcf-admin-top">
        <div>
          <span className="pcf-badge">Tattoo Story Academy</span>
          <h1 style={{ fontSize: 26, margin: "10px 0 0", fontWeight: 800 }}>לידים</h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="pcf-btn" style={{ padding: "8px 16px", fontSize: 14 }} onClick={() => setShowAdd(true)}>+ ליד חדש</button>

          {/* כפתור עמודות */}
          <div ref={colPickerRef} style={{ position: "relative" }}>
            <button
              className="pcf-btn ghost"
              style={{ padding: "8px 14px", fontSize: 14 }}
              onClick={() => setShowColPicker((v) => !v)}
            >
              עמודות ▾
            </button>
            {showColPicker && (
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50,
                background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12,
                padding: "10px 0", minWidth: 180,
                boxShadow: "0 8px 24px var(--shadow)",
              }}>
                {COLUMN_DEFS.map((col) => (
                  <label key={col.key} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 16px", cursor: "pointer", fontSize: 14,
                  }}>
                    <input
                      type="checkbox"
                      checked={!!visibleCols[col.key]}
                      onChange={(e) => setVisibleCols((v) => ({ ...v, [col.key]: e.target.checked }))}
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <span style={{ color: "var(--muted)", fontSize: 14 }}>{user.email}</span>
          <button className="pcf-link-btn" onClick={() => signOut(firebaseAuth())}>יציאה</button>
        </div>
      </div>

      {err && <div className="pcf-err" style={{ margin: "12px 0" }}>{err}</div>}

      {/* טאבי סטטוס */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "18px 0 14px", padding: "12px 14px", background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 14 }}>
        <button className={`pcf-pill sm${statusTab === "all" ? " active" : ""}`} onClick={() => setStatusTab("all")}>הכל ({allCount})</button>
        {STATUSES.map((s) => (
          <button key={s} className={`pcf-pill sm${statusTab === s ? " active" : ""}`} onClick={() => setStatusTab(s)}>
            {STATUS_LABELS[s]?.label || s} ({statusCounts[s] || 0})
          </button>
        ))}
      </div>

      {/* חיפוש */}
      <div style={{ marginBottom: 14 }}>
        <input
          placeholder="חיפוש לפי שם, טלפון או מייל..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--text)", fontSize: 15, fontFamily: "inherit", outline: "none" }}
        />
      </div>

      {loading && <div className="pcf-spin" style={{ margin: "40px auto" }} />}

      {!loading && (
        <div className="pcf-card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="pcf-admin-tabhead">
            {total} לידים{filteredLeads.length !== total ? ` (מציג ${filteredLeads.length})` : ""}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="pcf-table pcf-leads-table">
              <thead>
                <tr>
                  {activeCols.map((col) => <th key={col.key}>{col.label}</th>)}
                </tr>
                {/* שורת פילטר */}
                <tr className="pcf-filter-row">
                  {activeCols.map((col) => (
                    <th key={col.key}>
                      <input
                        placeholder="סינון..."
                        value={colFilters[col.key] || ""}
                        onChange={(e) => setColFilters((f) => ({ ...f, [col.key]: e.target.value }))}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((l) => (
                  <tr key={l.id} style={{ cursor: "pointer" }} onClick={() => (window.location.href = `/admin/leads/${l.id}`)}>
                    {activeCols.map((col) => {
                      if (col.key === "status") return (
                        <td key="status" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={l.status}
                            disabled={savingId === l.id}
                            onChange={(e) => changeStatus(l.id, e.target.value)}
                            style={{
                              padding: "4px 8px", borderRadius: 8, border: "1px solid var(--line)",
                              background: STATUS_LABELS[l.status]?.bg || "var(--surface)",
                              color: STATUS_LABELS[l.status]?.color || "var(--text)",
                              fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                            }}
                          >
                            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]?.label || s}</option>)}
                            {!STATUS_LABELS[l.status] && <option value={l.status}>{l.status}</option>}
                          </select>
                        </td>
                      );
                      if (col.key === "phone" || col.key === "email") return (
                        <td key={col.key} dir="ltr" style={{ textAlign: "right", fontSize: col.key === "email" ? 13 : undefined }}>
                          {getCellValue(l, col.key)}
                        </td>
                      );
                      if (col.key === "full_name") return (
                        <td key="full_name"><b>{getCellValue(l, "full_name")}</b></td>
                      );
                      return (
                        <td key={col.key} style={{ fontSize: 13, color: "var(--muted)", whiteSpace: ["last_call", "created_at"].includes(col.key) ? "nowrap" : undefined }}>
                          {getCellValue(l, col.key)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {filteredLeads.length === 0 && (
                  <tr><td colSpan={activeCols.length} style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>אין לידים תואמים</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {pageCount > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, padding: "12px 0" }}>
              <button className="pcf-btn ghost" style={{ padding: "6px 14px", fontSize: 13 }} disabled={page <= 1} onClick={() => { setPage((p) => p - 1); load(page - 1); }}>← הקודם</button>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>עמוד {page} מתוך {pageCount}</span>
              <button className="pcf-btn ghost" style={{ padding: "6px 14px", fontSize: 13 }} disabled={page >= pageCount} onClick={() => { setPage((p) => p + 1); load(page + 1); }}>הבא →</button>
            </div>
          )}
        </div>
      )}

      {/* מודל הוספת ליד */}
      {showAdd && (
        <div className="pcf-modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="pcf-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 20 }}>ליד חדש</h3>
            {[
              { key: "first_name", label: "שם פרטי" },
              { key: "last_name", label: "שם משפחה" },
              { key: "phone", label: "טלפון" },
              { key: "email", label: "מייל" },
              { key: "source", label: "מקור" },
            ].map(({ key, label }) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 13, color: "var(--muted)", display: "block", marginBottom: 4 }}>{label}</label>
                <input
                  value={(newLead as Record<string, string>)[key]}
                  onChange={(e) => setNewLead((n) => ({ ...n, [key]: e.target.value }))}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--text)", fontSize: 15, fontFamily: "inherit", outline: "none" }}
                />
              </div>
            ))}
            {err && <div className="pcf-err" style={{ marginBottom: 12 }}>{err}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="pcf-btn ghost" style={{ flex: 1 }} onClick={() => setShowAdd(false)}>ביטול</button>
              <button className="pcf-btn" style={{ flex: 1 }} disabled={addBusy} onClick={addLead}>{addBusy ? <span className="pcf-spin" /> : "הוספה"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
