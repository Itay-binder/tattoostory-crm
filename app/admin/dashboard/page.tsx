"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithPopup, setPersistence, browserLocalPersistence, firebaseAuth, googleProvider, type User } from "@/lib/authClient";
import AdminNav from "../AdminNav";

interface StatRow { source: string; stage: string; cnt: number }
interface BreakRow { name: string; cnt: number; enrolled: number }

const PLATFORM_META: Record<string, { icon: string; color: string }> = {
  "Meta": { icon: "🔵", color: "#1877f2" },
  "TikTok": { icon: "🎵", color: "#000000" },
  "YouTube / Google": { icon: "🔴", color: "#ea4335" },
  "אחר": { icon: "•", color: "#8a94a6" },
  "ללא ייחוס": { icon: "—", color: "#c2c8d2" },
};

const FUNNEL_ORDER = ["new", "contacted", "qualified", "interested", "follow_up", "enrolled", "closed_lost"];
const funnelIdx = (stage: string) => FUNNEL_ORDER.indexOf(stage);

const METRICS: { key: string; label: string; minIdx: number | null; placeholder?: boolean }[] = [
  { key: "total", label: "כמות לידים", minIdx: 0 },
  { key: "contacted", label: "נוצר קשר", minIdx: funnelIdx("contacted") },
  { key: "qualified", label: "מוסמכים", minIdx: funnelIdx("qualified") },
  { key: "interested", label: "מתעניינים", minIdx: funnelIdx("interested") },
  { key: "enrolled", label: "נרשמו לקורס", minIdx: funnelIdx("enrolled") },
];

