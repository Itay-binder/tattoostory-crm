"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, setPersistence, browserLocalPersistence, firebaseAuth, googleProvider, type User } from "@/lib/authClient";
import { LEAD_SOURCES, LEAD_STAGES, FOLLOWUP_STAGES, QUALI_FIELDS, UTM_FIELDS, stageLabel, compassStatusLabel, type Lead } from "@/lib/leads";
import { REPS, repByEmail } from "@/lib/reps";
import AdminNav from "../AdminNav";
import WhatsappButton from "../WhatsappButton";

interface LastNote { text: string; by: string; at: string; type: string }

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
function fmtDay(s: string): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short" }); }
  catch { return s; }
}
/** ISO → ערך ל-input[type=datetime-local] בשעון ישראל */
function toLocalInput(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return ""; }
}
/** מתי הפולואפ — עבר / היום / עתיד, לצביעת התא */
function dueKind(iso?: string): "none" | "overdue" | "today" | "future" {
  if (!iso) return "none";
  const d = new Date(iso); if (isNaN(d.getTime())) return "none";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  if (day.getTime() < today.getTime()) return "overdue";
  if (day.getTime() === today.getTime()) return "today";
  return "future";
}

interface CustomFieldDef { id: string; label: string; type: string; options?: string[] }
interface Column { key: string; label: string; get: (l: Lead) => string; isDate?: boolean; isDay?: boolean; kind: "core" | "meta" | "followup" | "quali" | "custom" }

const CORE_COLUMNS: Column[] = [
  { key: "fullName", label: "שם", get: (l) => l.fullName, kind: "core" },
  { key: "whatsapp", label: "ווצאפ", get: (l) => l.phone, kind: "core" },
  { key: "phone", label: "טלפון", get: (l) => l.phone, kind: "core" },
  { key: "email", label: "מייל", get: (l) => l.email, kind: "core" },
  { key: "stage", label: "שלב", get: (l) => stageLabel(l.stage), kind: "meta" },
  { key: "compassStatus", label: "פגישת התאמה", get: (l) => (l.compassStatus ? compassStatusLabel(l.compassStatus) : ""), kind: "meta" },
  { key: "assignedTo", label: "נציגה", get: (l) => repByEmail(l.assignedTo)?.name || "", kind: "meta" },
  { key: "custom.last_call_at", label: "תאריך שיחה אחרונה", get: (l) => l.custom?.last_call_at || "", isDay: true, kind: "followup" },
  { key: "lastNote", label: "תיעוד אחרון", get: () => "", kind: "followup" },
  { key: "custom.followup_at", label: "פולואפ (נקבע)", get: (l) => l.custom?.followup_at || "", isDate: true, kind: "followup" },
  { key: "createdAt", label: "נוצר", get: (l) => l.createdAt, isDate: true, kind: "meta" },
  { key: "lastLeadAt", label: "קליטה אחרונה", get: (l) => l.lastLeadAt, isDate: true, kind: "meta" },
  { key: "updatedAt", label: "עודכן", get: (l) => l.updatedAt, isDate: true, kind: "meta" },
  { key: "custom.calls", label: "שיחות שיצאו", get: (l) => l.custom?.calls || "", kind: "followup" },
  { key: "custom.landingpage", label: "דף נחיתה", get: (l) => l.custom?.landingpage || "", kind: "custom" },
];
const DEFAULT_VISIBLE = [
  "fullName", "whatsapp", "stage", "assignedTo",
  "custom.last_call_at", "lastNote", "custom.followup_at", "updatedAt",
];

