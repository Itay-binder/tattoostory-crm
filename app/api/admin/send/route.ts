import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";
import { createManualClient } from "@/lib/clientShell";
import { getClientById } from "@/lib/clientsRepo";
import { CLIENT_DATA_KEYS, type ContractField } from "@/lib/contracts";

export const maxDuration = 120;
export const runtime = "nodejs";

function token(): string {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 8);
}

interface SignerInput { role: string; name: string; contact?: string; clientUid?: string; createClient?: boolean; order?: number; optional?: boolean; }

export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const body = await req.json();
  const { templateId, senderValues = {}, clientDataOverrides = {}, signers } = body as { templateId: string; senderValues: Record<string, string>; clientDataOverrides: Record<string, string>; signers: SignerInput[] };
  if (!templateId || !Array.isArray(signers) || signers.length === 0) {
    return NextResponse.json({ error: "missing template or signers" }, { status: 400 });
  }

  const { data: template } = await supa().from("contract_templates").select("*").eq("id", templateId).maybeSingle();
  if (!template) return NextResponse.json({ error: "template not found" }, { status: 404 });
  const t = template as Record<string, unknown>;

  // לקוח ידני לחותמים שסומנו (ולא משויכים)
  for (const s of signers) {
    if (s.createClient && !s.clientUid && s.name?.trim()) {
      const created = await createManualClient(s.name, s.contact);
      s.clientUid = created.id;
    }
  }

  // auto-fill מנתוני הלקוח של החותם הראשון המשויך
  const clientData: Record<string, string> = {};
  const primary = signers.find((s) => s.clientUid);
  let primaryClientUid: string | undefined;
  if (primary?.clientUid) {
    primaryClientUid = primary.clientUid;
    const c = await getClientById(primary.clientUid);
    const answers = (c?.answers || {}) as Record<string, string>;
    for (const k of CLIENT_DATA_KEYS) if (answers[k.key]) clientData[k.key] = answers[k.key];
  }
  for (const [k, v] of Object.entries(clientDataOverrides)) {
    if (typeof v === "string" && v.trim()) clientData[k] = v.slice(0, 2000);
  }

  const envelopeId = randomUUID();
  const fields = (t.fields || []) as ContractField[];
  const hasSenderSignature = fields.some((f) => f.source === "sender" && f.type === "signature");

  const signerRecords = signers.map((s, i) => ({
    index: i, role: s.role, name: String(s.name || "").slice(0, 120),
    contact: s.contact ? String(s.contact).slice(0, 120) : "", clientUid: s.clientUid || null,
    order: typeof s.order === "number" ? s.order : i + 1, optional: !!s.optional, token: token(),
  }));
  if (hasSenderSignature) {
    signerRecords.push({ index: signerRecords.length, role: "sender", name: "השולח (פאוור קאפל)", contact: "", clientUid: null, order: 99, optional: false, token: token() });
  }

  const { error: envErr } = await supa().from("contract_envelopes").insert({
    id: envelopeId, template_id: templateId, template_name: t.name, storage_path: t.storage_path,
    page_count: t.page_count, signer_count: t.signer_count || 1, fields,
    sender_values: senderValues || {}, client_data: clientData, primary_client_id: primaryClientUid || null,
    status: "sent", created_at: new Date().toISOString(), created_by: admin.email,
  });
  if (envErr) return NextResponse.json({ error: envErr.message }, { status: 500 });

  const { error: sgErr } = await supa().from("contract_signers").insert(
    signerRecords.map((s) => ({
      envelope_id: envelopeId, signer_index: s.index, role: s.role, name: s.name, contact: s.contact,
      client_id: s.clientUid, sign_order: s.order, optional: s.optional, token: s.token, status: "sent",
      values: {}, signature_paths: {},
    }))
  );
  if (sgErr) return NextResponse.json({ error: sgErr.message }, { status: 500 });

  const links = signerRecords.map((s) => ({ role: s.role, name: s.name, order: s.order, optional: s.optional, token: s.token }));
  links.sort((a, b) => a.order - b.order);
  return NextResponse.json({ ok: true, envelopeId, links });
}