export default function DashboardPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [platforms, setPlatforms] = useState<BreakRow[]>([]);
  const [landings, setLandings] = useState<BreakRow[]>([]);
  const [totalLeads, setTotalLeads] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);

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
      if (resB.ok) {
        const b = await resB.json();
        setPlatforms(b.platforms || []);
        setLandings(b.landings || []);
      }
    } catch { setErr("שגיאה בטעינת הנתונים"); } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (user) load(from, to); }, [user, from, to, load]);

  const login = async () => { await setPersistence(firebaseAuth(), browserLocalPersistence); await signInWithPopup(firebaseAuth(), googleProvider).catch(() => {}); };

  const sources = useMemo(() => {
    const set = new Set(stats.map((r) => r.source));
    return [...set].filter(Boolean);
  }, [stats]);

  const rowFor = (minIdx: number | null) => {
    const bySrc: Record<string, number> = {};
    for (const s of sources) bySrc[s] = 0;
    if (minIdx === null) return { total: 0, bySrc };
    let total = 0;
    for (const r of stats) {
      if (funnelIdx(r.stage) < minIdx) continue;
      total += r.cnt;
      bySrc[r.source] = (bySrc[r.source] || 0) + r.cnt;
    }
    return { total, bySrc };
  };

  if (!authReady) return <main className="pcf-wrap pcf-wide"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div className="pcf-card" style={{ maxWidth: 380, width: "100%", margin: "0 18px", textAlign: "center", padding: "40px 32px" }}>
        <img src="https://tattoostoryacademy.com/wp-content/uploads/2025/03/black_logo.png" alt="Tattoo Story Academy" style={{ height: 60, objectFit: "contain", marginBottom: 24, filter: "brightness(0) invert(1)" }} />
        <h1 style={{ fontSize: 22, marginBottom: 28, fontWeight: 700 }}>כניסת מנהלים</h1>
        <button className="pcf-btn" style={{ width: "100%" }} onClick={login}>התחברות עם Google</button>
      </div>
    </main>
  );
  if (denied) return <main className="pcf-wrap pcf-wide"><AdminNav /><div className="pcf-card" style={{ textAlign: "center" }}><p>החשבון <b>{user.email}</b> אינו מורשה.</p></div></main>;

  return (
    <main className="pcf-wrap pcf-wide">
      <AdminNav />
      <div className="pcf-admin-top">
        <div>
          <span className="pcf-badge">Tattoo Story Academy</span>
          <h1 style={{ fontSize: 28, margin: "12px 0 0" }}>דשבורד</h1>
        </div>
      </div>

      {/* טווח תאריכים */}
      <div className="pcf-card" style={{ marginTop: 4 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "end", flexWrap: "wrap" }}>
          <div className="pcf-field" style={{ margin: 0 }}><label>מתאריך</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="pcf-field" style={{ margin: 0 }}><label>עד תאריך</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <button className="pcf-btn ghost" style={{ padding: "9px 16px" }} onClick={() => { setFrom(""); setTo(""); }}>הצג הכל</button>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            {from || to ? `מציג לפי טווח (${totalLeads.toLocaleString("he-IL")} לידים)` : `כל הזמנים (${totalLeads.toLocaleString("he-IL")} לידים)`}
          </span>
        </div>
      </div>

      {loading && <div className="pcf-spin" style={{ margin: "40px auto" }} />}
      {err && <div className="pcf-err">{err}</div>}

      {/* אריחי מדדים */}
      <div className="pcf-stats" style={{ marginTop: 18 }}>
        {METRICS.map((m) => (
          <div className="pcf-stat" key={m.key}>
            <div className="num">{rowFor(m.minIdx).total}</div>
            <div className="lbl">{m.label}</div>
          </div>
        ))}
      </div>

      {/* יחסי המרה */}
      <div className="pcf-card" style={{ marginTop: 18, padding: 0, overflow: "hidden" }}>
        <div className="pcf-admin-tabhead">יחסי המרה במשפך</div>
        <div style={{ overflowX: "auto" }}>
          <table className="pcf-table">
            <thead><tr><th>מעבר</th><th>מ</th><th>אל</th><th>יחס המרה</th></tr></thead>
            <tbody>
              {(() => {
                const fm = METRICS;
                return fm.slice(0, -1).map((m, i) => {
                  const prev = rowFor(m.minIdx).total;
                  const next = rowFor(fm[i + 1].minIdx).total;
                  const pct = prev > 0 ? Math.round((next / prev) * 100) : 0;
                  return (
                    <tr key={fm[i + 1].key}>
                      <td><b>{m.label} ← {fm[i + 1].label}</b></td>
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
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>

      {/* פילוח לפי מקור */}
      {sources.length > 0 && (
        <div className="pcf-card" style={{ marginTop: 18, padding: 0, overflow: "hidden" }}>
          <div className="pcf-admin-tabhead">פילוח לפי מקור הגעה</div>
          <div style={{ overflowX: "auto" }}>
            <table className="pcf-table">
              <thead>
                <tr><th>מדד</th><th>סה&quot;כ</th>{sources.map((s) => <th key={s} style={{ whiteSpace: "nowrap" }}>{s}</th>)}</tr>
              </thead>
              <tbody>
                {METRICS.map((m) => {
                  const r = rowFor(m.minIdx);
                  return (
                    <tr key={m.key}>
                      <td><b>{m.label}</b></td>
                      <td>{r.total}</td>
                      {sources.map((s) => <td key={s} style={{ color: r.bySrc[s] ? undefined : "var(--muted)" }}>{r.bySrc[s] || 0}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* פילוח לפי פלטפורמת פרסום */}
      {platforms.length > 0 && (() => {
        const attributed = platforms.filter((p) => p.name !== "ללא ייחוס").reduce((n, p) => n + p.cnt, 0);
        const maxCnt = Math.max(1, ...platforms.map((p) => p.cnt));
        return (
          <div className="pcf-card" style={{ marginTop: 18, padding: 0, overflow: "hidden" }}>
            <div className="pcf-admin-tabhead">פילוח לפי פלטפורמת פרסום</div>
            <div style={{ overflowX: "auto" }}>
              <table className="pcf-table">
                <thead><tr><th>פלטפורמה</th><th>לידים</th><th>% מהמיוחסים</th><th>נרשמו</th><th style={{ width: "38%" }}>נפח</th></tr></thead>
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
                        <td style={{ color: p.enrolled ? undefined : "var(--muted)" }}>{p.enrolled || 0}</td>
                        <td>
                          <div style={{ height: 10, background: "var(--bg)", borderRadius: 6, overflow: "hidden" }}>
                            <div style={{ width: `${Math.round((p.cnt / maxCnt) * 100)}%`, height: "100%", background: muted ? "var(--muted)" : m.color, opacity: muted ? 0.35 : 0.85 }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 12.5, padding: "0 16px 14px", margin: 0 }}>
              "ללא ייחוס" = לידים ללא UTM. האחוזים מחושבים מהלידים המיוחסים ({attributed.toLocaleString("he-IL")}).
            </p>
          </div>
        );
      })()}

      {/* פילוח לפי דף נחיתה */}
      {landings.length > 0 && (() => {
        const shown = landings.filter((l) => l.name !== "ללא דף נחיתה").slice(0, 15);
        const noPage = landings.find((l) => l.name === "ללא דף נחיתה");
        const maxCnt = Math.max(1, ...shown.map((l) => l.cnt));
        return (
          <div className="pcf-card" style={{ marginTop: 18, padding: 0, overflow: "hidden" }}>
            <div className="pcf-admin-tabhead">פילוח לידים לפי דף נחיתה</div>
            <div style={{ overflowX: "auto" }}>
              <table className="pcf-table">
                <thead><tr><th>דף נחיתה</th><th>לידים</th><th>נרשמו</th><th style={{ width: "40%" }}>נפח</th></tr></thead>
                <tbody>
                  {shown.map((l) => (
                    <tr key={l.name}>
                      <td><b>{l.name}</b></td>
                      <td>{l.cnt.toLocaleString("he-IL")}</td>
                      <td style={{ color: l.enrolled ? undefined : "var(--muted)" }}>{l.enrolled || 0}</td>
                      <td>
                        <div style={{ height: 10, background: "var(--bg)", borderRadius: 6, overflow: "hidden" }}>
                          <div style={{ width: `${Math.round((l.cnt / maxCnt) * 100)}%`, height: "100%", background: "linear-gradient(90deg,var(--accent),var(--accent-2))" }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && <tr><td colSpan={4} style={{ padding: 20, color: "var(--muted)" }}>אין נתונים</td></tr>}
                </tbody>
              </table>
            </div>
            {noPage && <p style={{ color: "var(--muted)", fontSize: 12.5, padding: "0 16px 14px", margin: 0 }}>ועוד {noPage.cnt.toLocaleString("he-IL")} לידים ללא דף נחיתה מתועד.</p>}
          </div>
        );
      })()}

      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 14 }}>
        המדדים מחושבים לפי שלב הליד במשפך. יחס המרה = כמות בשלב היעד חלקי כמות בשלב הקודם.
      </p>
    </main>
  );
}
