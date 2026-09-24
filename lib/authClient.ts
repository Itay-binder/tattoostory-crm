"use client";

// שכבת התחברות מבוססת Supabase עם API תואם ל-Firebase Auth,
// כדי שהדפים הקיימים ישתנו במינימום. התחברות גוגל = redirect (לא popup).
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";

let _supa: SupabaseClient | null = null;
function supa(): SupabaseClient {
  if (!_supa) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    _supa = createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  }
  return _supa;
}

export interface User {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  getIdToken(): Promise<string>;
}

function toUser(session: Session | null): User | null {
  if (!session?.user) return null;
  const u = session.user;
  const meta = (u.user_metadata || {}) as Record<string, string>;
  return {
    uid: u.id,
    email: u.email || "",
    displayName: meta.full_name || meta.name || u.email || "",
    photoURL: meta.avatar_url || meta.picture || "",
    getIdToken: async () => {
      const { data } = await supa().auth.getSession();
      return data.session?.access_token || "";
    },
  };
}

let _current: User | null = null;

export function firebaseAuth() {
  return {
    get currentUser(): User | null { return _current; },
  };
}

export const googleProvider = {};
export const browserLocalPersistence = {};
export async function setPersistence(_auth?: unknown, _persistence?: unknown): Promise<void> { /* no-op — Supabase persists ב-localStorage */ }

export function onAuthStateChanged(_auth: unknown, cb: (u: User | null) => void): () => void {
  supa().auth.getSession().then(({ data }) => { _current = toUser(data.session); cb(_current); });
  const { data: sub } = supa().auth.onAuthStateChange((_e, session) => { _current = toUser(session); cb(_current); });
  return () => sub.subscription.unsubscribe();
}

export async function signInWithPopup(_auth: unknown, _provider: unknown): Promise<void> {
  await supa().auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.href } });
}
export async function signInWithRedirect(_auth: unknown, _provider: unknown): Promise<void> {
  return signInWithPopup(_auth, _provider);
}
export async function getRedirectResult(_auth: unknown): Promise<null> { return null; }

export async function signOut(_auth: unknown): Promise<void> {
  await supa().auth.signOut();
  _current = null;
}