export default function FollowupsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [lastNotes, setLastNotes] = useState<Record<string, LastNote>>({});
  const [customDefs, setCustomDefs] = useState<CustomFieldDef[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [visible, setVisible] = useState<string[]>(DEFAULT_VISIBLE);
  const [showCols, setShowCols] = useState(false);
  const [sortKey, setSortKey] = useState("custom.followup_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [stageTabs, setStageTabs] = useState<string[]>([]);
  const [dragCol, setDragCol] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  const PAGE_SIZE = 50;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);

  useEffect(() => {
    try {
      const v = localStorage.getItem("fuVisible"); if (v) setVisible(JSON.parse(v));
      const s = localStorage.getItem("fuSort"); if (s) { const p = JSON.parse(s); setSortKey(p.key); setSortDir(p.dir); }
      const pg = sessionStorage.getItem("fuPage"); if (pg) setPage(Math.max(1, parseInt(pg, 10) || 1));
      const st = sessionStorage.getItem("fuStageTabs"); if (st) setStageTabs(JSON.parse(st));
      const fl = sessionStorage.getItem("fuFilters"); if (fl) setFilters(JSON.parse(fl));
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { try { localStorage.setItem("fuVisible", JSON.stringify(visible)); } catch { /* */ } }, [visible]);
  useEffect(() => { try { localStorage.setItem("fuSort", JSON.stringify({ key: sortKey, dir: sortDir })); } catch { /* */ } }, [sortKey, sortDir]);
  useEffect(() => { try { sessionStorage.setItem("fuPage", String(page)); } catch { /* */ } }, [page]);
  useEffect(() => { try { sessionStorage.setItem("fuStageTabs", JSON.stringify(stageTabs)); } catch { /* */ } }, [stageTabs]);
  useEffect(() => { try { sessionStorage.setItem("fuFilters", JSON.stringify(filters)); } catch { /* */ } }, [filters]);

  const allColumns: Column[] = useMemo(() => [
    ...CORE_COLUMNS,
    ...QUALI_FIELDS.map((f): Column => ({ key: `quali.${f.key}`, label: f.label, get: (l) => l.quali?.[f.key] || "", kind: "quali" })),
    ...UTM_FIELDS.map((f): Column => ({ key: `utm.${f.key}`, label: f.label, get: (l) => l.custom?.[f.key] || "", kind: "custom" })),
    ...customDefs.map((f): Column => ({ key: `custom.${f.id}`, label: f.label, get: (l) => l.custom?.[f.id] || "", kind: "custom" })),
  ], [customDefs]);
  const colByKey = useMemo(() => Object.fromEntries(allColumns.map((c) => [c.key, c])), [allColumns]);
  const visibleCols = visible.map((k) => colByKey[k]).filter(Boolean);

  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), stage: stageTabs.length ? stageTabs.join(",") : "all", sortKey, sortDir });
    for (const [k, v] of Object.entries(filters)) if (v.trim()) p.set(`f_${k}`, v.trim());
    return p.toString();
  }, [page, stageTabs, sortKey, sortDir, filters]);

  const load = useCallback(async (q: string) => {
    setLoading(true); setErr(null); setDenied(false);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const [fRes, sRes] = await Promise.all([
        fetch(`/api/admin/followups?${q}`, { headers: { Authorization: `Bearer ${t}` } }),
        fetch("/api/admin/settings", { headers: { Authorization: `Bearer ${t}` } }),
      ]);
      if (fRes.status === 403) { setDenied(true); return; }
      if (!fRes.ok) throw new Error((await fRes.json().catch(() => ({}))).error || "load failed");
      const d = await fRes.json();
      setLeads(d.leads || []);
      setLastNotes(d.lastNotes || {});
      setTotal(d.total || 0);
      setStageCounts(d.stageCounts || {});
      if (sRes.ok) setCustomDefs(((await sRes.json()).settings?.customFields) || []);
    } catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (user) load(query); }, [user, query, load]);

  const login = async () => {
    await setPersistence(firebaseAuth(), browserLocalPersistence);
    await signInWithPopup(firebaseAuth(), googleProvider);
  };

  const setSort = (key: string) => {
    if (key === "lastNote" || key === "whatsapp") return;     // עמודות מחושבות — אין מיון בשרת
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
    setPage(1);
  };
  const setFilter = (key: string, val: string) => { setPage(1); setFilters((p) => ({ ...p, [key]: val })); };
  const toggleCol = (key: string) => setVisible((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  const moveCol = (i: number, dir: -1 | 1) => setVisible((p) => {
    const j = i + dir; if (j < 0 || j >= p.length) return p;
    const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const dropCol = (to: number) => setVisible((p) => {
    if (dragCol === null || dragCol === to) return p;
    const n = [...p]; const [m] = n.splice(dragCol, 1); n.splice(to, 0, m); return n;
  });

  /** קובע/מנקה את תאריך ושעת הפולואפ */
  const saveFollowup = async (lead: Lead, localValue: string) => {
    setSavingId(lead.id);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const iso = localValue ? new Date(localValue).toISOString() : "";
      const res = await fetch(`/api/admin/leads/${lead.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: iso
          ? JSON.stringify({ action: "update", custom: { followup_at: iso } })
          : JSON.stringify({ action: "update", clearCustom: ["followup_at"] }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "update failed");
      setLeads((prev) => prev.map((l) => (l.id === lead.id
        ? { ...l, custom: { ...l.custom, followup_at: iso } } : l)));
    } catch (e) { setErr((e as Error).message); }
    finally { setSavingId(null); }
  };

  if (!authReady) return <main className="pcf-wrap pcf-wide"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return (
    <main className="pcf-wrap pcf-wide">
      <header className="pcf-hero"><span className="pcf-badge">ניהול • Tattoo Story</span><h1>כניסת מנהלים</h1></header>
      <div className="pcf-card pcf-login"><button className="pcf-btn white" onClick={login}>התחברות עם Google</button></div>
    </main>
  );
  if (denied) return (
    <main className="pcf-wrap pcf-wide">
      <header className="pcf-hero"><span className="pcf-badge">ניהול • Tattoo Story</span><h1>אין הרשאת גישה</h1></header>
    </main>
  );

  const dueColor: Record<string, string> = { overdue: "var(--accent)", today: "var(--gold)", future: "inherit", none: "var(--muted)" };

  return (
    <main className="pcf-wrap pcf-wide">
      <AdminNav />
      <div className="pcf-admin-top">
        <div>
          <span className="pcf-badge">ניהול • Tattoo Story</span>
          <h1 style={{ fontSize: 28, margin: "12px 0 0" }}>
            ⏰ פולואפים <span style={{ fontSize: 16, color: "var(--muted)", fontWeight: 400 }}>({total.toLocaleString("he-IL")})</span>
          </h1>
          <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 0" }}>
            לידים חיים שיצאה אליהם שיחה וטרם נסגרו, ולידים שהיתה להם פגישת התאמה וטרם התקדמו.
          </p>
        </div>
        <button className="pcf-btn ghost" style={{ padding: "8px 16px", fontSize: 14 }} onClick={() => setShowCols((v) => !v)}>
          {showCols ? "סגור עמודות" : "⚙ עמודות"}
        </button>
      </div>

      {/* טאבים לסינון מהיר לפי שלב — רק השלבים שבמאגר הפולואפים */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
        <button className={`pcf-pill${stageTabs.length === 0 ? " active" : ""}`} onClick={() => { setPage(1); setStageTabs([]); }}>
          הכל ({total.toLocaleString("he-IL")})
        </button>
        {LEAD_STAGES.filter((s) => FOLLOWUP_STAGES.includes(s.key)).map((s) => {
          const on = stageTabs.includes(s.key);
          return (
            <button key={s.key} className={`pcf-pill${on ? " active" : ""}`}
              onClick={() => { setPage(1); setStageTabs((p) => on ? p.filter((k) => k !== s.key) : [...p, s.key]); }}>
              {on ? "✓ " : ""}{s.label} ({stageCounts[s.key] || 0})
            </button>
          );
        })}
      </div>

      {showCols && (
        <div className="pcf-card" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <b>עמודות מוצגות — סדר וגלוי</b>
            <button className="pcf-link-btn" onClick={() => setVisible(DEFAULT_VISIBLE)}>איפוס לברירת מחדל</button>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>אפשר לגרור את השורות כדי לשנות סדר, או להשתמש בחצים.</div>
          <div style={{ display: "grid", gap: 6 }}>
            {visibleCols.map((c, i) => (
              <div key={c.key} draggable
                onDragStart={() => setDragCol(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); dropCol(i); }}
                onDragEnd={() => setDragCol(null)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, background: dragCol === i ? "var(--bg-2)" : "var(--bg)",
                  border: `1px solid ${dragCol === i ? "var(--accent)" : "var(--line)"}`, borderRadius: 10, padding: "6px 10px",
                  cursor: "grab", opacity: dragCol === i ? 0.6 : 1,
                }}>
                <span style={{ color: "var(--muted)", fontSize: 14 }} title="גרור לשינוי סדר">⠿</span>
                <span style={{ color: "var(--muted)", fontSize: 12, minWidth: 20 }}>{i + 1}</span>
                <b style={{ flex: 1 }}>{c.label}</b>
                <button className="pcf-icon-btn" title="למעלה" disabled={i === 0} onClick={() => moveCol(i, -1)}>↑</button>
                <button className="pcf-icon-btn" title="למטה" disabled={i === visibleCols.length - 1} onClick={() => moveCol(i, 1)}>↓</button>
                <button className="pcf-icon-btn" title="הסתר" onClick={() => toggleCol(c.key)} style={{ color: "var(--accent)" }}>✕</button>
              </div>
            ))}
          </div>
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

      {err && <div className="pcf-err">{err}</div>}

      <div className="pcf-card" style={{ marginTop: 18, padding: 0, overflow: "hidden", position: "relative" }}>
        {loading && <div style={{ position: "absolute", inset: 0, background: "var(--bg)", opacity: 0.3, zIndex: 5, pointerEvents: "none" }} />}
        {loading && <span className="pcf-spin" style={{ position: "absolute", top: 12, insetInlineStart: 12, zIndex: 6, width: 16, height: 16, borderWidth: 2 }} />}
        <div style={{ overflowX: "auto" }}>
          <table className="pcf-table pcf-leads-table">
            <thead>
              <tr>
                {visibleCols.map((c) => (
                  <th key={c.key} onClick={() => setSort(c.key)}
                    style={{ cursor: c.key === "lastNote" || c.key === "whatsapp" ? "default" : "pointer", whiteSpace: "nowrap" }}>
                    {c.label}{sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
              <tr className="pcf-filter-row">
                {visibleCols.map((c) => (
                  <th key={c.key}>
                    {c.key === "stage" ? (
                      <select value={filters[c.key] || ""} onChange={(e) => setFilter(c.key, e.target.value)}>
                        <option value="">הכל</option>
                        {LEAD_STAGES.filter((s) => FOLLOWUP_STAGES.includes(s.key)).map((s) => <option key={s.key} value={s.label}>{s.label}</option>)}
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
                    ) : c.key === "lastNote" || c.key === "whatsapp" ? null : (
                      <input value={filters[c.key] || ""} onChange={(e) => setFilter(c.key, e.target.value)} placeholder="סינון…" />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => {
                const note = lastNotes[l.id];
                const kind = dueKind(l.custom?.followup_at);
                return (
                  <tr key={l.id} onClick={() => (window.location.href = `/admin/leads/${l.id}`)}>
                    {visibleCols.map((c) => (
                      <td key={c.key}
                        dir={c.key === "phone" || c.key === "email" ? "ltr" : undefined}
                        style={{ textAlign: "right", whiteSpace: c.key === "lastNote" ? "normal" : "nowrap", maxWidth: c.key === "lastNote" ? 340 : undefined }}>
                        {c.key === "fullName" ? <b>{l.fullName || "(ללא שם)"}</b>
                          : c.key === "whatsapp" ? <WhatsappButton phone={l.phone} name={l.fullName} />
                          : c.key === "stage" ? <span className="pcf-pill-status draft">{stageLabel(l.stage)}</span>
                          : c.key === "assignedTo" ? <RepAvatar email={l.assignedTo} />
                          : c.key === "lastNote" ? (note ? (
                            <span>
                              <span style={{ color: "var(--muted)", fontSize: 12 }}>{note.by || "—"} · {fmtDay(note.at)}</span>
                              <br />
                              <span title={note.text}>{note.text.length > 90 ? note.text.slice(0, 90) + "…" : note.text}</span>
                            </span>
                          ) : <span style={{ color: "var(--muted)" }}>אין תיעוד</span>)
                          : c.key === "custom.followup_at" ? (
                            <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                              <input
                                type="datetime-local"
                                value={toLocalInput(l.custom?.followup_at)}
                                onChange={(e) => saveFollowup(l, e.target.value)}
                                disabled={savingId === l.id}
                                style={{
                                  padding: "5px 8px", borderRadius: 8, border: "1px solid var(--line)",
                                  background: "var(--bg)", color: dueColor[kind], fontSize: 13,
                                  fontWeight: kind === "overdue" || kind === "today" ? 700 : 400,
                                  filter: "var(--picker-filter, none)",
                                }} />
                              {kind === "overdue" && <span title="עבר המועד">⚠️</span>}
                              {kind === "today" && <span title="היום">🔔</span>}
                            </span>
                          )
                          : c.isDay ? fmtDay(c.get(l))
                          : c.isDate ? fmtDate(c.get(l))
                          : (c.get(l) || "—")}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {leads.length === 0 && !loading && (
                <tr><td colSpan={Math.max(1, visibleCols.length)} style={{ textAlign: "center", padding: 30, color: "var(--muted)" }}>אין פולואפים תואמים</td></tr>
              )}
            </tbody>
          </table>
        </div>

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
    </main>
  );
}
