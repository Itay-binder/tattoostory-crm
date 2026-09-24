"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { onAuthStateChanged, firebaseAuth } from "@/lib/authClient";

const TABS = [
  { href: "/admin/dashboard", label: "דשבורד", icon: "📊", countKey: "", match: (p: string) => p.startsWith("/admin/dashboard") },
  { href: "/admin", label: "לידים", icon: "🎯", countKey: "leads", match: (p: string) => p === "/admin" || (p.startsWith("/admin/leads") && !p.startsWith("/admin/meetings") && !p.startsWith("/admin/customers") && !p.startsWith("/admin/settings") && !p.startsWith("/admin/dashboard") && !p.startsWith("/admin/whatsapp")) },
  { href: "/admin/meetings", label: "פגישות התאמה", icon: "📆", countKey: "meetings", match: (p: string) => p.startsWith("/admin/meetings") },
  { href: "/admin/customers", label: "לקוחות", icon: "👤", countKey: "customers", match: (p: string) => p.startsWith("/admin/customers") },
  { href: "/admin/whatsapp", label: "ווצאפ", icon: "💬", countKey: "", match: (p: string) => p.startsWith("/admin/whatsapp") },
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
      <div className="pcf-topnav-logo">
        <img
          src="https://tattoostoryacademy.com/wp-content/uploads/2025/03/black_logo.png"
          alt="Tattoo Story Academy"
          style={{ height: 32, objectFit: "contain", filter: "brightness(0) invert(1)" }}
        />
      </div>
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
