import { randomUUID } from "crypto";
import { supa } from "@/lib/supabaseAdmin";
import { driveFolderUrl, DEAL_CHECKLIST_ITEMS } from "@/lib/deals";
import type { Deal, DealActivity, DealClient, DealPayment, DealStatus, DealChecklistItem, DealSigningDay } from "@/lib/deals";
import { addClientFile, removeClientFileByPath } from "@/lib/clientsRepo";

const nowIso = () => new Date().toISOString();
const SALE_AGREEMENT_CATEGORY = "הסכם מכר";

function clean(o?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o || {})) { const val = String(v ?? "").trim(); if (val) out[k] = val.slice(0, 5000); }
  return out;
}

interface DealRow {
  id: string; title: string; status: string; data: Record<string, string>;
  linked_lead_id: string | null; linked_client_id: string | null; business_plan: string | null;
  business_plan_file: string | null; business_plan_file_name: string | null;
  sale_agreement_file: string | null; sale_agreement_file_name: string | null;
  checklist: DealChecklistItem[] | null; signing_days: DealSigningDay[] | null;
  drive_folder_id: string | null; drive_folder_link: string | null;
  created_at: string; updated_at: string; deal_activity?: DealActRow[]; deal_clients?: DealClientRow[];
  deal_payments?: DealPaymentRow[];
}

/** ממזג את הצ'קליסט השמור עם משימות ברירת המחדל — כך שכל עסקה תמיד מציגה את כל 6 המשימות. */
function normalizeChecklist(stored?: DealChecklistItem[] | null): DealChecklistItem[] {
  const map = new Map((Array.isArray(stored) ? stored : []).map((i) => [i.key, i]));
  return DEAL_CHECKLIST_ITEMS.map((d) => {
    const s = map.get(d.key);
    return { key: d.key, label: d.label, done: !!s?.done, doneAt: s?.doneAt, doneBy: s?.doneBy, assignee: s?.assignee };
  });
}
interface DealPaymentRow {
  id: string; deal_id: string; title: string; amount: string | number | null; due_date: string;
  notify_week_before: boolean; notify_day_before: boolean; notify_same_day: boolean;
  status: string; paid_at: string | null; note: string | null; created_at: string;
  deal_payment_clients?: { client_id: string }[];
  deal_payment_sends?: { kind: string }[];
}
interface DealActRow { id: string; type: string; at: string; by_actor: string; text: string | null }
interface DealClientRow {
  client_id: string; role: string | null; added_at: string;
  clients: { id: string; email: string | null; google_name: string | null; answers: Record<string, string> | null } | null;
}

function rowToDeal(r: DealRow): Deal {
  const activity: DealActivity[] = (r.deal_activity || [])
    .map((a) => ({ id: a.id, type: a.type as DealActivity["type"], at: a.at, by: a.by_actor, text: a.text || undefined }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const clients: DealClient[] = (r.deal_clients || [])
    .map((c) => {
      const answers = c.clients?.answers || {};
      return {
        clientId: c.client_id,
        fullName: answers.fullName || c.clients?.google_name || "",
        email: c.clients?.email || "",
        phone: answers.phone || "",
        role: c.role || undefined,
        addedAt: c.added_at || "",
      };
    })
    .sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
  const payments: DealPayment[] = (r.deal_payments || [])
    .map((p) => ({
      id: p.id, dealId: p.deal_id, title: p.title || "",
      amount: p.amount == null ? undefined : Number(p.amount),
      dueDate: p.due_date || "",
      notifyWeekBefore: !!p.notify_week_before,
      notifyDayBefore: !!p.notify_day_before,
      notifySameDay: !!p.notify_same_day,
      status: (p.status as DealPayment["status"]) || "pending",
      paidAt: p.paid_at || undefined,
      note: p.note || undefined,
      clientIds: (p.deal_payment_clients || []).map((c) => c.client_id),
      sent: (p.deal_payment_sends || []).map((s) => s.kind),
      createdAt: p.created_at || "",
    }))
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  return {
    id: r.id, title: r.title || "", status: (r.status as DealStatus) || "new",
    data: r.data || {}, clients, payments, linkedLeadId: r.linked_lead_id || undefined, linkedClientUid: r.linked_client_id || undefined,
    businessPlan: r.business_plan || undefined,
    businessPlanFile: r.business_plan_file || undefined,
    businessPlanFileName: r.business_plan_file_name || undefined,
    saleAgreementFile: r.sale_agreement_file || undefined,
    saleAgreementFileName: r.sale_agreement_file_name || undefined,
    checklist: normalizeChecklist(r.checklist),
    signingDays: (Array.isArray(r.signing_days) ? r.signing_days : []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))),
    driveFolderId: r.drive_folder_id || undefined, driveFolderLink: r.drive_folder_link || undefined,
    createdAt: r.created_at || "", updatedAt: r.updated_at || "", activity,
  };
}

