import { supa } from "@/lib/supabaseAdmin";
import { findLeadForClient } from "@/lib/leadsRepo";
import { TRACKED_BANKS, type FinancingBank, type FinancingCase, type FinancingStats } from "@/lib/financing";

const nowIso = () => new Date().toISOString();

interface CaseRow {
  id: string; client_id: string; created_at: string; updated_at: string; submission_amount: string | number | null;
  clients: { id: string; email: string | null; google_name: string | null; stage: string | null; answers: Record<string, string> | null } | null;
  financing_banks?: BankRow[];
}
interface BankRow { id: string; case_id: string; bank_name: string; status: string; note: string | null; created_at: string }

function bankRow(b: BankRow): FinancingBank {
  return { id: b.id, caseId: b.case_id, bankName: b.bank_name, status: (b.status as FinancingBank["status"]) || "review", note: b.note || undefined, createdAt: b.created_at || "" };
}

function rowToCase(r: CaseRow): FinancingCase {
  const c = r.clients;
  const answers = c?.answers || {};
  return {
    id: r.id, clientId: r.client_id,
    clientName: answers.fullName || c?.google_name || c?.email || "לקוח",
    clientPhone: answers.phone || "",
    clientEmail: c?.email || "",
    clientStage: c?.stage || "new",
    submissionAmount: r.submission_amount == null ? undefined : Number(r.submission_amount),
    banks: (r.financing_banks || []).map(bankRow).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    createdAt: r.created_at || "", updatedAt: r.updated_at || "",
  };
}

const SEL = "*, clients(id, email, google_name, stage, answers), financing_banks(*)";

export async function listFinancingCases(): Promise<FinancingCase[]> {
  const { data, error } = await supa().from("financing_cases").select(SEL).order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown as CaseRow[]).map(rowToCase);
}

export async function getFinancingCase(id: string): Promise<FinancingCase | null> {
  const { data, error } = await supa().from("financing_cases").select(SEL).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToCase(data as unknown as CaseRow) : null;
}

export async function getCaseByClient(clientId: string): Promise<FinancingCase | null> {
  const { data } = await supa().from("financing_cases").select(SEL).eq("client_id", clientId).maybeSingle();
  return data ? rowToCase(data as unknown as CaseRow) : null;
}

