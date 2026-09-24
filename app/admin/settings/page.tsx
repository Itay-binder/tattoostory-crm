"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdmin } from "@/lib/useAdmin";
import { QUALI_FIELDS } from "@/lib/leads";
import { SECTIONS } from "@/lib/formSchema";
import { REPS } from "@/lib/reps";
import AdminNav from "../AdminNav";

interface CustomField { id: string; label: string; type: "text" | "number" | "radio"; options?: string[] }
interface MeetingType { id: string; name: string; titleTemplate: string; durationMin: number; location: string }
interface CalendarConfig { connected: boolean; impersonateUser: string; calendarId: string; calendarName: string }
interface RepCalendar { impersonateUser: string; calendarId: string; calendarName: string }
interface Settings { apiKey: string; customFields: CustomField[]; fieldMap: Record<string, string>; calendar: CalendarConfig; repCalendars: Record<string, RepCalendar>; meetingTypes: MeetingType[]; updatedAt: string }

const CORE_TARGETS = [
  { key: "firstName", label: "שם פרטי" }, { key: "lastName", label: "שם משפחה" }, { key: "fullName", label: "שם מלא" },
  { key: "email", label: "מייל" }, { key: "phone", label: "טלפון" }, { key: "idNumber", label: "ת.ז" },
];