const SEL = "*, deal_activity(*), deal_clients(client_id, role, added_at, clients(id, email, google_name, answers))," +
  "deal_payments(*, deal_payment_clients(client_id), deal_payment_sends(kind))";

export async function listDeals(): Promise<Deal[]> {
  const { data, error } = await supa().from("deals").select(SEL).order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown as DealRow[]).map(rowToDeal);
}

export async function getDeal(id: string): Promise<Deal | null> {
  const { data, error } = await supa().from("deals").select(SEL).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToDeal(data as unknown as DealRow) : null;
}

async function addActivity(dealId: string, type: string, by: string, text?: string): Promise<void> {
  await supa().from("deal_activity").insert({ deal_id: dealId, type, at: nowIso(), by_actor: by, text: text || null });
}

export async function createDeal(input: { title: string; status?: DealStatus; data?: Record<string, string>; linkedLeadId?: string; linkedClientUid?: string }, by: string): Promise<Deal> {
  const id = randomUUID();
  const now = nowIso();
  const { error } = await supa().from("deals").insert({
    id, title: (input.title || "עסקה חדשה").trim().slice(0, 200), status: input.status || "new",
    data: clean(input.data), linked_lead_id: input.linkedLeadId || null, linked_client_id: input.linkedClientUid || null,
    created_at: now, updated_at: now,
  });
  if (error) throw new Error(error.message);
  await addActivity(id, "system", by, "העסקה נוצרה");
  return (await getDeal(id))!;
}

export async function updateDeal(id: string, patch: { title?: string; status?: DealStatus; data?: Record<string, string>; businessPlan?: string }, by: string): Promise<Deal | null> {
  const existing = await getDeal(id);
  if (!existing) return null;
  const upd: Record<string, unknown> = { updated_at: nowIso() };
  if (patch.title !== undefined) upd.title = patch.title.trim().slice(0, 200);
  if (patch.data) upd.data = { ...existing.data, ...clean(patch.data) };
  if (patch.businessPlan !== undefined) upd.business_plan = patch.businessPlan;
  let statusChanged = false;
  if (patch.status !== undefined && patch.status !== existing.status) { upd.status = patch.status; statusChanged = true; }
  const { error } = await supa().from("deals").update(upd).eq("id", id);
  if (error) throw new Error(error.message);
  if (statusChanged) await addActivity(id, "status", by, `סטטוס עודכן ל: ${patch.status}`);
  return getDeal(id);
}

/** משייך תיקיית דרייב לעסקה. folderId ריק = ניתוק השיוך. */
export async function setDealDriveFolder(id: string, folderId: string, by: string): Promise<Deal | null> {
  const existing = await getDeal(id);
  if (!existing) return null;
  const link = folderId ? driveFolderUrl(folderId) : null;
  const { error } = await supa().from("deals").update({
    drive_folder_id: folderId || null, drive_folder_link: link, updated_at: nowIso(),
  }).eq("id", id);
  if (error) throw new Error(error.message);
  await addActivity(id, "system", by, folderId ? `📁 תיקיית דרייב שויכה לעסקה` : `📁 שיוך תיקיית הדרייב בוטל`);
  return getDeal(id);
}

export async function addDealNote(id: string, text: string, by: string): Promise<Deal | null> {
  const existing = await getDeal(id);
  if (!existing) return null;
  await addActivity(id, "note", by, text.slice(0, 5000));
  await supa().from("deals").update({ updated_at: nowIso() }).eq("id", id);
  return getDeal(id);
}

