import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";
import { SECTIONS } from "@/lib/formSchema";

export const runtime = "nodejs";

const FIELD_COUNT = SECTIONS.reduce((n, s) => n + s.fields.length, 0);

export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const [clientsRes, filesRes, envRes, signersRes] = await Promise.all([
    supa().from("clients").select("*"),
    supa().from("client_files").select("client_id"),
    supa().from("contract_envelopes").select("id, primary_client_id, status"),
    supa().from("contract_signers").select("envelope_id, client_id, status"),
  ]);

  const filesByClient: Record<string, number> = {};
  for (const f of (filesRes.data as { client_id: string }[]) || []) filesByClient[f.client_id] = (filesByClient[f.client_id] || 0) + 1;

  // "קליטה כלקוח" — התאריך האמיתי שבו נכנס למערכת, נלקח מהליד המקושר.
  // לקוחות שמוזגו/יובאו במכה (GHL/Pipedrive) קיבלו created_at של זמן המיזוג —
  // אבל הליד המקושר מחזיק את התאריך האמיתי (Pipedrive היסטורי / כניסת הליד).
  const fromLeadIds = [...new Set(((clientsRes.data as Record<string, unknown>[]) || []).map((d) => d.from_lead_id as string).filter(Boolean))];
  const leadCreated: Record<string, string> = {};
  for (let i = 0; i < fromLeadIds.length; i += 300) {
    const { data: ld } = await supa().from("leads").select("id, created_at").in("id", fromLeadIds.slice(i, i + 300));
    for (const l of (ld as { id: string; created_at: string }[]) || []) leadCreated[l.id] = l.created_at;
  }

  // סטטוס הסכם לכל לקוח
  const signersByEnv: Record<string, { client_id: string | null; status: string }[]> = {};
  for (const s of (signersRes.data as { envelope_id: string; client_id: string | null; status: string }[]) || []) {
    (signersByEnv[s.envelope_id] ||= []).push(s);
  }
  const rank: Record<string, number> = { "הופק הסכם": 1, "ממתין לחתימות": 2, "נחתם": 3 };
  const contractMap: Record<string, string> = {};
  const bump = (uid: string | null | undefined, status: string) => {
    if (!uid) return;
    if (!contractMap[uid] || rank[status] > rank[contractMap[uid]]) contractMap[uid] = status;
  };
  for (const e of (envRes.data as { id: string; primary_client_id: string | null; status: string }[]) || []) {
    const signers = signersByEnv[e.id] || [];
    let status: string;
    if (e.status === "signed") status = "נחתם";
    else if (signers.some((s) => s.status === "opened" || s.status === "signed")) status = "ממתין לחתימות";
    else status = "הופק הסכם";
    bump(e.primary_client_id, status);
    signers.forEach((s) => bump(s.client_id, status));
  }

  const clients = ((clientsRes.data as Record<string, unknown>[]) || []).map((d) => {
    const answers = (d.answers as Record<string, string>) || {};
    const answered = Object.values(answers).filter((v) => typeof v === "string" && v.trim()).length;
    const id = d.id as string;
    return {
      uid: id,
      fullName: answers.fullName || "",
      email: (d.email as string) || "",
      phone: answers.phone || "",
      idNumber: answers.idNumber || "",
      status: (d.status as string) || "draft",
      stage: (d.stage as string) || "new",
      contractStatus: contractMap[id] || "טרם הופק הסכם",
      filesCount: filesByClient[id] || 0,
      answeredCount: answered,
      totalFields: FIELD_COUNT,
      updatedAt: (d.updated_at as string) || "",
      submittedAt: (d.submitted_at as string) || "",
      // התאריך האמיתי: הליד המקושר קודם (לא מזמן המיזוג), אחרת המרה, אחרת יצירה.
      clientSince: leadCreated[d.from_lead_id as string] || (d.converted_at as string) || (d.created_at as string) || "",
      pace: (d.pace as string) || "", paceUpdatedAt: (d.pace_updated_at as string) || "",
      driveFolderLink: (d.drive_folder_link as string) || "",
    };
  });

  clients.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  const stats = {
    total: clients.length,
    submitted: clients.filter((c) => c.status === "submitted").length,
    drafts: clients.filter((c) => c.status !== "submitted").length,
    totalFiles: clients.reduce((n, c) => n + c.filesCount, 0),
  };

  return NextResponse.json({ stats, clients });
}
