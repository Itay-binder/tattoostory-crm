"use client";
import { useEffect, useState } from "react";
import { onAuthStateChanged, firebaseAuth, type User } from "@/lib/authClient";
import AdminNav from "../AdminNav";

export default function CustomersPage() {
  const [user, setUser] = useState<User | null>(null);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => setUser(u)), []);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    user.getIdToken().then(t =>
      fetch("/api/admin/customers", { headers: { Authorization: `Bearer ${t}` } })
        .then(r => r.json())
        .then(d => setCustomers(d.customers || []))
        .finally(() => setLoading(false))
    );
  }, [user]);

  return (
    <main className="pcf-wrap pcf-wide">
      <AdminNav />
      <div className="pcf-admin-top">
        <div>
          <span className="pcf-badge">Tattoo Story Academy</span>
          <h1 style={{ fontSize: 26, margin: "10px 0 0", fontWeight: 800 }}>לקוחות</h1>
        </div>
      </div>
      {loading && <div className="pcf-spin" style={{ margin: "40px auto" }} />}
      {!loading && customers.length === 0 && (
        <div className="pcf-card" style={{ marginTop: 20, textAlign: "center", padding: "60px 20px" }}>
          <p style={{ fontSize: 16, color: "var(--muted)" }}>👤 אין לקוחות רשומים עדיין</p>
        </div>
      )}
      {!loading && customers.length > 0 && (
        <div className="pcf-card" style={{ marginTop: 20, padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table className="pcf-table">
              <thead>
                <tr>
                  <th>שם</th>
                  <th>טלפון</th>
                  <th>מייל</th>
                  <th>מחזור</th>
                  <th>סטטוס</th>
                  <th>נרשם</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c: any) => (
                  <tr key={c.id}>
                    <td><b>{c.first_name} {c.last_name}</b></td>
                    <td>{c.phone || "—"}</td>
                    <td>{c.email || "—"}</td>
                    <td>{c.cycle_name || "—"}</td>
                    <td>{c.enrollment_status || "—"}</td>
                    <td>{c.enrolled_at ? new Date(c.enrolled_at).toLocaleDateString("he-IL") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
