"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, setPersistence, browserLocalPersistence, firebaseAuth, googleProvider, type User } from "@/lib/authClient";
import AdminNav from "../AdminNav";

interface AggRow { label: string; c: number }
interface NameRow { name: string; is_new: boolean; last: string }
interface MetaCampaign { name: string; objective: string; spend: number; impressions: number; clicks: number; ctr: number }
interface Perf {
  from: string; to: string;
  summary: { total: number; new: number; returning: number };
  bySource: AggRow[]; byCampaign: AggRow[]; byAd: AggRow[]; byPage: AggRow[];
  names: NameRow[];
  meta: { spend: number; impressions: number; clicks: number; ctr: number; cpc: number; reach: number; campaigns: MetaCampaign[] } | null;
}

const nis = (n: number) => "₪" + Math.round(n).toLocaleString("he-IL");
const nis1 = (n: number) => "₪" + n.toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n: number) => n.toLocaleString("he-IL");
const SRC_LBL: Record<string, string> = { metaADS: "מטא · VSL לידים", fb: "פייסבוק", ig: "אינסטגרם", wa: "וואטסאפ", mail: "מייל" };

function todayIso() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date()); }
function monthStartIso() { return todayIso().slice(0, 8) + "01"; }

function Bars({ data, relabel, adMode }: { data: AggRow[]; relabel?: boolean; adMode?: boolean }) {
  const max = Math.max(...data.map((d) => d.c), 1);
  const label = (l: string) => adMode && /^\d+$/.test(l) ? "מודעה #" + l.slice(-6) : (relabel ? (SRC_LBL[l] || l) : l);
  return (
    <>
      {data.slice(0, adMode ? 10 : 99).map((d) => (
        <div key={d.label} style={{ marginBottom: 11 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13.5, marginBottom: 4 }}>
            <span title={d.label} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(d.label)}</span>
            <b style={{ color: "var(--accent)" }}>{d.c}</b>
          </div>
          <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 6, overflow: "hidden" }}>
            <i style={{ display: "block", height: "100%", borderRadius: 6, width: `${Math.round(d.c / max * 100)}%`, background: "linear-gradient(90deg, var(--accent), var(--accent-2))" }} />
          </div>
        </div>
      ))}
    </>
  );
}

