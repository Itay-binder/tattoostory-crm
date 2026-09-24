"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, setPersistence, browserLocalPersistence, signOut, firebaseAuth, googleProvider, type User } from "@/lib/authClient";
import AdminNav from "./AdminNav";

const STATUS_LABELS: Record<string, string> = {
  new: "חדש",
  contacted: "נוצר קשר",
  qualified: "מוכשר",
  interested: "מעוניין",
  follow_up: "מעקב",
  enrolled: "נרשם",
  closed_lost: "נסגר",
};
const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
  new: { color: "#c4a899", bg: "rgba(196,168,153,0.12)" },
  contacted: { color: "#7db3ff", bg: "rgba(90,150,255,0.12)" },
  qualified: { color: "#d4a853", bg: "rgba(212,168,83,0.12)" },
  interested: { color: "#c8835a", bg: "rgba(200,131,90,0.14)" },
  follow_up: { color: "#e5c67a", bg: "rgba(229,198,122,0.12)" },
  enrolled: { color: "#34d399", bg: "rgba(52,211,153,0.12)" },
  closed_lost: { color: "#f87171", bg: "rgba(248,113,113,0.1)" },
};

const STATUSES = Object.keys(STATUS_LABELS);

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
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

function fmtDate(s: string): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }); }
  catch { return s; }
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

  if (!authReady) return (
    <main style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div className="pcf-spin" />
    </main>
  );

  if (!user) return (
    <main className="pcf-wrap pcf-wide">
      <div className="pcf-card pcf-login" style={{ maxWidth: 400, margin: "80px auto", textAlign: "center" }}>
        <span className="pcf-badge" style={{ marginBottom: 16, display: "inline-block" }}>Tattoo Story Academy</span>
        <h1 style={{ fontSize: 24, marginBottom: 8, fontWeight: 800 }}>כניסת מנהלים</h1>
        <p style={{ color: "var(--muted)", marginBottom: 24 }}>התחברו עם חשבון מנהל מורשה.</p>
        <button className="pcf-btn" onClick={login}>התחברות עם Google</button>
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
        <div className="pcf-user" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button className="pcf-btn" style={{ padding: "8px 16px", fontSize: 14 }} onClick={() => setShowAdd(true)}>+ ליד חדש</button>
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
            {STATUS_LABELS[s]} ({statusCounts[s] || 0})
          </button>
        ))}
      </div>

      {/* חיפוש */}
      <div style={{ marginBottom: 14 }}>
        <input
          className="pcf-search"
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
            {total} לידים{leads.length !== total ? ` (מציג ${leads.length})` : ""}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="pcf-table pcf-leads-table">
              <thead>
                <tr>
                  <th>שם</th>
                  <th>טלפון</th>
                  <th>מייל</th>
                  <th>סטטוס</th>
                  <th>מקור</th>
                  <th>נוצר</th>
                  <th>עדכון</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} style={{ cursor: "pointer" }} onClick={() => (window.location.href = `/admin/leads/${l.id}`)}>
                    <td><b>{l.full_name || "(ללא שם)"}</b></td>
                    <td dir="ltr" style={{ textAlign: "right" }}>{l.phone || "—"}</td>
                    <td dir="ltr" style={{ textAlign: "right", fontSize: 13 }}>{l.email || "—"}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select
                        value={l.status}
                        disabled={savingId === l.id}
                        onChange={(e) => changeStatus(l.id, e.target.value)}
                        style={{
                          padding: "4px 8px", borderRadius: 8, border: "1px solid var(--line)",
                          background: STATUS_COLORS[l.status]?.bg || "var(--surface)",
                          color: STATUS_COLORS[l.status]?.color || "var(--text)",
                          fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                        }}
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                      </select>
                    </td>
                    <td style={{ fontSize: 13, color: "var(--muted)" }}>{l.source || "—"}</td>
                    <td style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(l.created_at)}</td>
                    <td style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtDate(l.updated_at)}</td>
                  </tr>
                ))}
                {leads.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: "center", padding: 40, color: "var(--muted)" }}>אין לידים תואמים</td></tr>
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
