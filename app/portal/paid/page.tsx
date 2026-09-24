"use client";

import { useEffect, useState } from "react";

// דף שאליו CardCom מפנה אחרי הסליקה (בתוך ה-iframe או בטאב נפרד).
// מאמת את התשלום מול השרת לפי הקוד שקארדקום הוסיף ל-URL, ואז מאותת/מפנה.
export default function PaidPage() {
  const [msg, setMsg] = useState("מאמת תשלום…");
  useEffect(() => {
    (async () => {
      const q = new URLSearchParams(window.location.search);
      const failed = q.get("failed");
      const lpId = q.get("lowprofilecode") || q.get("LowProfileCode") || q.get("LowProfileId") || q.get("lpid") || "";
      const inFrame = window.parent && window.parent !== window;

      if (failed) {
        if (inFrame) { try { window.parent.postMessage({ type: "pc-pay-failed" }, "*"); } catch { /* */ } }
        else window.location.replace("/portal?paidfail=1");
        return;
      }

      // אימות + סימון בשרת (idempotent מול ה-webhook)
      if (lpId) {
        try { await fetch("/api/portal/pay/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lowProfileId: lpId }) }); } catch { /* */ }
      }

      if (inFrame) { try { window.parent.postMessage({ type: "pc-paid", lpId }, "*"); } catch { /* */ } setMsg("התקבל! סוגר…"); }
      else window.location.replace("/portal?justpaid=1");
    })();
  }, []);

  return (
    <main style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", direction: "rtl", fontFamily: "inherit", color: "var(--text)" }}>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 40, marginBottom: 10 }}>✅</div><p style={{ fontSize: 16 }}>{msg}</p></div>
    </main>
  );
}
