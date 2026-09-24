// שם היסטורי — עכשיו אימות מבוסס Supabase (לא Firebase). נשמר השם כדי לא לשבור ייבואים.
import { supa } from "@/lib/supabaseAdmin";

export { env, FORMS_COLLECTION } from "@/lib/env";

/** מאמת Bearer token של Supabase ומחזיר את המשתמש, או null. */
export async function verifyRequest(req: Request): Promise<{ uid: string; email: string; name: string } | null> {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  try {
    const { data, error } = await supa().auth.getUser(match[1]);
    if (error || !data.user) return null;
    const u = data.user;
    const meta = (u.user_metadata || {}) as Record<string, unknown>;
    const name = (meta.full_name as string) || (meta.name as string) || "";
    return { uid: u.id, email: u.email || "", name };
  } catch {
    return null;
  }
}
