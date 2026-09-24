"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signInWithPopup, setPersistence, browserLocalPersistence, firebaseAuth, googleProvider, type User } from "@/lib/authClient";

interface Stage { index: number; key: string; title: string; subtitle: string; state: "done" | "current" | "next" | "locked"; }
interface Portal {
  allowed: boolean;
  adminView?: boolean;
  canPreview?: boolean;
  name?: string;
  reachedMax?: number;
  stages?: Stage[];
  isWon?: boolean; compassProgressed?: boolean; clientStage?: string | null;
  questionnairePct?: number; contractStatus?: string; compassStatus?: string | null;
  content?: {
    lead: { submitCount: number; submissions: { date: string; landingpage: string }[]; lastLandingpage: string };
    compass: { status: string | null; summary: string | null };
    process: { questionnairePct: number; contractSigned: boolean; contractStatus: string; signers?: { name: string; token: string; signed: boolean }[] };
    banking: { notes: string[] };
    bizplan: { plan: string | null; fileUrl?: string | null; fileName?: string | null };
    mortgage: { payments: { dueDate: string; amount: number; status: string; note: string }[] };
  };
  whatsapp?: string;
}

const fmt = (d: string) => { try { return new Date(d).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "2-digit" }); } catch { return d; } };

// קונפטי — פרץ קצר ב-canvas, ללא ספריות.
function fireConfetti() {
  const c = document.createElement("canvas");
  c.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999";
  c.width = window.innerWidth; c.height = window.innerHeight;
  document.body.appendChild(c);
  const ctx = c.getContext("2d"); if (!ctx) { c.remove(); return; }
  const colors = ["#ff3b3b", "#ff7a3b", "#ffc857", "#22c55e", "#3b82f6", "#ffffff"];
  const P = Array.from({ length: 160 }, () => ({ x: window.innerWidth / 2, y: window.innerHeight / 3, vx: (Math.random() - 0.5) * 13, vy: Math.random() * -15 - 4, r: Math.random() * 6 + 3, col: colors[Math.floor(Math.random() * colors.length)], a: 1, rot: Math.random() * 6 }));
  let t = 0;
  const iv = setInterval(() => {
    ctx.clearRect(0, 0, c.width, c.height); t++;
    P.forEach((p) => { p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.rot += 0.2; p.a -= 0.0075; ctx.save(); ctx.globalAlpha = Math.max(0, p.a); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col; ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 1.2); ctx.restore(); });
    if (t > 160) { clearInterval(iv); c.remove(); }
  }, 16);
}

