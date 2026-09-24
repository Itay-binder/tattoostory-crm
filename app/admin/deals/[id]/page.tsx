"use client";

import { useCallback, useEffect, useState, use, type ReactNode } from "react";
import Link from "next/link";
import { onAuthStateChanged, firebaseAuth, type User } from "@/lib/authClient";
import { DEAL_STATUSES, DEAL_FIELDS, NOTIFY_OPTIONS, type Deal } from "@/lib/deals";
import { isAssignableToDeal } from "@/lib/clients";
import AdminNav from "../../AdminNav";
import ActivityText from "../../ActivityText";

function fmtDate(s: string): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }); }
  catch { return s; }
}
const ACT_ICON: Record<string, string> = { note: "🗒️", status: "🔀", system: "⚙️" };

interface ClientOption { uid: string; fullName: string; email: string; phone: string; idNumber: string; stage: string }

// אזור גרירה-ושחרור לקובץ PDF (בשימוש בתכנית עסקית ובהסכם מכר)
function PdfDrop({ onFile, busy, children }: { onFile: (f: File) => void; busy: boolean; children: ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!busy) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (busy) return; const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      style={{ border: `2px dashed ${over ? "var(--accent)" : "var(--line)"}`, borderRadius: 12, padding: 16, background: over ? "var(--bg-2)" : "var(--bg)", transition: "background .15s, border-color .15s", textAlign: "center" }}
    >
      {children}
    </div>
  );
}