export default function PerformancePage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<Perf | null>(null);
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null); setDenied(false);
    try {
      const t = await firebaseAuth().currentUser!.getIdToken();
      const res = await fetch(`/api/admin/performance?from=${from}&to=${to}`, { headers: { Authorization: `Bearer ${t}` } });
      if (res.status === 403) { setDenied(true); return; }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "שגיאה");
      setData(await res.json());
    } catch (e) { setErr(`שגיאה בטעינת הנתונים — ${(e as Error).message}`); } finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { if (user) load(); }, [user, load]);

  const login = async () => { await setPersistence(firebaseAuth(), browserLocalPersistence); await signInWithPopup(firebaseAuth(), googleProvider).catch(() => {}); };

  // עלות לליד = תקציב מטא חלקי הלידים האמיתיים מהמערכת (לא מסתמכים על ספירת מטא)
  const cpl = useMemo(() => (data?.meta && data.summary.total ? data.meta.spend / data.summary.total : 0), [data]);

  const quick = (label: string, f: () => [string, string]) => (
    <button className="pcf-pill" onClick={() => { const [a, b] = f(); setFrom(a); setTo(b); }}>{label}</button>
  );

  if (!authReady) return <main className="pcf-wrap pcf-wide"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return <main className="pcf-wrap pcf-wide"><header className="pcf-hero"><span className="pcf-badge">ניהול • פאוור קאפל</span><h1>כניסת מנהלים</h1></header><div className="pcf-card pcf-login"><button className="pcf-btn white" onClick={login}>התחברות עם Google</button></div></main>;
  if (denied) return <main className="pcf-wrap pcf-wide"><AdminNav /><div className="pcf-card" style={{ textAlign: "center" }}><p>החשבון <b>{user.email}</b> אינו מורשה.</p></div></main>;

  const m = data?.meta;
  return (
    <main className="pcf-wrap pcf-wide">
      <AdminNav />
      <div className="pcf-admin-top">
        <div>
          <span className="pcf-badge">ניהול • פאוור קאפל</span>
          <h1 style={{ fontSize: 28, margin: "12px 0 0" }}>📈 ביצועים</h1>
          <p style={{ color: "var(--muted)", margin: "6px 0 0", fontSize: 14 }}>לידים ותקציב פרסום — נתונים אמיתיים (אופטיוואן + המערכת), ללא מיזוגי גיליון.</p>
        </div>
      </div>

      {/* טווח תאריכים */}
      <div className="pcf-card" style={{ marginTop: 4, display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
        <div className="pcf-field" style={{ margin: 0 }}><label>מתאריך</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="pcf-field" style={{ margin: 0 }}><label>עד תאריך</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {quick("החודש", () => [monthStartIso(), todayIso()])}
          {quick("החודש שעבר", () => { const d = new Date(); const y = d.getFullYear(), mo = d.getMonth(); const s = new Date(Date.UTC(y, mo - 1, 1)), e = new Date(Date.UTC(y, mo, 0)); return [s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)]; })}
          {quick("7 ימים", () => { const e = new Date(); const s = new Date(e.getTime() - 6 * 864e5); return [s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)]; })}
        </div>
        {loading && <span className="pcf-spin" style={{ width: 18, height: 18, borderWidth: 2 }} />}
      </div>

      {err && <div className="pcf-err">{err}</div>}

      {data && (
        <>
          {/* KPI */}
          <div className="pcf-stats" style={{ marginTop: 16 }}>
            <div className="pcf-stat" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))", color: "#fff", border: 0 }}>
              <div className="num" style={{ color: "#fff" }}>{data.summary.total}</div><div className="lbl" style={{ color: "rgba(255,255,255,.9)" }}>לידים נכנסו</div>
            </div>
            <div className="pcf-stat"><div className="num" style={{ color: "var(--green)" }}>{data.summary.new}</div><div className="lbl">חדשים</div></div>
            <div className="pcf-stat"><div className="num" style={{ color: "var(--gold)" }}>{data.summary.returning}</div><div className="lbl">חוזרים</div></div>
            <div className="pcf-stat"><div className="num">{m ? nis(m.spend) : "—"}</div><div className="lbl">תקציב מטא</div></div>
            <div className="pcf-stat"><div className="num">{m && cpl ? nis(cpl) : "—"}</div><div className="lbl">עלות לליד</div></div>
          </div>

          {/* רצועת מטא */}
          {m && (
            <div className="pcf-card" style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10 }}>
              {[["חשיפות", int(m.impressions)], ["קליקים", int(m.clicks)], ["CTR", m.ctr.toFixed(2) + "%"], ["CPC", nis1(m.cpc)], ["Reach", int(m.reach)]].map(([k, v]) => (
                <div key={k} style={{ flex: 1, minWidth: 100, textAlign: "center", borderInlineStart: "1px solid var(--line)", padding: "0 8px" }}>
                  <b style={{ display: "block", fontSize: 19 }}>{v}</b><span style={{ color: "var(--muted)", fontSize: 12 }}>{k}</span>
                </div>
              ))}
            </div>
          )}
          {!m && <div className="pcf-card" style={{ marginTop: 14, color: "var(--muted)" }}>נתוני מטא לא נטענו (בדוק שהטוקן מוגדר ב-Vercel).</div>}

          {/* פילוחים */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }} className="pcf-perf-grid">
            <div className="pcf-card"><h2>פילוח לפי מקור</h2><Bars data={data.bySource} relabel /></div>
            <div className="pcf-card"><h2>פילוח לפי קמפיין</h2><Bars data={data.byCampaign} relabel /></div>
            <div className="pcf-card"><h2>פילוח לפי מודעה <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>Top 10</span></h2><Bars data={data.byAd} adMode /></div>
            <div className="pcf-card"><h2>פילוח לפי דף נחיתה</h2><Bars data={data.byPage} /></div>
          </div>

          {/* תקציב מטא לפי קמפיין */}
          {m && m.campaigns.length > 0 && (
            <div className="pcf-card" style={{ marginTop: 16, padding: 0, overflow: "hidden" }}>
              <div className="pcf-admin-tabhead">תקציב מטא לפי קמפיין</div>
              <div style={{ overflowX: "auto" }}>
                <table className="pcf-table">
                  <thead><tr><th>קמפיין</th><th>יעד</th><th>הוצאה</th><th>חשיפות</th><th>קליקים</th><th>CTR</th></tr></thead>
                  <tbody>
                    {m.campaigns.map((c, i) => (
                      <tr key={i} style={{ cursor: "default" }}>
                        <td><b>{c.name}</b></td>
                        <td><span className="pcf-pill-status" style={{ background: c.objective === "לידים" ? "rgba(37,211,102,.15)" : "rgba(255,200,87,.15)", color: c.objective === "לידים" ? "var(--green)" : "var(--gold)" }}>{c.objective}</span></td>
                        <td style={{ fontWeight: 600 }}>{nis1(c.spend)}</td>
                        <td>{int(c.impressions)}</td><td>{int(c.clicks)}</td><td>{c.ctr.toFixed(2)}%</td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 800 }}><td>סה"כ</td><td /><td>{nis1(m.spend)}</td><td>{int(m.impressions)}</td><td>{int(m.clicks)}</td><td>{m.ctr.toFixed(2)}%</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* רשימה שמית */}
          {data.summary.returning > 0 && (
            <div className="pcf-card" style={{ marginTop: 16 }}>
              <h2>לידים חוזרים <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>{data.summary.returning}</span></h2>
              <div className="pcf-names">{data.names.filter((n) => !n.is_new).map((n, i) => <div key={i} className="ret"><span>{n.name}</span><small>{n.last}</small></div>)}</div>
            </div>
          )}
          <div className="pcf-card" style={{ marginTop: 16 }}>
            <h2>לידים חדשים <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 400 }}>{data.summary.new}</span></h2>
            <div className="pcf-names">{data.names.filter((n) => n.is_new).map((n, i) => <div key={i}><span>{n.name}</span><small>{n.last}</small></div>)}</div>
          </div>
        </>
      )}
    </main>
  );
}
