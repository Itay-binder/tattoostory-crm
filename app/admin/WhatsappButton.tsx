"use client";

import { normalizeIsraeliPhone } from "@/lib/leads";

/**
 * כפתור ווצאפ לליד/לקוחה. לחיצה פותחת שיחה עם המספר הספציפי בטאב חדש
 * (wa.me — נפתח באפליקציה במובייל וב-WhatsApp Web בדסקטופ).
 * מופיע בטבלאות ובכרטיסים, ולכן עוצר את ה-click של השורה.
 */
export default function WhatsappButton({ phone, name, size = 28 }: { phone?: string | null; name?: string; size?: number }) {
  const num = normalizeIsraeliPhone(phone || "");
  if (num.length < 11) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <a
      href={`https://wa.me/${num}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`ווצאפ ל${name || num}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: size, height: size, borderRadius: "50%", background: "var(--green)",
        color: "#fff", textDecoration: "none", flexShrink: 0,
      }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="currentColor" aria-hidden="true">
        <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.95 1.16-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.19-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.46 0 1.45 1.06 2.85 1.21 3.05.15.2 2.09 3.19 5.06 4.36.71.3 1.26.48 1.69.62.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.28.17-1.41-.07-.12-.27-.2-.57-.35z"/>
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38c1.45.79 3.08 1.21 4.75 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.92 6.45 17.5 2 12.04 2zm0 18.13h-.01c-1.49 0-2.95-.4-4.22-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.36c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.82 2.41a8.17 8.17 0 0 1 2.41 5.83c0 4.54-3.7 8.21-8.2 8.21z"/>
      </svg>
    </a>
  );
}
