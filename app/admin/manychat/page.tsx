"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, firebaseAuth, type User } from "@/lib/authClient";
import AdminNav from "../AdminNav";

interface Waba { id: string; name: string }
interface Phone { id: string; display: string; name: string; quality?: string }
interface Page { id: string; name: string; ig?: { id: string; username: string } | null }
interface Settings {
  waba_id: string | null; waba_name: string | null;
  phone_number_id: string | null; phone_display: string | null;
  fb_page_id: string | null; fb_page_name: string | null;
  ig_user_id: string | null; ig_username: string | null;
  connected_at: string | null; connected_by: string | null;
}

const TABS = [
  { key: "settings", label: "⚙️ הגדרות וחיבור" },
  { key: "broadcast", label: "📤 שליחת ווצאפ" },
  { key: "audiences", label: "🏷️ קהלים ותגיות" },
  { key: "automations", label: "🤖 אוטומציות IG/FB" },
  { key: "inbox", label: "💬 שיחות" },
];

export default function ManyChatPage() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("settings");

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setReady(true); }), []);

  if (!ready) return <main className="pcf-wrap pcf-wide"><div className="pcf-spin" style={{ margin: "80px auto" }} /></main>;
  if (!user) return <main className="pcf-wrap pcf-wide"><div className="pcf-card" style={{ textAlign: "center" }}>נדרשת התחברות</div></main>;

  return (
    <main className="pcf-wrap pcf-wide">
      <AdminNav />
      <div className="pcf-hero" style={{ marginBottom: 8, marginTop: 12 }}>
        <span className="pcf-badge">Power Couple</span>
        <h1>💬 מאניצ'אט</h1>
        <p className="sub">מנוע האוטומציות והשיחות שלנו — WhatsApp רשמי (WABA), אינסטגרם ופייסבוק.</p>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "12px 14px", background: "var(--surface-2,rgba(255,255,255,.03))", border: "1px solid var(--line)", borderRadius: 14, marginBottom: 14 }}>
        {TABS.map((t) => (
          <button key={t.key} className={`pcf-pill sm${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === "settings" ? <SettingsTab />
        : tab === "audiences" ? <AudiencesTab />
        : tab === "automations" ? <AutomationsTab />
        : tab === "broadcast" ? <BroadcastTab />
        : tab === "inbox" ? <InboxTab />
        : <ComingSoon tab={tab} />}
    </main>
  );
}

async function authHeaders(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await firebaseAuth().currentUser!.getIdToken()}` };
}

function ComingSoon({ tab }: { tab: string }) {
  const info: Record<string, { title: string; body: string }> = {
    broadcast: { title: "📤 שליחת ווצאפ", body: "בחירת טמפלייט מאושר מ-WABA ושליחה לאנשי קשר לפי פילטר/תגית. ייבנה בשלב הבא (אחרי חיבור ה-WABA)." },
    audiences: { title: "🏷️ קהלים ותגיות", body: "תיוג אנשי קשר, בניית קהלים ופילטור מתקדם על הלידים והלקוחות." },
    automations: { title: "🤖 אוטומציות אינסטגרם/פייסבוק", body: "תגובה על פוסט → הודעה בפרטי (תגיבו X תקבלו Y). דורש חיבור Webhook של מטא." },
    inbox: { title: "💬 שיחות WABA", body: "ניהול השיחות עם לקוחות שהגיבו — צ'אט דו-כיווני. דורש חיבור Webhook של מטא." },
  };
  const i = info[tab] || { title: "בקרוב", body: "" };
  return (
    <div className="pcf-card" style={{ textAlign: "center", padding: "48px 24px" }}>
      <h2 style={{ marginTop: 0 }}>{i.title}</h2>
      <p style={{ color: "var(--muted)", maxWidth: 520, margin: "10px auto" }}>{i.body}</p>
      <span className="pcf-pill-status wait" style={{ marginTop: 8 }}>בבנייה — שלב הבא</span>
    </div>
  );
}

function SettingsTab() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [wabas, setWabas] = useState<Waba[]>([]);
  const [phones, setPhones] = useState<Phone[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [selWaba, setSelWaba] = useState("");
  const [selPhone, setSelPhone] = useState("");
  const [selPage, setSelPage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const authHeader = async () => ({ Authorization: `Bearer ${await firebaseAuth().currentUser!.getIdToken()}` });

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/admin/manychat/connect", { headers: await authHeader() });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה");
      setSettings(d.settings); setWabas(d.wabas || []); setPages(d.pages || []);
      if (d.settings?.waba_id) { setSelWaba(d.settings.waba_id); loadPhones(d.settings.waba_id); }
      setSelPhone(d.settings?.phone_number_id || "");
      setSelPage(d.settings?.fb_page_id || "");
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadPhones = async (waba: string) => {
    setPhones([]);
    try {
      const res = await fetch(`/api/admin/manychat/connect?waba=${encodeURIComponent(waba)}`, { headers: await authHeader() });
      const d = await res.json();
      if (res.ok) setPhones(d.phones || []);
    } catch { /* */ }
  };

  const onPickWaba = (id: string) => { setSelWaba(id); setSelPhone(""); if (id) loadPhones(id); };

  const save = async () => {
    setBusy(true); setMsg(null); setErr(null);
    try {
      const waba = wabas.find((w) => w.id === selWaba);
      const phone = phones.find((p) => p.id === selPhone);
      const res = await fetch("/api/admin/manychat/connect", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ waba_id: selWaba, waba_name: waba?.name, phone_number_id: selPhone, phone_display: phone?.display }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה");
      setSettings(d.settings); setMsg("החיבור נשמר ✓");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const savePage = async () => {
    setPageBusy(true); setMsg(null); setErr(null);
    try {
      const page = pages.find((p) => p.id === selPage);
      const res = await fetch("/api/admin/manychat/connect", {
        method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ fb_page_id: selPage, fb_page_name: page?.name, ig_user_id: page?.ig?.id || "", ig_username: page?.ig?.username || "" }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה");
      setSettings(d.settings); setMsg("חשבונות IG/FB נשמרו ✓");
    } catch (e) { setErr((e as Error).message); } finally { setPageBusy(false); }
  };

  if (loading) return <div className="pcf-card"><div className="pcf-spin" style={{ margin: "30px auto" }} /></div>;

  const connected = settings?.phone_number_id;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="pcf-card">
        <h2 style={{ marginTop: 0 }}>סטטוס חיבור</h2>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          {connected
            ? <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><span className="pcf-pill-status done">WABA ✓</span><b dir="ltr">{settings!.phone_display}</b> · {settings!.waba_name}</span>
            : <span className="pcf-pill-status draft">WABA לא מחובר</span>}
          {settings?.fb_page_id
            ? <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><span className="pcf-pill-status done">פייסבוק ✓</span>{settings.fb_page_name}</span>
            : <span className="pcf-pill-status draft">פייסבוק לא מחובר</span>}
          {settings?.ig_username
            ? <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><span className="pcf-pill-status done">אינסטגרם ✓</span>@{settings.ig_username}</span>
            : <span className="pcf-pill-status draft">אינסטגרם לא מחובר</span>}
        </div>
      </div>

      <div className="pcf-card">
        <h2 style={{ marginTop: 0 }}>חיבור WhatsApp Business (WABA)</h2>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>בחרו את חשבון ה-WABA ואת מספר הטלפון שמהם יישלחו ההודעות.</p>
        {err && <div className="pcf-pill-status danger" style={{ display: "inline-block", marginBottom: 10 }}>{err}</div>}
        <div style={{ display: "grid", gap: 12, maxWidth: 520, marginTop: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>חשבון WABA</span>
            <select value={selWaba} onChange={(e) => onPickWaba(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit" }}>
              <option value="">בחרו חשבון…</option>
              {wabas.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.id})</option>)}
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>מספר טלפון</span>
            <select value={selPhone} onChange={(e) => setSelPhone(e.target.value)} disabled={!selWaba} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit" }}>
              <option value="">{selWaba ? "בחרו מספר…" : "בחרו קודם חשבון"}</option>
              {phones.map((p) => <option key={p.id} value={p.id}>{p.display} — {p.name}{p.quality ? ` · ${p.quality}` : ""}</option>)}
            </select>
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="pcf-btn" onClick={save} disabled={busy || !selPhone}>{busy ? "שומר…" : "💾 שמור חיבור"}</button>
            {msg && <span style={{ color: "var(--green)", fontWeight: 600 }}>{msg}</span>}
          </div>
        </div>
      </div>

      <div className="pcf-card">
        <h2 style={{ marginTop: 0 }}>אינסטגרם / פייסבוק</h2>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 4 }}>בחרו את עמוד הפייסבוק לאוטומציות. חשבון האינסטגרם המחובר לעמוד ייקלט אוטומטית.</p>
        <div style={{ display: "grid", gap: 12, maxWidth: 520, marginTop: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>עמוד פייסבוק</span>
            <select value={selPage} onChange={(e) => setSelPage(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit" }}>
              <option value="">בחרו עמוד…</option>
              {pages.map((p) => <option key={p.id} value={p.id}>{p.name}{p.ig ? ` · IG @${p.ig.username}` : " · אין IG"}</option>)}
            </select>
          </label>
          {selPage && (() => { const p = pages.find((x) => x.id === selPage); return <span style={{ fontSize: 13, color: "var(--muted)" }}>{p?.ig ? `אינסטגרם מחובר: @${p.ig.username}` : "לעמוד זה אין חשבון אינסטגרם מקושר"}</span>; })()}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="pcf-btn" onClick={savePage} disabled={pageBusy || !selPage}>{pageBusy ? "שומר…" : "💾 שמור IG/FB"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────  קהלים ותגיות  ─────────────────────────
interface Tag { id: string; name: string; color: string; count: number }
interface Contact { type: "lead" | "client"; id: string; name: string; phone: string; email: string; stage: string; tags: string[] }

function AudiencesTab() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [f, setF] = useState({ type: "all", q: "", hasPhone: true, tag: "" });
  const [newTag, setNewTag] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const loadTags = async () => { const r = await fetch("/api/admin/manychat/tags", { headers: await authHeaders() }); const d = await r.json(); setTags(d.tags || []); };
  const loadContacts = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ type: f.type, q: f.q, tag: f.tag, ...(f.hasPhone ? { hasPhone: "1" } : {}) });
    const r = await fetch(`/api/admin/manychat/audience?${p}`, { headers: await authHeaders() });
    const d = await r.json(); setContacts(d.contacts || []); setTotal(d.total || 0); setLoading(false);
  }, [f]);
  useEffect(() => { loadTags(); }, []);
  useEffect(() => { loadContacts(); }, [loadContacts]);

  const createTag = async () => {
    const name = newTag.trim(); if (!name) return;
    await fetch("/api/admin/manychat/tags", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ name }) });
    setNewTag(""); loadTags();
  };
  const delTag = async (id: string) => { if (!confirm("למחוק תגית?")) return; await fetch(`/api/admin/manychat/tags?id=${id}`, { method: "DELETE", headers: await authHeaders() }); loadTags(); loadContacts(); };
  const toggleTag = async (c: Contact, tagId: string) => {
    const has = c.tags.includes(tagId);
    await fetch("/api/admin/manychat/audience", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ contact_type: c.type, contact_id: c.id, tag_id: tagId, action: has ? "remove" : "add" }) });
    setContacts((prev) => prev.map((x) => x === c ? { ...x, tags: has ? x.tags.filter((t) => t !== tagId) : [...x.tags, tagId] } : x));
    loadTags();
  };
  const tagAll = async () => {
    if (!f.tag) { setMsg("בחרו תגית לסינון כדי לתייג את כל הקהל"); return; }
    const list = contacts.map((c) => ({ contact_type: c.type, contact_id: c.id }));
    await fetch("/api/admin/manychat/audience", { method: "PUT", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ tag_id: f.tag, contacts: list }) });
    setMsg(`תויגו ${list.length} אנשי קשר`); loadTags();
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="pcf-card">
        <h2 style={{ marginTop: 0 }}>🏷️ תגיות</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createTag()} placeholder="שם תגית חדשה…" style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit" }} />
          <button className="pcf-btn" style={{ padding: "8px 16px" }} onClick={createTag}>+ צור תגית</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tags.map((t) => <span key={t.id} className="pcf-pill-status" style={{ background: `${t.color}22`, color: t.color, cursor: "pointer" }} onClick={() => delTag(t.id)} title="לחיצה מוחקת">{t.name} ({t.count}) ✕</span>)}
          {!tags.length && <span style={{ color: "var(--muted)" }}>אין תגיות עדיין</span>}
        </div>
      </div>

      <div className="pcf-card">
        <h2 style={{ marginTop: 0 }}>👥 קהל ({total})</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit" }}>
            <option value="all">הכל</option><option value="lead">לידים</option><option value="client">לקוחות</option>
          </select>
          <select value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit" }}>
            <option value="">כל התגיות</option>{tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="חיפוש שם/טלפון/מייל…" style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit" }} />
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={f.hasPhone} onChange={(e) => setF({ ...f, hasPhone: e.target.checked })} /> רק עם טלפון</label>
          {f.tag && <button className="pcf-btn ghost" style={{ padding: "8px 14px" }} onClick={tagAll}>תייג את כל הקהל המסונן</button>}
          {msg && <span style={{ color: "var(--green)", fontWeight: 600 }}>{msg}</span>}
        </div>
        {loading ? <div className="pcf-spin" style={{ margin: "20px auto" }} /> : (
          <div style={{ overflowX: "auto" }}>
            <table className="pcf-table" style={{ width: "100%", fontSize: 14 }}>
              <thead><tr><th style={{ textAlign: "right" }}>שם</th><th style={{ textAlign: "right" }}>טלפון</th><th style={{ textAlign: "right" }}>שלב</th><th style={{ textAlign: "right" }}>תגיות</th></tr></thead>
              <tbody>
                {contacts.slice(0, 200).map((c) => (
                  <tr key={`${c.type}:${c.id}`}>
                    <td>{c.name || "—"} <span style={{ color: "var(--muted)", fontSize: 12 }}>{c.type === "lead" ? "ליד" : "לקוח"}</span></td>
                    <td dir="ltr" style={{ textAlign: "right" }}>{c.phone || "—"}</td>
                    <td>{c.stage || "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {tags.map((t) => <span key={t.id} onClick={() => toggleTag(c, t.id)} style={{ cursor: "pointer", fontSize: 11, padding: "2px 8px", borderRadius: 999, border: `1px solid ${t.color}`, background: c.tags.includes(t.id) ? t.color : "transparent", color: c.tags.includes(t.id) ? "#fff" : t.color }}>{t.name}</span>)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total > 200 && <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>מוצגים 200 הראשונים מתוך {total}. השתמשו בסינון לצמצום.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────  אוטומציות IG/FB  ─────────────────────────
interface Automation { id: string; name: string; channel: string; trigger: { postId?: string; keywords?: string[]; matchType?: string }; action: { dmText: string; publicReply?: string }; enabled: boolean; stats?: Record<string, number> }

function AutomationsTab() {
  const [list, setList] = useState<Automation[]>([]);
  const [form, setForm] = useState({ name: "", channel: "ig", postId: "", keywords: "", matchType: "any", dmText: "", publicReply: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => { const r = await fetch("/api/admin/manychat/automations", { headers: await authHeaders() }); const d = await r.json(); setList(d.automations || []); };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.dmText.trim()) { setMsg("חסר טקסט DM"); return; }
    setBusy(true); setMsg(null);
    const body = { name: form.name || "אוטומציה", channel: form.channel, trigger: { postId: form.postId.trim(), keywords: form.keywords.split(",").map((k) => k.trim()).filter(Boolean), matchType: form.matchType }, action: { dmText: form.dmText, publicReply: form.publicReply.trim() || undefined } };
    const r = await fetch("/api/admin/manychat/automations", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify(body) });
    if (r.ok) { setForm({ name: "", channel: "ig", postId: "", keywords: "", matchType: "any", dmText: "", publicReply: "" }); setMsg("האוטומציה נוצרה ✓"); load(); } else setMsg("שגיאה ביצירה");
    setBusy(false);
  };
  const toggle = async (a: Automation) => { await fetch(`/api/admin/manychat/automations?id=${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ enabled: !a.enabled }) }); load(); };
  const del = async (id: string) => { if (!confirm("למחוק אוטומציה?")) return; await fetch(`/api/admin/manychat/automations?id=${id}`, { method: "DELETE", headers: await authHeaders() }); load(); };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="pcf-card" style={{ background: "rgba(255,122,59,.08)", border: "1px solid rgba(255,122,59,.3)" }}>
        <p style={{ margin: 0, fontSize: 14 }}>⚡ אוטומציות תגובה→DM פועלות אחרי חיבור ה-Webhook של מטא (ראו הגדרות). ה-DM נשלח דרך חשבון ה-IG/עמוד הפייסבוק המחוברים.</p>
      </div>
      <div className="pcf-card">
        <h2 style={{ marginTop: 0 }}>🤖 אוטומציה חדשה</h2>
        <div style={{ display: "grid", gap: 12, maxWidth: 640 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit" }}>
              <option value="ig">אינסטגרם</option><option value="fb">פייסבוק</option>
            </select>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="שם האוטומציה" style={{ flex: 1, minWidth: 180, padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit" }} />
          </div>
          <input value={form.postId} onChange={(e) => setForm({ ...form, postId: e.target.value })} placeholder="מזהה פוסט (ריק = כל הפוסטים)" style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit" }} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="מילות מפתח (מופרד בפסיק) — ריק = כל תגובה" style={{ flex: 1, minWidth: 200, padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit" }} />
            <select value={form.matchType} onChange={(e) => setForm({ ...form, matchType: e.target.value })} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit" }}>
              <option value="any">מכיל אחת</option><option value="all">מכיל את כולן</option><option value="exact">בדיוק</option>
            </select>
          </div>
          <textarea value={form.dmText} onChange={(e) => setForm({ ...form, dmText: e.target.value })} placeholder="טקסט ההודעה בפרטי (DM)…" rows={3} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit", resize: "vertical", fontFamily: "inherit" }} />
          <input value={form.publicReply} onChange={(e) => setForm({ ...form, publicReply: e.target.value })} placeholder="תגובה ציבורית (אופציונלי, למשל 'שלחתי לך בפרטי')" style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit" }} />
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="pcf-btn" onClick={create} disabled={busy}>{busy ? "יוצר…" : "+ צור אוטומציה"}</button>
            {msg && <span style={{ color: "var(--green)", fontWeight: 600 }}>{msg}</span>}
          </div>
        </div>
      </div>
      <div className="pcf-card">
        <h2 style={{ marginTop: 0 }}>אוטומציות פעילות</h2>
        {!list.length ? <p style={{ color: "var(--muted)" }}>אין אוטומציות עדיין.</p> : (
          <div style={{ display: "grid", gap: 10 }}>
            {list.map((a) => (
              <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <b>{a.name}</b>
                    <span className="pcf-pill-status sent">{a.channel === "ig" ? "אינסטגרם" : "פייסבוק"}</span>
                    <span className={`pcf-pill-status ${a.enabled ? "done" : "draft"}`}>{a.enabled ? "פעיל" : "כבוי"}</span>
                    {a.stats?.sent ? <span style={{ fontSize: 12, color: "var(--muted)" }}>נשלחו {a.stats.sent}</span> : null}
                  </div>
                  <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
                    {a.trigger?.keywords?.length ? `מילים: ${a.trigger.keywords.join(", ")}` : "כל תגובה"}{a.trigger?.postId ? ` · פוסט ${a.trigger.postId}` : ""} → DM: {a.action?.dmText?.slice(0, 60)}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="pcf-btn ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => toggle(a)}>{a.enabled ? "כבה" : "הפעל"}</button>
                  <button className="pcf-btn ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => del(a.id)}>מחק</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────  שליחת ווצאפ (דיוור)  ─────────────────────────
interface Template { name: string; status: string; category: string; language: string }

function BroadcastTab() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [needsWaba, setNeedsWaba] = useState(false);
  const [sel, setSel] = useState("");
  const [count, setCount] = useState(0);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [f, setF] = useState({ type: "all", tag: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/admin/manychat/templates", { headers: await authHeaders() }); const d = await r.json();
      setTemplates((d.templates || []).filter((t: Template) => t.status === "APPROVED")); setNeedsWaba(!!d.needsWaba);
      const rt = await fetch("/api/admin/manychat/tags", { headers: await authHeaders() }); setTags((await rt.json()).tags || []);
    })();
  }, []);
  const loadAudience = useCallback(async () => {
    const p = new URLSearchParams({ type: f.type, tag: f.tag, hasPhone: "1" });
    const r = await fetch(`/api/admin/manychat/audience?${p}`, { headers: await authHeaders() });
    const d = await r.json(); setContacts(d.contacts || []); setCount(d.total || 0);
  }, [f]);
  useEffect(() => { loadAudience(); }, [loadAudience]);

  const send = async () => {
    if (!sel) { setMsg("בחרו טמפלייט"); return; }
    if (!confirm(`לשלוח את הטמפלייט "${sel}" ל-${contacts.length} אנשי קשר?`)) return;
    setBusy(true); setMsg(null);
    const tpl = templates.find((t) => t.name === sel);
    const r = await fetch("/api/admin/manychat/broadcast", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ template_name: sel, template_language: tpl?.language || "he", contacts: contacts.map((c) => ({ contact_type: c.type, contact_id: c.id, phone: c.phone, name: c.name })) }) });
    const d = await r.json();
    setMsg(r.ok ? `נשלחו ${d.sent} · נכשלו ${d.failed}` : `שגיאה: ${d.error}`);
    setBusy(false);
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {needsWaba && <div className="pcf-card" style={{ background: "rgba(255,200,87,.1)", border: "1px solid rgba(255,200,87,.4)" }}><p style={{ margin: 0 }}>⚠️ צריך לחבר מספר WABA בהגדרות כדי למשוך טמפלייטים ולשלוח.</p></div>}
      <div className="pcf-card">
        <h2 style={{ marginTop: 0 }}>📤 שליחת טמפלייט WABA</h2>
        <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
          <label style={{ display: "grid", gap: 6 }}><span style={{ fontWeight: 600, fontSize: 14 }}>טמפלייט מאושר</span>
            <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit" }}>
              <option value="">בחרו טמפלייט…</option>{templates.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.language})</option>)}
            </select>
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit" }}>
              <option value="all">כל אנשי הקשר</option><option value="lead">לידים</option><option value="client">לקוחות</option>
            </select>
            <select value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} style={{ padding: "9px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg-2)", color: "inherit" }}>
              <option value="">כל התגיות</option>{tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <p style={{ margin: 0, fontSize: 15 }}>קהל יעד: <b>{count}</b> אנשי קשר עם טלפון{count > 500 ? " (יישלח ל-500 הראשונים)" : ""}</p>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button className="pcf-btn" onClick={send} disabled={busy || !sel || !contacts.length}>{busy ? "שולח…" : `📤 שלח ל-${contacts.length}`}</button>
            {msg && <span style={{ color: "var(--green)", fontWeight: 600 }}>{msg}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────  Inbox — שיחות  ─────────────────────────
interface Conv { id: string; channel: string; name: string; phone: string; last_text: string; last_message_at: string; unread: number }
interface Msg { id: string; direction: string; text: string; at: string }

function InboxTab() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [sel, setSel] = useState<Conv | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => { const r = await fetch("/api/admin/manychat/conversations", { headers: await authHeaders() }); const d = await r.json(); setConvs(d.conversations || []); };
  useEffect(() => { load(); }, []);
  const open = async (c: Conv) => { setSel(c); const r = await fetch(`/api/admin/manychat/conversations?id=${c.id}`, { headers: await authHeaders() }); const d = await r.json(); setMsgs(d.messages || []); };
  const send = async () => {
    if (!reply.trim() || !sel) return; setBusy(true);
    const r = await fetch("/api/admin/manychat/conversations", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeaders()) }, body: JSON.stringify({ conversation_id: sel.id, text: reply }) });
    if (r.ok) { setReply(""); open(sel); } setBusy(false);
  };

  return (
    <div className="pcf-card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", minHeight: 460 }}>
        <div style={{ borderLeft: "1px solid var(--line)", overflowY: "auto", maxHeight: 560 }}>
          {!convs.length && <p style={{ padding: 16, color: "var(--muted)", fontSize: 14 }}>אין שיחות עדיין. שיחות נכנסות יופיעו כאן אחרי חיבור ה-Webhook.</p>}
          {convs.map((c) => (
            <div key={c.id} onClick={() => open(c)} style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", cursor: "pointer", background: sel?.id === c.id ? "var(--surface-2,rgba(255,255,255,.05))" : "transparent" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><b>{c.name || c.phone}</b>{c.unread ? <span className="pcf-pill-status danger" style={{ padding: "0 6px" }}>{c.unread}</span> : null}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.last_text}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", maxHeight: 560 }}>
          {!sel ? <div style={{ margin: "auto", color: "var(--muted)" }}>בחרו שיחה</div> : (<>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", fontWeight: 700 }}>{sel.name || sel.phone} <span dir="ltr" style={{ color: "var(--muted)", fontWeight: 400, fontSize: 13 }}>{sel.phone}</span></div>
            <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              {msgs.map((m) => (
                <div key={m.id} style={{ alignSelf: m.direction === "out" ? "flex-start" : "flex-end", maxWidth: "75%", padding: "8px 12px", borderRadius: 12, background: m.direction === "out" ? "var(--accent,#ff3b3b)" : "var(--surface-2,rgba(255,255,255,.08))", color: m.direction === "out" ? "#fff" : "inherit", whiteSpace: "pre-wrap", fontSize: 14 }}>{m.text}</div>
              ))}
            </div>
            <div style={{ padding: 12, borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}>
              <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="כתבו תשובה…" style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "inherit" }} />
              <button className="pcf-btn" onClick={send} disabled={busy || !reply.trim()}>שלח</button>
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
}
