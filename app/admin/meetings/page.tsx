"use client";
import AdminNav from "../AdminNav";
export default function MeetingsPage() {
  return (
    <main className="pcf-wrap pcf-wide">
      <AdminNav />
      <div className="pcf-admin-top">
        <div>
          <span className="pcf-badge">Tattoo Story Academy</span>
          <h1 style={{ fontSize: 26, margin: "10px 0 0", fontWeight: 800 }}>פגישות התאמה</h1>
        </div>
        <button className="pcf-btn" style={{ padding: "8px 16px", fontSize: 14 }}>+ פגישה חדשה</button>
      </div>
      <div className="pcf-card" style={{ marginTop: 20, textAlign: "center", padding: "60px 20px" }}>
        <p style={{ fontSize: 18, color: "var(--muted)" }}>📆 ניהול פגישות התאמה יהיה זמין בקרוב</p>
        <p style={{ fontSize: 14, color: "var(--muted)", marginTop: 8 }}>הפגישות יקושרו ללידים ויציגו: תאריך, שם הליד, מי קיים, סטטוס פגישה</p>
      </div>
    </main>
  );
}
