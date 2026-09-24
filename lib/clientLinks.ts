import { supa } from "@/lib/supabaseAdmin";

export interface LinkedClient {
  uid: string;
  fullName: string;
  email: string;
  phone: string;
  stage: string;
  relation?: string;
}

interface ClientRowLite {
  id: string; email: string | null; google_name: string | null;
  stage: string | null; answers: Record<string, string> | null;
}

function nameOf(c: ClientRowLite): string {
  return c.answers?.fullName || c.google_name || c.email || "לקוח";
}

/** מחזיר את הלקוחות המקושרים ללקוח נתון (זוג/שותפים). */
export async function listLinkedClients(uid: string): Promise<LinkedClient[]> {
  const { data: links } = await supa()
    .from("client_links")
    .select("linked_client_id, relation")
    .eq("client_id", uid);
  const rows = (links as { linked_client_id: string; relation: string | null }[]) || [];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.linked_client_id);
  const { data: clients } = await supa()
    .from("clients").select("id, email, google_name, stage, answers").in("id", ids);
  const byId = new Map((clients as ClientRowLite[] || []).map((c) => [c.id, c]));
  return rows.map((r) => {
    const c = byId.get(r.linked_client_id);
    return {
      uid: r.linked_client_id,
      fullName: c ? nameOf(c) : "לקוח",
      email: c?.email || "",
      phone: c?.answers?.phone || "",
      stage: c?.stage || "new",
      relation: r.relation || undefined,
    };
  });
}

/** מקשר שני לקוחות זה לזה (סימטרי). מתעלם אם זהים או כבר מקושרים. */
export async function linkClients(a: string, b: string, by: string, relation?: string): Promise<void> {
  if (!a || !b || a === b) throw new Error("צריך שני לקוחות שונים");
  const rel = relation?.trim() || null;
  await supa().from("client_links").upsert([
    { client_id: a, linked_client_id: b, relation: rel, created_by: by },
    { client_id: b, linked_client_id: a, relation: rel, created_by: by },
  ], { onConflict: "client_id,linked_client_id" });
}

/** מנתק קישור בין שני לקוחות (שני הכיוונים). */
export async function unlinkClients(a: string, b: string): Promise<void> {
  await supa().from("client_links").delete().eq("client_id", a).eq("linked_client_id", b);
  await supa().from("client_links").delete().eq("client_id", b).eq("linked_client_id", a);
}
