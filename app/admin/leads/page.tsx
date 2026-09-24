"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, signInWithPopup, setPersistence, browserLocalPersistence, firebaseAuth, googleProvider, type User } from "@/lib/authClient";
import { LEAD_SOURCES, LEAD_STAGES, QUICK_FILTER_STAGES, QUALI_FIELDS, UTM_FIELDS, stageLabel, leadTempEmoji, type Lead } from "@/lib/leads";
import { REPS, repByEmail } from "@/lib/reps";
import AdminNav from "../AdminNav";

/** עיגול צבעוני עם ראשי התיבות של הנציג. */
function RepAvatar({ email }: { email?: string }) {
  const r = repByEmail(email);
  if (!r) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <span title={r.name} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 30, height: 30, borderRadius: "50%", background: r.color,
      color: "#fff", fontWeight: 800, fontSize: 12, letterSpacing: 0.5,
    }}>{r.initials}</span>
  );
}

function fmtDate(s: string): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }); }
  catch { return s; }
}
const STAGE_COLORS: Record<string, string> = { done: "done", won: "done" };

interface CustomFieldDef { id: string; label: string; type: string; options?: string[] }
interface Column { key: string; label: string; get: (l: Lead) => string; isDate?: boolean; kind: "core" | "meta" | "quali" | "custom" }

const CORE_COLUMNS: Column[] = [
  { key: "fullName", label: "שם", get: (l) => `${leadTempEmoji(l.custom?.submit_count)} ${l.fullName}`.trim(), kind: "core" },
  { key: "firstName", label: "שם פרטי", get: (l) => l.firstName, kind: "core" },
  { key: "lastName", label: "שם משפחה", get: (l) => l.lastName, kind: "core" },
  { key: "phone", label: "טלפון", get: (l) => l.phone, kind: "core" },
  { key: "email", label: "מייל", get: (l) => l.email, kind: "core" },
  { key: "idNumber", label: "ת.ז", get: (l) => l.idNumber, kind: "core" },
  { key: "stage", label: "שלב", get: (l) => stageLabel(l.stage), kind: "meta" },
  { key: "assignedTo", label: "נציג", get: (l) => repByEmail(l.assignedTo)?.name || "", kind: "meta" },
  { key: "createdAt", label: "נוצר", get: (l) => l.createdAt, isDate: true, kind: "meta" },
  { key: "updatedAt", label: "עודכן", get: (l) => l.updatedAt, isDate: true, kind: "meta" },
  { key: "lastLeadAt", label: "קליטה אחרונה", get: (l) => l.lastLeadAt, isDate: true, kind: "meta" },
  { key: "custom.landingpage", label: "דף נחיתה", get: (l) => l.custom?.landingpage || "", kind: "custom" },
];
const DEFAULT_VISIBLE = ["fullName", "phone", "email", "quali.source", "stage", "updatedAt"];

