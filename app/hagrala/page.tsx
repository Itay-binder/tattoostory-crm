"use client";

import { useMemo, useRef, useState } from "react";
import { PARTICIPANTS } from "./participants";
import { USERNAMES } from "./usernames";
import { HAS_PIC } from "./pics";

const nameOf = (id: string): string | null => (USERNAMES[id] ? "@" + USERNAMES[id] : null);
const ballImg = (id: string): string => (HAS_PIC.has(id) ? `url("/hg-pics/${id}.jpg") center/cover` : ballBg(id));

// צבע דטרמיניסטי לכל משתתף לפי המזהה
function hueOf(id: string): number { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360; return h; }
function ballBg(id: string): string { const a = hueOf(id), b = (a + 45) % 360; return `radial-gradient(circle at 32% 28%, #ffffff55, transparent 42%), linear-gradient(140deg, hsl(${a} 88% 58%), hsl(${b} 85% 46%))`; }
const short = (id: string) => id.slice(-5);
const rnd = (min: number, max: number) => Math.random() * (max - min) + min;

// קונפטי ללא ספריות
function fireConfetti() {
  const c = document.createElement("canvas");
  c.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:99999";
  c.width = innerWidth; c.height = innerHeight; document.body.appendChild(c);
  const ctx = c.getContext("2d"); if (!ctx) { c.remove(); return; }
  const cols = ["#ff3b3b", "#ff7a3b", "#ffc857", "#22c55e", "#3b82f6", "#ffffff", "#e02b2b"];
  const P = Array.from({ length: 240 }, () => ({ x: innerWidth / 2, y: innerHeight / 2.4, vx: (Math.random() - 0.5) * 18, vy: Math.random() * -18 - 5, r: Math.random() * 7 + 3, col: cols[Math.floor(Math.random() * cols.length)], a: 1, rot: Math.random() * 6 }));
  let t = 0; (function loop() {
    t++; ctx.clearRect(0, 0, c.width, c.height);
    for (const p of P) { p.vy += 0.4; p.x += p.vx; p.y += p.vy; p.a -= 0.008; p.rot += 0.2; ctx.globalAlpha = Math.max(0, p.a); ctx.fillStyle = p.col; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 1.4); ctx.restore(); }
    if (t < 220) requestAnimationFrame(loop); else c.remove();
  })();
}

// כדורים לתצוגה במכונה (תת-קבוצה אקראית מתוך כולם)
function pickMachine(ids: string[], n: number): { id: string; idx: number }[] {
  const arr = ids.map((id, idx) => ({ id, idx }));
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr.slice(0, Math.min(n, arr.length));
}

