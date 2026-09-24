"use client";

// מציג טקסט תיעוד. כל קישור (למשל הקלטת שיחה מ-PhoneCRM) יוצא לשורה נפרדת
// בתוך מסגרת, לחיץ, עם כפתור פתיחה בטאב חדש — כדי שיהיה נוח להעתיק ולפתוח.
const URL_RE = /(https?:\/\/[^\s]+)/g;
const isUrl = (s: string) => /^https?:\/\//i.test(s);

function LinkBox({ url }: { url: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginTop: 6, padding: "8px 12px", border: "1px solid var(--line)", borderRadius: 10, background: "var(--bg-2)" }}>
      <a href={url} target="_blank" rel="noopener noreferrer" dir="ltr" style={{ color: "var(--accent)", fontSize: 13, wordBreak: "break-all", flex: 1, minWidth: 0 }}>{url}</a>
      <a href={url} target="_blank" rel="noopener noreferrer" className="pcf-btn ghost" style={{ padding: "6px 12px", fontSize: 13, whiteSpace: "nowrap" }}>▶ פתח בטאב חדש</a>
    </div>
  );
}

export default function ActivityText({ text, fontSize = 15 }: { text: string; fontSize?: number }) {
  const parts = text.split(URL_RE);
  return (
    <div>
      {parts.map((part, i) => {
        if (!part) return null;
        if (isUrl(part)) return <LinkBox key={i} url={part} />;
        return <span key={i} style={{ whiteSpace: "pre-wrap", fontSize, lineHeight: 1.5 }}>{part}</span>;
      })}
    </div>
  );
}
