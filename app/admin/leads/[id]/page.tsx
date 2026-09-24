"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { onAuthStateChanged, firebaseAuth, type User } from "@/lib/authClient";
import { LEAD_STAGES, QUALI_FIELDS, UTM_FIELDS, CALL_REQUEST_STATUSES, stageLabel, leadTempEmoji, type Lead, type LeadActivity, type CallRequest } from "@/lib/leads";
import { SECTIONS } from "@/lib/formSchema";
import { REPS } from "@/lib/reps";
import AdminNav from "../../AdminNav";
import ActivityText from "../../ActivityText";

function fmtDate(s: string): string {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" }); }
  catch { return s; }
}

const WA_RECIPIENTS: Record<"mik" | "dean", { label: string; num: string }> = {
  mik: { label: "מיק", num: "972542226289" },
  dean: { label: "דין", num: "972528777824" },
};
function normalizeIL(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("972")) return d;
  if (d.startsWith("0")) return "972" + d.slice(1);
  if (d.length === 9 && d.startsWith("5")) return "972" + d;
  return d;
}

const ACT_ICON: Record<string, string> = { intake: "📥", note: "🗒️", stage: "🔀", system: "⚙️" };
const ACT_LABEL: Record<string, string> = { intake: "קליטת ליד", note: "הערה", stage: "שינוי שלב", system: "מערכת" };

