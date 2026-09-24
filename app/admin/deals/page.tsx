"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, setPersistence, browserLocalPersistence, firebaseAuth, googleProvider, type User } from "@/lib/authClient";
import { DEAL_STATUSES, DEAL_FIELDS, dealStatusLabel, type Deal } from "@/lib/deals";
import AdminNav from "../AdminNav";

function fmtDate(s: string): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }); }
  catch { return s; }
}
const STATUS_COLOR: Record<string, string> = { new: "draft", assignment: "wait", signing_pending: "wait", signing_scheduled: "sent", executing: "sent", closed: "done", cancelled: "draft" };
// פורמט סכום עם מפרידי אלפים (2000000 → ₪2,000,000). אם לא מספרי — מציג כמו שהוא.
function money(v?: string): string {
  if (!v) return "—";
  const n = Number(String(v).replace(/[^\d.]/g, ""));
  return isNaN(n) || !String(v).replace(/[^\d.]/g, "") ? String(v) : `₪${n.toLocaleString("he-IL")}`;
}
const dealTypeOptions = DEAL_FIELDS.find((f) => f.key === "dealType")?.options || [];

export default function DealsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", city: "", dealType: "", status: "new" });
  const [statusTab, setStatusTab] = useState<string>("all"); // סינון לפי סטטוס; "all" = הכל

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);

  // ספירה לכל סטטוס לטאבים
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { all: deals.length };
    for (const s of DEAL_STATUSES) c[s.key] = 0;
    for (const d of deals) c[d.status] = (c[d.status] || 0) + 1;
    return c;
  }, [deals]);
  const shownDeals = useMemo(() => (statusTab === "all" ? deals : deals.filter((d) => d.status === statusTab)), [deals, statusTab]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null); setDenied(false);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch("/api/admin/deals", { headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 403) { setDenied(true); return; }
      if (!res.ok) throw new Error();
      setDeals((await res.json()).deals || []);
    } catch { setErr("שגיאה בטעינת העסקאות"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  const login = async () => { await setPersistence(firebaseAuth(), browserLocalPersistence); await signInWithPopup(firebaseAuth(), googleProvider).catch(() => {}); };

  const addDeal = async () => {
    if (!form.title.trim()) { setMsg("צריך שם לעסקה"); return; }
    setBusy(true); setMsg(null);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch("/api/admin/deals", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ title: form.title, status: form.status, data: { city: form.city, dealType: form.dealType } }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה");
      window.location.href = `/admin/deals/${d.deal.id}`;
    } catch (e) { setMsg(`נכשל — ${(e as Error).message}`); setBusy(false); }
  };

  if (!authReady) return <main className="pcf-wrap pcf-wide"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return <main className="pcf-wrap pcf-wide"><header className="pcf-hero"><span className="pcf-badge">ניהול • פאוור קאפל</span><h1>כניסת מנהלים</h1></header><div className="pcf-card pcf-login"><button className="pcf-btn white" onClick={login}>התחברות עם Google</button></div></main>;
  if (denied) return <main className="pcf-wrap pcf-wide"><AdminNav /><div className="pcf-card" style={{ textAlign: "center" }}><p>החשבון <b>{user.email}</b> אינו מורשה.</p></div></main>;

  return (
    <main className="pcf-wrap pcf-wide">
      <AdminNav />
      <div className="pcf-admin-top">
        <div>
          <span className="pcf-badge">ניהול • פאוור קאפל</span>
          <h1 style={{ fontSize: 28, margin: "12px 0 0" }}>עסקאות <span style={{ fontSize: 16, color: "var(--muted)", fontWeight: 400 }}>({deals.length})</span></h1>
        </div>
        <button className="pcf-btn" style={{ padding: "10px 18px", fontSize: 14 }} onClick={() => { setShowAdd((s) => !s); setMsg(null); }}>+ הוסף עסקה</button>
      </div>

      {showAdd && (
        <div className="pcf-card" style={{ marginTop: 4 }}>
          <h2 style={{ marginTop: 0 }}>עסקה חדשה</h2>
          <div className="pcf-form">
            <div className="pcf-field full"><label>שם / כותרת העסקה *</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="למשל: דירת 3 חדרים קריית ים" /></div>
            <div className="pcf-field"><label>עיר</label><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <div className="pcf-field"><label>סוג עסקה</label><select value={form.dealType} onChange={(e) => setForm({ ...form, dealType: e.target.value })}><option value="">בחרו…</option>{dealTypeOptions.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>
            <div className="pcf-field"><label>סטטוס</label><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{DEAL_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
            <button className="pcf-btn" onClick={addDeal} disabled={busy}>{busy ? "יוצר…" : "צור עסקה"}</button>
            {msg && <span className="pcf-err" style={{ marginTop: 0, padding: "8px 14px" }}>{msg}</span>}
          </div>
        </div>
      )}

      {loading && <div className="pcf-spin" style={{ margin: "40px auto" }} />}
      {err && <div className="pcf-err">{err}</div>}

      {!loading && (
        <>
          {/* טאבים לסינון מהיר לפי סטטוס העסקה */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
            <button className={`pcf-pill${statusTab === "all" ? " active" : ""}`} onClick={() => setStatusTab("all")}>הכל ({statusCounts.all})</button>
            {DEAL_STATUSES.map((s) => (
              <button key={s.key} className={`pcf-pill${statusTab === s.key ? " active" : ""}`} onClick={() => setStatusTab(s.key)}>{s.label} ({statusCounts[s.key] || 0})</button>
            ))}
          </div>

          <div className="pcf-card" style={{ marginTop: 14, padding: 0, overflow: "hidden" }}>
            <div className="pcf-admin-tabhead">ניהול עסקאות ({shownDeals.length}{shownDeals.length !== deals.length ? ` מתוך ${deals.length}` : ""})</div>
            <div style={{ overflowX: "auto" }}>
            <table className="pcf-table">
              <thead><tr><th>עסקה</th><th>עיר</th><th>סוג</th><th>מחיר</th><th>רווח צפוי</th><th>סטטוס</th><th>עודכן</th></tr></thead>
              <tbody>
                {shownDeals.map((d) => (
                  <tr key={d.id} onClick={() => (window.location.href = `/admin/deals/${d.id}`)}>
                    <td><b>{d.title}</b></td>
                    <td>{d.data.city || "—"}</td>
                    <td>{d.data.dealType || "—"}</td>
                    <td dir="ltr" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money(d.data.price)}</td>
                    <td dir="ltr" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money(d.data.expectedProfit)}</td>
                    <td><span className={`pcf-pill-status ${STATUS_COLOR[d.status] || "draft"}`}>{dealStatusLabel(d.status)}</span></td>
                    <td style={{ fontSize: 13, color: "var(--muted)" }}>{fmtDate(d.updatedAt)}</td>
                  </tr>
                ))}
                {shownDeals.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: 30, color: "var(--muted)" }}>{deals.length === 0 ? "אין עסקאות עדיין" : "אין עסקאות בסטטוס הזה"}</td></tr>}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