export default function LeadsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [customDefs, setCustomDefs] = useState<CustomFieldDef[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", idNumber: "", source: "" });
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // טבלה: עמודות גלויות, מיון, פילטרים
  const [visible, setVisible] = useState<string[]>(DEFAULT_VISIBLE);
  const [showCols, setShowCols] = useState(false);
  const [sortKey, setSortKey] = useState("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [stageTabs, setStageTabs] = useState<string[]>([]); // בחירה מרובה; ריק = הכל
  const [category, setCategory] = useState<"sales" | "distribution">("sales"); // מכירות / רשימות תפוצה
  const [dragCol, setDragCol] = useState<number | null>(null); // גרירת עמודה לשינוי סדר
  // עימוד — הסינון, המיון והספירות רצים בשרת (ראה listLeadsPage)
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  const PAGE_SIZE = 50;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);

  // שחזור העדפות עמודות/מיון + מיקום הגלישה (עמוד/טאבים/פילטרים) — כדי שחזרה מכרטיס ליד
  // תחזיר לאותו מקום. עמוד/טאבים/פילטרים ב-sessionStorage (זמני לטאב), עמודות/מיון ב-localStorage (קבוע).
  useEffect(() => {
    try {
      const v = localStorage.getItem("leadsVisible"); if (v) setVisible(JSON.parse(v));
      const s = localStorage.getItem("leadsSort"); if (s) { const p = JSON.parse(s); setSortKey(p.key); setSortDir(p.dir); }
      const pg = sessionStorage.getItem("leadsPage"); if (pg) setPage(Math.max(1, parseInt(pg, 10) || 1));
      const st = sessionStorage.getItem("leadsStageTabs"); if (st) setStageTabs(JSON.parse(st));
      const fl = sessionStorage.getItem("leadsFilters"); if (fl) setFilters(JSON.parse(fl));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { try { localStorage.setItem("leadsVisible", JSON.stringify(visible)); } catch { /* */ } }, [visible]);
  useEffect(() => { try { localStorage.setItem("leadsSort", JSON.stringify({ key: sortKey, dir: sortDir })); } catch { /* */ } }, [sortKey, sortDir]);
  useEffect(() => { try { sessionStorage.setItem("leadsPage", String(page)); } catch { /* */ } }, [page]);
  useEffect(() => { try { sessionStorage.setItem("leadsStageTabs", JSON.stringify(stageTabs)); } catch { /* */ } }, [stageTabs]);
  useEffect(() => { try { sessionStorage.setItem("leadsFilters", JSON.stringify(filters)); } catch { /* */ } }, [filters]);

  const allColumns: Column[] = useMemo(() => [
    ...CORE_COLUMNS,
    ...QUALI_FIELDS.map((f): Column => ({ key: `quali.${f.key}`, label: f.label, get: (l) => l.quali?.[f.key] || "", kind: "quali" })),
    ...UTM_FIELDS.map((f): Column => ({ key: `utm.${f.key}`, label: f.label, get: (l) => l.custom?.[f.key] || "", kind: "custom" })),
    ...customDefs.map((f): Column => ({ key: `custom.${f.id}`, label: f.label, get: (l) => l.custom?.[f.id] || "", kind: "custom" })),
  ], [customDefs]);
  const colByKey = useMemo(() => Object.fromEntries(allColumns.map((c) => [c.key, c])), [allColumns]);
  const visibleCols = visible.map((k) => colByKey[k]).filter(Boolean);

  // הבקשה נבנית מהמצב של המסך — השרת מחזיר רק את העמוד המבוקש.
  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), stage: stageTabs.length ? stageTabs.join(",") : "all", sortKey, sortDir, category });
    for (const [k, v] of Object.entries(filters)) if (v.trim()) p.set(`f_${k}`, v.trim());
    return p.toString();
  }, [page, stageTabs, sortKey, sortDir, filters, category]);

  const load = useCallback(async (q: string) => {
    setLoading(true); setErr(null); setDenied(false);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const [lRes, sRes] = await Promise.all([
        fetch(`/api/admin/leads?${q}`, { headers: { Authorization: `Bearer ${t}` } }),
        fetch("/api/admin/settings", { headers: { Authorization: `Bearer ${t}` } }),
      ]);
      if (lRes.status === 403) { setDenied(true); return; }
      if (!lRes.ok) throw new Error();
      const d = await lRes.json();
      setLeads(d.leads || []);
      setTotal(d.total || 0);
      setStageCounts(d.stageCounts || {});
      if (sRes.ok) setCustomDefs((await sRes.json()).settings?.customFields || []);
    } catch { setErr("שגיאה בטעינת הלידים"); }
    finally { setLoading(false); }
  }, []);

  // השהיה קצרה בהקלדה כדי לא לירות בקשה על כל תו
  useEffect(() => {
    if (!user) return;
    const id = setTimeout(() => load(query), 450);
    return () => clearTimeout(id);
  }, [user, query, load]);

  const reload = useCallback(() => load(query), [load, query]);

  // איפוס העמוד לראשון נעשה בתוך פעולות המשתמש (setSort/setFilter/טאבים) — לא ב-useEffect,
  // כדי שהשחזור מ-sessionStorage בעת חזרה מכרטיס ליד לא יתאפס בטעות.

  const login = async () => { await setPersistence(firebaseAuth(), browserLocalPersistence); await signInWithPopup(firebaseAuth(), googleProvider).catch(() => {}); };

  const addLead = async () => {
    if (!form.email.trim() && !form.phone.trim()) { setAddMsg("צריך לפחות מייל או טלפון"); return; }
    setAddBusy(true); setAddMsg(null);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch("/api/admin/leads", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ firstName: form.firstName, lastName: form.lastName, email: form.email, phone: form.phone, idNumber: form.idNumber, quali: form.source ? { source: form.source } : undefined }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה");
      setAddMsg(d.merged ? "אוחד עם ליד קיים ✓" : "ליד נוסף ✓");
      setForm({ firstName: "", lastName: "", email: "", phone: "", idNumber: "", source: "" });
      reload();
    } catch (e) { setAddMsg(`נכשל — ${(e as Error).message}`); } finally { setAddBusy(false); }
  };

  const parseCSV = (text: string): Record<string, string>[] => {
    const grid: string[][] = []; let field = "", row: string[] = [], inQ = false;
    for (let i = 0; i < text.length; i++) { const c = text[i];
      if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
      else if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field); grid.push(row); row = []; field = ""; }
      else field += c;
    }
    if (field.length || row.length) { row.push(field); grid.push(row); }
    const ne = grid.filter((r) => r.some((c) => c.trim()));
    if (ne.length < 2) return [];
    const header = ne[0].map((h) => h.trim().replace(/^﻿/, ""));
    return ne.slice(1).map((r) => { const o: Record<string, string> = {}; header.forEach((h, i) => { if (h) o[h] = (r[i] ?? "").trim(); }); return o; });
  };
  const importCsv = async (file: File) => {
    setImportBusy(true); setImportMsg(null);
    try {
      const rows = parseCSV(await file.text());
      if (!rows.length) throw new Error("לא נמצאו שורות תקינות (כותרות + נתונים)");
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch("/api/admin/leads/import", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ rows }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה");
      setImportMsg(`יובאו ✓ — ${d.created} חדשים, ${d.merged} אוחדו, ${d.skipped} דולגו${d.errors?.length ? ` · ${d.errors.length} שגיאות` : ""}`);
      reload();
    } catch (e) { setImportMsg(`ייבוא נכשל — ${(e as Error).message}`); } finally { setImportBusy(false); }
  };

  const deleteLead = async (leadId: string, name: string) => {
    const confirm = window.prompt(`מחיקת "${name || "הליד"}" היא לצמיתות. הקלד DELETE לאישור:`);
    if (confirm !== "DELETE") return;
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch(`/api/admin/leads/${leadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ action: "delete-lead", confirm }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
      reload();
    } catch (e) { setErr(`מחיקה נכשלה — ${(e as Error).message}`); }
  };

  const toggleCol = (key: string) => setVisible((p) => p.includes(key) ? p.filter((k) => k !== key) : [...p, key]);
  /** גרירה: מעביר את העמודה שנגררה למיקום שעליו שוחררה. */
  const dropCol = (targetIdx: number) => {
    setVisible((p) => {
      if (dragCol === null || dragCol === targetIdx) return p;
      const n = [...p];
      const [moved] = n.splice(dragCol, 1);
      n.splice(targetIdx, 0, moved);
      return n;
    });
    setDragCol(null);
  };

  const moveCol = (idx: number, dir: -1 | 1) => setVisible((p) => {
    const n = [...p]; const j = idx + dir; if (j < 0 || j >= n.length) return p;
    [n[idx], n[j]] = [n[j], n[idx]]; return n;
  });
  const setSort = (key: string) => { setPage(1); if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir("asc"); } };
  const setFilter = (key: string, val: string) => { setPage(1); setFilters((p) => ({ ...p, [key]: val })); };

  // הסינון, המיון והספירות כבר נעשו בשרת — מה שהגיע הוא מה שמוצג.
  const rows = leads;

  if (!authReady) return <main className="pcf-wrap pcf-wide"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return <main className="pcf-wrap pcf-wide"><header className="pcf-hero"><span className="pcf-badge">ניהול • פאוור קאפל</span><h1>כניסת מנהלים</h1></header><div className="pcf-card pcf-login"><button className="pcf-btn white" onClick={login}>התחברות עם Google</button></div></main>;
  if (denied) return <main className="pcf-wrap pcf-wide"><AdminNav /><div className="pcf-card" style={{ textAlign: "center" }}><p>החשבון <b>{user.email}</b> אינו מורשה.</p></div></main>;

  return (
    <main className="pcf-wrap pcf-wide">
      <AdminNav />
      <div className="pcf-admin-top">
        <div>
          <span className="pcf-badge">ניהול • פאוור קאפל</span>
          <h1 style={{ fontSize: 28, margin: "12px 0 0" }}>לידים <span style={{ fontSize: 16, color: "var(--muted)", fontWeight: 400 }}>({total.toLocaleString("he-IL")})</span></h1>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="pcf-btn ghost" style={{ padding: "10px 16px", fontSize: 14 }} onClick={() => setShowCols((s) => !s)}>⚙ עמודות</button>
          <label className="pcf-btn ghost" style={{ padding: "10px 16px", fontSize: 14, cursor: "pointer" }}>
            {importBusy ? <><span className="pcf-spin" style={{ width: 14, height: 14, borderWidth: 2 }} /> מייבא…</> : "⬆ CSV"}
            <input type="file" accept=".csv,text/csv" style={{ display: "none" }} disabled={importBusy} onChange={(e) => { if (e.target.files?.[0]) importCsv(e.target.files[0]); e.target.value = ""; }} />
          </label>
          <button className="pcf-btn" style={{ padding: "10px 18px", fontSize: 14 }} onClick={() => { setShowAdd((s) => !s); setAddMsg(null); }}>+ הוסף ליד</button>
        </div>
      </div>
      {importMsg && <div className={importMsg.includes("✓") ? "pcf-ok" : "pcf-err"}>{importMsg}</div>}

      {/* מתג קטגוריה — מכירות מול רשימות תפוצה (לידים לא-בשלים) */}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button className={`pcf-pill${category === "sales" ? " active" : ""}`} onClick={() => { setPage(1); setStageTabs([]); setCategory("sales"); }}>🎯 מכירות</button>
        <button className={`pcf-pill${category === "distribution" ? " active" : ""}`} onClick={() => { setPage(1); setStageTabs([]); setCategory("distribution"); }}>📩 רשימות תפוצה</button>
      </div>

      {/* טאבים לסינון מהיר — בחירה מרובה (לחיצה מוסיפה/מסירה שלב) */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
        <button className={`pcf-pill${stageTabs.length === 0 ? " active" : ""}`} onClick={() => { setPage(1); setStageTabs([]); }}>הכל ({stageCounts.all})</button>
        {QUICK_FILTER_STAGES.map((s) => {
          const on = stageTabs.includes(s.key);
          return (
            <button key={s.key} className={`pcf-pill${on ? " active" : ""}`}
              onClick={() => { setPage(1); setStageTabs((p) => on ? p.filter((k) => k !== s.key) : [...p, s.key]); }}>
              {on ? "✓ " : ""}{s.label} ({stageCounts[s.key] || 0})
            </button>
          );
        })}
        {stageTabs.length > 1 && <span style={{ color: "var(--muted)", fontSize: 12 }}>{stageTabs.length} שלבים נבחרו</span>}
      </div>

      {showCols && (
        <div className="pcf-card" style={{ marginTop: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <b>עמודות מוצגות — סדר וגלוי</b>
            <button className="pcf-link-btn" onClick={() => setVisible(DEFAULT_VISIBLE)}>איפוס לברירת מחדל</button>
          </div>
          {/* עמודות גלויות — לפי סדר התצוגה, עם חצים לשינוי סדר */}
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>אפשר לגרור את השורות כדי לשנות סדר, או להשתמש בחצים.</div>
          <div style={{ display: "grid", gap: 6 }}>
            {visibleCols.map((c, i) => (
              <div key={c.key}
                draggable
                onDragStart={() => setDragCol(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); dropCol(i); }}
                onDragEnd={() => setDragCol(null)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, background: dragCol === i ? "var(--bg-2)" : "var(--bg)",
                  border: `1px solid ${dragCol === i ? "var(--accent)" : "var(--line)"}`, borderRadius: 10, padding: "6px 10px",
                  cursor: "grab", opacity: dragCol === i ? 0.6 : 1,
                }}>
                <span style={{ color: "var(--muted)", fontSize: 14, cursor: "grab" }} title="גרור לשינוי סדר">⠿</span>
                <span style={{ color: "var(--muted)", fontSize: 12, minWidth: 20 }}>{i + 1}</span>
                <b style={{ flex: 1 }}>{c.label}</b>
                <button className="pcf-icon-btn" title="למעלה" disabled={i === 0} onClick={() => moveCol(i, -1)}>↑</button>
                <button className="pcf-icon-btn" title="למטה" disabled={i === visibleCols.length - 1} onClick={() => moveCol(i, 1)}>↓</button>
                <button className="pcf-icon-btn" title="הסתר" onClick={() => toggleCol(c.key)} style={{ color: "var(--accent)" }}>✕</button>
              </div>
            ))}
          </div>
          {/* עמודות מוסתרות — להוספה */}
          {allColumns.some((c) => !visible.includes(c.key)) && (
            <>
              <div style={{ margin: "14px 0 8px", color: "var(--muted)", fontSize: 13 }}>הוסף עמודה:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {allColumns.filter((c) => !visible.includes(c.key)).map((c) => (
                  <button key={c.key} className="pcf-pill" style={{ cursor: "pointer" }} onClick={() => toggleCol(c.key)}>+ {c.label}</button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {showAdd && (
        <div className="pcf-card" style={{ marginTop: 4 }}>
          <h2 style={{ marginTop: 0 }}>ליד חדש</h2>
          <div className="pcf-form">
            <div className="pcf-field"><label>שם פרטי</label><input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
            <div className="pcf-field"><label>שם משפחה</label><input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
            <div className="pcf-field"><label>טלפון</label><input dir="ltr" style={{ textAlign: "right" }} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0521234567" /></div>
            <div className="pcf-field"><label>מייל</label><input dir="ltr" style={{ textAlign: "right" }} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="pcf-field"><label>תעודת זהות</label><input value={form.idNumber} onChange={(e) => setForm({ ...form, idNumber: e.target.value })} /></div>
            <div className="pcf-field"><label>מקור הגעה</label><select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}><option value="">בחרו…</option>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
            <button className="pcf-btn" onClick={addLead} disabled={addBusy}>{addBusy ? "שומר…" : "שמור ליד"}</button>
            {addMsg && <span className={addMsg.includes("✓") ? "pcf-ok" : "pcf-err"} style={{ marginTop: 0, padding: "8px 14px" }}>{addMsg}</span>}
          </div>
        </div>
      )}

      {err && <div className="pcf-err">{err}</div>}

      {/* הטבלה לא נהרסת בזמן טעינה — אחרת הפוקוס בשדה החיפוש נאבד בכל אות */}
      {(
        <div className="pcf-card" style={{ marginTop: 18, padding: 0, overflow: "hidden", position: "relative" }}>
          {loading && (
            <div style={{ position: "absolute", inset: 0, background: "var(--bg)", opacity: 0.3, zIndex: 5, pointerEvents: "none" }} />
          )}
          {loading && (
            <span className="pcf-spin" style={{ position: "absolute", top: 12, insetInlineStart: 12, zIndex: 6, width: 16, height: 16, borderWidth: 2 }} />
          )}
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
                      {c.key === "stage" ? (
                        <select value={filters[c.key] || ""} onChange={(e) => setFilter(c.key, e.target.value)}>
                          <option value="">הכל</option>
                          {LEAD_STAGES.map((s) => <option key={s.key} value={s.label}>{s.label}</option>)}
                        </select>
                      ) : c.key === "quali.source" ? (
                        <select value={filters[c.key] || ""} onChange={(e) => setFilter(c.key, e.target.value)}>
                          <option value="">הכל</option>
                          {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : c.key === "assignedTo" ? (
                        <select value={filters[c.key] || ""} onChange={(e) => setFilter(c.key, e.target.value)}>
                          <option value="">הכל</option>
                          {REPS.map((r) => <option key={r.email} value={r.name}>{r.name}</option>)}
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
                {rows.map((l) => (
                  <tr key={l.id} onClick={() => (window.location.href = `/admin/leads/${l.id}`)}>
                    {visibleCols.map((c) => (
                      <td key={c.key} dir={c.key === "phone" || c.key === "email" ? "ltr" : undefined} style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {c.key === "fullName" ? <b>{l.fullName || "(ללא שם)"}</b>
                          : c.key === "stage" ? <span className={`pcf-pill-status ${STAGE_COLORS[l.stage] || "draft"}`}>{stageLabel(l.stage)}</span>
                          : c.key === "assignedTo" ? <RepAvatar email={l.assignedTo} />
                          : c.isDate ? fmtDate(c.get(l)) : (c.get(l) || "—")}
                      </td>
                    ))}
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="pcf-link-btn" style={{ fontSize: 12, color: "var(--accent)" }} onClick={() => deleteLead(l.id, l.fullName)}>מחק</button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={Math.max(1, visibleCols.length) + 1} style={{ textAlign: "center", padding: 30, color: "var(--muted)" }}>אין לידים תואמים</td></tr>}
              </tbody>
            </table>
          </div>

          {/* עימוד — השרת מחזיר 50 בכל פעם */}
          {total > 0 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 16px", borderTop: "1px solid var(--line, #eee)", flexWrap: "wrap" }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>
                מציג {((page - 1) * PAGE_SIZE + 1).toLocaleString("he-IL")}–{Math.min(page * PAGE_SIZE, total).toLocaleString("he-IL")} מתוך {total.toLocaleString("he-IL")}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button className="pcf-btn ghost" style={{ padding: "7px 14px", fontSize: 14 }} disabled={page <= 1 || loading} onClick={() => setPage(1)}>« ראשון</button>
                <button className="pcf-btn ghost" style={{ padding: "7px 14px", fontSize: 14 }} disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>הקודם</button>
                <span style={{ fontSize: 14, minWidth: 90, textAlign: "center" }}>עמוד <b>{page}</b> מתוך {pages}</span>
                <button className="pcf-btn ghost" style={{ padding: "7px 14px", fontSize: 14 }} disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>הבא</button>
                <button className="pcf-btn ghost" style={{ padding: "7px 14px", fontSize: 14 }} disabled={page >= pages || loading} onClick={() => setPage(pages)}>אחרון »</button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