/** משבץ לקוח לעסקה (אין כפילויות — מפתח ראשי משותף). */
export async function addDealClient(dealId: string, clientId: string, by: string, role?: string): Promise<Deal | null> {
  const { data: client } = await supa().from("clients").select("id, email, google_name, answers").eq("id", clientId).maybeSingle();
  if (!client) return null;
  const c = client as { email: string | null; google_name: string | null; answers: Record<string, string> | null };
  const name = c.answers?.fullName || c.google_name || c.email || "לקוח";
  const { error } = await supa().from("deal_clients").upsert(
    { deal_id: dealId, client_id: clientId, role: role || null, added_by: by, added_at: nowIso() },
    { onConflict: "deal_id,client_id" }
  );
  if (error) throw new Error(error.message);
  await addActivity(dealId, "system", by, `👤 ${name} שובץ לעסקה${role ? ` (${role})` : ""}`);
  // תיעוד גם אצל הלקוח (נשאר לצמיתות גם אם יוסר מהשיבוץ בהמשך)
  await noteOnClient(clientId, `🤝 שובץ לעסקה "${await dealTitle(dealId)}"${role ? ` (${role})` : ""}`, by);
  // אם כבר קיים הסכם מכר בעסקה — לצרף אותו למסמכי הלקוח שהתווסף עכשיו
  const { data: dealRow } = await supa().from("deals").select("sale_agreement_file, sale_agreement_file_name").eq("id", dealId).maybeSingle();
  const sa = dealRow as { sale_agreement_file: string | null; sale_agreement_file_name: string | null } | null;
  if (sa?.sale_agreement_file) {
    await addClientFile(clientId, {
      category: SALE_AGREEMENT_CATEGORY, name: sa.sale_agreement_file_name || "הסכם מכר.pdf", size: 0,
      content_type: "application/pdf", storage_path: sa.sale_agreement_file, drive_file_id: null,
    }).catch(() => {});
  }
  await supa().from("deals").update({ updated_at: nowIso() }).eq("id", dealId);
  return getDeal(dealId);
}

/** מסיר לקוח מהעסקה. */
export async function removeDealClient(dealId: string, clientId: string, by: string): Promise<Deal | null> {
  const { data: client } = await supa().from("clients").select("email, google_name, answers").eq("id", clientId).maybeSingle();
  const c = client as { email: string | null; google_name: string | null; answers: Record<string, string> | null } | null;
  const name = c?.answers?.fullName || c?.google_name || c?.email || "לקוח";
  await supa().from("deal_clients").delete().eq("deal_id", dealId).eq("client_id", clientId);
  await addActivity(dealId, "system", by, `👤 ${name} הוסר מהשיבוץ`);
  await noteOnClient(clientId, `↩️ הוסר משיבוץ לעסקה "${await dealTitle(dealId)}"`, by);
  await supa().from("deals").update({ updated_at: nowIso() }).eq("id", dealId);
  return getDeal(dealId);
}

/** כותרת עסקה (לתיעוד). */
async function dealTitle(dealId: string): Promise<string> {
  const { data } = await supa().from("deals").select("title").eq("id", dealId).maybeSingle();
  return (data as { title: string | null } | null)?.title || "עסקה";
}

/** רושם הערה פנימית ביומן הלקוח (admin_notes). משמש לתיעוד שיבוץ/הסרה מעסקה. */
async function noteOnClient(clientId: string, text: string, by: string): Promise<void> {
  await supa().from("admin_notes").insert({ client_id: clientId, text, author_email: by, author_name: by });
}

/** קובע/מסיר את קובץ התכנית העסקית (PDF) של העסקה. */
export async function setBusinessPlanFile(dealId: string, path: string | null, name: string | null, by: string): Promise<Deal | null> {
  await supa().from("deals").update({ business_plan_file: path, business_plan_file_name: name, updated_at: nowIso() }).eq("id", dealId);
  await addActivity(dealId, "system", by, path ? `📈 הועלתה תכנית עסקית: ${name || "קובץ PDF"}` : "🗑️ קובץ התכנית העסקית הוסר");
  return getDeal(dealId);
}

/** מזהי הלקוחות המשובצים לעסקה. */
async function dealClientIds(dealId: string): Promise<string[]> {
  const { data } = await supa().from("deal_clients").select("client_id").eq("deal_id", dealId);
  return ((data as { client_id: string }[] | null) || []).map((r) => r.client_id);
}

/**
 * קובע/מסיר את קובץ הסכם המכר (PDF) של העסקה, ומסנכרן אותו למסמכי כל הלקוחות המשובצים:
 * מסיר את ההסכם הקודם (אם היה) מהם ומצרף את החדש.
 */
