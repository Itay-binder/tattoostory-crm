"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { useAdmin } from "@/lib/useAdmin";
import { FIELD_TYPE_LABELS, type ContractField } from "@/lib/contracts";

interface ClientOpt { uid: string; fullName: string; email: string; phone: string; }
interface SignerCfg { name: string; contact: string; clientUid: string; createClient: boolean; order: number; optional: boolean; }
interface GenLink { role: string; name: string; order: number; optional: boolean; token: string; }

export default function SendPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, ready, login, api } = useAdmin();
  const [tplName, setTplName] = useState("");
  const [signerCount, setSignerCount] = useState(1);
  const [fields, setFields] = useState<ContractField[]>([]);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [senderValues, setSenderValues] = useState<Record<string, string>>({});
  const [signers, setSigners] = useState<SignerCfg[]>([]);
  const [links, setLinks] = useState<GenLink[] | null>(null);
  const [envelopeId, setEnvelopeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [waSel, setWaSel] = useState<Record<string, boolean>>({ mik: false, dean: false, hamal: false, client: true });
  const [waOther1, setWaOther1] = useState("");
  const [waOther2, setWaOther2] = useState("");
  const [waBusy, setWaBusy] = useState(false);
  const [waMsg, setWaMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [tRes, cRes] = await Promise.all([api(`/api/admin/templates/${id}`), api("/api/admin/clients")]);
    if (!tRes.ok) { setErr("שגיאה בטעינת התבנית"); return; }
    const t = await tRes.json();
    const cnt = t.signerCount || 1;
    setTplName(t.name); setSignerCount(cnt); setFields(t.fields || []);
    const clientList: ClientOpt[] = cRes.ok ? ((await cRes.json()).clients || []) : [];
    setClients(clientList);
    // בחירת לקוח מראש מ-?client=<uid> (הגעה מכרטיס הלקוח) — ממלא את החותם הראשון
    const preUid = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("client") : null;
    const pre = preUid ? clientList.find((c) => c.uid === preUid) : null;
    setSigners(Array.from({ length: cnt }, (_, i) => (
      i === 0 && pre
        ? { name: pre.fullName || "", contact: pre.phone || pre.email || "", clientUid: pre.uid, createClient: false, order: 1, optional: false }
        : { name: "", contact: "", clientUid: "", createClient: false, order: i + 1, optional: false }
    )));
  }, [api, id]);
  useEffect(() => { if (user) load(); }, [user, load]);

  const senderFields = fields.filter((f) => f.source === "sender");
  const fieldsForSigner = (i: number) => fields.filter((f) => f.source === `signer${i}`);

  const setSigner = (i: number, patch: Partial<SignerCfg>) => setSigners((prev) => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));

  const onPickClient = (i: number, uid: string) => {
    const c = clients.find((x) => x.uid === uid);
    setSigner(i, { clientUid: uid, name: c?.fullName || "", contact: c?.phone || c?.email || "" });
  };

  const submit = async () => {
    setErr(null);
    if (signers.some((s) => !s.name.trim())) { setErr("יש למלא שם לכל חותם"); return; }
    setBusy(true);
    try {
      const payload = {
        templateId: id,
        senderValues,
        signers: signers.map((s, i) => ({ role: `signer${i + 1}`, name: s.name, contact: s.contact, clientUid: s.clientUid || undefined, createClient: s.createClient && !s.clientUid, order: s.order, optional: s.optional })),
      };
      const res = await api("/api/admin/send", { method: "POST", body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שליחה נכשלה");
      setLinks(d.links);
      setEnvelopeId(d.envelopeId || "");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const copy = (token: string) => navigator.clipboard?.writeText(`${origin}/sign/${token}`);

  const sendWa = async () => {
    const targets = Object.entries(waSel).filter(([, v]) => v).map(([k]) => k);
    const others = [waOther1, waOther2].map((s) => s.trim()).filter(Boolean);
    if (!targets.length && !others.length) { setWaMsg("בחר לפחות נמען אחד"); return; }
    setWaBusy(true); setWaMsg(null);
    try {
      const res = await api("/api/admin/send-signature-links", { method: "POST", body: JSON.stringify({ envelopeId, targets, others, origin }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה");
      const fails = (d.results || []).filter((r: { ok: boolean }) => !r.ok);
      setWaMsg(`נשלח ל-${d.sent}/${d.total} נמענים ✓${fails.length ? " · נכשל: " + fails.map((f: { label: string; error: string }) => `${f.label} (${f.error})`).join(", ") : ""}`);
    } catch (e) { setWaMsg(`נכשל — ${(e as Error).message}`); } finally { setWaBusy(false); }
  };

  const WA_OPTS: { key: string; label: string }[] = [
    { key: "client", label: "הלקוח שחותם" },
    { key: "mik", label: "מיק" },
    { key: "dean", label: "דין" },
    { key: "hamal", label: "חמל פאוור (קבוצה)" },
  ];

  if (!ready) return <main className="pcf-wrap"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return <main className="pcf-wrap"><div className="pcf-card pcf-login"><button className="pcf-btn white" onClick={login}>התחברות עם Google</button></div></main>;

  if (links) {
    return (
      <main className="pcf-wrap">
        <header className="pcf-hero"><span className="pcf-badge">נשלח לחתימה ✓</span><h1 style={{ fontSize: 26 }}>{tplName}</h1></header>
        <div className="pcf-card">
          <p className="lead">נוצרו {links.length} קישורי חתימה (לפי סדר). העתק ושלח לכל חותם:</p>
          {links.map((l) => (
            <div key={l.token} className="pcf-link-row">
              <div>
                <b>חתימה {l.order} — {l.name}</b>{l.optional && <span style={{ color: "var(--gold)", fontSize: 12 }}> (אופציונלי)</span>}
                <div className="pcf-link-url" dir="ltr">{origin}/sign/{l.token}</div>
              </div>
              <button className="pcf-btn ghost" style={{ padding: "8px 16px" }} onClick={() => copy(l.token)}>העתק</button>
            </div>
          ))}
          <div style={{ marginTop: 18 }}><Link href="/admin/templates" className="pcf-link-btn">→ חזרה לתבניות</Link></div>
        </div>

        {/* שליחת הקישורים בווצאפ */}
        <div className="pcf-card" style={{ marginTop: 16 }}>
          <h2 style={{ marginTop: 0 }}><span>💬</span> שליחת הקישורים בווצאפ</h2>
          <p className="lead" style={{ fontSize: 13 }}>נשלח מהמספר של פאוור קאפל. לנמענים קבועים נשלחת רשימת כל הקישורים; ל"לקוח שחותם" נשלח לכל חותם הקישור האישי שלו (לפי הטלפון שנרשם).</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
            {WA_OPTS.map((o) => (
              <label key={o.key} className={`pcf-pill${waSel[o.key] ? " active" : ""}`} style={{ cursor: "pointer", userSelect: "none" }}>
                <input type="checkbox" checked={!!waSel[o.key]} onChange={(e) => setWaSel((p) => ({ ...p, [o.key]: e.target.checked }))} style={{ marginInlineEnd: 6 }} />
                {o.label}
              </label>
            ))}
          </div>
          <div className="pcf-form" style={{ marginTop: 12 }}>
            <div className="pcf-field"><label>אחר (מספר)</label><input dir="ltr" style={{ textAlign: "right" }} value={waOther1} onChange={(e) => setWaOther1(e.target.value)} placeholder="0521234567" /></div>
            <div className="pcf-field"><label>אחר נוסף (מספר)</label><input dir="ltr" style={{ textAlign: "right" }} value={waOther2} onChange={(e) => setWaOther2(e.target.value)} placeholder="0521234567" /></div>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
            <button className="pcf-btn" onClick={sendWa} disabled={waBusy}>{waBusy ? <><span className="pcf-spin" style={{ width: 14, height: 14, borderWidth: 2 }} /> שולח…</> : "💬 שלח בווצאפ"}</button>
            {waMsg && <span className={waMsg.includes("✓") ? "pcf-ok" : "pcf-err"} style={{ marginTop: 0, padding: "8px 14px" }}>{waMsg}</span>}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="pcf-wrap">
      <div className="pcf-admin-top">
        <div>
          <Link href={`/admin/templates/${id}`} className="pcf-link-btn">→ עריכת תבנית</Link>
          <h1 style={{ fontSize: 26, margin: "10px 0 0" }}>שליחת הסכם: {tplName}</h1>
        </div>
      </div>
      {err && <div className="pcf-err">{err}</div>}

      {senderFields.length > 0 && (
        <div className="pcf-card" style={{ marginTop: 18 }}>
          <h2><span>✍️</span> שדות שהשולח ממלא</h2>
          <div className="pcf-form">
            {senderFields.map((f) => (
              <div className="pcf-field full" key={f.id}>
                <label>{f.label}</label>
                <input className="" type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                  value={senderValues[f.id] || ""} onChange={(e) => setSenderValues((p) => ({ ...p, [f.id]: e.target.value }))} />
              </div>
            ))}
          </div>
        </div>
      )}

      {signers.map((s, i) => (
        <div className="pcf-card" style={{ marginTop: 16 }} key={i}>
          <h2><span>🖊️</span> חותם {i + 1} <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>({fieldsForSigner(i + 1).length} שדות למילוי)</span></h2>
          <div className="pcf-form">
            <div className="pcf-field full">
              <label>שיוך ללקוח קיים (אופציונלי — ימלא אוטומטית שם ופרטים)</label>
              <select value={s.clientUid} onChange={(e) => onPickClient(i, e.target.value)}>
                <option value="">— ללא שיוך / איש קשר חדש —</option>
                {clients.map((c) => <option key={c.uid} value={c.uid}>{c.fullName || c.email} {c.phone ? `(${c.phone})` : ""}</option>)}
              </select>
            </div>
            <div className="pcf-field"><label>שם החותם *</label><input value={s.name} onChange={(e) => setSigner(i, { name: e.target.value })} /></div>
            <div className="pcf-field"><label>טלפון / מייל (לרישום)</label><input value={s.contact} onChange={(e) => setSigner(i, { contact: e.target.value })} /></div>
            <div className="pcf-field"><label>סדר חתימה</label><input type="number" min={1} value={s.order} onChange={(e) => setSigner(i, { order: Number(e.target.value) })} /></div>
            <div className="pcf-field" style={{ justifyContent: "flex-end" }}>
              <label className="pcf-side-checkbox" style={{ marginTop: 0 }}><input type="checkbox" checked={s.optional} onChange={(e) => setSigner(i, { optional: e.target.checked })} /> חתימה אופציונלית</label>
            </div>
            {!s.clientUid && (
              <div className="pcf-field full">
                <label className="pcf-side-checkbox" style={{ marginTop: 0 }}><input type="checkbox" checked={s.createClient} onChange={(e) => setSigner(i, { createClient: e.target.checked })} /> צור חשבון לקוח חדש + תיקיית דרייב (לחותם שאינו משויך)</label>
              </div>
            )}
          </div>
        </div>
      ))}

      <div style={{ marginTop: 20 }}>
        <button className="pcf-btn" onClick={submit} disabled={busy}>{busy ? <span className="pcf-spin" /> : "צור קישורי חתימה 🔗"}</button>
      </div>
    </main>
  );
}
