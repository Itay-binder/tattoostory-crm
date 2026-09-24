/** ערכי env — עלולים לכלול תווי שורה נגררים (הוזנו דרך CLI). */
export function env(name: string): string {
  return (process.env[name] || "").trim();
}

// שם היסטורי לאוסף הלקוחות (Firestore). ב-Supabase = טבלת clients.
export const FORMS_COLLECTION = "clients";