export default function DealDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [data, setData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [planUrl, setPlanUrl] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [agreementUrl, setAgreementUrl] = useState<string | null>(null);
  const [agreementBusy, setAgreementBusy] = useState(false);
  // צ'קליסט משימות
  const [checklistBusy, setChecklistBusy] = useState<string | null>(null);
  const [assigneeEdit, setAssigneeEdit] = useState<Record<string, string>>({});
  // ימי חתימות
  const [sdDate, setSdDate] = useState("");
  const [sdScope, setSdScope] = useState<"all" | "specific">("all");
  const [sdClients, setSdClients] = useState<string[]>([]);
  const [sdBusy, setSdBusy] = useState(false);
  // שיבוץ עסקה — השלמה אוטומטית מתוך הלקוחות
  const [allClients, setAllClients] = useState<ClientOption[]>([]);
  const [q, setQ] = useState("");
  const [openSuggest, setOpenSuggest] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  // לוח תשלומים
  const [payOpen, setPayOpen] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const emptyPay = { title: "", amount: "", dueDate: "", clientIds: [] as string[], notifyWeekBefore: false, notifyDayBefore: true, notifySameDay: true, note: "" };
  const [pay, setPay] = useState(emptyPay);
  // שיוך תיקיית דרייב
  const [driveOpen, setDriveOpen] = useState(false);
  const [driveInput, setDriveInput] = useState("");
  const [driveBusy, setDriveBusy] = useState(false);

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);
  const headers = async () => ({ "Content-Type": "application/json", Authorization: `Bearer ${await firebaseAuth().currentUser!.getIdToken()}` });

  const apply = (d: Deal) => { setDeal(d); setTitle(d.title); setData(d.data || {}); };

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch(`/api/admin/deals/${id}`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 403) { setErr("אין הרשאת גישה"); return; }
      if (res.status === 404) { setErr("העסקה לא נמצאה"); return; }
      if (!res.ok) throw new Error();
      const j = await res.json();
      apply(j.deal); setPlanUrl(j.businessPlanFileUrl || null); setAgreementUrl(j.saleAgreementFileUrl || null);
    } catch { setErr("שגיאה בטעינה"); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { if (user) load(); }, [user, load]);

  // רשימת הלקוחות להשלמה אוטומטית
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const t = await firebaseAuth().currentUser!.getIdToken();
        const res = await fetch("/api/admin/clients", { headers: { Authorization: `Bearer ${t}` } });
        if (res.ok) setAllClients((await res.json()).clients || []);
      } catch { /* ignore */ }
    })();
  }, [user]);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/deals/${id}`, { method: "POST", headers: await headers(), body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "שגיאה");
    return d;
  };

  const save = async () => {
    setSaving(true); setMsg(null);
    try { const d = await post({ action: "update", title, data }); apply(d.deal); setMsg("נשמר ✓"); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setSaving(false); }
  };
  const setStatus = async (status: string) => {
    setMsg(null);
    try { const d = await post({ action: "update", status }); apply(d.deal); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); }
  };
  const addNote = async () => {
    const text = noteText.trim(); if (!text) return;
    setNoteBusy(true); setMsg(null);
    try { const d = await post({ action: "add-note", text }); apply(d.deal); setNoteText(""); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setNoteBusy(false); }
  };
  // העלאת PDF (תכנית עסקית / הסכם מכר) בזרימת signed URL — עוקפת את מגבלת גוף-הבקשה של Vercel
  const uploadPdf = async (kind: "plan" | "agreement", file: File) => {
    if (file.type && file.type !== "application/pdf") { setMsg("נדרש קובץ PDF"); return; }
    const ep = kind === "plan" ? "plan" : "agreement";
    const setBusy = kind === "plan" ? setPlanBusy : setAgreementBusy;
    setBusy(true); setMsg(null);
    try {
      const h = await headers();
      const signRes = await fetch(`/api/admin/deals/${id}/${ep}`, { method: "POST", headers: h, body: JSON.stringify({ action: "sign", fileName: file.name, contentType: "application/pdf", size: file.size }) });
      const sign = await signRes.json().catch(() => ({}));
      if (!signRes.ok || !sign.uploadUrl) throw new Error(sign.error || "שגיאה בהכנת ההעלאה");
      const up = await fetch(sign.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: file });
      if (!up.ok) throw new Error("ההעלאה לאחסון נכשלה");
      const compRes = await fetch(`/api/admin/deals/${id}/${ep}`, { method: "POST", headers: h, body: JSON.stringify({ action: "complete", path: sign.path, fileName: file.name }) });
      const comp = await compRes.json().catch(() => ({}));
      if (!compRes.ok) throw new Error(comp.error || "שגיאה ברישום הקובץ");
      apply(comp.deal);
      if (kind === "plan") { setPlanUrl(comp.businessPlanFileUrl || null); setMsg("התכנית העסקית הועלתה ✓"); }
      else { setAgreementUrl(comp.saleAgreementFileUrl || null); setMsg("הסכם המכר הועלה וצורף ללקוחות המשובצים ✓"); }
    } catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setBusy(false); }
  };
  const removePdf = async (kind: "plan" | "agreement") => {
    const label = kind === "plan" ? "קובץ התכנית העסקית" : "קובץ הסכם המכר";
    if (!window.confirm(`להסיר את ${label}?`)) return;
    const ep = kind === "plan" ? "plan" : "agreement";
    const setBusy = kind === "plan" ? setPlanBusy : setAgreementBusy;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/deals/${id}/${ep}`, { method: "POST", headers: await headers(), body: JSON.stringify({ action: "delete" }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "שגיאה");
      apply(d.deal); if (kind === "plan") setPlanUrl(null); else setAgreementUrl(null); setMsg("הקובץ הוסר");
    } catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setBusy(false); }
  };
  const toggleChecklist = async (key: string, done: boolean) => {
    setChecklistBusy(key); setMsg(null);
    try { const d = await post({ action: "set-checklist-item", key, done }); apply(d.deal); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setChecklistBusy(null); }
  };
  const saveAssignee = async (key: string, assignee: string) => {
    setChecklistBusy(key); setMsg(null);
    try { const d = await post({ action: "set-checklist-item", key, assignee }); apply(d.deal); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setChecklistBusy(null); }
  };
  const addSigningDay = async () => {
    if (!sdDate) { setMsg("בחרו תאריך ליום החתימות"); return; }
    if (sdScope === "specific" && sdClients.length === 0) { setMsg("בחרו לפחות לקוח אחד ליום זה"); return; }
    setSdBusy(true); setMsg(null);
    try {
      const d = await post({ action: "add-signing-day", date: sdDate, scope: sdScope, clientIds: sdClients });
      apply(d.deal); setSdDate(""); setSdScope("all"); setSdClients([]); setMsg("יום החתימות נוסף ✓");
    } catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setSdBusy(false); }
  };
  const delSigningDay = async (dayId: string) => {
    if (!window.confirm("למחוק את יום החתימות?")) return;
    setMsg(null);
    try { const d = await post({ action: "delete-signing-day", dayId }); apply(d.deal); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); }
  };
  const addClient = async (clientId: string) => {
    setAssignBusy(true); setMsg(null);
    try { const d = await post({ action: "add-client", clientId }); apply(d.deal); setQ(""); setOpenSuggest(false); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setAssignBusy(false); }
  };
  const removeClient = async (clientId: string, name: string) => {
    if (!window.confirm(`להסיר את ${name} מהשיבוץ?`)) return;
    setMsg(null);
    try { const d = await post({ action: "remove-client", clientId }); apply(d.deal); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); }
  };

  const addPayment = async () => {
    if (!pay.title.trim()) { setMsg("צריך כותרת לתשלום"); return; }
    if (!pay.dueDate) { setMsg("צריך תאריך יעד"); return; }
    setPayBusy(true); setMsg(null);
    try {
      const d = await post({ action: "add-payment", ...pay, amount: pay.amount ? Number(pay.amount) : undefined });
      apply(d.deal); setPay(emptyPay); setPayOpen(false); setMsg("התשלום נוסף ללוח ✓");
    } catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setPayBusy(false); }
  };
  const setPayStatus = async (paymentId: string, status: string) => {
    setMsg(null);
    try { const d = await post({ action: "set-payment-status", paymentId, status }); apply(d.deal); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); }
  };
  const delPayment = async (paymentId: string, title: string) => {
    if (!window.confirm(`למחוק את התשלום "${title}" מהלוח?`)) return;
    try { const d = await post({ action: "delete-payment", paymentId }); apply(d.deal); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); }
  };

  const saveDriveFolder = async () => {
    const folder = driveInput.trim();
    if (!folder) { setMsg("הדביקו קישור לתיקייה בדרייב"); return; }
    setDriveBusy(true); setMsg(null);
    try { const d = await post({ action: "set-drive-folder", folder }); apply(d.deal); setDriveOpen(false); setDriveInput(""); setMsg("תיקיית הדרייב שויכה ✓"); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setDriveBusy(false); }
  };
  const unlinkDriveFolder = async () => {
    if (!window.confirm("לנתק את תיקיית הדרייב מהעסקה?")) return;
    setDriveBusy(true); setMsg(null);
    try { const d = await post({ action: "set-drive-folder", folder: "" }); apply(d.deal); setDriveOpen(false); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setDriveBusy(false); }
  };

  const del = async () => {
    if (!window.confirm("למחוק את העסקה?")) return;
    try { await post({ action: "delete" }); window.location.href = "/admin/deals"; }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); }
  };

  // כרטיס קובץ PDF (תכנית עסקית / הסכם מכר) עם גרירה-ושחרור
  const renderFileCard = (kind: "plan" | "agreement") => {
    if (!deal) return null;
    const isPlan = kind === "plan";
    const file = isPlan ? deal.businessPlanFile : deal.saleAgreementFile;
    const fileName = isPlan ? deal.businessPlanFileName : deal.saleAgreementFileName;
    const url = isPlan ? planUrl : agreementUrl;
    const busy = isPlan ? planBusy : agreementBusy;
    const desc = isPlan
      ? "העלו קובץ PDF של התכנית העסקית. הקובץ יופיע ללקוחות המשובצים לעסקה בפורטל שלהם."
      : "העלו קובץ PDF של הסכם המכר. הקובץ יצורף אוטומטית למסמכים של כל הלקוחות המשובצים לעסקה.";
    return (
      <div className="pcf-card" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}><span>{isPlan ? "📈" : "📝"}</span> {isPlan ? "תכנית עסקית" : "הסכם מכר"}</h2>
        <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 4 }}>{desc}</p>
        {file && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "10px 0 14px" }}>
            {url
              ? <a className="pcf-btn ghost" href={url} target="_blank" rel="noopener" style={{ padding: "9px 16px", fontSize: 14 }}>📄 {fileName || "צפה בקובץ"}</a>
              : <span style={{ color: "var(--muted)" }}>📄 {fileName}</span>}
            <button className="pcf-btn ghost" style={{ padding: "9px 16px", fontSize: 14 }} onClick={() => removePdf(kind)} disabled={busy}>🗑️ הסר</button>
          </div>
        )}
        <PdfDrop onFile={(f) => uploadPdf(kind, f)} busy={busy}>
          <p style={{ margin: "0 0 8px", color: "var(--muted)", fontSize: 14 }}>גררו לכאן קובץ PDF, או</p>
          <label className="pcf-btn" style={{ padding: "9px 18px", fontSize: 14, cursor: "pointer", display: "inline-block", opacity: busy ? 0.6 : 1 }}>
            {busy ? "מעלה…" : (file ? "🔄 החלף קובץ" : "⬆️ בחרו קובץ PDF")}
            <input type="file" accept="application/pdf" style={{ display: "none" }} disabled={busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPdf(kind, f); e.target.value = ""; }} />
          </label>
        </PdfDrop>
      </div>
    );
  };

  if (!authReady || (user && loading)) return <main className="pcf-wrap"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return <main className="pcf-wrap"><div className="pcf-card" style={{ textAlign: "center" }}><p>נדרשת התחברות. <Link href="/admin/deals" style={{ color: "var(--accent)" }}>לעסקאות</Link></p></div></main>;
  if (err) return <main className="pcf-wrap"><AdminNav /><div className="pcf-err">{err}</div><Link href="/admin/deals" className="pcf-link-btn">→ חזרה לעסקאות</Link></main>;
  if (!deal) return null;

  return (
    <main className="pcf-wrap">
      <AdminNav />
      <div className="pcf-admin-top">
        <div>
          <Link href="/admin/deals" className="pcf-link-btn">→ חזרה לעסקאות</Link>
          <h1 style={{ fontSize: 26, margin: "10px 0 0" }}>{deal.title}</h1>
          <p style={{ color: "var(--muted)", margin: "6px 0 0", fontSize: 14 }}>נוצר: {fmtDate(deal.createdAt)} • עודכן: {fmtDate(deal.updatedAt)}</p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={deal.status} onChange={(e) => setStatus(e.target.value)} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit", fontSize: 14 }}>
            {DEAL_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {deal.driveFolderLink
            ? <a className="pcf-btn ghost" style={{ padding: "9px 16px", fontSize: 14 }} href={deal.driveFolderLink} target="_blank" rel="noopener">📁 תיקייה בדרייב</a>
            : <button className="pcf-btn ghost" style={{ padding: "9px 16px", fontSize: 14 }} onClick={() => { setDriveOpen((o) => !o); setMsg(null); }} disabled={driveBusy}>📁 שייך תיקיית דרייב</button>}
          {deal.driveFolderLink && <button className="pcf-link-btn" style={{ fontSize: 13 }} onClick={() => { setDriveOpen((o) => !o); setDriveInput(deal.driveFolderId || ""); setMsg(null); }}>שנה שיוך</button>}
          <button className="pcf-link-btn" style={{ color: "var(--accent)" }} onClick={del}>מחק</button>
        </div>
      </div>
      {msg && <div className={msg.includes("✓") ? "pcf-ok" : "pcf-err"} style={{ marginTop: 10 }}>{msg}</div>}

      {driveOpen && (
        <div className="pcf-card" style={{ marginTop: 10, padding: 16 }}>
          <label style={{ display: "block", color: "var(--muted)", fontSize: 13, marginBottom: 6 }}>קישור לתיקייה בגוגל דרייב (או מזהה תיקייה)</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              value={driveInput}
              onChange={(e) => setDriveInput(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/…"
              disabled={driveBusy}
              dir="ltr"
              style={{ flex: "1 1 340px", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit", fontSize: 14, textAlign: "left" }}
            />
            <button className="pcf-btn" style={{ padding: "10px 18px", fontSize: 14 }} onClick={saveDriveFolder} disabled={driveBusy}>{driveBusy ? "משייך…" : "שייך"}</button>
            {deal.driveFolderLink && <button className="pcf-link-btn" style={{ color: "var(--accent)", fontSize: 13 }} onClick={unlinkDriveFolder} disabled={driveBusy}>נתק שיוך</button>}
          </div>
        </div>
      )}

      {/* שיבוץ עסקה — לקוחות משובצים */}
      <div className="pcf-card" style={{ marginTop: 18 }}>
        <h2><span>👥</span> שיבוץ עסקה <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>({deal.clients.length} לקוחות)</span></h2>

        {/* לקוחות משובצים */}
        {deal.clients.length > 0 ? (
          <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
            {deal.clients.map((c) => (
              <div key={c.clientId} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", background: "var(--bg)" }}>
                <Link href={`/admin/${c.clientId}`} style={{ fontWeight: 700, color: "inherit", textDecoration: "none" }}>{c.fullName || "(ללא שם)"}</Link>
                {c.phone && <span dir="ltr" style={{ color: "var(--muted)", fontSize: 13 }}>📞 {c.phone}</span>}
                {c.email && <span dir="ltr" style={{ color: "var(--muted)", fontSize: 13 }}>✉ {c.email}</span>}
                <button className="pcf-link-btn" style={{ marginInlineStart: "auto", color: "var(--accent)", fontSize: 13 }} onClick={() => removeClient(c.clientId, c.fullName)}>הסר</button>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 0 }}>אין לקוחות משובצים עדיין. התחילו להקליד שם כדי לשבץ.</p>
        )}

        {/* הוספה עם השלמה אוטומטית */}
        <div style={{ position: "relative", maxWidth: 460 }}>
          <label style={{ display: "block", color: "var(--muted)", fontSize: 13, marginBottom: 6 }}>הוסף לקוח</label>
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpenSuggest(true); }}
            onFocus={() => setOpenSuggest(true)}
            onBlur={() => setTimeout(() => setOpenSuggest(false), 150)}
            placeholder="התחילו להקליד שם, מייל, טלפון או ת.ז…"
            disabled={assignBusy}
            style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit", fontSize: 15 }}
          />
          {openSuggest && (() => {
            const assigned = new Set(deal.clients.map((c) => c.clientId));
            const needle = q.trim().toLowerCase();
            const matches = allClients
              .filter((c) => !assigned.has(c.uid))
              .filter((c) => isAssignableToDeal(c.stage)) // לא משבצים חתמו דירה / הקפאה / בוטל
              .filter((c) => !needle || [c.fullName, c.email, c.phone, c.idNumber].some((v) => (v || "").toLowerCase().includes(needle)))
              .slice(0, 8);
            if (!matches.length) return null;
            return (
              <div style={{ position: "absolute", zIndex: 20, top: "100%", insetInline: 0, marginTop: 4, background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", boxShadow: "0 8px 24px var(--shadow)" }}>
                {matches.map((c) => (
                  <div
                    key={c.uid}
                    onMouseDown={(e) => { e.preventDefault(); addClient(c.uid); }}
                    style={{ padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid var(--line)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ fontWeight: 600 }}>{c.fullName || "(ללא שם)"}</div>
                    <div dir="ltr" style={{ fontSize: 12, color: "var(--muted)", textAlign: "right" }}>{[c.phone, c.email].filter(Boolean).join(" · ") || "—"}</div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      {/* לוח תשלומים */}
      <div className="pcf-card" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}><span>💰</span> לוח תשלומים <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>({deal.payments.length})</span></h2>
          <button className="pcf-btn" style={{ padding: "9px 16px", fontSize: 14 }} onClick={() => { setPayOpen((o) => !o); setMsg(null); }}>+ צור תשלום</button>
        </div>

        {payOpen && (
          <div style={{ marginTop: 14, padding: 16, border: "1px solid var(--line)", borderRadius: 12, background: "var(--bg)" }}>
            <div className="pcf-form">
              <div className="pcf-field"><label>כותרת התשלום *</label><input value={pay.title} onChange={(e) => setPay({ ...pay, title: e.target.value })} placeholder="למשל: מקדמה / תשלום שני" /></div>
              <div className="pcf-field"><label>סכום (₪)</label><input type="number" min={0} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder="לא חובה" /></div>
              <div className="pcf-field"><label>תאריך יעד *</label><input type="date" value={pay.dueDate} onChange={(e) => setPay({ ...pay, dueDate: e.target.value })} /></div>
              <div className="pcf-field full"><label>הערה למייל (לא חובה)</label><input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} placeholder="טקסט חופשי שיופיע בתזכורת" /></div>
            </div>

            {/* שיוך לקוחות מתוך לקוחות העסקה */}
            <div style={{ marginTop: 14 }}>
              <label style={{ display: "block", color: "var(--muted)", fontSize: 13, marginBottom: 6 }}>למי לשלוח (מתוך לקוחות העסקה)</label>
              {deal.clients.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>אין לקוחות משובצים לעסקה — שבצו קודם בסקשן "שיבוץ עסקה". (בלי לקוח התזכורת תגיע רק אליכם)</p>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {deal.clients.map((c) => {
                    const on = pay.clientIds.includes(c.clientId);
                    return (
                      <button key={c.clientId} type="button" className={`pcf-pill${on ? " active" : ""}`}
                        onClick={() => setPay({ ...pay, clientIds: on ? pay.clientIds.filter((x) => x !== c.clientId) : [...pay.clientIds, c.clientId] })}>
                        {on ? "✓ " : ""}{c.fullName || c.email || "לקוח"}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* מתי להתריע */}
            <div style={{ marginTop: 14 }}>
              <label style={{ display: "block", color: "var(--muted)", fontSize: 13, marginBottom: 6 }}>מתי להתריע?</label>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                {NOTIFY_OPTIONS.map((o) => (
                  <label key={o.key} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 15 }}>
                    <input type="checkbox" checked={pay[o.key]} onChange={(e) => setPay({ ...pay, [o.key]: e.target.checked })} style={{ width: 18, height: 18, cursor: "pointer" }} />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16 }}>
              <button className="pcf-btn" onClick={addPayment} disabled={payBusy}>{payBusy ? "שומר…" : "צור תשלום"}</button>
              <button className="pcf-link-btn" onClick={() => { setPayOpen(false); setPay(emptyPay); }}>ביטול</button>
            </div>
          </div>
        )}

        {/* רשימת התשלומים */}
        {deal.payments.length > 0 ? (
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table className="pcf-table">
              <thead><tr><th>תשלום</th><th>סכום</th><th>תאריך יעד</th><th>למי</th><th>התרעות</th><th>סטטוס</th><th></th></tr></thead>
              <tbody>
                {deal.payments.map((p) => {
                  const names = p.clientIds.map((id) => deal.clients.find((c) => c.clientId === id)?.fullName || "לקוח").join(", ");
                  const alerts = NOTIFY_OPTIONS.filter((o) => p[o.key]).map((o) => o.label);
                  const overdue = p.status === "pending" && p.dueDate < new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={p.id} style={{ cursor: "default" }}>
                      <td><b>{p.title}</b>{p.note && <div style={{ fontSize: 12, color: "var(--muted)" }}>{p.note}</div>}</td>
                      <td>{p.amount ? `₪${p.amount.toLocaleString("he-IL")}` : "—"}</td>
                      <td style={{ whiteSpace: "nowrap", color: overdue ? "var(--accent)" : undefined, fontWeight: overdue ? 700 : undefined }}>
                        {new Date(p.dueDate).toLocaleDateString("he-IL")}{overdue ? " (עבר)" : ""}
                      </td>
                      <td style={{ fontSize: 13 }}>{names || <span style={{ color: "var(--muted)" }}>רק אליכם</span>}</td>
                      <td style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {alerts.length ? alerts.join(" · ") : "—"}
                        {p.sent.length > 0 && <div style={{ color: "var(--green)" }}>נשלחו: {p.sent.length}</div>}
                      </td>
                      <td>
                        <span className={`pcf-pill-status ${p.status === "paid" ? "done" : p.status === "canceled" ? "draft" : "wait"}`}>
                          {p.status === "paid" ? "שולם" : p.status === "canceled" ? "בוטל" : "ממתין"}
                        </span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {p.status !== "paid" && <button className="pcf-link-btn" style={{ fontSize: 12, color: "var(--green)" }} onClick={() => setPayStatus(p.id, "paid")}>סמן שולם</button>}
                        {p.status === "paid" && <button className="pcf-link-btn" style={{ fontSize: 12, color: "var(--muted)" }} onClick={() => setPayStatus(p.id, "pending")}>החזר לממתין</button>}
                        <button className="pcf-link-btn" style={{ fontSize: 12, color: "var(--accent)", marginInlineStart: 10 }} onClick={() => delPayment(p.id, p.title)}>מחק</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          !payOpen && <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 0 }}>אין תשלומים בלוח. לחצו "צור תשלום" כדי להוסיף תזכורת.</p>
        )}
        <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          התזכורות נשלחות אוטומטית במייל מ-blog@powercouple.co.il ללקוחות המשויכים, עם עותק אליכם.
        </p>
      </div>

      {/* פרטי העסקה */}
      <div className="pcf-card" style={{ marginTop: 18 }}>
        <h2><span>🏘️</span> פרטי העסקה</h2>
        <div className="pcf-form">
          <div className="pcf-field full"><label>שם / כותרת</label><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          {DEAL_FIELDS.map((f) => (
            <div className={`pcf-field${f.type === "textarea" ? " full" : ""}`} key={f.key}>
              <label>{f.label}</label>
              {f.type === "textarea" ? <textarea value={data[f.key] || ""} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} />
                : f.type === "select" ? <select value={data[f.key] || ""} onChange={(e) => setData({ ...data, [f.key]: e.target.value })}><option value="">בחרו…</option>{f.options!.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                : <input type={f.type === "number" ? "number" : "text"} value={data[f.key] || ""} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} />}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button className="pcf-btn" onClick={save} disabled={saving}>{saving ? "שומר…" : "💾 שמור"}</button>
        </div>
      </div>

      {/* צ'קליסט משימות העסקה */}
      <div className="pcf-card" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}><span>✅</span> צ'קליסט משימות <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>({deal.checklist.filter((c) => c.done).length}/{deal.checklist.length})</span></h2>
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {deal.checklist.map((it) => {
            const editVal = assigneeEdit[it.key] !== undefined ? assigneeEdit[it.key] : (it.assignee || "");
            return (
              <div key={it.key} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", background: it.done ? "var(--bg-2)" : "var(--bg)" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flex: "1 1 220px" }}>
                  <input type="checkbox" checked={it.done} disabled={checklistBusy === it.key} onChange={(e) => toggleChecklist(it.key, e.target.checked)} style={{ width: 20, height: 20, cursor: "pointer", accentColor: "var(--green)" }} />
                  <span style={{ fontWeight: 600, textDecoration: it.done ? "line-through" : "none", color: it.done ? "var(--muted)" : "inherit" }}>{it.label}</span>
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginInlineStart: "auto" }}>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>אחראי:</span>
                  <input
                    value={editVal}
                    onChange={(e) => setAssigneeEdit({ ...assigneeEdit, [it.key]: e.target.value })}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (it.assignee || "")) saveAssignee(it.key, v); }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    placeholder="שם (לא חובה)"
                    disabled={checklistBusy === it.key}
                    style={{ width: 150, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit", fontSize: 13 }}
                  />
                </div>
                {it.done && it.doneAt && <div style={{ flexBasis: "100%", fontSize: 11, color: "var(--muted)" }}>בוצע {fmtDate(it.doneAt)}{it.doneBy ? ` · ${it.doneBy}` : ""}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* ימי חתימות */}
      <div className="pcf-card" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}><span>📅</span> ימי חתימות <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>({deal.signingDays.length})</span></h2>
        <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 4 }}>קבעו תאריך ליום חתימות. אפשר להוסיף כמה ימים — ולכל יום לשייך את כל הלקוחות או לקוחות מסוימים.</p>

        {deal.signingDays.length > 0 && (
          <div style={{ display: "grid", gap: 8, margin: "12px 0" }}>
            {deal.signingDays.map((d) => {
              const names = d.scope === "all"
                ? "כל הלקוחות המשובצים"
                : d.clientIds.map((cid) => deal.clients.find((c) => c.clientId === cid)?.fullName || "לקוח").join(", ") || "—";
              return (
                <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", background: "var(--bg)" }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>🗓️ {new Date(d.date).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span>
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>{names}</span>
                  {d.note && <span style={{ fontSize: 13, color: "var(--muted)" }}>· {d.note}</span>}
                  <button className="pcf-link-btn" style={{ marginInlineStart: "auto", color: "var(--accent)", fontSize: 13 }} onClick={() => delSigningDay(d.id)}>מחק</button>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ padding: 16, border: "1px solid var(--line)", borderRadius: 12, background: "var(--bg)", marginTop: 10 }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={{ display: "block", color: "var(--muted)", fontSize: 13, marginBottom: 6 }}>תאריך יום החתימות</label>
              <input type="date" value={sdDate} onChange={(e) => setSdDate(e.target.value)} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit", fontSize: 14 }} />
            </div>
            <div>
              <label style={{ display: "block", color: "var(--muted)", fontSize: 13, marginBottom: 6 }}>מי מגיע</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className={`pcf-pill${sdScope === "all" ? " active" : ""}`} onClick={() => { setSdScope("all"); setSdClients([]); }}>כל הלקוחות</button>
                <button type="button" className={`pcf-pill${sdScope === "specific" ? " active" : ""}`} onClick={() => setSdScope("specific")}>לקוחות מסוימים</button>
              </div>
            </div>
          </div>

          {sdScope === "specific" && (
            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", color: "var(--muted)", fontSize: 13, marginBottom: 6 }}>בחרו לקוחות ליום זה (מתוך לקוחות העסקה)</label>
              {deal.clients.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 14, margin: 0 }}>אין לקוחות משובצים לעסקה — שבצו קודם בסקשן "שיבוץ עסקה".</p>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {deal.clients.map((c) => {
                    const on = sdClients.includes(c.clientId);
                    return (
                      <button key={c.clientId} type="button" className={`pcf-pill${on ? " active" : ""}`}
                        onClick={() => setSdClients(on ? sdClients.filter((x) => x !== c.clientId) : [...sdClients, c.clientId])}>
                        {on ? "✓ " : ""}{c.fullName || c.email || "לקוח"}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <button className="pcf-btn" onClick={addSigningDay} disabled={sdBusy}>{sdBusy ? "מוסיף…" : "+ הוסף יום חתימות"}</button>
          </div>
        </div>
      </div>

      {/* תכנית עסקית + הסכם מכר — קבצי PDF */}
      {renderFileCard("plan")}
      {renderFileCard("agreement")}

      {/* יומן */}
      <div className="pcf-card" style={{ marginTop: 18 }}>
        <h2><span>📓</span> יומן העסקה</h2>
        <div style={{ marginTop: 8 }}>
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="הוסף עדכון/הערה על העסקה…" rows={3}
            style={{ width: "100%", resize: "vertical", padding: 12, borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit", fontFamily: "inherit", fontSize: 15 }}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") addNote(); }} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button className="pcf-btn" style={{ padding: "8px 20px", fontSize: 14 }} onClick={addNote} disabled={noteBusy || !noteText.trim()}>{noteBusy ? "שומר…" : "+ הוסף"}</button>
          </div>
        </div>
        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          {deal.activity.map((a) => (
            <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", background: "var(--bg)" }}>
              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginBottom: 4 }}>{ACT_ICON[a.type] || "•"} {a.by} · {fmtDate(a.at)}</div>
              {a.text && <ActivityText text={a.text} />}
            </div>
          ))}
          {deal.activity.length === 0 && <p style={{ color: "var(--muted)" }}>אין עדכונים עדיין.</p>}
        </div>
      </div>
    </main>
  );
}
