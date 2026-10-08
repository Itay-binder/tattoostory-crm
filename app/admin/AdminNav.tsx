"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { onAuthStateChanged, firebaseAuth } from "@/lib/authClient";
import ThemeToggle from "./ThemeToggle";

const OTHER_PREFIXES = ["/admin/leads", "/admin/matching", "/admin/dashboard", "/admin/performance", "/admin/settings", "/admin/templates", "/admin/manychat", "/admin/whatsapp"];
const TABS = [
  { href: "/admin/dashboard", label: "דשבורד", icon: "📊", countKey: "", match: (p: string) => p.startsWith("/admin/dashboard") },
  { href: "/admin/leads", label: "לידים", icon: "🎯", countKey: "leads", match: (p: string) => p.startsWith("/admin/leads") },
  { href: "/admin/matching", label: "פגישות התאמה", icon: "🧭", countKey: "matching", match: (p: string) => p.startsWith("/admin/matching") },
  { href: "/admin", label: "לקוחות", icon: "👥", countKey: "clients", match: (p: string) => p === "/admin" || (p.startsWith("/admin/") && !OTHER_PREFIXES.some((pre) => p.startsWith(pre))) },
  { href: "/admin/manychat", label: "מאניצ'אט", icon: "💬", countKey: "", match: (p: string) => p.startsWith("/admin/manychat") },
  { href: "/admin/whatsapp", label: "ווצאפ", icon: "🟢", countKey: "", match: (p: string) => p.startsWith("/admin/whatsapp") },
  { href: "/admin/settings", label: "הגדרות", icon: "⚙️", countKey: "", match: (p: string) => p.startsWith("/admin/settings") },
];

export default function AdminNav() {
  const pathname = usePathname() || "/admin";
  const [counts, setCounts] = useState<{ leads?: number; clients?: number; matching?: number }>({});

  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth(), async (u) => {
      if (!u) return;
      try {
        const t = await u.getIdToken();
        const res = await fetch("/api/admin/counts", { headers: { Authorization: `Bearer ${t}` } });
        if (res.ok) setCounts(await res.json());
      } catch { /* ignore */ }
    });
    return () => unsub();
  }, []);

  return (
    <nav className="pcf-topnav">
      <div className="pcf-topnav-logo">
        <img src="https://tattoostoryacademy.com/wp-content/uploads/2025/03/black_logo.png" alt="Tattoo Story Academy" />
      </div>
      {TABS.map((t) => {
        const active = t.match(pathname);
        const c = t.countKey ? (counts as Record<string, number | undefined>)[t.countKey] : undefined;
        return (
          <Link key={t.href} href={t.href} className={`pcf-topnav-item${active ? " active" : ""}`}>
            <span>{t.icon}</span> {t.label}{c != null ? ` (${c})` : ""}
          </Link>
        );
      })}
      <ThemeToggle />
    </nav>
  );
}
