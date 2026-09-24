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
  { key: "compass", label: "פגישת מצפן", minIdx: funnelIdx("compass") },
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
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

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
      const [res, resB] = await Promise.all([
        fetch(`/api/admin/leads/stats?${p}`, auth),
        fetch(`/api/admin/leads/breakdowns?${p}`, auth),
      ]);
      if (res.status === 403) { setDenied(true); return; }
      if (!res.ok) throw new Error();
      const d = await res.json();
      setStats(d.stats || []);
      setTotalLeads(d.total || 0);
      if (resB.ok) { const b = await resB.json(); setPlatforms(b.platforms || []); setLandings(b.landings || []); setAds(b.ads || []); }
    } catch { setErr("שגיאה בטעינת הנתונים"); } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (user) load(from, to); }, [user, from, to, load]);

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
  if (!user) return <main className="pcf-wrap pcf-wide"><header className="pcf-hero"><span className="pcf-badge">ניהול • פאוור קאפל</span><h1>כניסת מנהלים</h1></header><div className="pcf-card pcf-login"><button className="pcf-btn white" onClick={login}>התחברות עם Google</button></div></main>;
  if (denied) return <main className="pcf-wrap pcf-wide"><AdminNav /><div className="pcf-card" style={{ textAlign: "center" }}><p>החשבון <b>{user.email}</b> אינו מורשה.</p></div></main>;

  return (
    <main className="pcf-wrap pcf-wide">
      <AdminNav />
      <div className="pcf-admin-top">
        <div><span className="pcf-badge">ניהול • פאוור קאפל</span><h1 style={{ fontSize: 28, margin: "12px 0 0" }}>דשבורד</h1></div>
      </div>

      {/* טווח תאריכים */}
      <div className="pcf-card" style={{ marginTop: 4 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "end", flexWrap: "wrap" }}>
          <div className="pcf-field" style={{ margin: 0 }}><label>מתאריך</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="pcf-field" style={{ margin: 0 }}><label>עד תאריך</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="pcf-btn ghost" style={{ padding: "9px 16px" }} onClick={() => { setFrom(""); setTo(""); }}>הצג הכל</button>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>{from || to ? `מציג לפי טווח (${totalLeads.toLocaleString("he-IL")} לידים)` : `מציג את כל הנתונים (${totalLeads.toLocaleString("he-IL")} לידים)`}</span>
        </div>
      </div>

      {loading && <div className="pcf-spin" style={{ margin: "40px auto" }} />}
      {err && <div className="pcf-err">{err}</div>}

      {/* אריחי מדדים */}
      <div className="pcf-stats" style={{ marginTop: 18 }}>
        {METRICS.map((m) => (
          <div className="pcf-stat" key={m.key}>
            <div className="num" style={{ color: m.placeholder ? "var(--muted)" : undefined }}>{m.placeholder ? "—" : rowFor(m.minIdx).total}</div>
            <div className="lbl">{m.label}{m.placeholder && <span style={{ display: "block", fontSize: 11 }}>(בקרוב)</span>}</div>
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
                <thead><tr><th>פלטפורמה</th><th>לידים</th><th>% מהמיוחסים</th><th>הגיעו למצפן</th><th style={{ width: "38%" }}>נפח</th></tr></thead>
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
                <thead><tr><th>דף נחיתה</th><th>לידים</th><th>הגיעו למצפן</th><th style={{ width: "40%" }}>נפח</th></tr></thead>
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
                <thead><tr><th>מודעה (שם הקריאייטיב)</th><th>לידים</th><th>הגיעו למצפן</th><th style={{ width: "34%" }}>נפח</th></tr></thead>
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
