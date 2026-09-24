"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { onAuthStateChanged, firebaseAuth, type User } from "@/lib/authClient";
import { SECTIONS, isFieldVisible, type Answers } from "@/lib/formSchema";
import { CLIENT_STAGES, CLIENT_PACES } from "@/lib/clients";
import ActivityText from "../ActivityText";

interface FileItem { category: string; categoryLabel: string; name: string; size: number; contentType: string; url: string; }
interface ContractSigner { name: string; role?: string; order: number; optional: boolean; token: string; status: string; signedAt: string; }
interface Contract { id: string; templateName: string; status: string; createdAt: string; signedDriveLink: string; signers: ContractSigner[]; }
interface AdminNote { id: string; text: string; authorEmail: string; authorName: string; createdAt: string; }
interface LeadActivity { id: string; type: string; at: string; by: string; source: string; text?: string; }
interface LinkedLead { id: string; fullName: string; stage: string; stageLabel: string; phone: string; email: string; source: string; createdAt: string; activity: LeadActivity[]; }
interface LinkedClient { uid: string; fullName: string; email: string; phone: string; stage: string; relation?: string; }
interface ClientData {
  email: string; googleName: string; status: string; stage: string; answers: Answers; files: FileItem[]; contracts: Contract[];
  adminNotes: AdminNote[]; linkedLead: LinkedLead | null; linkedClients: LinkedClient[]; fromLeadSource: string; convertedByName: string; convertedAt: string;
  updatedAt: string; submittedAt: string; driveFolderLink: string; pace: string; paceUpdatedAt: string;
  questionnaireDocLink: string;
}
interface PickClient { uid: string; fullName: string; phone: string; email: string; }

