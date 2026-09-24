"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup, setPersistence, browserLocalPersistence, firebaseAuth, googleProvider, type User } from "@/lib/authClient";
import { clientStageLabel } from "@/lib/clients";
import { bankStatusLabel, BANK_STATUS_KIND, fmtAmount, type FinancingCase, type FinancingStats } from "@/lib/financing";
import AdminNav from "../AdminNav";

interface PickClient { uid: string; fullName: string; phone: string; email: string }

export default function FinancingPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cases, setCases] = useState<FinancingCase[]>([]);
  const [stats, setStats] = useState<FinancingStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [pickList, setPickList] = useState<PickClient[]>([]);
  const [pickSearch, setPickSearch] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null); setDenied(false);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch("/api/admin/financing", { headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 403) { setDenied(true); return; }
      if (!res.ok) throw new Error();
      const d = await res.json();
      setCases(d.cases || []); setStats(d.stats || null);
    } catch { setErr("שגיאה בטעינת המימון"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  const openAdd = async () => {
    setShowAdd((s) => !s);
    if (pickList.length === 0) {
      try {
        const t = await firebaseAuth().currentUser!.getIdToken();
        const res = await fetch("/api/admin/clients", { headers: { Authorization: `Bearer ${t}` } });
        if (res.ok) setPickList(((await res.json()).clients || []).map((c: PickClient) => ({ uid: c.uid, fullName: c.fullName, phone: c.phone, email: c.email })));
      } catch { /* ignore */ }
    }
  };

  const addClient = async (clientId: string) => {
    setBusy(true); setErr(null);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch("/api/admin/financing", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ action: "add-client", clientId }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה");
      window.location.href = `/admin/financing/${d.case.id}`;
    } catch (e) { setErr(`נכשל — ${(e as Error).message}`); setBusy(false); }
  };

  const login = async () => { await setPersistence(firebaseAuth(), browserLocalPersistence); await signInWithPopup(firebaseAuth(), googleProvider).catch(() => {}); };

  if (!authReady) return <main className="pcf-wrap pcf-wide"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return <main className="pcf-wrap pcf-wide"><header className="pcf-hero"><span className="pcf-badge">ניהול • פאוור קאפל</span><h1>כניסת מנהלים</h1></header><div className="pcf-card pcf-login"><button className="pcf-btn white" onClick={login}>התחברות עם Google</button></div></main>;
  if (denied) return <main className="pcf-wrap pcf-wide"><AdminNav /><div className="pcf-card" style={{ textAlign: "center" }}><p>החשבון <b>{user.email}</b> אינו מורשה.</p></div></main>;

  const alreadyIn = new Set(cases.map((c) => c.clientId));

  return (
    <main className="pcf-wrap pcf-wide">
      <AdminNav />
      <div className="pcf-admin-top">
        <div>
          <span className="pcf-badge">ניהול • פאוור קאפל</span>
          <h1 style={{ fontSize: 28, margin: "12px 0 0" }}>מימון <span style={{ fontSize: 16, color: "var(--muted)", fontWeight: 400 }}>({cases.length})</span></h1>
        </div>
        <button className="pcf-btn" style={{ padding: "10px 18px", fontSize: 14 }} onClick={openAdd}>+ הוסף לקוח למימון</button>
      </div>

      {loading && <div className="pcf-spin" style={{ margin: "40px auto" }} />}
      {err && <div className="pcf-err">{err}</div>}

      {/* סטטיסטיקות */}
      {stats && (
        <div className="pcf-stats" style={{ marginTop: 8 }}>
          <div className="pcf-stat"><div className="num">{stats.adiYahav}</div><div className="lbl">נשלח לעדי יהב</div></div>
          <div className="pcf-stat"><div className="num">{stats.hagitDiscount}</div><div className="lbl">נשלח לחגית דיסקונט</div></div>
          <div className="pcf-stat"><div className="num">{stats.liatYahav}</div><div className="lbl">נשלח לליאת יהב</div></div>
          <div className="pcf-stat"><div className="num">{stats.otherBank}</div><div className="lbl">בנק אחר</div></div>
          <div className="pcf-stat"><div className="num" style={{ color: "var(--gold)" }}>{stats.waitingApproval}</div><div className="lbl">ממתינים לאישור</div></div>
          <div className="pcf-stat"><div className="num" style={{ color: "var(--green)" }}>{stats.approved}</div><div className="lbl">מאושרים</div></div>
        </div>
      )}

      {/* בחירת לקוח להוספה */}
      {showAdd && (
        <div className="pcf-card" style={{ marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{ fontWeight: 700 }}>בחר לקוח להוספה למימון:</span>
            <input value={pickSearch} onChange={(e) => setPickSearch(e.target.value)} placeholder="חיפוש שם / טלפון / מייל…" style={{ flex: 1, minWidth: 220, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit", fontSize: 15 }} />
          </div>
          <div style={{ maxHeight: 280, overflowY: "auto", display: "grid", gap: 6 }}>
            {pickList
              .filter((c) => !alreadyIn.has(c.uid))
              .filter((c) => { const q = pickSearch.trim().toLowerCase(); return !q || `${c.fullName} ${c.phone} ${c.email}`.toLowerCase().includes(q); })
              .slice(0, 40)
              .map((c) => (
                <button key={c.uid} className="pcf-link-row" style={{ textAlign: "right", cursor: "pointer", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--bg)" }} disabled={busy} onClick={() => addClient(c.uid)}>
                  <span><b>{c.fullName || "(ללא שם)"}</b> <span style={{ color: "var(--muted)", fontSize: 13 }} dir="ltr">{c.phone || c.email}</span></span>
                  <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 13 }}>הוסף +</span>
                </button>
              ))}
            {pickList.length === 0 && <div className="pcf-spin" style={{ margin: "16px auto" }} />}
          </div>
        </div>
      )}

      {/* טבלת תיקי מימון */}
      {!loading && (
        <div className="pcf-card" style={{ marginTop: 18, padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="pcf-table">
              <thead><tr><th>לקוח</th><th>טלפון</th><th>שלב</th><th>סכום הגשה</th><th>גורמי מימון</th><th>סטטוסים</th></tr></thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} onClick={() => (window.location.href = `/admin/financing/${c.id}`)}>
                    <td><b>{c.clientName}</b></td>
                    <td dir="ltr" style={{ textAlign: "right" }}>{c.clientPhone || "—"}</td>
                    <td>{clientStageLabel(c.clientStage)}</td>
                    <td dir="ltr" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{c.submissionAmount != null ? `₪${fmtAmount(c.submissionAmount)}` : "—"}</td>
                    <td>{c.banks.length ? c.banks.map((b) => b.bankName).join(", ") : <span style={{ color: "var(--muted)" }}>—</span>}</td>
                    <td>
                      <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {c.banks.map((b) => <span key={b.id} className={`pcf-pill-status ${BANK_STATUS_KIND[b.status] || "draft"}`} style={{ fontSize: 11 }}>{bankStatusLabel(b.status)}</span>)}
                      </span>
                    </td>
                  </tr>
                ))}
                {cases.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 30, color: "var(--muted)" }}>אין לקוחות במימון עדיין</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