export default function HagralaPage() {
  const [phase, setPhase] = useState<"idle" | "spinning" | "count" | "winner">("idle");
  const [count, setCount] = useState(5);
  const [winner, setWinner] = useState<{ id: string; idx: number } | null>(null);
  const [q, setQ] = useState("");
  const machine = useMemo(() => pickMachine(PARTICIPANTS, 60), []);
  const started = useRef(false);

  const start = () => {
    if (phase === "spinning" || phase === "count") return;
    setWinner(null); started.current = true;
    setPhase("spinning");
    setTimeout(() => {
      setPhase("count"); let n = 5; setCount(n);
      const iv = setInterval(() => {
        n--; if (n > 0) { setCount(n); } else {
          clearInterval(iv);
          const w = Math.floor(Math.random() * PARTICIPANTS.length);
          setWinner({ id: PARTICIPANTS[w], idx: w });
          setPhase("winner");
          fireConfetti(); setTimeout(fireConfetti, 500); setTimeout(fireConfetti, 1100);
        }
      }, 1000);
    }, 1400);
  };

  const filtered = q.trim()
    ? PARTICIPANTS.map((id, idx) => ({ id, idx })).filter((p) => p.id.includes(q.trim()) || String(p.idx + 1) === q.trim() || (USERNAMES[p.id] || "").toLowerCase().includes(q.trim().toLowerCase()))
    : PARTICIPANTS.map((id, idx) => ({ id, idx }));

  return (
    <main dir="rtl" className="hg-root">
      <style>{CSS}</style>

      <header className="hg-hero">
        <span className="hg-badge">Power Couple</span>
        <h1>הגרלת המשתתפים</h1>
        <p>{PARTICIPANTS.length} משתתפים נכנסו לתוך המכונה. לחצו והתחילו — הכדור המנצח יקפוץ תוך 5 שניות.</p>
      </header>

      <section className="hg-stage">
        <div className={`hg-machine ${phase === "spinning" || phase === "count" ? "spin" : ""} ${phase === "winner" ? "won" : ""}`}>
          <div className="hg-glass" />
          <div className="hg-balls">
            {machine.map((b, i) => (
              <span key={b.id} className="hg-ball" style={{
                background: ballImg(b.id),
                left: `${rnd(6, 78)}%`, top: `${rnd(6, 74)}%`,
                ["--d" as string]: `${rnd(2.4, 5.2)}s`, ["--dl" as string]: `${rnd(0, 3)}s`,
                ["--x1" as string]: `${rnd(-120, 120)}px`, ["--y1" as string]: `${rnd(-120, 120)}px`,
                ["--x2" as string]: `${rnd(-120, 120)}px`, ["--y2" as string]: `${rnd(-120, 120)}px`,
                ["--x3" as string]: `${rnd(-120, 120)}px`, ["--y3" as string]: `${rnd(-120, 120)}px`,
              } as React.CSSProperties}>{HAS_PIC.has(b.id) ? "" : b.idx + 1}</span>
            ))}
          </div>
          {phase === "count" && <div className="hg-count"><span key={count}>{count}</span></div>}
          <div className="hg-chute" />
        </div>

        {phase === "winner" && winner && (
          <div className="hg-winner">
            <div className="hg-winner-ball" style={{ background: ballImg(winner.id) }}>{HAS_PIC.has(winner.id) ? "" : winner.idx + 1}</div>
            <h2>יש לנו זוכה!</h2>
            <div className="hg-winner-id">{nameOf(winner.id) || `משתתף #${winner.idx + 1}`}</div>
            {!nameOf(winner.id) && <code className="hg-winner-code">IGSID: {winner.id}</code>}
          </div>
        )}

        <button className="hg-btn" onClick={start} disabled={phase === "spinning" || phase === "count"}>
          {phase === "idle" ? "התחל הגרלה" : phase === "winner" ? "הגרלה חוזרת" : "מגריל…"}
        </button>
      </section>

      <section className="hg-list">
        <div className="hg-list-head">
          <h3>כל המשתתפים ({PARTICIPANTS.length})</h3>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי מספר או מזהה…" />
        </div>
        <div className="hg-grid">
          {filtered.map((p) => (
            <div key={p.id} className={`hg-chip ${winner?.id === p.id ? "win" : ""}`}>
              <span className="hg-chip-ball" style={{ background: ballImg(p.id) }}>{HAS_PIC.has(p.id) ? "" : p.idx + 1}</span>
              <span className="hg-chip-id" style={nameOf(p.id) ? { color: "#fff", fontWeight: 700, direction: "ltr" } : undefined}>{nameOf(p.id) || `…${short(p.id)}`}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

const CSS = `
.hg-root{min-height:100vh;background:radial-gradient(1200px 600px at 50% -10%,#2a0b12,#0b0d12 60%);color:#fff;font-family:Heebo,Arial,sans-serif;padding:24px 16px 60px;overflow-x:hidden}
.hg-hero{text-align:center;max-width:720px;margin:8px auto 10px}
.hg-badge{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.12em;color:#ff8a5b;border:1px solid #ff7a3b55;border-radius:999px;padding:5px 14px;margin-bottom:12px}
.hg-hero h1{font-size:clamp(28px,6vw,52px);margin:6px 0;background:linear-gradient(90deg,#ff3b3b,#ff7a3b,#ffc857);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:900}
.hg-hero p{color:#c9c9d2;font-size:15px}
.hg-stage{display:flex;flex-direction:column;align-items:center;gap:22px;margin-top:18px}
.hg-machine{position:relative;width:min(78vw,440px);height:min(78vw,440px);border-radius:50%;
 background:radial-gradient(circle at 50% 35%,rgba(255,255,255,.08),rgba(255,255,255,.02) 60%,rgba(0,0,0,.4));
 border:3px solid rgba(255,255,255,.14);box-shadow:0 0 0 10px rgba(255,59,59,.06),0 30px 80px rgba(0,0,0,.6),inset 0 0 60px rgba(0,0,0,.5);overflow:hidden}
.hg-glass{position:absolute;inset:0;border-radius:50%;background:linear-gradient(135deg,rgba(255,255,255,.16),transparent 40%);pointer-events:none;z-index:5}
.hg-balls{position:absolute;inset:6%}
.hg-ball{position:absolute;width:clamp(28px,7vw,40px);height:clamp(28px,7vw,40px);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;color:#3a1200;box-shadow:0 3px 8px rgba(0,0,0,.4),inset 0 -3px 6px rgba(0,0,0,.25);animation:hgTumble var(--d) ease-in-out var(--dl) infinite}
.hg-machine.spin .hg-ball{animation-duration:calc(var(--d) / 3.4)}
.hg-machine.won .hg-ball{opacity:.25;filter:blur(1px)}
@keyframes hgTumble{0%{transform:translate(0,0) rotate(0)}25%{transform:translate(var(--x1),var(--y1)) rotate(120deg)}50%{transform:translate(var(--x2),var(--y2)) rotate(240deg)}75%{transform:translate(var(--x3),var(--y3)) rotate(340deg)}100%{transform:translate(0,0) rotate(360deg)}}
.hg-count{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:8}
.hg-count span{font-size:min(38vw,190px);font-weight:900;color:#fff;text-shadow:0 0 40px #ff3b3b,0 0 12px #ff7a3b;animation:hgPop 1s ease-out}
@keyframes hgPop{0%{transform:scale(.2);opacity:0}30%{transform:scale(1.15);opacity:1}100%{transform:scale(.7);opacity:.15}}
.hg-chute{position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);width:64px;height:22px;border-radius:0 0 40px 40px;background:linear-gradient(#ff3b3b,#b3261e);z-index:6}
.hg-winner{text-align:center;animation:hgRise .7s cubic-bezier(.2,1.3,.4,1)}
@keyframes hgRise{0%{transform:translateY(40px) scale(.6);opacity:0}100%{transform:none;opacity:1}}
.hg-winner-ball{width:120px;height:120px;border-radius:50%;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:900;color:#3a1200;box-shadow:0 0 0 8px rgba(255,200,87,.25),0 18px 50px rgba(0,0,0,.6);animation:hgSpinOnce .8s ease-out}
@keyframes hgSpinOnce{from{transform:rotate(-360deg) scale(.3)}to{transform:none}}
.hg-winner h2{font-size:30px;margin:6px 0;color:#ffc857}
.hg-winner-id{font-size:22px;font-weight:800}
.hg-winner-code{display:inline-block;margin-top:8px;background:#ffffff12;border:1px solid #ffffff22;border-radius:8px;padding:6px 12px;font-size:13px;color:#c9c9d2;direction:ltr}
.hg-winner-note{color:#9a9aa6;font-size:13px;margin-top:8px}
.hg-btn{background:linear-gradient(90deg,#ff1f1f,#ff7a3b);color:#fff;font-weight:900;font-size:18px;border:none;border-radius:14px;padding:15px 40px;cursor:pointer;box-shadow:0 10px 30px rgba(255,59,59,.35);transition:transform .12s}
.hg-btn:hover:not(:disabled){transform:translateY(-2px)}
.hg-btn:disabled{opacity:.6;cursor:default}
.hg-list{max-width:900px;margin:46px auto 0}
.hg-list-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.hg-list-head h3{font-size:20px;margin:0}
.hg-list-head input{padding:9px 14px;border-radius:10px;border:1px solid #ffffff22;background:#ffffff0d;color:#fff;font-size:14px;min-width:220px}
.hg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px}
.hg-chip{display:flex;align-items:center;gap:8px;background:#ffffff08;border:1px solid #ffffff14;border-radius:12px;padding:8px 10px}
.hg-chip.win{border-color:#ffc857;box-shadow:0 0 0 2px #ffc85755}
.hg-chip-ball{width:30px;height:30px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:11px;color:#3a1200}
.hg-chip-id{font-size:12px;color:#b8b8c2;direction:ltr}
`;
