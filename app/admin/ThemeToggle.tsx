"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, firebaseAuth } from "@/lib/authClient";

type Theme = "dark" | "light";

function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
}

/** מחליף בין ערכה כהה לבהירה. ההעדפה נשמרת ברמת החשבון (ולכן עוברת בין מכשירים). */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  // מצב ראשוני מהדפדפן (מיידי) ואז סנכרון מהשרת (ההעדפה של החשבון)
  useEffect(() => {
    const local = (localStorage.getItem("pcfTheme") as Theme) || "dark";
    setTheme(local);
    applyTheme(local);

    const unsub = onAuthStateChanged(firebaseAuth(), async (u) => {
      if (!u) return;
      try {
        const t = await u.getIdToken();
        const res = await fetch("/api/admin/prefs", { headers: { Authorization: `Bearer ${t}` } });
        if (!res.ok) return;
        const server = ((await res.json()).theme as Theme) || "dark";
        if (server !== local) {
          setTheme(server);
          applyTheme(server);
          localStorage.setItem("pcfTheme", server);
        }
      } catch { /* נשארים עם ההעדפה המקומית */ }
    });
    return () => unsub();
  }, []);

  const toggle = async () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try { localStorage.setItem("pcfTheme", next); } catch { /* */ }
    try {
      const u = firebaseAuth().currentUser;
      if (!u) return;
      const t = await u.getIdToken();
      await fetch("/api/admin/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ theme: next }),
      });
    } catch { /* נשמר מקומית גם אם השרת נכשל */ }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="pcf-topnav-item"
      title={theme === "dark" ? "מעבר לתצוגה בהירה" : "מעבר לתצוגה כהה"}
    >
      <span>{theme === "dark" ? "☀️" : "🌙"}</span> {theme === "dark" ? "בהיר" : "כהה"}
    </button>
  );
}
