"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, setPersistence, browserLocalPersistence, firebaseAuth, googleProvider, type User } from "@/lib/authClient";
import { LEAD_SOURCES } from "@/lib/leads";
import AdminNav from "../AdminNav";
import DataChat from "./DataChat";

/** שורה במטריצת האגרגציה שמגיעה מ-/api/admin/leads/stats */
interface StatRow { source: string; stage: string; cnt: number }
/** שורת פילוח (פלטפורמה / דף נחיתה) מ-/api/admin/leads/breakdowns */
interface BreakRow { name: string; cnt: number; compass: number }
/** מוני המשפך מ-/api/admin/funnel */
interface Funnel {
  intakes: number; uniqueLeads: number; callsMade: number;
  meetingsScheduled: number; meetingsHeld: number; clientsWon: number;
}
/** קמפיין מחשבון המודעות, מ-/api/admin/meta */
interface MetaCampaign {
  id: string; name: string; objective: string; status: string; statusLabel: string;
  spend: number; impressions: number; reach: number; frequency: number;
  clicks: number; linkClicks: number; ctr: number; cpc: number; cpm: number;
  leads: number; costPerLead: number; landingPageViews: number;
}
interface MetaData {
  account: string; currency: string; spend: number; impressions: number; reach: number;
  clicks: number; linkClicks: number; ctr: number; cpc: number; leads: number;
  costPerLead: number; campaigns: MetaCampaign[];
}

// ── טווחי זמן מוכנים ──
type Preset = "today" | "yesterday" | "week" | "month" | "last30" | "custom" | "all";
const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "היום" },
  { key: "yesterday", label: "אתמול" },
  { key: "week", label: "השבוע" },
  { key: "month", label: "החודש" },
  { key: "last30", label: "30 ימים אחרונים" },
  { key: "custom", label: "מותאם אישית" },
  { key: "all", label: "הכל" },
];
/** YYYY-MM-DD בשעון המקומי (ישראל) — לא UTC, כדי ש"היום" יהיה היום. */
const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return d; };
/** טווח התאריכים לכל פריסט. custom/all מוחזרים ריקים ומנוהלים בנפרד. */
function rangeOf(preset: Preset): { from: string; to: string } {
  const now = new Date();
  switch (preset) {
    case "today": return { from: ymd(now), to: ymd(now) };
    case "yesterday": { const y = ymd(shift(-1)); return { from: y, to: y }; }
    case "week": { // שבוע שמתחיל בראשון, כמו בישראל
      const start = new Date(now); start.setDate(now.getDate() - now.getDay());
      return { from: ymd(start), to: ymd(now) };
    }
    case "month": { const start = new Date(now.getFullYear(), now.getMonth(), 1); return { from: ymd(start), to: ymd(now) }; }
    case "last30": return { from: ymd(shift(-29)), to: ymd(now) };
    default: return { from: "", to: "" };
  }
}
const ils = (n: number) => `₪${Math.round(n).toLocaleString("he-IL")}`;
const int = (n: number) => Math.round(n).toLocaleString("he-IL");
const dec = (n: number, d = 2) => n.toLocaleString("he-IL", { minimumFractionDigits: d, maximumFractionDigits: d });

// צבע/אימוג'י לכל פלטפורמה — עוזר לזהות מבט מהיר.
const PLATFORM_META: Record<string, { icon: string; color: string }> = {
  "Meta": { icon: "🔵", color: "#1877f2" },
  "TikTok": { icon: "🎵", color: "#000000" },
  "YouTube / Google": { icon: "🔴", color: "#ea4335" },
  "אחר": { icon: "•", color: "#8a94a6" },
  "ללא ייחוס": { icon: "—", color: "#c2c8d2" },
};

