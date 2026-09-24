"use client";

import { useCallback, useEffect, useMemo, useRef, useState, use } from "react";
import { loadPdf } from "@/lib/pdfClient";

interface SignField { id: string; page: number; x: number; y: number; w: number; h: number; type: string; label: string; required: boolean; editableByMe: boolean; value: string; }
interface SignData { templateName: string; pageCount: number; pdfUrl: string; signerName: string; status: string; fields: SignField[]; }

export default function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<SignData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [pageSizes, setPageSizes] = useState<Record<number, { w: number; h: number }>>({});
  const [zoom, setZoom] = useState(() => (typeof window !== "undefined" && window.innerWidth < 640 ? 1.5 : 1));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [sigField, setSigField] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/sign/${token}`);
        if (!res.ok) { setErr(res.status === 404 ? "הקישור אינו תקף" : "שגיאה בטעינה"); return; }
        const d: SignData = await res.json();
        setData(d);
        if (d.status === "signed") setDone(true);
        const init: Record<string, string> = {};
        d.fields.forEach((f) => { if (f.editableByMe && f.value) init[f.id] = f.value; });
        setValues(init);
      } catch { setErr("שגיאה בטעינה"); }
    })();
  }, [token]);

  // רינדור עמודי ה-PDF (תלוי בזום)
  useEffect(() => {
    if (!data?.pdfUrl) return;
    let cancelled = false;
    (async () => {
      const pdf = await loadPdf(data.pdfUrl);
      const container = document.getElementById("sign-pages");
      const fitW = Math.min((container?.clientWidth || 700) - 4, 760);
      const dpr = Math.min(window.devicePixelRatio || 1, 3); // חדות גבוהה במסכי רטינה/מובייל
      const sizes: Record<number, { w: number; h: number }> = {};
      for (let p = 1; p <= pdf.numPages; p++) {
        if (cancelled) return;
        const page = await pdf.getPage(p);
        const base = page.getViewport({ scale: 1 });
        const cssScale = (fitW / base.width) * zoom;
        const vp = page.getViewport({ scale: cssScale * dpr });
        const canvas = canvasRefs.current[p - 1];
        if (!canvas) continue;
        const cssW = vp.width / dpr, cssH = vp.height / dpr;
        canvas.width = vp.width; canvas.height = vp.height;
        canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
        sizes[p - 1] = { w: cssW, h: cssH };
        await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp, canvas }).promise;
      }
      if (!cancelled) setPageSizes({ ...sizes });
    })();
    return () => { cancelled = true; };
  }, [data?.pdfUrl, zoom]);

  // השדות שלי, מסודרים: עמוד → מלמעלה למטה → ימין לשמאל
  const myFields = useMemo(() => (data?.fields || []).filter((f) => f.editableByMe).sort((a, b) => a.page - b.page || a.y - b.y || b.x - a.x), [data]);
  const isFilled = useCallback((f: SignField) => f.type === "signature" ? !!signatures[f.id] : !!values[f.id]?.trim(), [signatures, values]);
  const firstUnfilled = useCallback(() => myFields.find((f) => f.required && !isFilled(f)) || myFields.find((f) => !isFilled(f)) || null, [myFields, isFilled]);
  const filledCount = myFields.filter(isFilled).length;

  const goToField = useCallback((f: SignField | null) => {
    if (!f) return;
    setActiveId(f.id);
    const el = fieldRefs.current[f.id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => {
      if (f.type === "signature") setSigField(f.id);
      else { const input = el?.querySelector("input") as HTMLInputElement | null; input?.focus(); }
    }, 420);
  }, []);

  // השדה הפעיל הראשוני
  useEffect(() => { if (myFields.length && !activeId) setActiveId((firstUnfilled() || myFields[0]).id); }, [myFields, activeId, firstUnfilled]);

  const submit = async () => {
    setErr(null);
    const missing = firstUnfilled();
    if (missing) { setErr(`נותרו שדות למילוי — קפצתי לשדה הבא`); goToField(missing); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/sign/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values, signatures }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "שגיאה");
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (err && !data) return <main className="pcf-wrap"><div className="pcf-err" style={{ marginTop: 60 }}>{err}</div></main>;
  if (!data) return <main className="pcf-wrap"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;

  if (done) return (
    <main className="pcf-wrap">
      <header className="pcf-hero"><span className="pcf-badge">פאוור קאפל • דין ומיק</span></header>
      <div className="pcf-card pcf-success"><div className="check">✓</div><h2>החתימה נקלטה!</h2><p>תודה {data.signerName}. ההסכם נשמר וכל הצדדים יקבלו עותק חתום.</p></div>
    </main>
  );

  const typeColors: Record<string, string> = { text: "#3b82f6", date: "#a855f7", number: "#f59e0b", signature: "#ff3b3b" };
  const allFilled = filledCount === myFields.length;
  const next = firstUnfilled();

  return (
    <main className="pcf-sign-wrap">
      <header style={{ textAlign: "center", padding: "16px 12px 8px" }}>
        <span className="pcf-badge">פאוור קאפל • דין ומיק</span>
        <h1 style={{ fontSize: 20, margin: "10px 0 2px" }}>{data.templateName}</h1>
        <p className="sub" style={{ fontSize: 13 }}>שלום {data.signerName}, מלא את השדות המסומנים וחתום.</p>
      </header>

      {/* בקרת זום */}
      <div className="pcf-sign-toolbar">
        <button onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(2)))}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.2).toFixed(2)))}>+</button>
        <span className="pcf-sign-progress">מולאו {filledCount}/{myFields.length}</span>
      </div>

      {err && <div className="pcf-err" style={{ margin: "0 12px" }}>{err}</div>}

      <div id="sign-pages" className="pcf-sign-pages">
        {Array.from({ length: data.pageCount }, (_, p) => (
          <div key={p} className="pcf-pdf-page" style={{ width: pageSizes[p]?.w, height: pageSizes[p]?.h }}>
            <canvas ref={(el) => { canvasRefs.current[p] = el; }} style={{ display: "block" }} />
            {data.fields.filter((f) => f.page === p).map((f) => {
              const style: React.CSSProperties = { position: "absolute", left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` };
              if (!f.editableByMe) {
                return f.value ? <div key={f.id} style={{ ...style, display: "flex", alignItems: "center", justifyContent: "flex-end", fontSize: 12, color: "#111", padding: "0 3px", overflow: "hidden" }}>{f.value}</div> : null;
              }
              const active = activeId === f.id;
              return (
                <div key={f.id} ref={(el) => { fieldRefs.current[f.id] = el; }} style={style}>
                  {active && <span className="pcf-field-arrow">▼</span>}
                  {f.type === "signature" ? (
                    <div onClick={() => { setActiveId(f.id); setSigField(f.id); }}
                      style={{ width: "100%", height: "100%", border: `2px ${signatures[f.id] ? "solid" : "dashed"} ${typeColors.signature}`, background: signatures[f.id] ? "#fff" : "rgba(255,59,59,.08)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: active ? "0 0 0 3px rgba(255,59,59,.35)" : "none" }}>
                      {signatures[f.id] ? <img src={signatures[f.id]} alt="חתימה" style={{ maxWidth: "100%", maxHeight: "100%" }} /> : <span style={{ fontSize: 11, color: typeColors.signature, fontWeight: 700 }}>לחתימה ✍️</span>}
                    </div>
                  ) : (
                    <input value={values[f.id] || ""} placeholder={f.label}
                      type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                      onFocus={() => setActiveId(f.id)}
                      onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                      style={{ width: "100%", height: "100%", border: `2px solid ${typeColors[f.type]}`, borderRadius: 3, background: "#fff", color: "#111", fontSize: 16, padding: "0 4px", textAlign: "right", outline: "none", boxShadow: active ? `0 0 0 3px ${typeColors[f.type]}55` : "none" }} />
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {Object.keys(pageSizes).length === 0 && <div className="pcf-spin" style={{ margin: "40px auto" }} />}
      </div>

      {/* פעולה צפה */}
      <div className="pcf-sign-fab">
        {!allFilled ? (
          <button className="pcf-btn" onClick={() => goToField(next)}>
            {next?.type === "signature" ? "חתום כאן ✍️" : "מלא את השדה הבא"} ↓ <span style={{ opacity: .8, fontSize: 13 }}>({filledCount}/{myFields.length})</span>
          </button>
        ) : (
          <button className="pcf-btn" onClick={submit} disabled={busy}>{busy ? <span className="pcf-spin" /> : "אישור וחתימה על המסמך ✓"}</button>
        )}
      </div>

      {sigField && <SignaturePad onCancel={() => setSigField(null)} onSave={(png) => { setSignatures((s) => ({ ...s, [sigField]: png })); setSigField(null); const nf = myFields.find((f) => f.id !== sigField && f.required && !(f.type === "signature" ? !!signatures[f.id] : !!values[f.id]?.trim())); if (nf) setActiveId(nf.id); }} />}
    </main>
  );
}

function SignaturePad({ onSave, onCancel }: { onSave: (png: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const has = useRef(false);

  useEffect(() => {
    const c = ref.current!; const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "#0a0a14"; ctx.lineWidth = 4; ctx.lineCap = "round"; ctx.lineJoin = "round";
  }, []);

  // גזירת השוליים הלבנים כך שהחתימה תמלא את התיבה ותהיה בולטת
  const trimmed = (): string => {
    const c = ref.current!; const ctx = c.getContext("2d")!;
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) {
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (maxX < minX) return c.toDataURL("image/png");
    const pad = 8;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const out = document.createElement("canvas"); out.width = w; out.height = h;
    out.getContext("2d")!.drawImage(c, minX, minY, w, h, 0, 0, w, h);
    return out.toDataURL("image/png");
  };

  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) * (ref.current!.width / r.width), y: (e.clientY - r.top) * (ref.current!.height / r.height) }; };
  const down = (e: React.PointerEvent) => { drawing.current = true; has.current = true; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = ref.current!.getContext("2d")!; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = ref.current!; const ctx = c.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); has.current = false; };

  return (
    <div className="pcf-modal-overlay">
      <div className="pcf-modal">
        <h3 style={{ margin: "0 0 10px" }}>חתום באצבע / עכבר</h3>
        <canvas ref={ref} width={600} height={240} className="pcf-sig-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} style={{ touchAction: "none" }} />
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button className="pcf-btn ghost" style={{ flex: 1 }} onClick={clear}>נקה</button>
          <button className="pcf-btn ghost" style={{ flex: 1 }} onClick={onCancel}>ביטול</button>
          <button className="pcf-btn" style={{ flex: 1 }} onClick={() => { if (has.current) onSave(trimmed()); }}>אישור חתימה</button>
        </div>
      </div>
    </div>
  );
}