export default function PortalPage() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Portal | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [payBusy, setPayBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [asId, setAsId] = useState<string | null>(null);   // צפייה כאדמין בפורטל של ליד מסוים
  const [payModal, setPayModal] = useState<{ url: string; lowProfileId: string; label: string } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setReady(true); }), []);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const p = sp.get("preview");
    if (p != null && !isNaN(Number(p))) setPreview(Math.max(0, Math.min(8, Math.floor(Number(p)))));
    if (sp.get("as")) setAsId(sp.get("as"));
    // חזרה מסליקה בטאב נפרד — קונפטי + טוסט, וניקוי הפרמטר
    if (sp.get("justpaid")) { setTimeout(() => { fireConfetti(); setToast("התשלום התקבל! השלב הבא נפתח 🎉"); }, 400); sp.delete("justpaid"); const u = new URL(window.location.href); u.search = sp.toString(); window.history.replaceState({}, "", u.toString()); }
    if (sp.get("paidfail")) { setTimeout(() => setToast("התשלום לא הושלם. אפשר לנסות שוב."), 400); }
  }, []);

  const lastReached = useRef<number | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const qs = new URLSearchParams();
      if (preview != null) qs.set("preview", String(preview));
      if (asId) qs.set("as", asId);
      const res = await fetch(`/api/portal${qs.toString() ? `?${qs}` : ""}`, { headers: { Authorization: `Bearer ${t}` } });
      const d = await res.json();
      // התקדמות אמיתית (למשל אחרי סליקה שעברה ב-webhook) → קונפטי
      if (preview == null && typeof d.reachedMax === "number" && lastReached.current != null && d.reachedMax > lastReached.current) {
        fireConfetti(); setToast("השלב הבא נפתח! 🎉");
      }
      if (preview == null && typeof d.reachedMax === "number") lastReached.current = d.reachedMax;
      setData(d);
      if (typeof d.reachedMax === "number") setOpen(d.reachedMax);
    } catch { setData({ allowed: false }); } finally { setLoading(false); }
  }, [preview, asId]);
  useEffect(() => { if (user) load(); }, [user, load]);
  // חזרה לטאב אחרי תשלום (כולל בטאב נפרד) → רענון, וקונפטי אם השלב התקדם.
  useEffect(() => {
    const onFocus = () => { if (user && preview == null) load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) onFocus(); });
    return () => window.removeEventListener("focus", onFocus);
  }, [user, preview, load]);

  const login = async () => { await setPersistence(firebaseAuth(), browserLocalPersistence); await signInWithPopup(firebaseAuth(), googleProvider).catch(() => {}); };

  const pay = async (step: string) => {
    // מצב צפייה כאדמין — התשלום מבוצע רק ע"י הלקוח האמיתי.
    if (data?.adminView) { setToast("מצב צפייה כאדמין — התשלום מבוצע ע\"י הלקוח בלבד"); return; }
    // מצב תצוגה מקדימה — מדמה תשלום מוצלח (קונפטי + פתיחת השלב הבא) בלי CardCom אמיתי.
    if (preview != null) {
      fireConfetti();
      setToast("התשלום התקבל! השלב הבא נפתח 🎉");
      const next = Math.min(8, preview + 1);
      setPreview(next);
      const u = new URL(window.location.href); u.searchParams.set("preview", String(next)); window.history.replaceState({}, "", u.toString());
      return;
    }
    setPayBusy(step);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch("/api/portal/pay", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ step }) });
      const d = await res.json();
      if (d.url) {
        // בנייד: Google/Apple Pay לא עובדים בתוך iframe → ניווט מלא בעמוד. שומרים את מזהה הסליקה לאימות בחזרה.
        const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.matchMedia("(max-width: 820px)").matches;
        if (isMobile) {
          try { sessionStorage.setItem("pc_pending_lp", d.lowProfileId || ""); } catch { /* */ }
          window.location.href = d.url;
          return;
        }
        setPayModal({ url: d.url, lowProfileId: d.lowProfileId || "", label: step === "compass" ? "פגישת מצפן · 500 ₪" : "התקדמות לתהליך · 1000 ₪" });
      } else alert(d.error || "שגיאה בפתיחת דף התשלום");
    } catch { alert("שגיאה בפתיחת דף התשלום"); } finally { setPayBusy(null); }
  };

  // האזנה לסיום התשלום בתוך הפופאפ (מ-/portal/paid), אימות סינכרוני, ואז קונפטי + פתיחת השלב הבא.
  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      const type = (e.data && (e.data as { type?: string }).type) || "";
      if (type === "pc-pay-failed") { setPayModal(null); setToast("התשלום לא הושלם. אפשר לנסות שוב."); return; }
      if (type !== "pc-paid" || !payModal) return;
      setVerifying(true);
      try {
        const t = await firebaseAuth().currentUser!.getIdToken();
        await fetch("/api/portal/pay/verify", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ lowProfileId: payModal.lowProfileId }) }).catch(() => {});
      } catch { /* */ }
      setPayModal(null); setVerifying(false);
      fireConfetti();
      setToast("התשלום התקבל! השלב הבא נפתח 🎉");
      setPreview(null);
      await load();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [payModal, load]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 4500); return () => clearTimeout(id); }, [toast]);

  // בדיקת סטטוס תשלום ברקע (polling) — הכי אמין: לא תלוי בהפניה/webhook. פועל כל עוד הפופאפ פתוח.
  useEffect(() => {
    if (!payModal?.lowProfileId) return;
    let stopped = false, tries = 0;
    const iv = setInterval(async () => {
      tries++;
      if (tries > 120) { clearInterval(iv); return; }        // ~6 דקות
      try {
        const res = await fetch("/api/portal/pay/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lowProfileId: payModal.lowProfileId }) });
        const d = await res.json();
        if (d.paid && !stopped) {
          clearInterval(iv);
          setPayModal(null); fireConfetti(); setToast("התשלום התקבל! השלב הבא נפתח 🎉"); setPreview(null);
          await load();
        }
      } catch { /* ממשיך לנסות */ }
    }, 3000);
    return () => { stopped = true; clearInterval(iv); };
  }, [payModal, load]);

  // חזרה מניווט תשלום בנייד: מאמת את הסליקה השמורה (עם כמה ניסיונות), קונפטי, ורענון.
  useEffect(() => {
    if (!user || !data) return;
    let pend = ""; try { pend = sessionStorage.getItem("pc_pending_lp") || ""; } catch { /* */ }
    if (!pend) return;
    try { sessionStorage.removeItem("pc_pending_lp"); } catch { /* */ }
    let stopped = false, tries = 0;
    const iv = setInterval(async () => {
      tries++;
      if (tries > 15) { clearInterval(iv); return; }   // ~30 שניות
      try {
        const res = await fetch("/api/portal/pay/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lowProfileId: pend }) });
        const d = await res.json();
        if (d.paid && !stopped) { clearInterval(iv); fireConfetti(); setToast("התשלום התקבל! השלב הבא נפתח 🎉"); setPreview(null); await load(); }
      } catch { /* */ }
    }, 2000);
    return () => { stopped = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, data]);

  const wa = (data?.whatsapp || "972532484618");
  const Consult = () => <a className="pcf-btn ghost" style={{ padding: "11px 18px", fontSize: 14 }} href={`https://wa.me/${wa}?text=${encodeURIComponent("היי, אשמח להתייעצות לגבי התהליך")}`} target="_blank" rel="noopener">💬 התייעצות בווצאפ</a>;

  if (!ready || (user && (loading || !data))) return <main className="pcf-wrap"><div className="pcf-spin" style={{ margin: "80px auto" }} /></main>;

  if (!user) return (
    <main className="pcf-wrap">
      <div className="pcf-hero"><span className="pcf-badge">Power Couple</span><h1>המסע שלך אלינו</h1><p className="sub">התחבר כדי לעקוב אחרי השלב שבו אתה נמצא בתהליך.</p></div>
      <div className="pcf-card" style={{ maxWidth: 460, textAlign: "center" }}><button className="pcf-btn white" onClick={login}>התחברות עם Google</button></div>
    </main>
  );

  if (!data!.allowed) return (
    <main className="pcf-wrap">
      <div className="pcf-hero"><span className="pcf-badge">Power Couple</span><h1>הפורטל בהרצה 🚧</h1><p className="sub">הפורטל האישי עדיין לא פתוח לחשבון הזה. נעדכן אותך כשיהיה זמין.</p></div>
      <div className="pcf-card" style={{ maxWidth: 460, textAlign: "center", color: "var(--muted)" }}>{user.email}</div>
    </main>
  );

  const d = data!;
  const c = d.content!;

  // ה-CTA להתקדמות מהשלב הנוכחי לשלב הבא — מוצג בתוך השלב הנוכחי.
  const advanceCTA = (stageKey: string) => {
    if (stageKey === "lead") return (
      <div className="pf-cta">
        <p>השלב הבא: <b>פגישת מצפן</b> — תכנית אישית עם יועץ הנדל"ן שלנו.</p>
        <div className="pf-actions">
          <button className="pcf-btn" style={{ padding: "12px 22px", fontSize: 15 }} disabled={payBusy === "compass"} onClick={() => pay("compass")}>{payBusy === "compass" ? "פותח…" : "התקדם לפגישת מצפן · 500 ₪"}</button>
          <Consult />
        </div>
      </div>
    );
    if (stageKey === "compass" && !d.compassProgressed) return (
      <div className="pf-cta">
        <p>מוכן להתקדם? השלב הבא: <b>שאלון פיננסי + חתימה על הסכם התקשרות</b>.</p>
        <div className="pf-actions">
          <button className="pcf-btn" style={{ padding: "12px 22px", fontSize: 15 }} disabled={payBusy === "process"} onClick={() => pay("process")}>{payBusy === "process" ? "פותח…" : "התקדמות לתהליך · 1000 ₪"}</button>
          <Consult />
        </div>
      </div>
    );
    return null;
  };

  const content = (s: Stage) => {
    const isCurrent = s.state === "current";
    switch (s.key) {
      case "lead":
        return (<>
          <p>השארת פרטים <b>{c.lead.submitCount}</b> פעמים. אנחנו כאן כדי להבין יחד אם התהליך מתאים לך.</p>
          {c.lead.submissions.length > 0 && <ul className="pf-list">{c.lead.submissions.map((x, i) => <li key={i}>{fmt(x.date)}{x.landingpage ? ` · ${x.landingpage}` : ""}</li>)}</ul>}
          {isCurrent && advanceCTA("lead")}
        </>);
      case "compass":
        return (<>
          {c.compass.summary ? <><p><b>סיכום פגישת המצפן:</b></p><p style={{ whiteSpace: "pre-wrap" }}>{c.compass.summary}</p></>
            : d.isWon ? <p>נכנסת לתהליך פגישת המצפן — ניצור קשר לתיאום.</p>
            : <p>פגישת מצפן: תכנית אישית עם יועץ, בעלות 500 ₪.</p>}
          {isCurrent && advanceCTA("compass")}
        </>);
      case "process":
        return (<>
          <p>שאלון פיננסי: <b>{c.process.questionnairePct}%</b> · הסכם התקשרות: <b>{c.process.contractStatus}</b></p>
          {c.process.signers && c.process.signers.length > 0 && (
            <div className="pf-actions" style={{ marginTop: 10, flexWrap: "wrap" }}>
              {c.process.signers.map((sg, i) => sg.signed
                ? <span key={i} className="pcf-btn ghost" style={{ padding: "10px 18px", fontSize: 14, opacity: 0.75, pointerEvents: "none" }}>✓ {sg.name} חתם/ה</span>
                : <a key={i} className="pcf-btn" style={{ padding: "12px 22px", fontSize: 15 }} href={`/sign/${sg.token}`} target="_blank" rel="noopener">✍️ {c.process.signers!.length > 1 ? `${sg.name} — חתימה על ההסכם` : "חתימה על ההסכם"}</a>
              )}
            </div>
          )}
          {isCurrent && <div className="pf-actions" style={{ marginTop: 12 }}>
            <a className="pcf-btn ghost" style={{ padding: "12px 22px", fontSize: 15 }} href="/">מילוי / המשך השאלון</a>
            <Consult />
          </div>}
        </>);
      case "mortgage":
        return c.mortgage.payments.length
          ? <><p>לוח תשלומים:</p><ul className="pf-list">{c.mortgage.payments.map((p, i) => <li key={i}>{fmt(p.dueDate)} · ₪{p.amount.toLocaleString("he-IL")} · {p.status === "paid" ? "שולם ✓" : "לתשלום"}{p.note ? ` · ${p.note}` : ""}</li>)}</ul></>
          : <p>כאן יופיעו תאריכי התשלומים והתזכורות עד לקבלת המפתח.</p>;
      case "bizplan":
        return (c.bizplan.plan || c.bizplan.fileUrl)
          ? <>
              {c.bizplan.plan && <><p><b>תכנית עסקית:</b></p><p style={{ whiteSpace: "pre-wrap" }}>{c.bizplan.plan}</p></>}
              {c.bizplan.fileUrl && <div className="pf-actions" style={{ marginTop: 10 }}>
                <a className="pcf-btn" style={{ padding: "12px 22px", fontSize: 15 }} href={c.bizplan.fileUrl} target="_blank" rel="noopener">📄 {c.bizplan.fileName || "צפה בתכנית העסקית"}</a>
              </div>}
            </>
          : <p>כאן יופיעו התכניות העסקיות שנציע לך.</p>;
      case "banking": return <p>כאן יופיעו הבנקים שאיתם מתנהל משא ומתן וסיכומי הבנקאות.</p>;
      case "manage": return <p>ליווי שוטף בניהול העסקה.</p>;
      case "sell": return <p>מכירת הנכס ברווח, לפי התכנית העסקית.</p>;
      default: return null;
    }
  };

  const STAGE_NAMES = ["ליד", "מצפן", "התקדם לתהליך", "בנקאות", "תכנית עסקית", "חתימה", "משכנתא", "ניהול", "מכירה"];
  const setPv = (n: number | null) => {
    setPreview(n);
    const u = new URL(window.location.href);
    if (n == null) u.searchParams.delete("preview"); else u.searchParams.set("preview", String(n));
    window.history.replaceState({}, "", u.toString());
  };
  const curPv = preview ?? (d.reachedMax || 0);

  return (
    <main className="pcf-wrap">
      {/* באנר צפייה כאדמין — "לראות מה הלקוח רואה" */}
      {d.adminView && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "rgba(255,122,59,.12)", border: "1px solid rgba(255,122,59,.4)", borderRadius: 12, padding: "9px 14px", marginBottom: 6, fontSize: 14, fontWeight: 700, color: "var(--accent-2,#ff7a3b)" }}>
          👁️ צפייה כאדמין בפורטל של {d.name || "הלקוח"} — זו התצוגה שהלקוח רואה
        </div>
      )}
      {/* סרגל תצוגה מקדימה — לדפדוף בין השלבים (אדמין בלבד) */}
      {d.canPreview && (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, background: "var(--surface-2,rgba(255,255,255,.05))", border: "1px solid var(--line)", borderRadius: 12, padding: "8px 14px", marginBottom: 6, fontSize: 13 }}>
        <span style={{ color: "var(--muted)" }}>👁️ תצוגה מקדימה:</span>
        <button className="pcf-btn ghost" style={{ padding: "5px 12px", fontSize: 13 }} disabled={curPv <= 0} onClick={() => setPv(Math.max(0, curPv - 1))}>▶ הקודם</button>
        <b style={{ minWidth: 120, textAlign: "center" }}>{curPv + 1}. {STAGE_NAMES[curPv]}</b>
        <button className="pcf-btn ghost" style={{ padding: "5px 12px", fontSize: 13 }} disabled={curPv >= 8} onClick={() => setPv(Math.min(8, curPv + 1))}>הבא ◀</button>
        {preview != null && <button className="pcf-btn ghost" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setPv(null)}>חזרה למצב אמיתי</button>}
      </div>
      )}

      <div className="pcf-hero"><span className="pcf-badge">Power Couple</span><h1>{d.name ? `היי ${d.name},` : "היי,"} זה המסע שלך</h1><p className="sub">מה שעברת מסומן, מה שלפניך מחכה. לחיצה על שלב פותחת פרטים.</p></div>

      <div className="pcf-card pf-timeline">
        {d.stages!.map((s) => {
          const expandable = s.state === "done" || s.state === "current";
          return (
            <div key={s.key} className={`pf-stage pf-${s.state}`}>
              <div className="pf-node">{s.state === "done" ? "✓" : s.index + 1}</div>
              <div className="pf-body">
                <button className="pf-head" onClick={() => expandable && setOpen(open === s.index ? null : s.index)} style={{ cursor: expandable ? "pointer" : "default" }}>
                  <span><span className="pf-title">{s.title}</span><span className="pf-sub">{s.subtitle}</span></span>
                  {expandable && <span className="pf-chev">{open === s.index ? "▲" : "▼"}</span>}
                </button>
                {expandable && open === s.index && <div className="pf-panel">{content(s)}</div>}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ textAlign: "center", color: "var(--muted)", marginTop: 22, fontSize: 14 }}>שאלה? <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener" style={{ color: "var(--accent)", fontWeight: 700 }}>דברו איתנו בווצאפ</a></p>

      {/* פופאפ סליקה ממותג — דף CardCom מוטמע (האשראי נשאר מאובטח אצל CardCom) */}
      {payModal && (
        <div className="pf-modal-bg" onClick={() => !verifying && setPayModal(null)}>
          <div className="pf-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pf-modal-head"><span>🔒 תשלום מאובטח · {payModal.label}</span><button className="pf-modal-x" onClick={() => !verifying && setPayModal(null)}>✕</button></div>
            <div className="pf-modal-body">
              <iframe src={payModal.url} title="תשלום מאובטח" className="pf-iframe" />
              {verifying && <div className="pf-verify"><div className="pcf-spin" /><span>מאמת תשלום…</span></div>}
            </div>
            <div className="pf-modal-foot">התשלום מאובטח ע״י CardCom · <a href={payModal.url} target="_blank" rel="noopener">לא נטען? פתח בחלון נפרד</a></div>
          </div>
        </div>
      )}
      {toast && <div className="pf-toast">{toast}</div>}

      <style>{`
        .pf-timeline{padding:20px 20px 8px}
        .pf-stage{display:flex;gap:14px;position:relative}
        .pf-stage:not(:last-child) .pf-node::after{content:"";position:absolute;top:36px;right:17px;width:2px;height:calc(100% - 22px);background:var(--line)}
        .pf-node{position:relative;flex:0 0 36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;background:var(--surface-2,rgba(255,255,255,.06));color:var(--muted);z-index:1}
        .pf-body{flex:1;padding-bottom:20px;min-width:0}
        .pf-head{width:100%;background:none;border:0;padding:0;display:flex;justify-content:space-between;align-items:center;gap:10px;text-align:right}
        .pf-title{display:block;font-weight:800;font-size:16px;color:var(--text)}
        .pf-sub{display:block;color:var(--muted);font-size:13px;margin-top:2px}
        .pf-chev{color:var(--muted);font-size:11px;flex:0 0 auto}
        .pf-panel{margin-top:12px;background:var(--surface-2,rgba(255,255,255,.04));border:1px solid var(--line);border-radius:14px;padding:15px 16px;font-size:14.5px;line-height:1.75;color:var(--text)}
        .pf-panel p{margin:0 0 8px}
        .pf-list{margin:6px 0 0;padding-right:18px;color:var(--muted);font-size:13px;line-height:1.9}
        .pf-cta{margin-top:12px;border-top:1px solid var(--line);padding-top:12px}
        .pf-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}
        .pf-done .pf-node{background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff}
        .pf-current .pf-node{background:linear-gradient(90deg,var(--accent),var(--accent-2));color:#fff;box-shadow:0 0 0 5px rgba(255,59,59,.18)}
        .pf-current .pf-title{color:var(--accent)}
        .pf-next{opacity:.85}
        .pf-next .pf-node{background:transparent;border:2px dashed var(--line-strong,var(--line));color:var(--muted);transform:scale(1.06)}
        .pf-next .pf-title{font-size:17px}
        .pf-locked{opacity:.42}
        .pf-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
        .pf-modal{width:100%;max-width:460px;background:linear-gradient(180deg,var(--card-a),var(--card-b));border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.55);animation:pfpop .2s ease}
        @keyframes pfpop{from{transform:scale(.96);opacity:0}to{transform:scale(1);opacity:1}}
        .pf-modal-head{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--line);font-weight:800;font-size:14px;color:var(--text)}
        .pf-modal-x{background:none;border:0;color:var(--muted);font-size:18px;cursor:pointer;line-height:1}
        .pf-modal-body{position:relative;background:#fff}
        .pf-iframe{width:100%;height:560px;border:0;display:block}
        .pf-verify{position:absolute;inset:0;background:rgba(15,18,25,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--text);font-weight:700}
        .pf-modal-foot{padding:10px 16px;font-size:12px;color:var(--muted);text-align:center;border-top:1px solid var(--line)}
        .pf-modal-foot a{color:var(--accent)}
        .pf-toast{position:fixed;bottom:26px;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,var(--accent),var(--accent-2));color:#fff;font-weight:800;padding:12px 22px;border-radius:14px;z-index:100000;box-shadow:0 14px 40px rgba(255,31,31,.42);animation:pfpop .25s ease}
      `}</style>
    </main>
  );
}