export async function setSaleAgreementFile(dealId: string, path: string | null, name: string | null, by: string): Promise<Deal | null> {
  const { data: prev } = await supa().from("deals").select("sale_agreement_file").eq("id", dealId).maybeSingle();
  const oldPath = (prev as { sale_agreement_file: string | null } | null)?.sale_agreement_file || null;
  const clientIds = await dealClientIds(dealId);
  // ניקוי ההסכם הקודם ממסמכי הלקוחות
  if (oldPath) for (const cid of clientIds) await removeClientFileByPath(cid, oldPath).catch(() => {});
  await supa().from("deals").update({ sale_agreement_file: path, sale_agreement_file_name: name, updated_at: nowIso() }).eq("id", dealId);
  // צירוף ההסכם החדש לכל לקוח משובץ
  if (path) for (const cid of clientIds) {
    await addClientFile(cid, {
      category: SALE_AGREEMENT_CATEGORY, name: name || "הסכם מכר.pdf", size: 0,
      content_type: "application/pdf", storage_path: path, drive_file_id: null,
    }).catch(() => {});
  }
  await addActivity(dealId, "system", by, path
    ? `📝 הועלה הסכם מכר: ${name || "קובץ PDF"} (צורף ל-${clientIds.length} לקוחות משובצים)`
    : "🗑️ קובץ הסכם המכר הוסר");
  return getDeal(dealId);
}

/** מעדכן פריט בצ'קליסט המשימות (סימון בוצע + אחראי). מחזיר צ'קליסט מנורמל. */
export async function setChecklistItem(dealId: string, key: string, patch: { done?: boolean; assignee?: string }, by: string): Promise<Deal | null> {
  const def = DEAL_CHECKLIST_ITEMS.find((d) => d.key === key);
  if (!def) return getDeal(dealId);
  const { data: row } = await supa().from("deals").select("checklist").eq("id", dealId).maybeSingle();
  const current = normalizeChecklist((row as { checklist: DealChecklistItem[] | null } | null)?.checklist);
  let toggledTo: boolean | null = null;
  const next = current.map((it) => {
    if (it.key !== key) return it;
    const done = patch.done !== undefined ? patch.done : it.done;
    if (patch.done !== undefined && patch.done !== it.done) toggledTo = patch.done;
    return {
      ...it,
      done,
      doneAt: done ? (it.done ? it.doneAt : nowIso()) : undefined,
      doneBy: done ? (it.done ? it.doneBy : by) : undefined,
      assignee: patch.assignee !== undefined ? (patch.assignee.trim() || undefined) : it.assignee,
    };
  });
  await supa().from("deals").update({ checklist: next, updated_at: nowIso() }).eq("id", dealId);
  if (toggledTo !== null) await addActivity(dealId, "system", by, `${toggledTo ? "✅ בוצעה משימה" : "↩️ בוטל סימון משימה"}: ${def.label}`);
  return getDeal(dealId);
}

/** קורא את ימי החתימות השמורים. */
async function readSigningDays(dealId: string): Promise<DealSigningDay[]> {
  const { data } = await supa().from("deals").select("signing_days").eq("id", dealId).maybeSingle();
  const v = (data as { signing_days: DealSigningDay[] | null } | null)?.signing_days;
  return Array.isArray(v) ? v : [];
}

/** מוסיף יום חתימות לעסקה. */
export async function addSigningDay(dealId: string, input: { date: string; scope: "all" | "specific"; clientIds?: string[]; note?: string }, by: string): Promise<Deal | null> {
  const days = await readSigningDays(dealId);
  const day: DealSigningDay = {
    id: randomUUID(), date: input.date,
    scope: input.scope === "specific" ? "specific" : "all",
    clientIds: input.scope === "specific" ? [...new Set(input.clientIds || [])] : [],
    note: input.note?.trim() || undefined,
  };
  await supa().from("deals").update({ signing_days: [...days, day], updated_at: nowIso() }).eq("id", dealId);
  const who = day.scope === "all" ? "כל הלקוחות" : `${day.clientIds.length} לקוחות`;
  await addActivity(dealId, "system", by, `📅 נקבע יום חתימות: ${input.date} (${who})`);
  return getDeal(dealId);
}