function fmtDate(s: string): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }); }
  catch { return s; }
}
function fmtSize(b: number): string { return b > 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`; }

// נמעני ווצאפ קבועים
const WA_RECIPIENTS: Record<"mik" | "dean", { label: string; num: string }> = {
  mik: { label: "מיק", num: "972542226289" },
  dean: { label: "דין", num: "972528777824" },
};

// נרמול מספר ישראלי לפורמט בינלאומי (0526660006 → 972526660006)
function normalizeIL(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("972")) return d;
  if (d.startsWith("0")) return "972" + d.slice(1);
  if (d.length === 9 && d.startsWith("5")) return "972" + d;
  return d;
}

export default function ClientDetail({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = use(params);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState<ClientData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [waBusy, setWaBusy] = useState(false);
  const [waMsg, setWaMsg] = useState<string | null>(null);
  const [waOpen, setWaOpen] = useState(false);
  const [waTarget, setWaTarget] = useState<"mik" | "dean" | "other">("mik");
  const [waOther, setWaOther] = useState("");
  // קישור לקוח נוסף (זוג/שותפים)
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [selTemplate, setSelTemplate] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [pickList, setPickList] = useState<PickClient[]>([]);
  const [pickSearch, setPickSearch] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);

  const authHeaders = async () => ({ "Content-Type": "application/json", Authorization: `Bearer ${await firebaseAuth().currentUser!.getIdToken()}` });

  const addNote = async () => {
    const text = noteText.trim();
    if (!text) return;
    setNoteBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/client/${uid}`, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ action: "add-note", text }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
      setNoteText("");
      await load();
    } catch (e) { setErr(`שמירת ההערה נכשלה — ${(e as Error).message}`); } finally { setNoteBusy(false); }
  };

  const deleteNote = async (id: string) => {
    if (!window.confirm("למחוק את ההערה?")) return;
    setErr(null);
    try {
      const res = await fetch(`/api/admin/client/${uid}`, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ action: "delete-note", id }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
      await load();
    } catch (e) { setErr(`מחיקת ההערה נכשלה — ${(e as Error).message}`); }
  };

  const sendWhatsapp = async (to: string, label: string) => {
    setWaBusy(true); setWaMsg(null); setErr(null);
    try {
      const res = await fetch(`/api/admin/client/${uid}`, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ action: "send-whatsapp", to }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "שגיאה");
      setWaMsg(`נשלח ל${label} בווצאפ ✓`);
      setWaOpen(false);
    } catch (e) { setWaMsg(`השליחה נכשלה — ${(e as Error).message}`); } finally { setWaBusy(false); }
  };

  /** שלב הלקוח בתהליך — נשמר מיד ומתועד בהערות. */
  const setStage = async (stage: string) => {
    setErr(null);
    try {
      const res = await fetch(`/api/admin/client/${uid}`, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ action: "set-stage", stage }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
      await load();
    } catch (e) { setErr(`עדכון השלב נכשל — ${(e as Error).message}`); }
  };

  /** קצב הלקוח — נשמר מיד עם תאריך עדכון אחרון. */
  const setPace = async (pace: string) => {
    setErr(null);
    try {
      const res = await fetch(`/api/admin/client/${uid}`, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ action: "set-pace", pace }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
      await load();
    } catch (e) { setErr(`עדכון הקצב נכשל — ${(e as Error).message}`); }
  };

  // טעינת רשימת לקוחות לבחירה בקישור
  const openLink = async () => {
    setLinkOpen((o) => !o);
    if (pickList.length === 0) {
      try {
        const t = await firebaseAuth().currentUser!.getIdToken();
        const res = await fetch("/api/admin/clients", { headers: { Authorization: `Bearer ${t}` } });
        if (res.ok) {
          const d = await res.json();
          setPickList((d.clients || []).map((c: { uid: string; fullName: string; phone: string; email: string }) => ({ uid: c.uid, fullName: c.fullName, phone: c.phone, email: c.email })));
        }
      } catch { /* ignore */ }
    }
  };

  const linkClient = async (otherUid: string) => {
    setLinkBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/admin/client/${uid}`, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ action: "link-client", otherUid }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
      setLinkOpen(false); setPickSearch("");
      await load();
    } catch (e) { setErr(`הקישור נכשל — ${(e as Error).message}`); } finally { setLinkBusy(false); }
  };

  const unlinkClient = async (otherUid: string) => {
    if (!window.confirm("לנתק את הקישור בין הלקוחות?")) return;
    try {
      const res = await fetch(`/api/admin/client/${uid}`, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ action: "unlink-client", otherUid }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
      await load();
    } catch (e) { setErr(`הניתוק נכשל — ${(e as Error).message}`); }
  };

  const deleteClient = async () => {
    const confirm = window.prompt('מחיקת הלקוח היא לצמיתות. הקלד DELETE לאישור:');
    if (confirm !== "DELETE") return;
    setErr(null);
    try {
      const res = await fetch(`/api/admin/client/${uid}`, { method: "POST", headers: await authHeaders(), body: JSON.stringify({ action: "delete-client", confirm }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
      window.location.href = "/admin";
    } catch (e) { setErr(`מחיקה נכשלה — ${(e as Error).message}`); }
  };

  const submitWhatsapp = () => {
    if (waTarget === "other") {
      const num = normalizeIL(waOther);
      if (num.length < 11) { setWaMsg("מספר לא תקין — בדוק שוב"); return; }
      sendWhatsapp(num, num);
    } else {
      const r = WA_RECIPIENTS[waTarget];
      sendWhatsapp(r.num, r.label);
    }
  };

  const uploadManual = async (file: File) => {
    setUploadingFile(true); setErr(null);
    try {
      const displayName = window.prompt("שם להצגה לקובץ (אופציונלי):", file.name.replace(/\.[^.]+$/, "")) ?? "";
      const t = await firebaseAuth().currentUser!.getIdToken();
      const H = { "Content-Type": "application/json", Authorization: `Bearer ${t}` };
      const sign = await (await fetch(`/api/admin/client/${uid}`, { method: "POST", headers: H, body: JSON.stringify({ action: "sign-upload", fileName: file.name, contentType: file.type || "application/octet-stream", size: file.size }) })).json();
      if (!sign.uploadUrl) throw new Error(sign.error || "שגיאה");
      const up = await fetch(sign.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!up.ok) throw new Error("העלאה נכשלה");
      await fetch(`/api/admin/client/${uid}`, { method: "POST", headers: H, body: JSON.stringify({ action: "attach", storagePath: sign.storagePath, fileName: file.name, displayName, contentType: file.type, size: file.size }) });
      await load();
    } catch (e) { setErr(`העלאה נכשלה — ${(e as Error).message}`); } finally { setUploadingFile(false); }
  };

  const copyLink = (token: string) => navigator.clipboard?.writeText(`${window.location.origin}/sign/${token}`);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch(`/api/admin/client/${uid}`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 403) { setErr("אין הרשאת גישה"); return; }
      if (res.status === 404) { setErr("הלקוח לא נמצא"); return; }
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch { setErr("שגיאה בטעינה"); }
    finally { setLoading(false); }
  }, [uid]);

  useEffect(() => { if (user) load(); }, [user, load]);

  // רשימת תבניות ההסכם הקיימות — לבחירה מכרטיס הלקוח
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const t = await firebaseAuth().currentUser!.getIdToken();
        const res = await fetch("/api/admin/templates", { headers: { Authorization: `Bearer ${t}` } });
        if (res.ok) setTemplates(((await res.json()).templates || []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
      } catch { /* לא חוסם */ }
    })();
  }, [user]);

  if (!authReady || (user && loading)) return <main className="pcf-wrap"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return <main className="pcf-wrap"><div className="pcf-card" style={{ textAlign: "center" }}><p>נדרשת התחברות. <Link href="/admin" style={{ color: "var(--accent)" }}>למסך הניהול</Link></p></div></main>;
  if (err) return <main className="pcf-wrap"><div className="pcf-err">{err}</div><Link href="/admin" className="pcf-link-btn">→ חזרה לרשימה</Link></main>;
  if (!data) return null;

  const name = data.answers.fullName || "(ללא שם)";

  return (
    <main className="pcf-wrap">
      <div className="pcf-admin-top">
        <div>
          <Link href="/admin" className="pcf-link-btn">→ חזרה לרשימת הלקוחות</Link>
          <h1 style={{ fontSize: 26, margin: "10px 0 0" }}>{name}</h1>
          <p style={{ color: "var(--muted)", margin: "6px 0 0", fontSize: 14 }}>
            {data.status === "submitted" ? <span className="pcf-pill-status done">נשלח ✓</span> : data.status === "manual" ? <span className="pcf-pill-status draft">לקוח ידני (חוזה)</span> : <span className="pcf-pill-status draft">טיוטה (טרם הוגש)</span>}
            {"  "}עודכן: {fmtDate(data.updatedAt)}{data.submittedAt ? ` • נשלח: ${fmtDate(data.submittedAt)}` : ""}
          </p>
          {data.fromLeadSource && (
            <p style={{ margin: "6px 0 0", fontSize: 13 }}>
              <span className="pcf-pill-status" style={{ background: "rgba(255,59,59,0.12)", color: "var(--accent)" }}>מקור: {data.fromLeadSource}</span>
              {data.convertedByName && <span style={{ color: "var(--muted)" }}>  הומר ע&quot;י <b>{data.convertedByName}</b>{data.convertedAt ? ` · ${fmtDate(data.convertedAt)}` : ""}</span>}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={data.stage || "new"} onChange={(e) => setStage(e.target.value)}
            title="שלב הלקוח בתהליך"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit", fontSize: 14 }}>
            {CLIENT_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <select value={data.pace || ""} onChange={(e) => setPace(e.target.value)}
              title="קצב הלקוח"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit", fontSize: 14 }}>
              <option value="">⚡ קצב לקוח…</option>
              {CLIENT_PACES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            {data.pace && data.paceUpdatedAt && <span style={{ fontSize: 11, color: "var(--muted)", textAlign: "center" }}>עודכן: {fmtDate(data.paceUpdatedAt)}</span>}
          </div>
          <button className="pcf-btn" style={{ padding: "10px 18px", fontSize: 14 }} onClick={() => { setWaOpen((o) => !o); setWaMsg(null); }} disabled={waBusy}>
            💬 שלח בווצאפ
          </button>
          <button className="pcf-btn ghost" style={{ padding: "10px 18px", fontSize: 14 }} onClick={openLink}>🔗 קשר לקוח נוסף</button>
          {data.driveFolderLink && <a className="pcf-btn ghost" style={{ padding: "10px 18px", fontSize: 14 }} href={data.driveFolderLink} target="_blank" rel="noopener">📁 תיקייה בדרייב</a>}
          {data.questionnaireDocLink && <a className="pcf-btn ghost" style={{ padding: "10px 18px", fontSize: 14 }} href={data.questionnaireDocLink} target="_blank" rel="noopener">📄 מסמך השאלון (חי)</a>}
          <button className="pcf-link-btn" style={{ color: "var(--accent)", fontSize: 13 }} onClick={deleteClient}>מחיקת לקוח</button>
        </div>
      </div>

      {waOpen && (
        <div className="pcf-card" style={{ marginTop: 10, padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700 }}>שליחת פרטי הלקוח אל:</span>
            {([["mik", "מיק"], ["dean", "דין"], ["other", "אחר"]] as const).map(([k, l]) => (
              <button key={k} type="button" className={`pcf-pill${waTarget === k ? " active" : ""}`} onClick={() => setWaTarget(k)}>{l}</button>
            ))}
            {waTarget === "other" && (
              <input
                value={waOther}
                onChange={(e) => setWaOther(e.target.value)}
                placeholder="מספר, למשל 0521234567"
                dir="ltr"
                style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit", fontFamily: "inherit", fontSize: 15, minWidth: 180, textAlign: "right" }}
                onKeyDown={(e) => { if (e.key === "Enter") submitWhatsapp(); }}
              />
            )}
            <button className="pcf-btn" style={{ padding: "8px 22px", fontSize: 14 }} onClick={submitWhatsapp} disabled={waBusy || (waTarget === "other" && !waOther.trim())}>
              {waBusy ? <><span className="pcf-spin" style={{ width: 14, height: 14, borderWidth: 2 }} /> שולח…</> : "שלח"}
            </button>
          </div>
          {waTarget === "other" && waOther.trim() && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }} dir="ltr">← יישלח אל {normalizeIL(waOther) || "מספר לא תקין"}</div>
          )}
        </div>
      )}
      {waMsg && <div className={waMsg.includes("✓") ? "pcf-ok" : "pcf-err"} style={{ marginTop: 10 }}>{waMsg}</div>}

      {/* קישור לקוח נוסף — בחירת לקוח קיים */}
      {linkOpen && (
        <div className="pcf-card" style={{ marginTop: 10, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{ fontWeight: 700 }}>קשר את הלקוח ללקוח קיים נוסף:</span>
            <input value={pickSearch} onChange={(e) => setPickSearch(e.target.value)} placeholder="חיפוש לפי שם / טלפון / מייל…" style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit", fontFamily: "inherit", fontSize: 15 }} />
          </div>
          <div style={{ maxHeight: 260, overflowY: "auto", display: "grid", gap: 6 }}>
            {pickList
              .filter((c) => c.uid !== uid && !data.linkedClients?.some((l) => l.uid === c.uid))
              .filter((c) => { const q = pickSearch.trim().toLowerCase(); return !q || `${c.fullName} ${c.phone} ${c.email}`.toLowerCase().includes(q); })
              .slice(0, 40)
              .map((c) => (
                <button key={c.uid} className="pcf-link-row" style={{ textAlign: "right", cursor: "pointer", padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--bg)" }} disabled={linkBusy} onClick={() => linkClient(c.uid)}>
                  <span><b>{c.fullName || "(ללא שם)"}</b> <span style={{ color: "var(--muted)", fontSize: 13 }} dir="ltr">{c.phone || c.email}</span></span>
                  <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 13 }}>קשר +</span>
                </button>
              ))}
            {pickList.length === 0 && <div className="pcf-spin" style={{ margin: "16px auto" }} />}
          </div>
        </div>
      )}

      {/* לקוחות מקושרים (זוג/שותפים) */}
      {data.linkedClients?.length > 0 && (
        <div className="pcf-card" style={{ marginTop: 14, borderColor: "var(--accent)" }}>
          <h2 style={{ margin: "0 0 10px" }}><span>👥</span> לקוחות מקושרים ({data.linkedClients.length})</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {data.linkedClients.map((l) => (
              <div key={l.uid} className="pcf-link-row" style={{ padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--bg)" }}>
                <Link href={`/admin/${l.uid}`} style={{ color: "inherit", textDecoration: "none" }}>
                  <b>{l.fullName || "(ללא שם)"}</b> <span style={{ color: "var(--muted)", fontSize: 13 }} dir="ltr">{l.phone || l.email}</span>
                </Link>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <Link href={`/admin/${l.uid}`} className="pcf-btn ghost" style={{ padding: "5px 12px", fontSize: 13 }}>לכרטיס ←</Link>
                  <button className="pcf-link-btn" style={{ fontSize: 12, color: "var(--muted)" }} onClick={() => unlinkClient(l.uid)}>ניתוק</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ליד מקושר — תיעוד נגרר מהליד */}
      {data.linkedLead && (
        <div className="pcf-card" style={{ marginTop: 20, borderColor: "var(--accent)", background: "rgba(255,59,59,0.04)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}><span>🔗</span> ליד מקושר <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>({data.linkedLead.stageLabel}{data.linkedLead.source ? ` · ${data.linkedLead.source}` : ""})</span></h2>
            <Link href={`/admin/leads/${data.linkedLead.id}`} className="pcf-btn ghost" style={{ padding: "7px 14px", fontSize: 13 }}>🎯 לכרטיס הליד</Link>
          </div>
          <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0 0" }}>התיעוד מהליד מוצג כאן למנהלים. עדכונים בליד מופיעים גם כאן.</p>
          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {data.linkedLead.activity.filter((a) => a.type === "note" || a.type === "system" || a.type === "stage").length === 0 && (
              <p style={{ color: "var(--muted)" }}>אין תיעוד בליד עדיין.</p>
            )}
            {data.linkedLead.activity.filter((a) => a.type === "note" || a.type === "system" || a.type === "stage").map((a) => (
              <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "8px 12px", background: "var(--bg)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginBottom: 3 }}>
                  {a.type === "note" ? "🗒️ הערה" : a.type === "stage" ? "🔀 שלב" : "⚙️ מערכת"} · {a.by} · {fmtDate(a.at)}
                </div>
                {a.text && <ActivityText text={a.text} fontSize={14} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* הערות פנימיות — מנהלים בלבד */}
      <div className="pcf-card" style={{ marginTop: 20, borderColor: "var(--gold)", background: "rgba(212,175,55,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}><span>🗒️</span> הערות פנימיות</h2>
          <span className="pcf-pill-status draft" style={{ background: "rgba(212,175,55,0.15)", color: "var(--gold)" }}>מנהלים בלבד • הלקוח לא רואה</span>
        </div>
        <div style={{ marginTop: 12 }}>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="כתוב הערה על התהליך… (למשל: דיברתי עם הלקוח, ממתין לאישור משכנתא)"
            rows={3}
            style={{ width: "100%", resize: "vertical", padding: 12, borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit", fontFamily: "inherit", fontSize: 15 }}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") addNote(); }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>טיפ: Ctrl+Enter לשמירה מהירה</span>
            <button className="pcf-btn" style={{ padding: "8px 20px", fontSize: 14 }} onClick={addNote} disabled={noteBusy || !noteText.trim()}>
              {noteBusy ? <><span className="pcf-spin" style={{ width: 14, height: 14, borderWidth: 2 }} /> שומר…</> : "+ הוסף הערה"}
            </button>
          </div>
        </div>
        {data.adminNotes?.length > 0 && (
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {data.adminNotes.map((n) => (
              <div key={n.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", background: "var(--bg)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{n.authorName} · {fmtDate(n.createdAt)}</span>
                  <button className="pcf-link-btn" style={{ fontSize: 12, color: "var(--muted)" }} onClick={() => deleteNote(n.id)}>מחיקה</button>
                </div>
                <div style={{ whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.5 }}>{n.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* הסכמי התקשרות */}
      <div className="pcf-card" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}><span>📝</span> הסכמי התקשרות ({data.contracts?.length || 0})</h2>
          {/* הפקת הסכם חדש מתוך תבנית קיימת — מעביר לדף ההפקה עם הלקוח נבחר מראש */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select className="pcf-stage-sel" value={selTemplate} onChange={(e) => setSelTemplate(e.target.value)} style={{ minWidth: 190 }}>
              <option value="">בחר תבנית הסכם…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button
              className="pcf-btn"
              style={{ padding: "9px 18px", fontSize: 14, opacity: selTemplate ? 1 : 0.5 }}
              disabled={!selTemplate}
              onClick={() => { if (selTemplate) window.location.href = `/admin/templates/${selTemplate}/send?client=${uid}`; }}
            >📝 הפק הסכם</button>
          </div>
        </div>
        {!data.contracts || data.contracts.length === 0 ? (
          <p style={{ color: "var(--muted)", marginTop: 10 }}>לא הופק הסכם דיגיטלי ללקוח זה. בחר תבנית למעלה ולחץ "הפק הסכם".</p>
        ) : data.contracts.map((c) => (
          <div key={c.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <b>{c.templateName}</b>
              {c.status === "signed" && c.signedDriveLink
                ? <a className="pcf-btn" style={{ padding: "7px 16px", fontSize: 13 }} href={c.signedDriveLink} target="_blank" rel="noopener">📄 PDF חתום</a>
                : <span className="pcf-pill-status draft">ממתין לחתימות</span>}
            </div>
            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
              {c.signers.map((s) => (
                <div key={s.token} className="pcf-link-row" style={{ padding: "8px 12px" }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 14 }}>חתימה {s.order} — {s.name}{s.optional && <span style={{ color: "var(--gold)", fontSize: 11 }}> (אופציונלי)</span>}</span>
                    {" "}{s.status === "signed" ? <span className="pcf-pill-status done">נחתם ✓</span> : s.status === "opened" ? <span className="pcf-pill-status draft">נצפה</span> : <span className="pcf-pill-status draft">נשלח</span>}
                    <div className="pcf-link-url" dir="ltr">/sign/{s.token.slice(0, 14)}…</div>
                  </div>
                  {s.status !== "signed" && (s.role === "sender"
                    ? <a className="pcf-btn" style={{ padding: "6px 14px", fontSize: 13 }} href={`/sign/${s.token}`} target="_blank" rel="noopener">חתום עכשיו כשולח ✍️</a>
                    : <button className="pcf-btn ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => copyLink(s.token)}>העתק קישור</button>)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* קבצים */}
      <div className="pcf-card" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}><span>📎</span> מסמכים שהועלו ({data.files.length})</h2>
          <label className="pcf-btn ghost" style={{ cursor: "pointer", padding: "8px 16px", fontSize: 14 }}>
            {uploadingFile ? <span className="pcf-spin" /> : "⬆ העלאת מסמך"}
            <input type="file" style={{ display: "none" }} disabled={uploadingFile} onChange={(e) => { if (e.target.files?.[0]) uploadManual(e.target.files[0]); e.target.value = ""; }} />
          </label>
        </div>
        {data.files.length === 0 ? <p style={{ color: "var(--muted)", marginTop: 10 }}>לא הועלו קבצים עדיין.</p> : (
          <ul className="pcf-file-list" style={{ marginTop: 12 }}>
            {data.files.map((f, i) => (
              <li className="pcf-file-item" key={i}>
                <span className="name">📄 {f.category === "manual" ? "ידני" : f.categoryLabel} — {f.name}</span>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span className="size">{fmtSize(f.size)}</span>
                  {f.url && <a href={f.url} target="_blank" rel="noopener" style={{ color: "var(--accent)", fontWeight: 700, fontSize: 14 }}>צפייה ↗</a>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* תשובות השאלון */}
      {SECTIONS.map((section) => {
        const visible = section.fields.filter((f) => isFieldVisible(f, data.answers));
        const answered = visible.filter((f) => data.answers[f.key]?.trim());
        // המייל לא חלק מהשאלון — מגיע מהחשבון/הליד. מוצג בראש "פרטים אישיים".
        const showEmail = section.key === "personal";
        const email = data.email || data.linkedLead?.email || "";
        return (
          <div className="pcf-card" style={{ marginTop: 18 }} key={section.key}>
            <h2><span>{section.icon}</span> {section.title} <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>({answered.length + (showEmail && email ? 1 : 0)}/{visible.length + (showEmail ? 1 : 0)})</span></h2>
            <table className="pcf-table answers">
              <tbody>
                {showEmail && (
                  <tr>
                    <td style={{ width: "42%", color: "var(--muted)", fontWeight: 600 }}>מייל</td>
                    <td dir="ltr" style={{ textAlign: "right" }}>
                      {email ? <a href={`mailto:${email}`} style={{ color: "var(--accent)" }}>{email}</a> : <span style={{ color: "var(--muted)" }}>— לא מולא —</span>}
                    </td>
                  </tr>
                )}
                {visible.map((f) => (
                  <tr key={f.key}>
                    <td style={{ width: "42%", color: "var(--muted)", fontWeight: 600 }}>{f.label}</td>
                    <td style={{ whiteSpace: "pre-wrap" }}>{data.answers[f.key]?.trim() ? data.answers[f.key] : <span style={{ color: "var(--muted)" }}>— לא מולא —</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </main>
  );
}