/** מוסיף לקוח לסקשן מימון (תיק אחד ללקוח — idempotent). */
export async function addClientToFinancing(clientId: string, by: string): Promise<FinancingCase | null> {
  const { data: client } = await supa().from("clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return null;
  const existing = await getCaseByClient(clientId);
  if (existing) return existing;
  const { data, error } = await supa().from("financing_cases").insert({ client_id: clientId, created_by: by }).select("id").single();
  if (error) throw new Error(error.message);
  return getFinancingCase((data as { id: string }).id);
}

const touch = (caseId: string) => supa().from("financing_cases").update({ updated_at: nowIso() }).eq("id", caseId);

/** מוסיף גורם מימון (בנק) לתיק. */
export async function addBank(caseId: string, bankName: string, by: string): Promise<FinancingCase | null> {
  const name = bankName.trim();
  if (!name) throw new Error("חסר שם גורם מימון");
  const { error } = await supa().from("financing_banks").insert({ case_id: caseId, bank_name: name.slice(0, 120), status: "review", created_by: by });
  if (error) throw new Error(error.message);
  await touch(caseId);
  return getFinancingCase(caseId);
}

/** מסיר גורם מימון מהתיק. */
export async function removeBank(caseId: string, bankId: string): Promise<FinancingCase | null> {
  await supa().from("financing_banks").delete().eq("id", bankId).eq("case_id", caseId);
  await touch(caseId);
  return getFinancingCase(caseId);
}

/** מעדכן סטטוס של גורם מימון. */
export async function setBankStatus(caseId: string, bankId: string, status: string, by: string): Promise<FinancingCase | null> {
  void by;
  await supa().from("financing_banks").update({ status, updated_at: nowIso() }).eq("id", bankId).eq("case_id", caseId);
  await touch(caseId);
  return getFinancingCase(caseId);
}

/** מעדכן סכום הגשה לתיק. */
export async function setSubmissionAmount(caseId: string, amount: number | null): Promise<FinancingCase | null> {
  await supa().from("financing_cases").update({ submission_amount: amount, updated_at: nowIso() }).eq("id", caseId);
  return getFinancingCase(caseId);
}

/** פריט תיעוד מאוחד — מכל המקומות (ליד / לקוח / עסקה / מימון). */
export interface UnifiedDoc {
  id: string; origin: "lead" | "client" | "deal" | "financing";
  type: string; at: string; by: string; text: string;
}

/**
 * כל התיעוד על הלקוח ממקום אחד: הערות פנימיות (לקוח), פעילות הליד המקושר
 * (כולל ייבוא/קליטה/הערות), ופעילות העסקאות שהוא משובץ בהן. ממוין מהחדש לישן.
 */
export async function unifiedClientDocs(clientId: string): Promise<UnifiedDoc[]> {
  const docs: UnifiedDoc[] = [];

  // 1) הערות פנימיות של הלקוח (admin_notes) — כולל תיעודי מימון
  const { data: notes } = await supa().from("admin_notes").select("*").eq("client_id", clientId);
  for (const n of (notes as Record<string, unknown>[]) || []) {
    const text = (n.text as string) || "";
    docs.push({
      id: `an-${n.id}`, origin: /\[מימון\]/.test(text) ? "financing" : "client",
      type: "note", at: (n.created_at as string) || "", by: (n.author_name as string) || "", text,
    });
  }

  // הליד המקושר (מקור התיעוד המרכזי)
  const { data: cl } = await supa().from("clients").select("from_lead_id, email, answers").eq("id", clientId).maybeSingle();
  const c = cl as { from_lead_id: string | null; email: string | null; answers: Record<string, string> | null } | null;
  const lead = await findLeadForClient({ fromLeadId: c?.from_lead_id || undefined, email: c?.email || c?.answers?.email, phone: c?.answers?.phone });

  // 2) פעילות הליד
  if (lead) {
    const { data: la } = await supa().from("lead_activity").select("*").eq("lead_id", lead.id);
    for (const a of (la as Record<string, unknown>[]) || []) {
      docs.push({
        id: `la-${a.id}`, origin: (a.source as string) === "financing" ? "financing" : "lead",
        type: (a.type as string) || "note", at: (a.at as string) || "", by: (a.by_actor as string) || "", text: (a.text as string) || "",
      });
    }

    // 3) פעילות עסקאות שהלקוח משובץ בהן
    const { data: dc } = await supa().from("deal_clients").select("deal_id").eq("client_id", clientId);
    const dealIds = ((dc as { deal_id: string }[]) || []).map((x) => x.deal_id);
    if (dealIds.length) {
      const { data: da } = await supa().from("deal_activity").select("*, deals(title)").in("deal_id", dealIds);
      for (const a of (da as Record<string, unknown>[]) || []) {
        const dealTitle = ((a.deals as { title?: string } | null)?.title) || "עסקה";
        docs.push({
          id: `da-${a.id}`, origin: "deal", type: (a.type as string) || "note",
          at: (a.at as string) || "", by: (a.by_actor as string) || "", text: `[${dealTitle}] ${(a.text as string) || ""}`,
        });
      }
    }
  }

  return docs.filter((d) => d.text.trim()).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** מוסיף תיעוד מימון שמסתנכרן לכל המקומות — נכתב לפעילות הליד המקושר (המרכז),
 *  ואם אין ליד — להערות הלקוח. מסומן source='financing' + [מימון] בטקסט. */
export async function addFinancingNote(clientId: string, text: string, by: { email: string; name: string }): Promise<void> {
  const clean = `💰 [מימון] ${text}`.slice(0, 5000);
  const { data: cl } = await supa().from("clients").select("from_lead_id, email, answers").eq("id", clientId).maybeSingle();
  const c = cl as { from_lead_id: string | null; email: string | null; answers: Record<string, string> | null } | null;
  const lead = await findLeadForClient({ fromLeadId: c?.from_lead_id || undefined, email: c?.email || c?.answers?.email, phone: c?.answers?.phone });
  if (lead) {
    await supa().from("lead_activity").insert({ lead_id: lead.id, type: "note", at: nowIso(), source: "financing", by_actor: by.name || by.email, text: clean });
  } else {
    await supa().from("admin_notes").insert({ client_id: clientId, text: clean, author_email: by.email, author_name: by.name || by.email });
  }
}

/** סטטיסטיקות למסך הראשי. */
export async function financingStats(): Promise<FinancingStats> {
  const cases = await listFinancingCases();
  const stats: FinancingStats = { cases: cases.length, adiYahav: 0, hagitDiscount: 0, liatYahav: 0, otherBank: 0, waitingApproval: 0, approved: 0 };
  for (const cs of cases) {
    for (const b of cs.banks) {
      if (b.bankName.includes("עדי יהב")) stats.adiYahav++;
      else if (b.bankName.includes("חגית")) stats.hagitDiscount++;
      else if (b.bankName.includes("ליאת יהב")) stats.liatYahav++;
      else if (!TRACKED_BANKS.some((t) => b.bankName.includes(t))) stats.otherBank++;
      if (b.status === "review") stats.waitingApproval++;
      if (b.status === "approved") stats.approved++;
    }
  }
  return stats;
}