export default function SettingsPage() {
  const { user, ready, login, api } = useAdmin();
  const [s, setS] = useState<Settings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [mapRows, setMapRows] = useState<{ ext: string; internal: string }[]>([]);
  const [meetingTypes, setMeetingTypes] = useState<MeetingType[]>([]);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  // יומן גוגל
  const [calUser, setCalUser] = useState("");
  const [calUsedUser, setCalUsedUser] = useState("");
  const [calList, setCalList] = useState<{ id: string; summary: string; primary?: boolean }[]>([]);
  const [calSel, setCalSel] = useState("");
  const [calBusy, setCalBusy] = useState(false);
  const [calMsg, setCalMsg] = useState<string | null>(null);

  const calAction = async (payload: Record<string, unknown>) => {
    const res = await api("/api/admin/settings", { method: "POST", body: JSON.stringify(payload) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "שגיאה");
    return d;
  };
  const loadCalendars = async () => {
    setCalBusy(true); setCalMsg(null);
    try {
      const d = await calAction({ action: "calendar-list", impersonateUser: calUser });
      setCalList(d.calendars || []); setCalUsedUser(d.user || calUser);
      if (!d.calendars?.length) setCalMsg("לא נמצאו יומנים עם הרשאת כתיבה למשתמש הזה");
    } catch (e) { setCalMsg(`${(e as Error).message}`); } finally { setCalBusy(false); }
  };
  const connectCalendar = async () => {
    if (!calSel) { setCalMsg("בחר יומן"); return; }
    setCalBusy(true); setCalMsg(null);
    try {
      const name = calList.find((c) => c.id === calSel)?.summary || calSel;
      const d = await calAction({ action: "calendar-save", impersonateUser: calUsedUser || calUser, calendarId: calSel, calendarName: name });
      setS(d.settings); setCalMsg("היומן חובר ✓");
    } catch (e) { setCalMsg(`${(e as Error).message}`); } finally { setCalBusy(false); }
  };
  const disconnectCalendar = async () => {
    setCalBusy(true); setCalMsg(null);
    try { const d = await calAction({ action: "calendar-disconnect" }); setS(d.settings); setCalList([]); setCalSel(""); setCalMsg("נותק"); }
    catch (e) { setCalMsg(`${(e as Error).message}`); } finally { setCalBusy(false); }
  };

  // === יומני נציגים (פולואפים) ===
  const [repBusy, setRepBusy] = useState<string | null>(null);
  const [repList, setRepList] = useState<Record<string, { id: string; summary: string; primary?: boolean }[]>>({});
  const [repSel, setRepSel] = useState<Record<string, string>>({});
  const [repMsg, setRepMsg] = useState<Record<string, string>>({});
  const repLoad = async (email: string) => {
    setRepBusy(email); setRepMsg((m) => ({ ...m, [email]: "" }));
    try {
      const d = await calAction({ action: "rep-calendar-list", email });
      setRepList((r) => ({ ...r, [email]: d.calendars || [] }));
      if (!d.calendars?.length) setRepMsg((m) => ({ ...m, [email]: "לא נמצאו יומנים" }));
    } catch (e) { setRepMsg((m) => ({ ...m, [email]: (e as Error).message })); } finally { setRepBusy(null); }
  };
  const repSave = async (email: string) => {
    const calendarId = repSel[email]; if (!calendarId) { setRepMsg((m) => ({ ...m, [email]: "בחר יומן" })); return; }
    setRepBusy(email);
    try {
      const name = (repList[email] || []).find((c) => c.id === calendarId)?.summary || calendarId;
      const d = await calAction({ action: "rep-calendar-save", email, calendarId, calendarName: name });
      setS(d.settings); setRepMsg((m) => ({ ...m, [email]: "חובר ✓" }));
    } catch (e) { setRepMsg((m) => ({ ...m, [email]: (e as Error).message })); } finally { setRepBusy(null); }
  };
  const repRemove = async (email: string) => {
    setRepBusy(email);
    try { const d = await calAction({ action: "rep-calendar-remove", email }); setS(d.settings); setRepList((r) => ({ ...r, [email]: [] })); setRepMsg((m) => ({ ...m, [email]: "נותק" })); }
    catch (e) { setRepMsg((m) => ({ ...m, [email]: (e as Error).message })); } finally { setRepBusy(null); }
  };

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await api("/api/admin/settings");
      if (res.status === 403) { setErr("אין הרשאת גישה"); return; }
      if (!res.ok) throw new Error();
      const d = await res.json();
      setS(d.settings);
      setCustomFields(d.settings.customFields || []);
      setMapRows(Object.entries(d.settings.fieldMap || {}).map(([ext, internal]) => ({ ext, internal: internal as string })));
      setMeetingTypes(d.settings.meetingTypes || []);
      setCalUser(d.settings.calendar?.impersonateUser || "");
      setCalSel(d.settings.calendar?.calendarId || "");
    } catch { setErr("שגיאה בטעינת ההגדרות"); }
  }, [api]);
  useEffect(() => { if (user) load(); }, [user, load]);

  const targetOptions = [
    ...CORE_TARGETS,
    ...QUALI_FIELDS.map((f) => ({ key: f.key, label: `הסמכה: ${f.label}` })),
    ...customFields.map((f) => ({ key: f.id, label: `מותאם: ${f.label}` })),
    ...SECTIONS.flatMap((sec) => sec.fields.map((f) => ({ key: f.key, label: `שאלון: ${f.label}` }))),
  ];

  const rotate = async () => {
    if (!window.confirm("לרענן את מפתח ה-API? מקורות שמשתמשים במפתח הישן יפסיקו לעבוד.")) return;
    setBusy(true); setMsg(null);
    try { const d = await (await api("/api/admin/settings", { method: "POST", body: JSON.stringify({ action: "rotate-key" }) })).json(); setS(d.settings); setMsg("מפתח חדש נוצר ✓"); }
    catch { setMsg("שגיאה"); } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const fieldMap: Record<string, string> = {};
      for (const r of mapRows) if (r.ext.trim() && r.internal.trim()) fieldMap[r.ext.trim()] = r.internal.trim();
      const cf = customFields.filter((f) => f.id.trim() && f.label.trim());
      const mt = meetingTypes.filter((m) => m.id.trim() && m.name.trim());
      const d = await (await api("/api/admin/settings", { method: "POST", body: JSON.stringify({ action: "save", customFields: cf, fieldMap, meetingTypes: mt }) })).json();
      setS(d.settings); setCustomFields(d.settings.customFields); setMeetingTypes(d.settings.meetingTypes || []); setMsg("נשמר ✓");
    } catch { setMsg("שגיאה בשמירה"); } finally { setBusy(false); }
  };

  const copy = (t: string) => navigator.clipboard?.writeText(t);

  if (!ready) return <main className="pcf-wrap"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return <main className="pcf-wrap"><div className="pcf-card pcf-login"><button className="pcf-btn white" onClick={login}>התחברות עם Google</button></div></main>;

  const intakeUrl = `${origin}/api/leads/intake`;

  return (
    <main className="pcf-wrap">
      <AdminNav />
      <div className="pcf-admin-top">
        <div><span className="pcf-badge">ניהול • פאוור קאפל</span><h1 style={{ fontSize: 28, margin: "12px 0 0" }}>הגדרות מערכת</h1></div>
      </div>
      {err && <div className="pcf-err">{err}</div>}
      {msg && <div className={msg.includes("✓") ? "pcf-ok" : "pcf-err"}>{msg}</div>}
      {!s ? <div className="pcf-spin" style={{ margin: "40px auto" }} /> : (
        <>
          {/* API */}
          <div className="pcf-card" style={{ marginTop: 18 }}>
            <h2><span>🔌</span> API לקליטת לידים</h2>
            <p className="lead" style={{ fontSize: 14 }}>שלח POST עם JSON לנקודת הקצה, עם המפתח בכותרת <code>x-api-key</code>. לידים נקלטים אוטומטית עם זיהוי כפילויות.</p>
            <div className="pcf-field full"><label>נקודת קצה (endpoint)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input readOnly value={intakeUrl} dir="ltr" style={{ textAlign: "left", flex: 1 }} />
                <button className="pcf-btn ghost" style={{ padding: "8px 14px" }} onClick={() => copy(intakeUrl)}>העתק</button>
              </div>
            </div>
            <div className="pcf-field full" style={{ marginTop: 12 }}><label>מפתח API</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input readOnly value={showKey ? s.apiKey : "•".repeat(Math.min(36, s.apiKey.length))} dir="ltr" style={{ textAlign: "left", flex: 1 }} />
                <button className="pcf-btn ghost" style={{ padding: "8px 14px" }} onClick={() => setShowKey((v) => !v)}>{showKey ? "הסתר" : "הצג"}</button>
                <button className="pcf-btn ghost" style={{ padding: "8px 14px" }} onClick={() => copy(s.apiKey)}>העתק</button>
                <button className="pcf-btn ghost" style={{ padding: "8px 14px" }} onClick={rotate} disabled={busy}>רענן</button>
              </div>
            </div>
            <details style={{ marginTop: 14 }}>
              <summary style={{ cursor: "pointer", color: "var(--muted)" }}>דוגמת שליחה (curl)</summary>
              <pre dir="ltr" style={{ overflowX: "auto", background: "var(--bg)", padding: 12, borderRadius: 10, fontSize: 12, marginTop: 8 }}>{`curl -X POST ${intakeUrl} \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${showKey ? s.apiKey : "YOUR_API_KEY"}" \\
  -d '{"fullName":"ישראל ישראלי","phone":"0521234567","email":"a@b.com","source":"אינסטגרם"}'`}</pre>
            </details>
          </div>

          {/* שדות מותאמים */}
          <div className="pcf-card" style={{ marginTop: 18 }}>
            <h2><span>🧩</span> שדות מותאמים אישית</h2>
            <p className="lead" style={{ fontSize: 14 }}>שדות נוספים לכל ליד. ה-ID הוא המפתח שמגיע ב-API/CSV.</p>
            {customFields.map((f, i) => (
              <div className="pcf-form" key={i} style={{ alignItems: "end", borderBottom: "1px solid var(--line)", paddingBottom: 10, marginBottom: 10 }}>
                <div className="pcf-field"><label>ID</label><input dir="ltr" style={{ textAlign: "right" }} value={f.id} onChange={(e) => setCustomFields((p) => p.map((x, idx) => idx === i ? { ...x, id: e.target.value } : x))} /></div>
                <div className="pcf-field"><label>תווית</label><input value={f.label} onChange={(e) => setCustomFields((p) => p.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} /></div>
                <div className="pcf-field"><label>סוג</label>
                  <select value={f.type} onChange={(e) => setCustomFields((p) => p.map((x, idx) => idx === i ? { ...x, type: e.target.value as CustomField["type"] } : x))}>
                    <option value="text">טקסט</option><option value="number">מספר</option><option value="radio">בחירה</option>
                  </select>
                </div>
                <div className="pcf-field" style={{ justifyContent: "flex-end" }}><button className="pcf-link-btn" style={{ color: "var(--accent)" }} onClick={() => setCustomFields((p) => p.filter((_, idx) => idx !== i))}>מחק</button></div>
              </div>
            ))}
            <button className="pcf-btn ghost" style={{ padding: "8px 16px" }} onClick={() => setCustomFields((p) => [...p, { id: "", label: "", type: "text" }])}>+ הוסף שדה</button>
          </div>

          {/* מיפוי שדות */}
          <div className="pcf-card" style={{ marginTop: 18 }}>
            <h2><span>🔀</span> מיפוי שדות (IDs חיצוניים)</h2>
            <p className="lead" style={{ fontSize: 14 }}>ממפה מזהה/שם שדה שמגיע ממקור חיצוני (למשל field_id ממטא) לשדה הפנימי. שדות שלא ממופים ולא מזוהים נשמרים כשדה מותאם.</p>
            {mapRows.map((r, i) => (
              <div className="pcf-form" key={i} style={{ alignItems: "end" }}>
                <div className="pcf-field"><label>מזהה חיצוני</label><input dir="ltr" style={{ textAlign: "right" }} value={r.ext} onChange={(e) => setMapRows((p) => p.map((x, idx) => idx === i ? { ...x, ext: e.target.value } : x))} /></div>
                <div className="pcf-field"><label>שדה פנימי</label>
                  <select value={r.internal} onChange={(e) => setMapRows((p) => p.map((x, idx) => idx === i ? { ...x, internal: e.target.value } : x))}>
                    <option value="">בחר…</option>
                    {targetOptions.map((o) => <option key={o.key} value={o.key}>{o.label} ({o.key})</option>)}
                  </select>
                </div>
                <div className="pcf-field" style={{ justifyContent: "flex-end" }}><button className="pcf-link-btn" style={{ color: "var(--accent)" }} onClick={() => setMapRows((p) => p.filter((_, idx) => idx !== i))}>מחק</button></div>
              </div>
            ))}
            <button className="pcf-btn ghost" style={{ padding: "8px 16px" }} onClick={() => setMapRows((p) => [...p, { ext: "", internal: "" }])}>+ הוסף מיפוי</button>
          </div>

          {/* תבניות פגישה */}
          <div className="pcf-card" style={{ marginTop: 18 }}>
            <h2><span>📆</span> תבניות פגישה</h2>
            <p className="lead" style={{ fontSize: 14 }}>סוגי פגישות למילוי מהיר בכרטיס הליד. בכותרת אפשר להשתמש ב-<code>[שם הלקוח]</code> — יוחלף אוטומטית.</p>
            {meetingTypes.map((m, i) => (
              <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, marginBottom: 10 }}>
                <div className="pcf-form">
                  <div className="pcf-field"><label>שם הסוג</label><input value={m.name} onChange={(e) => setMeetingTypes((p) => p.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} /></div>
                  <div className="pcf-field"><label>משך (דקות)</label><input type="number" min={5} step={5} value={m.durationMin} onChange={(e) => setMeetingTypes((p) => p.map((x, idx) => idx === i ? { ...x, durationMin: Number(e.target.value) } : x))} /></div>
                  <div className="pcf-field full"><label>כותרת הפגישה</label><input value={m.titleTemplate} onChange={(e) => setMeetingTypes((p) => p.map((x, idx) => idx === i ? { ...x, titleTemplate: e.target.value } : x))} /></div>
                  <div className="pcf-field full"><label>מיקום</label><input value={m.location} onChange={(e) => setMeetingTypes((p) => p.map((x, idx) => idx === i ? { ...x, location: e.target.value } : x))} /></div>
                </div>
                <div style={{ textAlign: "left", marginTop: 6 }}><button className="pcf-link-btn" style={{ color: "var(--accent)" }} onClick={() => setMeetingTypes((p) => p.filter((_, idx) => idx !== i))}>מחק סוג</button></div>
              </div>
            ))}
            <button className="pcf-btn ghost" style={{ padding: "8px 16px" }} onClick={() => setMeetingTypes((p) => [...p, { id: "type_" + Date.now(), name: "", titleTemplate: "", durationMin: 60, location: "" }])}>+ הוסף סוג פגישה</button>
          </div>

          <div style={{ marginTop: 20 }}>
            <button className="pcf-btn" onClick={save} disabled={busy}>{busy ? <span className="pcf-spin" /> : "💾 שמור הגדרות"}</button>
          </div>

          <div className="pcf-card" style={{ marginTop: 18 }}>
            <h2 style={{ marginTop: 0 }}><span>📅</span> יומן גוגל (פגישות)</h2>
            {s.calendar?.connected ? (
              <div className="pcf-ok" style={{ marginTop: 0 }}>
                מחובר ✓ — יומן <b>{s.calendar.calendarName || s.calendar.calendarId}</b> (משתמש: {s.calendar.impersonateUser})
                <div style={{ marginTop: 10 }}><button className="pcf-btn ghost" style={{ padding: "6px 14px", fontSize: 13 }} onClick={disconnectCalendar} disabled={calBusy}>נתק יומן</button></div>
              </div>
            ) : (
              <p className="lead" style={{ fontSize: 14 }}>בחרו יומן לחיבור. אחרי החיבור אפשר לתאם פגישות ישירות מכרטיס הליד.</p>
            )}
            <div className="pcf-form" style={{ marginTop: 12 }}>
              <div className="pcf-field full"><label>משתמש היומן (חשבון Workspace — ריק = ברירת המחדל)</label>
                <input dir="ltr" style={{ textAlign: "right" }} value={calUser} onChange={(e) => setCalUser(e.target.value)} placeholder="office@powercouple.co.il" />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              <button className="pcf-btn ghost" style={{ padding: "9px 16px", fontSize: 14 }} onClick={loadCalendars} disabled={calBusy}>{calBusy ? "טוען…" : "טען יומנים"}</button>
              {calList.length > 0 && (
                <>
                  <select value={calSel} onChange={(e) => setCalSel(e.target.value)} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit", fontSize: 14, minWidth: 220 }}>
                    <option value="">בחר יומן…</option>
                    {calList.map((c) => <option key={c.id} value={c.id}>{c.summary}{c.primary ? " (ראשי)" : ""}</option>)}
                  </select>
                  <button className="pcf-btn" style={{ padding: "9px 18px", fontSize: 14 }} onClick={connectCalendar} disabled={calBusy || !calSel}>חבר יומן</button>
                </>
              )}
              {calMsg && <span className={calMsg.includes("✓") ? "pcf-ok" : "pcf-err"} style={{ marginTop: 0, padding: "8px 14px" }}>{calMsg}</span>}
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 0 }}>יומן זה משמש ל<b>פגישות מצפן</b> (נקבעות תמיד ביומן של רגב).</p>
          </div>

          {/* יומני נציגים — לפולואפים */}
          <div className="pcf-card" style={{ marginTop: 18 }}>
            <h2 style={{ marginTop: 0 }}><span>👤</span> יומני נציגים (פולואפים)</h2>
            <p className="lead" style={{ fontSize: 14 }}>כל נציג מחבר את היומן האישי שלו. כשמסמנים ליד כ<b>פולואפ</b>, הפגישה נקבעת ביומן של הנציג שסימן.</p>
            <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
              {REPS.map((r) => {
                const cfg = s.repCalendars?.[r.email];
                const list = repList[r.email] || [];
                const busyR = repBusy === r.email;
                const rmsg = repMsg[r.email];
                return (
                  <div key={r.email} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "12px 14px", background: "var(--bg)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "50%", background: r.color, color: "#fff", fontWeight: 800, fontSize: 12 }}>{r.initials}</span>
                      <b>{r.name}</b>
                      <span dir="ltr" style={{ color: "var(--muted)", fontSize: 13 }}>{r.email}</span>
                      {cfg
                        ? <span className="pcf-pill-status done" style={{ marginInlineStart: "auto" }}>מחובר: {cfg.calendarName || "יומן ראשי"}</span>
                        : <span className="pcf-pill-status draft" style={{ marginInlineStart: "auto" }}>לא מחובר</span>}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                      <button className="pcf-btn ghost" style={{ padding: "7px 14px", fontSize: 13 }} onClick={() => repLoad(r.email)} disabled={busyR}>{busyR ? "טוען…" : "טען יומנים"}</button>
                      {list.length > 0 && (
                        <>
                          <select value={repSel[r.email] || cfg?.calendarId || ""} onChange={(e) => setRepSel((m) => ({ ...m, [r.email]: e.target.value }))} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit", fontSize: 13, minWidth: 200 }}>
                            <option value="">בחר יומן…</option>
                            {list.map((c) => <option key={c.id} value={c.id}>{c.summary}{c.primary ? " (ראשי)" : ""}</option>)}
                          </select>
                          <button className="pcf-btn" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => repSave(r.email)} disabled={busyR}>חבר</button>
                        </>
                      )}
                      {cfg && <button className="pcf-link-btn" style={{ color: "var(--accent)", fontSize: 13 }} onClick={() => repRemove(r.email)}>נתק</button>}
                      {rmsg && <span className={rmsg.includes("✓") ? "pcf-ok" : "pcf-err"} style={{ marginTop: 0, padding: "6px 12px", fontSize: 13 }}>{rmsg}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12, marginBottom: 0 }}>נציגי @powercouple.co.il מתחברים אוטומטית (הרשאת דומיין). למייל בדומיין אחר (כמו binder.co.il) ייתכן שיידרש אישור נפרד.</p>
          </div>
        </>
      )}
    </main>
  );
}
