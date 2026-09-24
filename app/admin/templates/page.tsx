"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAdmin } from "@/lib/useAdmin";
import { loadPdf } from "@/lib/pdfClient";
import type { ContractTemplate } from "@/lib/contracts";

export default function TemplatesPage() {
  const { user, ready, login, logout, api } = useAdmin();
  const [templates, setTemplates] = useState<ContractTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await api("/api/admin/templates");
      if (res.status === 403) { setDenied(true); return; }
      const d = await res.json();
      setTemplates(d.templates || []);
    } catch { setErr("שגיאה בטעינה"); } finally { setLoading(false); }
  }, [api]);

  useEffect(() => { if (user) load(); }, [user, load]);

  const deleteTemplate = async (id: string, name: string) => {
    if (!window.confirm(`למחוק את התבנית "${name}"? פעולה זו אינה הפיכה.`)) return;
    setErr(null);
    try {
      const res = await api(`/api/admin/templates/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch { setErr("מחיקה נכשלה"); }
  };

  const upload = async (file: File) => {
    setUploading(true); setErr(null);
    try {
      const buf = await file.arrayBuffer();
      const pdf = await loadPdf(buf.slice(0));
      const pageCount = pdf.numPages;
      const sign = await (await api("/api/admin/templates", { method: "POST", body: JSON.stringify({ action: "sign-upload" }) })).json();
      const up = await fetch(sign.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: file });
      if (!up.ok) throw new Error("העלאה נכשלה");
      const name = file.name.replace(/\.pdf$/i, "");
      await api("/api/admin/templates", { method: "POST", body: JSON.stringify({ action: "create", id: sign.id, name, storagePath: sign.storagePath, pageCount }) });
      window.location.href = `/admin/templates/${sign.id}`;
    } catch (e) { setErr(`שגיאה בהעלאה — ${(e as Error).message}`); setUploading(false); }
  };

  if (!ready) return <main className="pcf-wrap"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return (
    <main className="pcf-wrap">
      <header className="pcf-hero"><span className="pcf-badge">ניהול • פאוור קאפל</span><h1>כניסת מנהלים</h1></header>
      <div className="pcf-card pcf-login"><button className="pcf-btn white" onClick={login}>התחברות עם Google</button></div>
    </main>
  );
  if (denied) return <main className="pcf-wrap"><div className="pcf-card" style={{ textAlign: "center" }}><p>אין הרשאת גישה ({user.email}).</p><button className="pcf-btn ghost" onClick={logout} style={{ marginTop: 14 }}>התנתקות</button></div></main>;

  return (
    <main className="pcf-wrap">
      <div className="pcf-admin-top">
        <div>
          <Link href="/admin" className="pcf-link-btn">→ דשבורד</Link>
          <h1 style={{ fontSize: 26, margin: "10px 0 0" }}>תבניות הסכם</h1>
        </div>
        <label className="pcf-btn" style={{ cursor: "pointer" }}>
          {uploading ? <span className="pcf-spin" /> : "+ העלאת תבנית PDF"}
          <input type="file" accept="application/pdf" style={{ display: "none" }} disabled={uploading}
            onChange={(e) => { if (e.target.files?.[0]) upload(e.target.files[0]); e.target.value = ""; }} />
        </label>
      </div>

      {err && <div className="pcf-err">{err}</div>}
      {loading && <div className="pcf-spin" style={{ margin: "30px auto" }} />}

      <div className="pcf-card" style={{ marginTop: 20, padding: 0, overflow: "hidden" }}>
        <table className="pcf-table">
          <thead><tr><th>שם התבנית</th><th>עמודים</th><th>שדות</th><th>חותמים</th><th></th></tr></thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td onClick={() => (window.location.href = `/admin/templates/${t.id}`)} style={{ cursor: "pointer" }}><b>{t.name}</b></td>
                <td>{t.pageCount}</td>
                <td>{t.fields?.length || 0}</td>
                <td>{t.signerCount || 1}</td>
                <td style={{ textAlign: "left", whiteSpace: "nowrap" }}>
                  <a className="pcf-btn ghost" href={`/admin/templates/${t.id}`} style={{ padding: "6px 12px", fontSize: 13 }}>✏️ עריכה</a>
                  <a className="pcf-btn" href={`/admin/templates/${t.id}/send`} style={{ padding: "6px 14px", fontSize: 13, marginInlineStart: 8 }}>🔗 שלח לחתימה</a>
                  <button title="מחיקת תבנית" onClick={() => deleteTemplate(t.id, t.name)} style={{ marginInlineStart: 8, background: "none", border: "1px solid var(--line)", color: "#ff8585", borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>✕</button>
                </td>
              </tr>
            ))}
            {templates.length === 0 && !loading && <tr><td colSpan={5} style={{ textAlign: "center", padding: 30, color: "var(--muted)" }}>אין תבניות עדיין — העלה PDF כדי להתחיל</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
