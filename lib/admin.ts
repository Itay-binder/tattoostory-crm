import { verifyRequest } from "@/lib/firebaseAdmin";

// אדמינים מורשים לממשק הניהול. להוספת אדמין — הוסיפו אימייל לרשימה.
export const ADMIN_EMAILS = ["blog@powercouple.co.il", "itay@binder.co.il", "assaf@powercouple.co.il", "regev@powercouple.co.il", "katia@powercouple.co.il"];

export function isAdmin(email: string | undefined | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}

/** מאמת שהמבקש מחובר וגם אדמין. מחזיר את המשתמש או null. */
export async function verifyAdmin(req: Request): Promise<{ uid: string; email: string; name: string } | null> {
  const user = await verifyRequest(req);
  if (!user || !isAdmin(user.email)) return null;
  return user;
}
