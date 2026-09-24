"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { onAuthStateChanged, firebaseAuth } from "@/lib/authClient";

const OTHER_PREFIXES = ["/admin/contacts", "/admin/cycles", "/admin/enrollments", "/admin/settings"];

const TABS = [
  { href: "/admin", label: "לידים", icon: "🎯", countKey: "leads", match: (p: string) => p === "/admin" || (p.startsWith("/admin/leads") ?? false) || (!OTHER_PREFIXES.some((pre) => p.startsWith(pre)) && p.startsWith("/admin/") && !p.startsWith("/admin/contacts") && !p.startsWith("/admin/cycles") && !p.startsWith("/admin/enrollments") && !p.startsWith("/admin/settings")) },
  { href: "/admin/contacts", label: "אנשי קשר", icon: "👤", countKey: "contacts", match: (p: string) => p.startsWith("/admin/contacts") },
  { href: "/admin/cycles", label: "מחזורים", icon: "📅", countKey: "cycles", match: (p: string) => p.startsWith("/admin/cycles") },
  { href: "/admin/enrollments", label: "רשומים", icon: "🎓", countKey: "enrollments", match: (p: string) => p.startsWith("/admin/enrollments") },
  { href: "/admin/settings", label: "הגדרות", icon: "⚙️", countKey: "", match: (p: string) => p.startsWith("/admin/settings") },
];

export default function AdminNav() {
  const pathname = usePathname() || "/admin";
  const [counts, setCounts] = useState<Record<string, number>>({});

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
      {TABS.map((t) => {
        const active = t.match(pathname);
        const c = t.countKey ? counts[t.countKey] : undefined;
        return (
          <Link key={t.href} href={t.href} className={`pcf-topnav-item${active ? " active" : ""}`}>
            <span>{t.icon}</span> {t.label}{c != null ? ` (${c})` : ""}
          </Link>
        );
      })}
    </nav>
  );
}
