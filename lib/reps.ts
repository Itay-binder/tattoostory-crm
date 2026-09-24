// נציגי המערכת (האדמינים) — לשיוך לידים. client-safe.

export interface Rep {
  email: string;
  name: string;
  initials: string;
  color: string;
}

export const REPS: Rep[] = [
  { email: "assaf@powercouple.co.il", name: "אסף אליאסי", initials: "אא", color: "#3b82f6" },
  { email: "regev@powercouple.co.il", name: "רגב", initials: "רפ", color: "#22c55e" },
  { email: "itay@binder.co.il", name: "איתי בינדר", initials: "אב", color: "#f59e0b" },
  { email: "blog@powercouple.co.il", name: "בלוג פאוור", initials: "בפ", color: "#a855f7" },
  { email: "katia@powercouple.co.il", name: "קטרינה", initials: "קס", color: "#14b8a6" },
];

export function repByEmail(email?: string | null): Rep | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return REPS.find((r) => r.email === e) || null;
}

/**
 * נרמול טלפון לחיפוש רחב — מחזיר את "הגרעין" הלאומי (בלי 0 / 972 / +).
 * כך חיפוש של 0526660006, 972526660006, +972-52-666-0006 או 526660006
 * ימצא את אותה רשומה.
 */
export function phoneCore(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("972")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return d;
}
