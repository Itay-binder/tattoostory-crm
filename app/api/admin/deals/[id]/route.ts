import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { getDeal, updateDeal, addDealNote, deleteDeal, addDealClient, removeDealClient, addDealPayment, setPaymentStatus, deleteDealPayment, setDealDriveFolder, setChecklistItem, addSigningDay, updateSigningDay, deleteSigningDay } from "@/lib/dealsRepo";
import { parseDriveFolderId } from "@/lib/deals";
import { signedReadUrl } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;
  const deal = await getDeal(id);
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
  let businessPlanFileUrl: string | null = null;
  if (deal.businessPlanFile) { try { businessPlanFileUrl = await signedReadUrl(deal.businessPlanFile, 3600); } catch { /* */ } }
  let saleAgreementFileUrl: string | null = null;
  if (deal.saleAgreementFile) { try { saleAgreementFileUrl = await signedReadUrl(deal.saleAgreementFile, 3600); } catch { /* */ } }
  return NextResponse.json({ deal, businessPlanFileUrl, saleAgreementFileUrl });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  switch (body.action) {
    case "update": {
      const deal = await updateDeal(id, { title: body.title, status: body.status, data: body.data }, admin.email);
      if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, deal });
    }
    case "set-drive-folder": {
      const raw = String(body.folder || "").trim();
      const folderId = raw ? parseDriveFolderId(raw) : "";
      if (raw && !folderId) return NextResponse.json({ error: "קישור או מזהה תיקייה לא תקינים" }, { status: 400 });
      const deal = await setDealDriveFolder(id, folderId, admin.name || admin.email);
      if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, deal });
    }
    case "add-client": {
      const clientId = String(body.clientId || "").trim();
      if (!clientId) return NextResponse.json({ error: "לא נבחר לקוח" }, { status: 400 });
      const deal = await addDealClient(id, clientId, admin.name || admin.email, String(body.role || "").trim() || undefined);
      if (!deal) return NextResponse.json({ error: "הלקוח לא נמצא" }, { status: 404 });
      return NextResponse.json({ ok: true, deal });
    }
    case "remove-client": {
      const deal = await removeDealClient(id, String(body.clientId || ""), admin.name || admin.email);
      if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, deal });
    }
    case "add-payment": {
      const title = String(body.title || "").trim();
      const dueDate = String(body.dueDate || "").trim();
      if (!title) return NextResponse.json({ error: "צריך כותרת לתשלום" }, { status: 400 });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return NextResponse.json({ error: "צריך תאריך יעד תקין" }, { status: 400 });
      const amt = Number(body.amount);
      const deal = await addDealPayment(id, {
        title, dueDate,
        amount: Number.isFinite(amt) && amt > 0 ? amt : undefined,
        clientIds: Array.isArray(body.clientIds) ? body.clientIds.map(String) : [],
        notifyWeekBefore: !!body.notifyWeekBefore,
        notifyDayBefore: !!body.notifyDayBefore,
        notifySameDay: !!body.notifySameDay,
        note: body.note ? String(body.note) : undefined,
      }, admin.name || admin.email);
      return NextResponse.json({ ok: true, deal });
    }
    case "set-payment-status": {
      const status = String(body.status || "");
      if (!["pending", "paid", "canceled"].includes(status)) return NextResponse.json({ error: "סטטוס לא תקין" }, { status: 400 });
      const deal = await setPaymentStatus(id, String(body.paymentId || ""), status as "pending" | "paid" | "canceled", admin.name || admin.email);
      return NextResponse.json({ ok: true, deal });
    }
    case "delete-payment": {
      const deal = await deleteDealPayment(id, String(body.paymentId || ""), admin.name || admin.email);
      return NextResponse.json({ ok: true, deal });
    }
    case "set-checklist-item": {
      const key = String(body.key || "").trim();
      if (!key) return NextResponse.json({ error: "חסר מזהה משימה" }, { status: 400 });
      const patch: { done?: boolean; assignee?: string } = {};
      if (typeof body.done === "boolean") patch.done = body.done;
      if (body.assignee !== undefined) patch.assignee = String(body.assignee);
      const deal = await setChecklistItem(id, key, patch, admin.name || admin.email);
      if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, deal });
    }
    case "add-signing-day": {
      const date = String(body.date || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "צריך תאריך תקין" }, { status: 400 });
      const scope = body.scope === "specific" ? "specific" : "all";
      const deal = await addSigningDay(id, {
        date, scope,
        clientIds: Array.isArray(body.clientIds) ? body.clientIds.map(String) : [],
        note: body.note ? String(body.note) : undefined,
      }, admin.name || admin.email);
      if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, deal });
    }
    case "update-signing-day": {
      const dayId = String(body.dayId || "").trim();
      if (!dayId) return NextResponse.json({ error: "חסר מזהה יום" }, { status: 400 });
      const patch: { date?: string; scope?: "all" | "specific"; clientIds?: string[]; note?: string } = {};
      if (body.date !== undefined) { const d = String(body.date); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return NextResponse.json({ error: "תאריך לא תקין" }, { status: 400 }); patch.date = d; }
      if (body.scope !== undefined) patch.scope = body.scope === "specific" ? "specific" : "all";
      if (body.clientIds !== undefined) patch.clientIds = Array.isArray(body.clientIds) ? body.clientIds.map(String) : [];
      if (body.note !== undefined) patch.note = String(body.note);
      const deal = await updateSigningDay(id, dayId, patch, admin.name || admin.email);
      if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, deal });
    }
    case "delete-signing-day": {
      const deal = await deleteSigningDay(id, String(body.dayId || ""), admin.name || admin.email);
      if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, deal });
    }
    case "add-note": {
      const text = String(body.text || "").trim();
      if (!text) return NextResponse.json({ error: "ההערה ריקה" }, { status: 400 });
      const deal = await addDealNote(id, text, admin.email);
      if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ ok: true, deal });
    }
    case "delete": {
      const ok = await deleteDeal(id);
      return NextResponse.json({ ok });
    }
    case "generate-plan": {
      // תשתית — הפקת תכנית עסקית תיושם בהמשך
      return NextResponse.json({ error: "הפקת תכנית עסקית תיפתח בשלב הבא" }, { status: 501 });
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