export default function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [lead, setLead] = useState<Lead | null>(null);
  // יומן התיעוד נטען בחלונות של 50 — ליד עם מאות תיעודים לא גורר אותם בכל פתיחה
  const [acts, setActs] = useState<LeadActivity[]>([]);
  const [actTotal, setActTotal] = useState(0);
  const [actBusy, setActBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingCore, setSavingCore] = useState(false);
  const [core, setCore] = useState({ firstName: "", lastName: "", email: "", phone: "", idNumber: "" });
  const [quali, setQuali] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [customDefs, setCustomDefs] = useState<{ id: string; label: string; type: string; options?: string[] }[]>([]);
  const [noteText, setNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [waOpen, setWaOpen] = useState(false);
  const [waTarget, setWaTarget] = useState<"mik" | "dean" | "other">("mik");
  const [waOther, setWaOther] = useState("");
  const [waBusy, setWaBusy] = useState(false);
  const [meetOpen, setMeetOpen] = useState(false);
  const [followupMode, setFollowupMode] = useState(false); // פגישת פולואפ → יומן הנציג
  const [meet, setMeet] = useState({ date: "", time: "", durationMin: 30, title: "", location: "" });
  const [meetBusy, setMeetBusy] = useState(false);
  const [meetTypes, setMeetTypes] = useState<{ id: string; name: string; titleTemplate: string; durationMin: number; location: string }[]>([]);
  const [meetTypeId, setMeetTypeId] = useState("");
  const [conflict, setConflict] = useState<null | { conflict: { summary: string; from: string; to: string }; before: { time: string; free: boolean }; after: { time: string; free: boolean }; time: string }>(null);
  const [callReq, setCallReq] = useState<CallRequest | null>(null);
  const [callBusy, setCallBusy] = useState(false);

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);

  const headers = async () => ({ "Content-Type": "application/json", Authorization: `Bearer ${await firebaseAuth().currentUser!.getIdToken()}` });

  const apply = (l: Lead) => {
    setLead(l);
    setCore({ firstName: l.firstName, lastName: l.lastName, email: l.email, phone: l.phone, idNumber: l.idNumber });
    setQuali(l.quali || {});
    setCustom(l.custom || {});
    // הכרטיס נטען עם 50 הרשומות האחרונות בלבד; השאר נמשכות בלחיצה על "טען עוד".
    setActs(l.activity || []);
    setActTotal(l.activityTotal ?? (l.activity || []).length);
  };

  /** מושך את חלון ה-50 הבא מיומן התיעוד ומוסיף אותו למטה. */
  const loadMoreActivity = async () => {
    setActBusy(true);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch(`/api/admin/leads/${id}/activity?offset=${acts.length}&limit=50`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setActs((prev) => [...prev, ...(d.activity || [])]);
      setActTotal(d.total ?? actTotal);
    } catch { setErr("שגיאה בטעינת התיעוד"); } finally { setActBusy(false); }
  };

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const [res, setRes] = await Promise.all([
        fetch(`/api/admin/leads/${id}`, { headers: { Authorization: `Bearer ${t}` } }),
        fetch(`/api/admin/settings`, { headers: { Authorization: `Bearer ${t}` } }),
      ]);
      if (res.status === 403) { setErr("אין הרשאת גישה"); return; }
      if (res.status === 404) { setErr("הליד לא נמצא"); return; }
      if (!res.ok) throw new Error();
      if (setRes.ok) { const st = (await setRes.json()).settings; setCustomDefs(st?.customFields || []); setMeetTypes(st?.meetingTypes || []); }
      apply((await res.json()).lead);
    } catch { setErr("שגיאה בטעינה"); } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { if (user) load(); }, [user, load]);

  const post = async (body: Record<string, unknown>, url = `/api/admin/leads/${id}`) => {
    const res = await fetch(url, { method: "POST", headers: await headers(), body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "שגיאה");
    return d;
  };

  const saveCore = async () => {
    setSavingCore(true); setMsg(null);
    try { const d = await post({ action: "update", ...core, quali, custom }); apply(d.lead); setMsg("נשמר ✓"); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setSavingCore(false); }
  };

  /** שיוך הליד לנציג (ריק = ביטול שיוך). */
  const assign = async (assignedTo: string) => {
    setMsg(null);
    try { const d = await post({ action: "assign", assignedTo }); apply(d.lead); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); }
  };

  const setStage = async (stage: string) => {
    setMsg(null);
    try {
      const d = await post({ action: "set-stage", stage }); apply(d.lead);
      // פולואפ → פותח תיאום פגישה ביומן האישי של הנציג שסימן
      if (stage === "followup") {
        setFollowupMode(true);
        setMeet((m) => ({ ...m, title: `פולואפ — ${d.lead.fullName || "ליד"}`, durationMin: 30, location: "" }));
        setMeetTypeId("");
        setMeetOpen(true);
        setMsg("סומן פולואפ — קבעו פגישה ביומן שלכם 📅");
      }
    }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); }
  };

  /** פותח גישה לפורטל הלקוח (טריגר). לא משנה את שלב הפייפליין — אפשר לסמן סטטוס מיד אחרי. */
  const grantPortal = async () => {
    setMsg(null);
    try { const d = await post({ action: "portal-access", on: true }); apply(d.lead); setMsg("🔓 נפתחה גישה לפורטל — עכשיו סמנו את הסטטוס הרלוונטי"); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); }
  };

  const addNote = async () => {
    const text = noteText.trim(); if (!text) return;
    setNoteBusy(true); setMsg(null);
    try { const d = await post({ action: "add-note", text }); apply(d.lead); setNoteText(""); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setNoteBusy(false); }
  };

  const deleteNote = async (activityId: string) => {
    if (!window.confirm("למחוק את התיעוד?")) return;
    try { const d = await post({ action: "delete-note", activityId }); apply(d.lead); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); }
  };

  const convert = async () => {
    if (!window.confirm("לסמן כ-WON ולהפוך ללקוח? הליד יופיע גם תחת לקוחות.")) return;
    setMsg(null);
    try { const d = await post({ action: "convert" }); apply(d.lead); setMsg("הומר ללקוח ✓"); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); }
  };

  const deleteLead = async () => {
    const confirm = window.prompt("מחיקת הליד היא לצמיתות. הקלד DELETE לאישור:");
    if (confirm !== "DELETE") return;
    setMsg(null);
    try { await post({ action: "delete-lead", confirm }); window.location.href = "/admin/leads"; }
    catch (e) { setMsg(`מחיקה נכשלה — ${(e as Error).message}`); }
  };

  const applyMeetType = (tid: string) => {
    setMeetTypeId(tid);
    const t = meetTypes.find((x) => x.id === tid);
    if (!t) return;
    setMeet((m) => ({ ...m, title: t.titleTemplate.replace(/\[שם הלקוח\]/g, lead?.fullName || ""), durationMin: t.durationMin, location: t.location }));
  };

  const scheduleMeeting = async (overrideTime?: string) => {
    const time = overrideTime || meet.time;
    if (!meet.date || !time) { setMsg("בחר תאריך ושעה"); return; }
    setMeetBusy(true); setMsg(null); setConflict(null);
    const typeName = meetTypes.find((t) => t.id === meetTypeId)?.name || "";
    try {
      // בדיקת חפיפה — רק בקביעה רגילה (לא כשכבר בחרנו חלופה מהפופאפ)
      if (!overrideTime) {
        const c = await post({ action: "check-slot", date: meet.date, time, durationMin: meet.durationMin, useRepCalendar: followupMode });
        if (c.conflict) { setConflict({ ...c, time }); setMeetBusy(false); return; }
      }
      const d = await post({ action: "schedule-meeting", date: meet.date, time, durationMin: meet.durationMin, title: meet.title, location: meet.location, meetingType: typeName, useRepCalendar: followupMode });
      apply(d.lead);
      setMsg(d.duplicate ? "פגישה זהה כבר קיימת ביומן — לא נוצרה כפילות ✓" : (followupMode ? "פגישת פולואפ נקבעה ביומן שלך ✓" : "הפגישה נקבעה ביומן ✓"));
      setMeetOpen(false); setFollowupMode(false);
    } catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setMeetBusy(false); }
  };

  const fetchCallReq = useCallback(async () => {
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch(`/api/admin/call-requests?leadId=${id}`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.ok) setCallReq((await res.json()).request);
    } catch { /* ignore */ }
  }, [id]);
  useEffect(() => { if (user) fetchCallReq(); }, [user, fetchCallReq]);

  // מרענן סטטוס כל 4 שניות כל עוד הבקשה פעילה (ממתין/אושר/מחייג)
  useEffect(() => {
    if (!callReq || !["pending", "approved", "dialing"].includes(callReq.status)) return;
    const iv = setInterval(fetchCallReq, 4000);
    return () => clearInterval(iv);
  }, [callReq, fetchCallReq]);

  const requestCall = async () => {
    setCallBusy(true); setMsg(null);
    try {
      const d = await post({ leadId: id }, "/api/admin/call-requests");
      setCallReq(d.request);
      setMsg(d.request?.note === "no_device"
        ? "הבקשה נוצרה, אבל אין פלאפון רשום למייל שלך — פתח את אפליקציית PHONECRM והתחבר עם אותו מייל"
        : "בקשת חיוג נשלחה לפלאפון ✓");
    } catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setCallBusy(false); }
  };

  const cancelCall = async () => {
    if (!callReq) return;
    try { await post({ action: "cancel", id: callReq.id }, "/api/admin/call-requests"); await fetchCallReq(); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); }
  };

  const sendWa = async () => {
    let to = "", label = "";
    if (waTarget === "other") { to = normalizeIL(waOther); label = to; if (to.length < 11) { setMsg("מספר לא תקין"); return; } }
    else { to = WA_RECIPIENTS[waTarget].num; label = WA_RECIPIENTS[waTarget].label; }
    setWaBusy(true); setMsg(null);
    try { await post({ action: "send-whatsapp", to }); setMsg(`נשלח ל${label} בווצאפ ✓`); setWaOpen(false); }
    catch (e) { setMsg(`נכשל — ${(e as Error).message}`); } finally { setWaBusy(false); }
  };

  if (!authReady || (user && loading)) return <main className="pcf-wrap"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return <main className="pcf-wrap"><div className="pcf-card" style={{ textAlign: "center" }}><p>נדרשת התחברות. <Link href="/admin/leads" style={{ color: "var(--accent)" }}>ללידים</Link></p></div></main>;
  if (err) return <main className="pcf-wrap"><AdminNav /><div className="pcf-err">{err}</div><Link href="/admin/leads" className="pcf-link-btn">→ חזרה ללידים</Link></main>;
  if (!lead) return null;

  return (
    <main className="pcf-wrap">
      <AdminNav />
      <div className="pcf-admin-top">
        <div>
          <Link href="/admin/leads" className="pcf-link-btn">→ חזרה ללידים</Link>
          <h1 style={{ fontSize: 26, margin: "10px 0 0" }}>
            <span title="חום הליד לפי מספר ההגשות">{leadTempEmoji(lead.custom?.submit_count)}</span> {lead.fullName || "(ליד ללא שם)"}
          </h1>
          <p style={{ color: "var(--muted)", margin: "6px 0 0", fontSize: 14 }}>
            נוצר: {fmtDate(lead.createdAt)} • עודכן: {fmtDate(lead.updatedAt)} • קליטה אחרונה: {fmtDate(lead.lastLeadAt)}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select value={lead.stage} onChange={(e) => e.target.value === "__portal__" ? grantPortal() : setStage(e.target.value)} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit", fontSize: 14 }}>
            {LEAD_STAGES.flatMap((s) => s.key === "new"
              ? [<option key="new" value="new">{s.label}</option>, <option key="__portal__" value="__portal__">🔓 פתח פורטל (גישה ללקוח)</option>]
              : [<option key={s.key} value={s.key}>{s.label}</option>])}
          </select>
          {lead.portalAccess && <a href={`/portal?as=${lead.id}`} target="_blank" rel="noopener" title="צפה בפורטל של הלקוח — בדיוק מה שהוא רואה" style={{ padding: "7px 12px", borderRadius: 999, background: "rgba(34,197,94,.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,.35)", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", textDecoration: "none", cursor: "pointer" }}>🔓 פורטל פתוח ↗</a>}
          <select value={lead.assignedTo || ""} onChange={(e) => assign(e.target.value)} title="שיוך לנציג"
            style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit", fontSize: 14 }}>
            <option value="">👤 ללא נציג</option>
            {REPS.map((r) => <option key={r.email} value={r.email}>{r.name}</option>)}
          </select>
          <button className="pcf-btn" style={{ padding: "9px 16px", fontSize: 14 }} onClick={requestCall} disabled={callBusy || !lead.phone} title={!lead.phone ? "אין מספר טלפון" : "בקש חיוג מהפלאפון"}>{callBusy ? "שולח…" : "📞 חייג בפלאפון"}</button>
          <button className="pcf-btn" style={{ padding: "9px 16px", fontSize: 14 }} onClick={() => { setWaOpen((o) => !o); setMsg(null); }}>💬 שלח בווצאפ</button>
          <button className="pcf-btn ghost" style={{ padding: "9px 16px", fontSize: 14 }} onClick={() => { setMeetOpen((o) => !o); setMsg(null); setConflict(null); }}>📅 תאם פגישה</button>
          {lead.convertedClientUid
            ? <Link className="pcf-btn ghost" style={{ padding: "9px 16px", fontSize: 14 }} href={`/admin/${lead.convertedClientUid}`}>👥 צפה בלקוח</Link>
            : <button className="pcf-btn ghost" style={{ padding: "9px 16px", fontSize: 14 }} onClick={convert}>🏆 סמן WON → לקוח</button>}
          <button className="pcf-btn" style={{ padding: "9px 18px", fontSize: 14 }} onClick={saveCore} disabled={savingCore}>{savingCore ? "שומר…" : "💾 שמור"}</button>
          <button className="pcf-link-btn" style={{ color: "var(--accent)", fontSize: 13 }} onClick={deleteLead}>מחיקה</button>
        </div>
      </div>

      {waOpen && (
        <div className="pcf-card" style={{ marginTop: 6, padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700 }}>שליחת פרטי הליד אל:</span>
            {([["mik", "מיק"], ["dean", "דין"], ["other", "אחר"]] as const).map(([k, l]) => (
              <button key={k} type="button" className={`pcf-pill${waTarget === k ? " active" : ""}`} onClick={() => setWaTarget(k)}>{l}</button>
            ))}
            {waTarget === "other" && <input value={waOther} onChange={(e) => setWaOther(e.target.value)} placeholder="0521234567" dir="ltr" style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit", fontSize: 15, minWidth: 160, textAlign: "right" }} />}
            <button className="pcf-btn" style={{ padding: "8px 22px", fontSize: 14 }} onClick={sendWa} disabled={waBusy || (waTarget === "other" && !waOther.trim())}>{waBusy ? "שולח…" : "שלח"}</button>
          </div>
          {waTarget === "other" && waOther.trim() && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }} dir="ltr">← {normalizeIL(waOther) || "מספר לא תקין"}</div>}
        </div>
      )}
      {meetOpen && (
        <div className="pcf-card" style={{ marginTop: 6, padding: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>📅 {followupMode ? "פגישת פולואפ — ביומן שלך" : "תיאום פגישה ביומן גוגל"}</h3>
          {followupMode && <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--muted)" }}>הפגישה תיקבע ביומן האישי שחיברת בהגדרות → יומני נציגים.</p>}
          {meetTypes.length > 0 && (
            <div className="pcf-field full" style={{ marginBottom: 4 }}>
              <label>סוג פגישה (מילוי מהיר)</label>
              <select value={meetTypeId} onChange={(e) => applyMeetType(e.target.value)}>
                <option value="">בחר סוג…</option>
                {meetTypes.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.durationMin} דק')</option>)}
              </select>
            </div>
          )}
          <div className="pcf-form">
            <div className="pcf-field"><label>תאריך</label><input type="date" value={meet.date} onChange={(e) => setMeet({ ...meet, date: e.target.value })} /></div>
            <div className="pcf-field"><label>שעה</label><input type="time" value={meet.time} onChange={(e) => setMeet({ ...meet, time: e.target.value })} /></div>
            <div className="pcf-field"><label>משך (דקות)</label><input type="number" min={5} step={5} value={meet.durationMin} onChange={(e) => setMeet({ ...meet, durationMin: Number(e.target.value) })} /></div>
            <div className="pcf-field full"><label>כותרת (ריק = פגישה עם שם הליד)</label><input value={meet.title} onChange={(e) => setMeet({ ...meet, title: e.target.value })} placeholder={`פגישה — ${lead.fullName || "ליד"}`} /></div>
            <div className="pcf-field full"><label>מיקום</label><input value={meet.location} onChange={(e) => setMeet({ ...meet, location: e.target.value })} placeholder="כתובת הפגישה" /></div>
          </div>
          <div style={{ marginTop: 10 }}>
            <button className="pcf-btn" onClick={() => scheduleMeeting()} disabled={meetBusy}>{meetBusy ? <><span className="pcf-spin" style={{ width: 14, height: 14, borderWidth: 2 }} /> {conflict ? "בודק…" : "קובע…"}</> : "קבע פגישה"}</button>
            <span style={{ fontSize: 12, color: "var(--muted)", marginInlineStart: 12 }}>הלקוח יקבל הזמנה למייל (אם קיים).</span>
          </div>

          {conflict && (
            <div style={{ marginTop: 12, padding: 14, borderRadius: 12, border: "1px solid #f0b400", background: "rgba(240,180,0,.08)" }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>⚠️ כבר קיימת פגישה בזמן הזה</div>
              <div style={{ fontSize: 14, marginBottom: 10 }}>
                <b>{conflict.conflict.summary}</b> · {conflict.conflict.from}–{conflict.conflict.to}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="pcf-btn" style={{ padding: "8px 14px", fontSize: 14, opacity: conflict.before.free ? 1 : .45 }}
                  disabled={!conflict.before.free || meetBusy}
                  onClick={() => scheduleMeeting(conflict.before.time)}>
                  ⏪ 20 דק' לפני ({conflict.before.time}){conflict.before.free ? "" : " · תפוס"}
                </button>
                <button className="pcf-btn" style={{ padding: "8px 14px", fontSize: 14, opacity: conflict.after.free ? 1 : .45 }}
                  disabled={!conflict.after.free || meetBusy}
                  onClick={() => scheduleMeeting(conflict.after.time)}>
                  ⏩ 20 דק' אחרי ({conflict.after.time}){conflict.after.free ? "" : " · תפוס"}
                </button>
                <button className="pcf-btn ghost" style={{ padding: "8px 14px", fontSize: 14 }}
                  onClick={() => setConflict(null)}>
                  🗓️ קבע מועד חדש
                </button>
              </div>
              {!conflict.before.free && !conflict.after.free && (
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>גם 20 דק' לפני וגם אחרי תפוסים — בחר/י מועד חדש.</div>
              )}
            </div>
          )}
        </div>
      )}
      {msg && <div className={msg.includes("✓") ? "pcf-ok" : "pcf-err"} style={{ marginTop: 10 }}>{msg}</div>}

      {/* סטטוס בקשת חיוג מרחוק */}
      {callReq && (
        <div className="pcf-card" style={{ marginTop: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18 }}>📞</span>
          <span className={`pcf-pill-status ${CALL_REQUEST_STATUSES[callReq.status]?.kind || "draft"}`}>{CALL_REQUEST_STATUSES[callReq.status]?.label || callReq.status}</span>
          <span dir="ltr" style={{ color: "var(--muted)", fontSize: 13 }}>{callReq.leadPhone}</span>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>· ביקש: {callReq.requestedByName} · {fmtDate(callReq.updatedAt)}</span>
          {["pending", "approved", "dialing"].includes(callReq.status) && <span className="pcf-spin" style={{ width: 14, height: 14, borderWidth: 2 }} />}
          {callReq.status === "pending" && <button className="pcf-link-btn" style={{ color: "var(--accent)", fontSize: 13, marginInlineStart: "auto" }} onClick={cancelCall}>ביטול בקשה</button>}
        </div>
      )}

      {/* פרטי ליבה + הסמכה */}
      <div className="pcf-card" style={{ marginTop: 18 }}>
        <h2><span>🧾</span> פרטי הליד</h2>
        <div className="pcf-form">
          <div className="pcf-field"><label>שם פרטי</label><input value={core.firstName} onChange={(e) => setCore({ ...core, firstName: e.target.value })} /></div>
          <div className="pcf-field"><label>שם משפחה</label><input value={core.lastName} onChange={(e) => setCore({ ...core, lastName: e.target.value })} /></div>
          <div className="pcf-field"><label>טלפון</label><input dir="ltr" style={{ textAlign: "right" }} value={core.phone} onChange={(e) => setCore({ ...core, phone: e.target.value })} /></div>
          <div className="pcf-field"><label>מייל</label><input dir="ltr" style={{ textAlign: "right" }} value={core.email} onChange={(e) => setCore({ ...core, email: e.target.value })} /></div>
          <div className="pcf-field"><label>תעודת זהות</label><input value={core.idNumber} onChange={(e) => setCore({ ...core, idNumber: e.target.value })} /></div>
        </div>

        <h3 style={{ margin: "18px 0 8px", fontSize: 16 }}>שדות הסמכה (filtertnx)</h3>
        <div className="pcf-form">
          {QUALI_FIELDS.map((f) => (
            <div className="pcf-field" key={f.key}>
              <label>{f.label}</label>
              {f.type === "radio" ? (
                <select value={quali[f.key] || ""} onChange={(e) => setQuali({ ...quali, [f.key]: e.target.value })}>
                  <option value="">—</option>
                  {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input type={f.type === "number" ? "number" : "text"} value={quali[f.key] || ""} onChange={(e) => setQuali({ ...quali, [f.key]: e.target.value })} />
              )}
            </div>
          ))}
        </div>
        <h3 style={{ margin: "18px 0 8px", fontSize: 16 }}>פרטי קמפיין (UTM)</h3>
        <div className="pcf-form">
          {UTM_FIELDS.map((f) => (
            <div className="pcf-field" key={f.key}>
              <label>{f.label}</label>
              <input dir="ltr" style={{ textAlign: "right" }} value={custom[f.key] || ""} onChange={(e) => setCustom({ ...custom, [f.key]: e.target.value })} placeholder="—" />
            </div>
          ))}
        </div>

        {customDefs.length > 0 && (
          <>
            <h3 style={{ margin: "18px 0 8px", fontSize: 16 }}>שדות מותאמים</h3>
            <div className="pcf-form">
              {customDefs.map((f) => (
                <div className="pcf-field" key={f.id}>
                  <label>{f.label}</label>
                  {f.type === "radio" && f.options?.length ? (
                    <select value={custom[f.id] || ""} onChange={(e) => setCustom({ ...custom, [f.id]: e.target.value })}>
                      <option value="">—</option>
                      {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={f.type === "number" ? "number" : "text"} value={custom[f.id] || ""} onChange={(e) => setCustom({ ...custom, [f.id]: e.target.value })} />
                  )}
                </div>
              ))}
            </div>
          </>
        )}
        <div style={{ marginTop: 14 }}>
          <button className="pcf-btn" onClick={saveCore} disabled={savingCore}>{savingCore ? <><span className="pcf-spin" style={{ width: 14, height: 14, borderWidth: 2 }} /> שומר…</> : "💾 שמור שינויים"}</button>
        </div>
      </div>

      {/* תשובות השאלון (אם מולאו) */}
      {SECTIONS.map((section) => {
        const rows = section.fields.filter((f) => lead.answers[f.key]?.trim());
        if (!rows.length) return null;
        return (
          <div className="pcf-card" style={{ marginTop: 18 }} key={section.key}>
            <h2><span>{section.icon}</span> {section.title}</h2>
            <table className="pcf-table answers"><tbody>
              {rows.map((f) => (
                <tr key={f.key}><td style={{ width: "42%", color: "var(--muted)", fontWeight: 600 }}>{f.label}</td><td style={{ whiteSpace: "pre-wrap" }}>{lead.answers[f.key]}</td></tr>
              ))}
            </tbody></table>
          </div>
        );
      })}

      {/* יומן פעילות ותיעוד */}
      <div className="pcf-card" style={{ marginTop: 18 }}>
        <h2><span>📓</span> יומן פעילות ותיעוד {actTotal > 0 && <span style={{ fontSize: 14, color: "var(--muted)", fontWeight: 400 }}>({actTotal.toLocaleString("he-IL")})</span>}</h2>
        <div style={{ marginTop: 8 }}>
          <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="הוסף תיעוד/הערה על הליד…" rows={3}
            style={{ width: "100%", resize: "vertical", padding: 12, borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit", fontFamily: "inherit", fontSize: 15 }}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") addNote(); }} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button className="pcf-btn" style={{ padding: "8px 20px", fontSize: 14 }} onClick={addNote} disabled={noteBusy || !noteText.trim()}>{noteBusy ? "שומר…" : "+ הוסף תיעוד"}</button>
          </div>
        </div>
        <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
          {acts.map((a) => (
            <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 14px", background: "var(--bg)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
                  {ACT_ICON[a.type] || "•"} {ACT_LABEL[a.type] || a.type} · {a.source === "api" ? "API" : a.source === "csv" ? "CSV" : a.by} · {fmtDate(a.at)}
                </span>
                {a.type === "note" && <button className="pcf-link-btn" style={{ fontSize: 12, color: "var(--muted)" }} onClick={() => deleteNote(a.id)}>מחיקה</button>}
              </div>
              {a.text && <ActivityText text={a.text} />}
              {a.fields && Object.keys(a.fields).length > 0 && (
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>
                  {Object.entries(a.fields).map(([k, v]) => <div key={k}><b>{k}:</b> {v}</div>)}
                </div>
              )}
            </div>
          ))}
          {acts.length === 0 && <p style={{ color: "var(--muted)" }}>אין תיעוד עדיין.</p>}

          {acts.length < actTotal && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginTop: 4 }}>
              <button className="pcf-btn ghost" style={{ padding: "9px 22px", fontSize: 14 }} onClick={loadMoreActivity} disabled={actBusy}>
                {actBusy ? "טוען…" : `טען עוד ${Math.min(50, actTotal - acts.length)}`}
              </button>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                מוצגות {acts.length.toLocaleString("he-IL")} מתוך {actTotal.toLocaleString("he-IL")} רשומות
              </span>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
