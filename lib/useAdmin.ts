"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup, setPersistence, browserLocalPersistence, signOut, firebaseAuth, googleProvider, type User } from "@/lib/authClient";

// hook משותף לדפי האדמין: התחברות גוגל + קריאות API עם טוקן
export function useAdmin() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setReady(true); }), []);

  const login = useCallback(async () => {
    await setPersistence(firebaseAuth(), browserLocalPersistence);
    await signInWithPopup(firebaseAuth(), googleProvider);
  }, []);

  const logout = useCallback(() => signOut(firebaseAuth()), []);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const t = await firebaseAuth().currentUser!.getIdToken();
    return fetch(path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}`, ...(init?.headers || {}) } });
  }, []);

  return { user, ready, login, logout, api };
}
