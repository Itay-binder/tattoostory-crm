"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { onAuthStateChanged, firebaseAuth, type User } from "@/lib/authClient";
import { clientStageLabel } from "@/lib/clients";
import { BANK_STATUSES, BANK_STATUS_KIND, PRESET_BANKS, fmtAmount, type FinancingCase } from "@/lib/financing";
import AdminNav from "../../AdminNav";
import ActivityText from "../../ActivityText";

interface Doc { id: string; origin: "lead" | "client" | "deal" | "financing"; type: string; at: string; by: string; text: string }
const ORIGIN_LABEL: Record<string, string> = { lead: "🎯 ליד", client: "👤 לקוח", deal: "🏘️ עסקה", financing: "💰 מימון" };

function fmtDate(s: string): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }); }
  catch { return s; }
}

export default function FinancingCard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [fcase, setFcase] = useState<FinancingCase | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newBank, setNewBank] = useState("");
  const [noteText, setNoteText] = useState("");
  const [amount, setAmount] = useState("");
  const [amountDirty, setAmountDirty] = useState(false);

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);
  const authHeaders = async () => ({ "Content-Type": "application/json", Authorization: `Bearer ${await firebaseAuth().currentUser!.getIdToken()}` });

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch(`/api/admin/financing/${id}`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 403) { setErr("אין הרשאת גישה"); return; }
      if (res.status === 404) { setErr("תיק המימון לא נמצא"); return; }
      if (!res.ok) throw new Error();
      const d = await res.json();
      setFcase(d.case); setDocs(d.docs || []);
      setAmount(d.case?.submissionAmount != null ? String(d.case.submissionAmount) : ""); setAmountDirty(false);
    } catch { setErr("שגיאה בטעינה"); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { if (user) load(); }, [user, load]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/financing/${id}`, { method: "POST", headers: await authHeaders(), body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "שגיאה");
      if (d.case) setFcase(d.case);
      return d;
    } catch (e) { setErr((e as Error).message); throw e; } finally { setBusy(false); }
  };

  const togglePreset = async (name: string) => {
    if (!fcase) return;
    const existing = fcase.banks.find((b) => b.bankName === name);
    try {
      if (existing) await post({ action: "remove-bank", bankId: existing.id });
      else await post({ action: "add-bank", bankName: name });
    } catch { /* err shown */ }
  };
  const addManualBank = async () => {
    const n = newBank.trim(); if (!n) return;
    try { await post({ action: "add-bank", bankName: n }); setNewBank(""); } catch { /* */ }
  };
  const setStatus = async (bankId: string, status: string) => { try { await post({ action: "set-bank-status", bankId, status }); } catch { /* */ } };
  const removeBank = async (bankId: string) => { if (!window.confirm("להסיר את גורם המימון?")) return; try { await post({ action: "remove-bank", bankId }); } catch { /* */ } };
  const addNote = async () => {
    const text = noteText.trim(); if (!text) return;
    try { const d = await post({ action: "add-note", text }); if (d.docs) setDocs(d.docs); setNoteText(""); } catch { /* */ }
  };
  const saveAmount = async () => {
    try { await post({ action: "set-amount", amount }); setAmountDirty(false); } catch { /* */ }
  };

  if (!authReady || (user && loading)) return <main className="pcf-wrap"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return <main className="pcf-wrap"><div className="pcf-card" style={{ textAlign: "center" }}><p>נדרשת התחברות. <Link href="/admin/financing" style={{ color: "var(--accent)" }}>למסך המימון</Link></p></div></main>;
  if (err && !fcase) return <main className="pcf-wrap"><div className="pcf-err">{err}</div><Link href="/admin/financing" className="pcf-link-btn">→ חזרה למימון</Link></main>;
  if (!fcase) return null;

  return (
    <main className="pcf-wrap">
      <div className="pcf-admin-top">
        <div>
          <Link href="/admin/financing" className="pcf-link-btn">→ חזרה לרשימת המימון</Link>
          <h1 style={{ fontSize: 26, margin: "10px 0 0" }}>💰 מימון — {fcase.clientName}</h1>
          <p style={{ color: "var(--muted)", margin: "6px 0 0", fontSize: 14 }}>
            <span className="pcf-pill-status draft">{clientStageLabel(fcase.clientStage)}</span>{"  "}
            <span dir="ltr">{fcase.clientPhone}</span>{fcase.clientEmail ? ` · ${fcase.clientEmail}` : ""}
          </p>
        </div>
        <Link href={`/admin/${fcase.clientId}`} className="pcf-btn ghost" style={{ padding: "10px 18px", fontSize: 14 }}>👤 לכרטיס הלקוח</Link>
      </div>

      {err && <div className="pcf-err" style={{ marginTop: 10 }}>{err}</div>}

      {/* סכום הגשה */}
      <div className="pcf-card" style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700 }}>💵 סכום הגשה:</span>
        <input value={amount} onChange={(e) => { setAmount(e.target.value); setAmountDirty(true); }} placeholder="למשל 1,800,000" dir="ltr"
          onKeyDown={(e) => { if (e.key === "Enter") saveAmount(); }}
          style={{ width: 200, padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit", fontSize: 15, textAlign: "right" }} />
        {!amountDirty && fcase.submissionAmount != null && <span style={{ color: "var(--muted)", fontSize: 14 }}>₪{fmtAmount(fcase.submissionAmount)}</span>}
        {amountDirty && <button className="pcf-btn" style={{ padding: "8px 18px", fontSize: 14 }} disabled={busy} onClick={saveAmount}>שמור</button>}
      </div>

      {/* גורמי מימון */}
      <div className="pcf-card" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}><span>🏦</span> גורמי מימון</h2>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 12px" }}>סמן גורם ששלחת אליו, וקבע לו סטטוס. אפשר להוסיף גורמים נוספים ידנית.</p>

        {/* צ'קבוקסים מובנים */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          {PRESET_BANKS.map((p) => {
            const on = fcase.banks.some((b) => b.bankName === p.name);
            return (
              <button key={p.name} type="button" className={`pcf-pill${on ? " active" : ""}`} disabled={busy} onClick={() => togglePreset(p.name)}>
                {on ? "✓ " : ""}{p.label}
              </button>
            );
          })}
        </div>

        {/* שורות גורמי מימון עם סטטוס */}
        {fcase.banks.length > 0 && (
          <div style={{ display: "grid", gap: 8 }}>
            {fcase.banks.map((b) => (
              <div key={b.id} className="pcf-link-row" style={{ padding: "10px 14px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--bg)" }}>
                <span style={{ fontWeight: 700 }}>{b.bankName}</span>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <select className={`pcf-stage-sel ${BANK_STATUS_KIND[b.status] || "draft"}`} value={b.status} disabled={busy} onChange={(e) => setStatus(b.id, e.target.value)}>
                    {BANK_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                  <button className="pcf-link-btn" style={{ fontSize: 12, color: "var(--muted)" }} onClick={() => removeBank(b.id)}>הסר</button>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* הוספה ידנית */}
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <input value={newBank} onChange={(e) => setNewBank(e.target.value)} placeholder="הוסף בנק/גורם מימון ידני…" onKeyDown={(e) => { if (e.key === "Enter") addManualBank(); }}
            style={{ flex: 1, minWidth: 200, padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit", fontSize: 15 }} />
          <button className="pcf-btn" style={{ padding: "9px 20px", fontSize: 14 }} disabled={busy || !newBank.trim()} onClick={addManualBank}>+ הוסף</button>
        </div>
      </div>

      {/* תיעוד מאוחד — כל התיעוד על הלקוח מכל המקומות */}
      <div className="pcf-card" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}><span>🗒️</span> תיעוד מלא <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>(ליד + לקוח + עסקאות + מימון — הכל במקום אחד. תיעוד מכאן מסתנכרן לכל המקומות)</span></h2>
        <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} placeholder="תעד עדכון מימון… (למשל: עדי אישרה עקרונית, ממתין למסמכים)"
          style={{ width: "100%", resize: "vertical", padding: 12, borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit", fontFamily: "inherit", fontSize: 15 }}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") addNote(); }} />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button className="pcf-btn" style={{ padding: "8px 20px", fontSize: 14 }} onClick={addNote} disabled={busy || !noteText.trim()}>+ הוסף תיעוד</button>
        </div>
        {docs.length > 0 && (
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {docs.map((n) => (
              <div key={n.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", background: "var(--bg)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginBottom: 4 }}>
                  <span style={{ marginInlineEnd: 6 }}>{ORIGIN_LABEL[n.origin] || n.origin}</span>· {n.by || "מערכת"} · {fmtDate(n.at)}
                </div>
                <ActivityText text={n.text} fontSize={15} />
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
