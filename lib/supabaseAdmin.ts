import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// לקוח Supabase בצד שרת עם service_role (עוקף RLS). כל הגישה לדאטה עוברת דרכו.
let cached: SupabaseClient | null = null;

export function supa(): SupabaseClient {
  if (!cached) {
    const url = (process.env.SUPABASE_URL || "").trim();
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!url || !key) throw new Error("Supabase env missing (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return cached;
}

/** עוזר: זורק שגיאה אם ל-Supabase יש error, אחרת מחזיר data. */
export function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}