// סדר המשפך — אינדקס גבוה = שלב מתקדם יותר. lost מחוץ למשפך.
const FUNNEL_ORDER = ["new", "contacted", "no_answer_1", "no_answer_2", "no_answer_3", "followup", "watching", "relevant", "meeting_scheduled", "compass", "progressed", "in_process", "done", "won"];
const funnelIdx = (stage: string) => FUNNEL_ORDER.indexOf(stage);

// מדדי המשפך (reached = הגיע לשלב זה או מעבר). minIdx מחושב מהסדר כדי לא להישבר בהוספת שלבים.
const METRICS: { key: string; label: string; minIdx: number | null; placeholder?: boolean }[] = [
  { key: "total", label: "כמות לידים", minIdx: 0 },
  { key: "calls", label: "שיחות שבוצעו", minIdx: null, placeholder: true },
  { key: "relevant", label: "לידים רלוונטיים", minIdx: funnelIdx("relevant") },
  { key: "compass", label: "פגישת התאמה", minIdx: funnelIdx("compass") },
  { key: "progressed", label: "התקדמו לתהליך", minIdx: funnelIdx("progressed") },
  { key: "in_process", label: "בתהליך", minIdx: funnelIdx("in_process") },
  { key: "done", label: "סיימו תהליך", minIdx: funnelIdx("done") },
];

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [platforms, setPlatforms] = useState<BreakRow[]>([]);
  const [landings, setLandings] = useState<BreakRow[]>([]);
  const [ads, setAds] = useState<BreakRow[]>([]);
  const [totalLeads, setTotalLeads] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  // ברירת המחדל: החודש הנוכחי
  const [preset, setPreset] = useState<Preset>("month");
  const [from, setFrom] = useState(rangeOf("month").from);
  const [to, setTo] = useState(rangeOf("month").to);
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [meta, setMeta] = useState<MetaData | null>(null);
  const [metaReason, setMetaReason] = useState<string | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);

  /** בחירת טווח מוכן — custom משאיר את השדות למשתמש, all מנקה אותם. */
  const pickPreset = (k: Preset) => {
    setPreset(k);
    if (k === "all") { setFrom(""); setTo(""); return; }
    if (k === "custom") return;
    const r = rangeOf(k);
    setFrom(r.from); setTo(r.to);
  };

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);

  // השרת מחזיר מטריצת (מקור × שלב) — עשרות שורות, לא עשרות אלפי לידים.
  // החישובים למטה זהים למה שהיה, רק שהם רצים על המטריצה במקום על המערך המלא.
  const load = useCallback(async (f: string, t2: string) => {
    setLoading(true); setErr(null); setDenied(false);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const p = new URLSearchParams();
      if (f) p.set("from", f);
      if (t2) p.set("to", t2);
      const auth = { headers: { Authorization: `Bearer ${t}` } };
      const [res, resB, resF] = await Promise.all([
        fetch(`/api/admin/leads/stats?${p}`, auth),
        fetch(`/api/admin/leads/breakdowns?${p}`, auth),
        fetch(`/api/admin/funnel?${p}`, auth),
      ]);
      if (res.status === 403) { setDenied(true); return; }
      if (!res.ok) throw new Error();
      const d = await res.json();
      setStats(d.stats || []);
      setTotalLeads(d.total || 0);
      if (resB.ok) { const b = await resB.json(); setPlatforms(b.platforms || []); setLandings(b.landings || []); setAds(b.ads || []); }
      setFunnel(resF.ok ? (await resF.json()).funnel : null);
    } catch { setErr("שגיאה בטעינת הנתונים"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (user) load(from, to); }, [user, from, to, load]);

  // נתוני המודעות נטענים בנפרד — הקריאה ל-Graph API איטית ולא צריכה לעכב את הדשבורד
  const loadMeta = useCallback(async (f: string, t2: string) => {
    setMetaLoading(true); setMetaReason(null);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const p = new URLSearchParams();
      if (f) p.set("from", f);
      if (t2) p.set("to", t2);
      const res = await fetch(`/api/admin/meta?${p}`, { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) { setMeta(null); setMetaReason("שגיאה בטעינת נתוני המודעות"); return; }
      const d = await res.json();
      setMeta(d.meta || null);
      setMetaReason(d.meta ? null : (d.reason || "אין נתונים"));
    } catch { setMeta(null); setMetaReason("שגיאה בטעינת נתוני המודעות"); }
    finally { setMetaLoading(false); }
  }, []);
  useEffect(() => { if (user) loadMeta(from, to); }, [user, from, to, loadMeta]);

  const login = async () => { await setPersistence(firebaseAuth(), browserLocalPersistence); await signInWithPopup(firebaseAuth(), googleProvider).catch(() => {}); };

  const sources = useMemo(() => {
    const set = new Set(stats.map((r) => r.source));
    const known = LEAD_SOURCES.filter((s) => set.has(s));
    const extra = [...set].filter((s) => !LEAD_SOURCES.includes(s as (typeof LEAD_SOURCES)[number]));
    return [...known, ...extra];
  }, [stats]);

  /** reached — כמה לידים הגיעו לשלב minIdx או מעבר לו, בסך הכל ולפי מקור. */
  const rowFor = (minIdx: number | null) => {
    const bySrc: Record<string, number> = {};
    for (const s of sources) bySrc[s] = 0;
    if (minIdx === null) return { total: 0, bySrc };
    let total = 0;
    for (const r of stats) {
      if (funnelIdx(r.stage) < minIdx) continue; // lost מקבל -1 ולכן נופל מחוץ למשפך, כמו קודם
      total += r.cnt;
      bySrc[r.source] = (bySrc[r.source] || 0) + r.cnt;
    }
    return { total, bySrc };
  };

  if (!authReady) return <main className="pcf-wrap pcf-wide"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return <main className="pcf-wrap pcf-wide"><header className="pcf-hero"><span className="pcf-badge">ניהול • Tattoo Story</span><h1>כניסת מנהלים</h1></header><div className="pcf-card pcf-login"><button className="pcf-btn white" onClick={login}>התחברות עם Google</button></div></main>;
  if (denied) return <main className="pcf-wrap pcf-wide"><AdminNav /><div className="pcf-card" style={{ textAlign: "center" }}><p>החשבון <b>{user.email}</b> אינו מורשה.</p></div></main>;

  return (
    <main className="pcf-wrap pcf-wide">
      <AdminNav />
      <div className="pcf-admin-top">
        <div><span className="pcf-badge">ניהול • Tattoo Story</span><h1 style={{ fontSize: 28, margin: "12px 0 0" }}>דשבורד</h1></div>
      </div>

      {/* טווח תאריכים — פריסטים מוכנים + מותאם אישית */}
      <div className="pcf-card" style={{ marginTop: 4 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {PRESETS.map((pr) => (
            <button key={pr.key} className={`pcf-pill${preset === pr.key ? " active" : ""}`} onClick={() => pickPreset(pr.key)}>
              {pr.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div style={{ display: "flex", gap: 14, alignItems: "end", flexWrap: "wrap", marginTop: 12 }}>
            <div className="pcf-field" style={{ margin: 0 }}><label>מתאריך</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="pcf-field" style={{ margin: 0 }}><label>עד תאריך</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
        )}
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>
          {from || to
            ? `${from || "ההתחלה"} → ${to || "היום"} · ${totalLeads.toLocaleString("he-IL")} לידים נוצרו בטווח`
            : `כל הנתונים · ${totalLeads.toLocaleString("he-IL")} לידים`}
        </div>
      </div>

      {loading && <div className="pcf-spin" style={{ margin: "40px auto" }} />}
      {err && <div className="pcf-err">{err}</div>}

      {/* מוני המשפך בטווח — נשענים על מה שבאמת תועד במערכת */}
      <div className="pcf-stats" style={{ marginTop: 18 }}>
        <div className="pcf-stat">
          <div className="num">{int(funnel?.intakes || 0)}</div>
          <div className="lbl">לידים שנקלטו
            <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>
              {int(funnel?.uniqueLeads || 0)} אנשים ייחודיים
            </span>
          </div>
        </div>
        <div className="pcf-stat">
          <div className="num">{int(funnel?.callsMade || 0)}</div>
          <div className="lbl">שיחות שיצאו
            <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>לפי תיעוד נציגה</span>
          </div>
        </div>
        <div className="pcf-stat">
          <div className="num">{int(funnel?.meetingsScheduled || 0)}</div>
          <div className="lbl">פגישות שתואמו</div>
        </div>
        <div className="pcf-stat">
          <div className="num">{int(funnel?.meetingsHeld || 0)}</div>
          <div className="lbl">פגישות שבוצעו</div>
        </div>
        <div className="pcf-stat">
          <div className="num" style={{ color: "var(--green)" }}>{int(funnel?.clientsWon || 0)}</div>
          <div className="lbl">לקוחות שנסגרו
            {!!funnel?.intakes && (
              <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>
                {dec((funnel.clientsWon / funnel.intakes) * 100, 1)}% מהלידים
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── חשבון המודעות ── */}
      <div className="pcf-card" style={{ marginTop: 18, padding: 0, overflow: "hidden" }}>
        <div className="pcf-admin-tabhead" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>📣 חשבון המודעות{meta ? ` — ${meta.account}` : ""}</span>
          {metaLoading
            ? <span className="pcf-spin" style={{ width: 14, height: 14, borderWidth: 2 }} />
            : meta && <span style={{ fontWeight: 800 }}>סה״כ תקציב שיצא: {ils(meta.spend)}</span>}
        </div>

        {!meta && !metaLoading && (
          <div style={{ padding: 24, color: "var(--muted)" }}>{metaReason || "אין נתונים לטווח הזה"}</div>
        )}

        {meta && (
          <>
            <div className="pcf-stats" style={{ margin: 0, padding: 16, borderBottom: "1px solid var(--line)" }}>
              <div className="pcf-stat"><div className="num">{ils(meta.spend)}</div><div className="lbl">תקציב שיצא</div></div>
              <div className="pcf-stat"><div className="num">{int(meta.impressions)}</div><div className="lbl">חשיפות</div></div>
              <div className="pcf-stat"><div className="num">{int(meta.reach)}</div><div className="lbl">תפוצה</div></div>
              <div className="pcf-stat"><div className="num">{int(meta.linkClicks)}</div><div className="lbl">קליקים על קישור</div></div>
              <div className="pcf-stat"><div className="num">{dec(meta.ctr, 2)}%</div><div className="lbl">CTR</div></div>
              <div className="pcf-stat"><div className="num">{ils(meta.cpc)}</div><div className="lbl">עלות לקליק</div></div>
              <div className="pcf-stat">
                <div className="num">{int(meta.leads)}</div>
                <div className="lbl">לידים ממטא
                  {meta.leads > 0 && <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>{ils(meta.costPerLead)} לליד</span>}
                </div>
              </div>
            </div>

            {meta.campaigns.length === 0 ? (
              <div style={{ padding: 24, color: "var(--muted)" }}>אף קמפיין לא הוציא תקציב בטווח הזה.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="pcf-table">
                  <thead>
                    <tr>
                      <th>קמפיין</th><th>מטרה</th><th>סטטוס</th><th>תקציב שיצא</th>
                      <th>חשיפות</th><th>תפוצה</th><th>קליקים על קישור</th>
                      <th>CTR</th><th>עלות לקליק</th><th>לידים</th><th>עלות לליד</th>
                    </tr>
                  </thead>
                  <tbody>
                    {meta.campaigns.map((c) => (
                      <tr key={c.id}>
                        <td style={{ maxWidth: 320, whiteSpace: "normal" }}><b>{c.name}</b></td>
                        <td style={{ whiteSpace: "nowrap" }}>{c.objective}</td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <span className={`pcf-pill-status ${c.status === "ACTIVE" ? "done" : "draft"}`}>{c.statusLabel}</span>
                        </td>
                        <td style={{ whiteSpace: "nowrap", fontWeight: 700 }}>{ils(c.spend)}</td>
                        <td>{int(c.impressions)}</td>
                        <td>{int(c.reach)}</td>
                        <td>{int(c.linkClicks)}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{dec(c.ctr, 2)}%</td>
                        <td style={{ whiteSpace: "nowrap" }}>{ils(c.cpc)}</td>
                        <td>{c.leads ? <b>{int(c.leads)}</b> : "—"}</td>
                        <td style={{ whiteSpace: "nowrap" }}>{c.leads ? ils(c.costPerLead) : "—"}</td>
                      </tr>
                    ))}
                    <tr style={{ background: "var(--surface-2)", fontWeight: 800 }}>
                      <td>סיכום ({meta.campaigns.length} קמפיינים)</td><td /><td />
                      <td style={{ whiteSpace: "nowrap" }}>{ils(meta.campaigns.reduce((a, c) => a + c.spend, 0))}</td>
                      <td>{int(meta.campaigns.reduce((a, c) => a + c.impressions, 0))}</td>
                      <td>{int(meta.reach)}</td>
                      <td>{int(meta.campaigns.reduce((a, c) => a + c.linkClicks, 0))}</td>
                      <td /><td />
                      <td>{int(meta.campaigns.reduce((a, c) => a + c.leads, 0))}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ padding: "10px 16px", color: "var(--muted)", fontSize: 12, borderTop: "1px solid var(--line)" }}>
              תפוצה היא אנשים ייחודיים, ולכן סכום התפוצה של הקמפיינים אינו שווה לתפוצת החשבון (אותו אדם נחשף לכמה קמפיינים). שורת הסיכום מציגה את תפוצת החשבון.
            </div>
          </>
        )}
      </div>

      {/* אריחי מדדים לפי שלב במשפך */}
      <div className="pcf-stats" style={{ marginTop: 18 }}>
        {METRICS.filter((m) => !m.placeholder).map((m) => (
          <div className="pcf-stat" key={m.key}>
            <div className="num">{rowFor(m.minIdx).total}</div>
            <div className="lbl">{m.label}</div>
          </div>
        ))}
      </div>

      <DataChat />

      {/* פילוח לפי מקור */}
      <div className="pcf-card" style={{ marginTop: 18, padding: 0, overflow: "hidden" }}>
        <div className="pcf-admin-tabhead">פילוח לפי מקור הגעה</div>
        <div style={{ overflowX: "auto" }}>
          <table className="pcf-table">
            <thead>
              <tr><th>מדד</th><th>סה"כ</th>{sources.map((s) => <th key={s} style={{ whiteSpace: "nowrap" }}>{s}</th>)}</tr>
            </thead>
            <tbody>
              {METRICS.filter((m) => !m.placeholder).map((m) => {
                const r = rowFor(m.minIdx);
                return (
                  <tr key={m.key}>
                    <td><b>{m.label}</b></td>
                    <td>{r.total}</td>
                    {sources.map((s) => <td key={s} style={{ color: r.bySrc[s] ? undefined : "var(--muted)" }}>{r.bySrc[s] || 0}</td>)}
                  </tr>
                );
              })}
              {sources.length === 0 && <tr><td colSpan={2} style={{ padding: 20, color: "var(--muted)" }}>אין נתונים בטווח הנבחר</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* פילוח לפי פלטפורמת פרסום (מ-UTM) */}
      {(() => {
        const attributed = platforms.filter((p) => p.name !== "ללא ייחוס").reduce((n, p) => n + p.cnt, 0);
        const maxCnt = Math.max(1, ...platforms.map((p) => p.cnt));
        return (
          <div className="pcf-card" style={{ marginTop: 18, padding: 0, overflow: "hidden" }}>
            <div className="pcf-admin-tabhead">פילוח לידים לפי פלטפורמת פרסום</div>
            <div style={{ overflowX: "auto" }}>
              <table className="pcf-table">
                <thead><tr><th>פלטפורמה</th><th>לידים</th><th>% מהמיוחסים</th><th>הגיעו לפגישה</th><th style={{ width: "38%" }}>נפח</th></tr></thead>
                <tbody>
                  {platforms.map((p) => {
                    const m = PLATFORM_META[p.name] || { icon: "•", color: "#8a94a6" };
                    const muted = p.name === "ללא ייחוס";
                    const pct = attributed > 0 && !muted ? Math.round((p.cnt / attributed) * 100) : 0;
                    return (
                      <tr key={p.name} style={muted ? { color: "var(--muted)" } : undefined}>
                        <td><b>{m.icon} {p.name}</b></td>
                        <td>{p.cnt.toLocaleString("he-IL")}</td>
                        <td>{muted ? "—" : `${pct}%`}</td>
                        <td style={{ color: p.compass ? undefined : "var(--muted)" }}>{p.compass}</td>
                        <td>
                          <div style={{ height: 10, background: "var(--bg)", borderRadius: 6, overflow: "hidden" }}>
                            <div style={{ width: `${Math.round((p.cnt / maxCnt) * 100)}%`, height: "100%", background: muted ? "var(--muted)" : m.color, opacity: muted ? 0.35 : 0.85 }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {platforms.length === 0 && <tr><td colSpan={5} style={{ padding: 20, color: "var(--muted)" }}>אין נתונים בטווח הנבחר</td></tr>}
                </tbody>
              </table>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 12.5, padding: "0 16px 14px", margin: 0 }}>"ללא ייחוס" = לידים ותיקים שיובאו מ-Optione/Pipedrive בלי UTM. האחוזים מחושבים מתוך הלידים המיוחסים בלבד ({attributed.toLocaleString("he-IL")}).</p>
          </div>
        );
      })()}

      {/* פילוח לפי דף נחיתה */}
      {(() => {
        const shown = landings.filter((l) => l.name !== "ללא דף נחיתה").slice(0, 15);
        const noPage = landings.find((l) => l.name === "ללא דף נחיתה");
        const maxCnt = Math.max(1, ...shown.map((l) => l.cnt));
        return (
          <div className="pcf-card" style={{ marginTop: 18, padding: 0, overflow: "hidden" }}>
            <div className="pcf-admin-tabhead">פילוח לידים לפי דף נחיתה</div>
            <div style={{ overflowX: "auto" }}>
              <table className="pcf-table">
                <thead><tr><th>דף נחיתה</th><th>לידים</th><th>הגיעו לפגישה</th><th style={{ width: "40%" }}>נפח</th></tr></thead>
                <tbody>
                  {shown.map((l) => (
                    <tr key={l.name}>
                      <td><b>{l.name}</b></td>
                      <td>{l.cnt.toLocaleString("he-IL")}</td>
                      <td style={{ color: l.compass ? undefined : "var(--muted)" }}>{l.compass}</td>
                      <td>
                        <div style={{ height: 10, background: "var(--bg)", borderRadius: 6, overflow: "hidden" }}>
                          <div style={{ width: `${Math.round((l.cnt / maxCnt) * 100)}%`, height: "100%", background: "linear-gradient(90deg,var(--accent),var(--accent-2))" }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && <tr><td colSpan={4} style={{ padding: 20, color: "var(--muted)" }}>אין נתונים בטווח הנבחר</td></tr>}
                </tbody>
              </table>
            </div>
            {noPage && <p style={{ color: "var(--muted)", fontSize: 12.5, padding: "0 16px 14px", margin: 0 }}>ועוד {noPage.cnt.toLocaleString("he-IL")} לידים ללא דף נחיתה מתועד (רובם ייבוא היסטורי). מוצגים 15 הדפים המובילים.</p>}
          </div>
        );
      })()}

      {/* פילוח לפי מודעה (utm_content) */}
      {(() => {
        const shown = ads.filter((a) => a.name !== "ללא מודעה").slice(0, 20);
        const noAd = ads.find((a) => a.name === "ללא מודעה");
        const maxCnt = Math.max(1, ...shown.map((a) => a.cnt));
        return (
          <div className="pcf-card" style={{ marginTop: 18, padding: 0, overflow: "hidden" }}>
            <div className="pcf-admin-tabhead">פילוח לידים לפי מודעה</div>
            <div style={{ overflowX: "auto" }}>
              <table className="pcf-table">
                <thead><tr><th>מודעה (שם הקריאייטיב)</th><th>לידים</th><th>הגיעו לפגישה</th><th style={{ width: "34%" }}>נפח</th></tr></thead>
                <tbody>
                  {shown.map((a) => (
                    <tr key={a.name}>
                      <td><b style={{ whiteSpace: "nowrap" }}>{a.name}</b></td>
                      <td>{a.cnt.toLocaleString("he-IL")}</td>
                      <td style={{ color: a.compass ? undefined : "var(--muted)" }}>{a.compass}</td>
                      <td>
                        <div style={{ height: 10, background: "var(--bg)", borderRadius: 6, overflow: "hidden" }}>
                          <div style={{ width: `${Math.round((a.cnt / maxCnt) * 100)}%`, height: "100%", background: "linear-gradient(90deg,var(--accent),var(--accent-2))" }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && <tr><td colSpan={4} style={{ padding: 20, color: "var(--muted)" }}>אין נתונים בטווח הנבחר</td></tr>}
                </tbody>
              </table>
            </div>
            {noAd && <p style={{ color: "var(--muted)", fontSize: 12.5, padding: "0 16px 14px", margin: 0 }}>ועוד {noAd.cnt.toLocaleString("he-IL")} לידים ללא מודעה מתועדת (ייבוא היסטורי / מקורות ללא UTM). מוצגות 20 המודעות המובילות.</p>}
          </div>
        );
      })()}

      {/* יחסי המרה בין השלבים */}
      <div className="pcf-card" style={{ marginTop: 18, padding: 0, overflow: "hidden" }}>
        <div className="pcf-admin-tabhead">יחסי המרה בין השלבים</div>
        <div style={{ overflowX: "auto" }}>
          <table className="pcf-table">
            <thead><tr><th>מעבר</th><th>מ־</th><th>אל</th><th>יחס המרה</th></tr></thead>
            <tbody>
              {(() => {
                const fm = METRICS.filter((m) => !m.placeholder);
                const rowsC = [];
                for (let i = 0; i < fm.length - 1; i++) {
                  const prev = rowFor(fm[i].minIdx).total, next = rowFor(fm[i + 1].minIdx).total;
                  const pct = prev > 0 ? Math.round((next / prev) * 100) : 0;
                  rowsC.push(
                    <tr key={fm[i + 1].key}>
                      <td><b>{fm[i].label} ← {fm[i + 1].label}</b></td>
                      <td>{prev}</td>
                      <td>{next}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, minWidth: 80, height: 8, background: "var(--bg)", borderRadius: 6, overflow: "hidden" }}>
                            <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: "linear-gradient(90deg,var(--accent),var(--accent-2))" }} />
                          </div>
                          <b style={{ minWidth: 42, textAlign: "left" }}>{pct}%</b>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return rowsC;
              })()}
            </tbody>
          </table>
        </div>
      </div>

      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 14 }}>המדדים מחושבים לפי שלב הליד במשפך (reached — הגיע לשלב או מעבר). יחס המרה = כמות בשלב היעד חלקי כמות בשלב הקודם. "שיחות שבוצעו" ימולא כשנחבר תשתית שיחות.</p>
    </main>
  );
}
