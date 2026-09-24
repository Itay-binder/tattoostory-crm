import { NextResponse } from "next/server";
import { supa } from "@/lib/supabaseAdmin";
import { verifyAdmin } from "@/lib/admin";
import { createManualClient } from "@/lib/clientShell";

export const runtime = "nodejs";
export const maxDuration = 120;

// יצירת חשבון לקוח (+תיקיית דרייב) מתוך הסכם קיים, ושיוך ההסכם אליו
export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const { envelopeId } = await req.json();
  if (!envelopeId) return NextResponse.json({ error: "missing envelopeId" }, { status: 400 });

  const { data: env } = await supa().from("contract_envelopes").select("primary_client_id").eq("id", envelopeId).maybeSingle();
  if (!env) return NextResponse.json({ error: "not found" }, { status: 404 });
  if ((env as { primary_client_id?: string }).primary_client_id) return NextResponse.json({ error: "ההסכם כבר משויך ללקוח" }, { status: 400 });

  const { data: signers } = await supa().from("contract_signers").select("signer_index,role,name,contact").eq("envelope_id", envelopeId).order("signer_index", { ascending: true });
  const rows = (signers as { signer_index: number; role: string; name: string; contact?: string }[]) || [];
  const primary = rows.find((s) => s.role !== "sender") || rows[0];
  if (!primary) return NextResponse.json({ error: "אין חותם" }, { status: 400 });

  const created = await createManualClient(primary.name, primary.contact);

  await supa().from("contract_signers").update({ client_id: created.id }).eq("envelope_id", envelopeId).eq("signer_index", primary.signer_index);
  await supa().from("contract_envelopes").update({ primary_client_id: created.id }).eq("id", envelopeId);

  return NextResponse.json({ ok: true, clientUid: created.id, name: primary.name, driveFolderLink: created.driveFolderLink });
}
