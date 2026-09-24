"use client";

import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useAdmin } from "@/lib/useAdmin";
import { loadPdf } from "@/lib/pdfClient";
import { FIELD_TYPE_LABELS, sourceOptions, MAX_SIGNERS, type ContractField, type FieldType, type FieldSource } from "@/lib/contracts";

type Draft = { page: number; x: number; y: number; w: number; h: number } | null;

export default function TemplateEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, ready, login, api } = useAdmin();
  const [name, setName] = useState("");
  const [pdfUrl, setPdfUrl] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [signerCount, setSignerCount] = useState(1);
  const [fields, setFields] = useState<ContractField[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [armed, setArmed] = useState<FieldType | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [pageSizes, setPageSizes] = useState<Record<number, { w: number; h: number }>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const drawStart = useRef<{ page: number; x: number; y: number } | null>(null);
  const moveRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  // טעינת התבנית
  const load = useCallback(async () => {
    const res = await api(`/api/admin/templates/${id}`);
    if (!res.ok) { setErr("שגיאה בטעינת התבנית"); return; }
    const d = await res.json();
    setName(d.name || ""); setPdfUrl(d.pdfUrl || ""); setPageCount(d.pageCount || 0); setSignerCount(d.signerCount || 1); setFields(d.fields || []);
    setLoaded(true);
  }, [api, id]);
  useEffect(() => { if (user) load(); }, [user, load]);

  // רינדור עמודי ה-PDF
  useEffect(() => {
    if (!pdfUrl || !loaded) return;
    let cancelled = false;
    (async () => {
      const pdf = await loadPdf(pdfUrl);
      const container = document.getElementById("pdf-pages");
      const targetW = Math.min(container?.clientWidth || 800, 800);
      const sizes: Record<number, { w: number; h: number }> = {};
      for (let p = 1; p <= pdf.numPages; p++) {
        if (cancelled) return;
        const page = await pdf.getPage(p);
        const base = page.getViewport({ scale: 1 });
        const scale = targetW / base.width;
        const vp = page.getViewport({ scale });
        const canvas = canvasRefs.current[p - 1];
        if (!canvas) continue;
        canvas.width = vp.width; canvas.height = vp.height;
        sizes[p - 1] = { w: vp.width, h: vp.height };
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
      }
      if (!cancelled) setPageSizes({ ...sizes });
    })();
    return () => { cancelled = true; };
  }, [pdfUrl, loaded]);

  const addField = (page: number, x: number, y: number, w: number, h: number) => {
    const fid = `f_${Date.now()}_${Math.round(x * 1000)}`;
    const nf: ContractField = { id: fid, page, x, y, w, h, type: armed!, label: FIELD_TYPE_LABELS[armed!], source: "signer1", required: true };
    setFields((prev) => [...prev, nf]);
    setSelectedId(fid); setArmed(null);
  };

  const duplicateField = (f: ContractField) => {
    const fid = `f_${Date.now()}_${Math.round(Math.abs(f.x) * 1000)}`;
    const copy: ContractField = { ...f, id: fid, x: Math.min(0.9, f.x + 0.02), y: Math.min(0.95, f.y + f.h + 0.01) };
    setFields((prev) => [...prev, copy]);
    setSelectedId(fid);
  };

  // ציור תיבה חדשה
  const onPagePointerDown = (e: React.PointerEvent, page: number) => {
    if (!armed) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    drawStart.current = { page, x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPagePointerMove = (e: React.PointerEvent, page: number) => {
    if (!drawStart.current || drawStart.current.page !== page) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width, cy = (e.clientY - rect.top) / rect.height;
    const s = drawStart.current;
    setDraft({ page, x: Math.min(s.x, cx), y: Math.min(s.y, cy), w: Math.abs(cx - s.x), h: Math.abs(cy - s.y) });
  };
  const onPagePointerUp = () => {
    if (draft && draft.w > 0.01 && draft.h > 0.01) addField(draft.page, draft.x, draft.y, draft.w, draft.h);
    drawStart.current = null; setDraft(null);
  };

  // הזזת תיבה קיימת
  const onBoxPointerDown = (e: React.PointerEvent, f: ContractField) => {
    if (armed) return;
    e.stopPropagation();
    setSelectedId(f.id);
    const pageEl = document.getElementById(`page-${f.page}`)!;
    const rect = pageEl.getBoundingClientRect();
    moveRef.current = { id: f.id, startX: e.clientX, startY: e.clientY, origX: f.x, origY: f.y };
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - moveRef.current!.startX) / rect.width;
      const dy = (ev.clientY - moveRef.current!.startY) / rect.height;
      setFields((prev) => prev.map((x) => x.id === f.id ? { ...x, x: Math.max(0, Math.min(1 - x.w, moveRef.current!.origX + dx)), y: Math.max(0, Math.min(1 - x.h, moveRef.current!.origY + dy)) } : x));
    };
    const onUp = () => { moveRef.current = null; window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  };

  const updateField = (fid: string, patch: Partial<ContractField>) => setFields((prev) => prev.map((f) => f.id === fid ? { ...f, ...patch } : f));
  const deleteField = (fid: string) => { setFields((prev) => prev.filter((f) => f.id !== fid)); if (selectedId === fid) setSelectedId(null); };

  const save = async () => {
    setSaving(true); setSavedMsg(""); setErr(null);
    try {
      const res = await api(`/api/admin/templates/${id}`, { method: "PUT", body: JSON.stringify({ name, fields, signerCount }) });
      if (!res.ok) throw new Error();
      setSavedMsg("✓ נשמר");
    } catch { setErr("שמירה נכשלה"); } finally { setSaving(false); }
  };

  const selected = fields.find((f) => f.id === selectedId) || null;
  const typeColors: Record<FieldType, string> = { text: "#3b82f6", date: "#a855f7", number: "#f59e0b", signature: "#ff3b3b" };

  if (!ready) return <main className="pcf-wrap"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return <main className="pcf-wrap"><div className="pcf-card pcf-login"><button className="pcf-btn white" onClick={login}>התחברות עם Google</button></div></main>;

  return (
    <main className="pcf-wrap" style={{ maxWidth: 1200 }}>
      <div className="pcf-admin-top">
        <div>
          <Link href="/admin/templates" className="pcf-link-btn">→ תבניות</Link>
          <input value={name} onChange={(e) => setName(e.target.value)} className="pcf-title-input" placeholder="שם התבנית" />
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {savedMsg && <span style={{ color: "var(--green)", fontSize: 14 }}>{savedMsg}</span>}
          <button className="pcf-btn" onClick={save} disabled={saving} style={{ padding: "10px 22px" }}>{saving ? <span className="pcf-spin" /> : "💾 שמירה"}</button>
          <a className="pcf-btn ghost" href={`/admin/templates/${id}/send`} style={{ padding: "10px 18px" }}>🔗 שלח לחתימה</a>
        </div>
      </div>
      {err && <div className="pcf-err">{err}</div>}

      <div className="pcf-editor">
        {/* סרגל כלים + מאפיינים */}
        <aside className="pcf-editor-side">
          <div className="pcf-side-card">
            <div className="pcf-side-title">מספר חותמים במסמך</div>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }}>כמה אנשים חותמים על אותו הסכם (זוג = 2).</p>
            <select className="pcf-side-input" value={signerCount} onChange={(e) => setSignerCount(Number(e.target.value))}>
              {Array.from({ length: MAX_SIGNERS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} {n === 1 ? "חותם" : "חותמים"}</option>)}
            </select>
          </div>

          <div className="pcf-side-card">
            <div className="pcf-side-title">הוספת שדה</div>
            <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 0 10px" }}>בחר סוג ואז גרור על המסמך כדי לסמן מיקום.</p>
            <div className="pcf-type-grid">
              {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((t) => (
                <button key={t} className={`pcf-type-btn${armed === t ? " active" : ""}`} style={{ borderColor: armed === t ? typeColors[t] : undefined }}
                  onClick={() => setArmed(armed === t ? null : t)}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: typeColors[t], display: "inline-block", marginInlineEnd: 6 }} />
                  {FIELD_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
            {armed && <div style={{ fontSize: 12, color: typeColors[armed], marginTop: 8 }}>גרור על המסמך לסימון שדה {FIELD_TYPE_LABELS[armed]}…</div>}
          </div>

          {selected && (
            <div className="pcf-side-card">
              <div className="pcf-side-title">מאפייני שדה</div>
              <label className="pcf-side-label">תווית</label>
              <input className="pcf-side-input" value={selected.label} onChange={(e) => updateField(selected.id, { label: e.target.value })} />
              <label className="pcf-side-label">סוג</label>
              <select className="pcf-side-input" value={selected.type} onChange={(e) => updateField(selected.id, { type: e.target.value as FieldType })}>
                {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
              </select>
              <label className="pcf-side-label">{selected.type === "signature" ? "מי חותם" : "מי ממלא / מקור"}</label>
              <select className="pcf-side-input" value={selected.source} onChange={(e) => updateField(selected.id, { source: e.target.value as FieldSource })}>
                {sourceOptions(signerCount)
                  .filter((o) => selected.type !== "signature" || (!o.value.startsWith("clientData:") && o.value !== "auto:today"))
                  .map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <label className="pcf-side-checkbox"><input type="checkbox" checked={selected.required} onChange={(e) => updateField(selected.id, { required: e.target.checked })} /> שדה חובה</label>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="pcf-btn ghost" style={{ flex: 1 }} onClick={() => duplicateField(selected)}>📑 שכפול</button>
                <button className="pcf-btn ghost" style={{ flex: 1, color: "#ff8585" }} onClick={() => deleteField(selected.id)}>מחיקה</button>
              </div>
            </div>
          )}

          <div className="pcf-side-card">
            <div className="pcf-side-title">שדות ({fields.length})</div>
            {fields.length === 0 && <p style={{ fontSize: 12, color: "var(--muted)" }}>טרם הוגדרו שדות.</p>}
            {fields.map((f) => (
              <div key={f.id} className={`pcf-field-row${selectedId === f.id ? " active" : ""}`} onClick={() => setSelectedId(f.id)}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: typeColors[f.type], display: "inline-block" }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.label}</span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>ע׳{f.page + 1}</span>
              </div>
            ))}
          </div>
        </aside>

        {/* תצוגת ה-PDF */}
        <div id="pdf-pages" className="pcf-editor-canvas">
          {Array.from({ length: pageCount }, (_, p) => (
            <div key={p} id={`page-${p}`} className="pcf-pdf-page"
              onPointerDown={(e) => onPagePointerDown(e, p)} onPointerMove={(e) => onPagePointerMove(e, p)} onPointerUp={onPagePointerUp}
              style={{ width: pageSizes[p]?.w, height: pageSizes[p]?.h, cursor: armed ? "crosshair" : "default" }}>
              <canvas ref={(el) => { canvasRefs.current[p] = el; }} style={{ display: "block" }} />
              {fields.filter((f) => f.page === p).map((f) => (
                <div key={f.id} onPointerDown={(e) => onBoxPointerDown(e, f)}
                  className={`pcf-field-box${selectedId === f.id ? " selected" : ""}`}
                  style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%`, borderColor: typeColors[f.type], background: `${typeColors[f.type]}22` }}>
                  <span className="pcf-field-box-label">{f.label}</span>
                </div>
              ))}
              {draft && draft.page === p && (
                <div className="pcf-field-box" style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%`, borderColor: "#fff", background: "rgba(255,255,255,.15)" }} />
              )}
            </div>
          ))}
          {!loaded && <div className="pcf-spin" style={{ margin: "40px auto" }} />}
        </div>
      </div>
    </main>
  );
}