/** מעדכן יום חתימות קיים. */
export async function updateSigningDay(dealId: string, dayId: string, patch: { date?: string; scope?: "all" | "specific"; clientIds?: string[]; note?: string }, by: string): Promise<Deal | null> {
  const days = await readSigningDays(dealId);
  const next = days.map((d) => {
    if (d.id !== dayId) return d;
    const scope = patch.scope ?? d.scope;
    return {
      ...d,
      date: patch.date ?? d.date,
      scope,
      clientIds: scope === "specific" ? [...new Set(patch.clientIds ?? d.clientIds)] : [],
      note: patch.note !== undefined ? (patch.note.trim() || undefined) : d.note,
    };
  });
  await supa().from("deals").update({ signing_days: next, updated_at: nowIso() }).eq("id", dealId);
  return getDeal(dealId);
}

/** מוחק יום חתימות. */
export async function deleteSigningDay(dealId: string, dayId: string, by: string): Promise<Deal | null> {
  const days = await readSigningDays(dealId);
  const removed = days.find((d) => d.id === dayId);
  await supa().from("deals").update({ signing_days: days.filter((d) => d.id !== dayId), updated_at: nowIso() }).eq("id", dealId);
  if (removed) await addActivity(dealId, "system", by, `📅 יום חתימות ${removed.date} נמחק`);
  return getDeal(dealId);
}

/** מוסיף תזכורת תשלום ללוח התשלומים של העסקה. */
export async function addDealPayment(dealId: string, input: {
  title: string; amount?: number; dueDate: string; clientIds?: string[];
  notifyWeekBefore?: boolean; notifyDayBefore?: boolean; notifySameDay?: boolean; note?: string;
}, by: string): Promise<Deal | null> {
  const { data, error } = await supa().from("deal_payments").insert({
    deal_id: dealId,
    title: input.title.trim(),
    amount: input.amount ?? null,
    due_date: input.dueDate,
    notify_week_before: !!input.notifyWeekBefore,
    notify_day_before: !!input.notifyDayBefore,
    notify_same_day: input.notifySameDay !== false,
    note: input.note?.trim() || null,
    created_by: by,
  }).select("id").single();
  if (error) throw new Error(error.message);
  const paymentId = (data as { id: string }).id;

  const ids = [...new Set(input.clientIds || [])];
  if (ids.length) {
    await supa().from("deal_payment_clients").insert(ids.map((client_id) => ({ payment_id: paymentId, client_id })));
  }
  const amountTxt = input.amount ? ` — ₪${Number(input.amount).toLocaleString("he-IL")}` : "";
  await addActivity(dealId, "system", by, `💰 תשלום נוסף ללוח: ${input.title}${amountTxt} (יעד ${input.dueDate})`);
  await supa().from("deals").update({ updated_at: nowIso() }).eq("id", dealId);
  return getDeal(dealId);
}

/** מסמן תשלום כשולם / מבטל / מחזיר לממתין. */
export async function setPaymentStatus(dealId: string, paymentId: string, status: "pending" | "paid" | "canceled", by: string): Promise<Deal | null> {
  const { data: p } = await supa().from("deal_payments").select("title").eq("id", paymentId).maybeSingle();
  await supa().from("deal_payments").update({
    status, paid_at: status === "paid" ? nowIso() : null, updated_at: nowIso(),
  }).eq("id", paymentId).eq("deal_id", dealId);
  const label = status === "paid" ? "סומן כשולם ✔" : status === "canceled" ? "בוטל" : "הוחזר לממתין";
  await addActivity(dealId, "system", by, `💰 תשלום "${(p as { title?: string } | null)?.title || ""}" ${label}`);
  return getDeal(dealId);
}

/** מוחק תזכורת תשלום. */
export async function deleteDealPayment(dealId: string, paymentId: string, by: string): Promise<Deal | null> {
  const { data: p } = await supa().from("deal_payments").select("title").eq("id", paymentId).maybeSingle();
  await supa().from("deal_payments").delete().eq("id", paymentId).eq("deal_id", dealId);
  await addActivity(dealId, "system", by, `💰 תשלום "${(p as { title?: string } | null)?.title || ""}" נמחק מהלוח`);
  return getDeal(dealId);
}

export async function deleteDeal(id: string): Promise<boolean> {
  const { error } = await supa().from("deals").delete().eq("id", id);
  return !error;
}
