import { randomUUID } from "crypto";
import { supa } from "@/lib/supabaseAdmin";
import { normalizeIsraeliPhone } from "@/lib/notify";
import { REPS, phoneCore } from "@/lib/reps";
import { SECTIONS } from "@/lib/formSchema";
import {
  QUALI_FIELDS,
  UTM_KEYS,
  LEAD_STAGES,
  utmLabel,
  type Lead,
  type LeadIntake,
  type LeadActivity,
  type LeadStage,
  type CompassStatus,
  compassStatusLabel,
  deriveFullName,
  normalizeEmail,
  isDistributionLead,
} from "@/lib/leads";

const CORE_KEYS = ["firstName", "lastName", "fullName", "email", "phone", "idNumber"];
// כינויים לשדה השם המלא — טפסים מסוימים שולחים "name"/"שם" במקום "fullName".
// בלי המיפוי הזה השם נופל ל-custom (מותאם:name) והליד נקלט ללא שם.
const FULLNAME_ALIASES = new Set(["name", "full name", "your name", "yourname", "lead name", "שם", "שם מלא", "שם ושם משפחה"]);
const normKey = (k: string) => k.toLowerCase().replace(/[_-]+/g, " ").trim();
const QUALI_KEYS = new Set(QUALI_FIELDS.map((f) => f.key));
const ANSWER_KEYS = new Set(SECTIONS.flatMap((s) => s.fields.map((f) => f.key)));
const UTM_SET = new Set(UTM_KEYS);
// שים לב: utm_* לא נזרק יותר — נקלט לתוך custom כדי שיישמר בליד ובתיעוד.
const DROP_KEY = /^(fbc$|fbp$|fbclid$|ttp$|ttc$|gclid$|event_id$|acceptance$|queried_id$|post_id$|form_id$|referer_title$|_wpnonce$)/i;

const nowIso = () => new Date().toISOString();

/** ממפה payload שטוח (מ-API/CSV) ל-LeadIntake. */
export function buildIntakeFromFlat(
  flat: Record<string, unknown>,
  opts: { fieldMap?: Record<string, string>; customFieldIds?: string[] }
): LeadIntake {
  const fieldMap = opts.fieldMap || {};
  const customIds = new Set(opts.customFieldIds || []);
  const intake: LeadIntake = { answers: {}, quali: {}, custom: {} };
  for (const [rawKey, rawVal] of Object.entries(flat || {})) {
    const val = rawVal == null ? "" : String(rawVal).trim();
    if (!val) continue;
    if (DROP_KEY.test(rawKey)) continue;
    // UTM (בכל אותיות) → תמיד ל-custom עם מפתח אחיד באותיות קטנות
    const lower = rawKey.toLowerCase();
    if (UTM_SET.has(lower)) { intake.custom![lower] = val; continue; }
    let key = fieldMap[rawKey] || rawKey;
    // כינוי שם מלא (name/שם וכו') → fullName, אלא אם השדה כבר ממופה מפורשות
    if (!CORE_KEYS.includes(key) && FULLNAME_ALIASES.has(normKey(key))) key = "fullName";
    if (CORE_KEYS.includes(key)) (intake as Record<string, unknown>)[key] = val;
    else if (QUALI_KEYS.has(key)) intake.quali![key] = val;
    else if (ANSWER_KEYS.has(key)) intake.answers![key] = val;
    else if (customIds.has(key)) intake.custom![key] = val;
    else intake.custom![key] = val;
  }
  return intake;
}

function cleanObj(o?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o || {})) {
    const val = typeof v === "string" ? v.trim() : String(v ?? "").trim();
    if (val) out[k] = val.slice(0, 2000);
  }
  return out;
}

interface LeadRow {
  id: string; first_name: string; last_name: string; full_name: string; email: string; phone: string;
  id_number: string; stage: string; answers: Record<string, string>; quali: Record<string, string>;
  custom: Record<string, string>; converted_client_id: string | null;
  compass_status: string | null; compass_entered_at: string | null; assigned_to: string | null;
  created_at: string; updated_at: string; last_lead_at: string;
  category?: string | null; distribution_last_at?: string | null; portal_access?: boolean | null;
  lead_activity?: ActivityRow[];
}
interface ActivityRow { id: string; type: string; at: string; source: string; by_actor: string; text: string | null; fields: Record<string, string> | null }

function rowToLead(r: LeadRow): Lead {
  const activity: LeadActivity[] = (r.lead_activity || [])
    .map((a) => ({ id: a.id, type: a.type as LeadActivity["type"], at: a.at, source: a.source, by: a.by_actor, text: a.text || undefined, fields: a.fields || undefined }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return {
    id: r.id,
    firstName: r.first_name || "", lastName: r.last_name || "", fullName: r.full_name || "",
    email: r.email || "", phone: r.phone || "", idNumber: r.id_number || "",
    stage: (r.stage as LeadStage) || "new",
    answers: r.answers || {}, quali: r.quali || {}, custom: r.custom || {},
    createdAt: r.created_at || "", updatedAt: r.updated_at || "", lastLeadAt: r.last_lead_at || "",
    activity,
    assignedTo: r.assigned_to || undefined,
    convertedClientUid: r.converted_client_id || undefined,
    compassStatus: (r.compass_status as Lead["compassStatus"]) || undefined,
    compassEnteredAt: r.compass_entered_at || undefined,
    category: (r.category as Lead["category"]) || "sales",
    distributionLastAt: r.distribution_last_at || undefined,
    portalAccess: !!r.portal_access,
  };
}

const SEL = "*, lead_activity(*)";

/**
 * רשימת לידים — בלי יומן הפעילות ובלי answers.
 * מסך הלידים והדשבורד לא מציגים אותם, והם מכפילים את משקל התשובה פי ~7
 * (57 לידים: 493KB עם היומן מול 72KB בלעדיו). היומן נטען רק בכרטיס הליד, דרך getLead.
 */
const SEL_LIST =
  "id,first_name,last_name,full_name,email,phone,id_number,stage,quali,custom," +
  "created_at,updated_at,last_lead_at,converted_client_id,compass_status,compass_entered_at,assigned_to,category,distribution_last_at,portal_access";

export async function listLeads(): Promise<Lead[]> {
  const { data, error } = await supa().from("leads").select(SEL_LIST).order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown as LeadRow[]).map(rowToLead);
}

/* ── עימוד בצד השרת ──────────────────────────────────────────────────
   מסך הלידים שולח את המצב שלו (עמוד, שלב, פילטרים, מיון) והשרת מחזיר
   רק את השורות שמוצגות בפועל + הספירות לטאבים. כך המשקל שעובר ברשת
   קבוע — לא משנה אם בטבלה 50 לידים או 50,000.                        */

export const LEADS_PAGE_SIZE = 50;

/** מפתח עמודה בטבלת המסך → ביטוי עמודה ב-Postgres. */
const CORE_COL_DB: Record<string, string> = {
  fullName: "full_name", firstName: "first_name", lastName: "last_name",
  phone: "phone", email: "email", idNumber: "id_number", stage: "stage",
  assignedTo: "assigned_to",
  createdAt: "created_at", updatedAt: "updated_at", lastLeadAt: "last_lead_at",
};

function colToDb(key: string): string | null {
  if (CORE_COL_DB[key]) return CORE_COL_DB[key];
  if (key.startsWith("quali.")) return `quali->>${key.slice(6)}`;
  if (key.startsWith("utm.")) return `custom->>${key.slice(4)}`;
  if (key.startsWith("custom.")) return `custom->>${key.slice(7)}`;
  return null; // עמודה לא מוכרת — לא מסננים/ממיינים לפיה
}

export interface LeadsQuery {
  page?: number;
  stage?: string;                       // מפתח שלב, או "all"
  filters?: Record<string, string>;     // מפתח עמודה → טקסט חיפוש
  sortKey?: string;
  sortDir?: "asc" | "desc";
  category?: "sales" | "distribution";  // מכירות (ברירת מחדל) או רשימות תפוצה
}

/** מגביל שאילתה לקטגוריה: מכירות (category='sales') או רשימות תפוצה (distribution_last_at≠null). */
function scopeCategory(qb: Qb, category?: string): Qb {
  return category === "distribution"
    ? qb.not("distribution_last_at", "is", null)
    : qb.eq("category", "sales");
}

export interface LeadsPage {
  leads: Lead[];
  total: number;                        // כמה תואמים לפילטרים (לא כמה בעמוד)
  page: number;
  pageSize: number;
  stageCounts: Record<string, number>;  // למוני הטאבים, תחת אותם פילטרים
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Qb = any;

/** מחיל את פילטרי העמודות על שאילתה. השלב מטופל בנפרד (טאב + פילטר עמודה). */
function applyFilters(qb: Qb, filters: Record<string, string>): Qb {
  for (const [key, raw] of Object.entries(filters)) {
    const val = (raw || "").trim();
    if (!val) continue;
    if (key === "stage") {
      // בטבלה מוצגת התווית בעברית — מתרגמים אותה בחזרה למפתחות השלב.
      const keys = LEAD_STAGES.filter(
        (s) => s.label.toLowerCase().includes(val.toLowerCase()) || s.key.toLowerCase().includes(val.toLowerCase())
      ).map((s) => s.key);
      qb = qb.in("stage", keys.length ? keys : ["__none__"]);
      continue;
    }
    if (key === "phone") {
      // חיפוש טלפון רחב: 0526660006 / 972526660006 / +972-52-666-0006 / 526660006
      // כולם מצטמצמים לאותו גרעין ומוצאים את הרשומה (שנשמרת כ-972…).
      const core = phoneCore(val);
      qb = qb.ilike("phone", `%${core || val}%`);
      continue;
    }
    if (key === "assignedTo") {
      // בטבלה מוצג שם הנציג — מתרגמים חזרה למייל.
      const emails = REPS.filter(
        (r) => r.name.toLowerCase().includes(val.toLowerCase()) || r.initials.includes(val) || r.email.toLowerCase().includes(val.toLowerCase())
      ).map((r) => r.email);
      qb = qb.in("assigned_to", emails.length ? emails : ["__none__"]);
      continue;
    }
    const col = colToDb(key);
    if (!col) continue;
    qb = qb.ilike(col, `%${val}%`);
  }
  return qb;
}

export async function listLeadsPage(q: LeadsQuery = {}): Promise<LeadsPage> {
  const page = Math.max(1, q.page || 1);
  const pageSize = LEADS_PAGE_SIZE;
  const filters = q.filters || {};
  // הטאב תומך בבחירה מרובה: "new,contacted" → כל השלבים שנבחרו
  const stages = (q.stage && q.stage !== "all" ? q.stage.split(",") : [])
    .map((s) => s.trim()).filter(Boolean);
  const sortCol = colToDb(q.sortKey || "updatedAt") || "updated_at";
  const ascending = q.sortDir === "asc";

  // ספירת התצוגה הנוכחית (פילטרים + שלבים) — כדי לתחום את העמוד ולא לבקש טווח מעבר לקיים
  let viewCountQb = scopeCategory(applyFilters(supa().from("leads").select("id", { count: "exact", head: true }), filters), q.category);
  if (stages.length) viewCountQb = viewCountQb.in("stage", stages);
  const { count: viewCount0, error: vErr } = await viewCountQb;
  if (vErr) throw new Error(vErr.message);
  const viewCount = viewCount0 || 0;

  // תיחום העמוד לטווח תקף — אחרת PostgREST מחזיר "Requested range not satisfiable"
  // (קורה כשהעמוד השמור בדפדפן גדול מהתוצאות אחרי שינוי סינון/כמות).
  const maxPage = Math.max(1, Math.ceil(viewCount / pageSize));
  const safePage = Math.min(page, maxPage);
  const from = (safePage - 1) * pageSize;

  let data: unknown[] = [];
  if (viewCount > 0) {
    let rowsQb = scopeCategory(applyFilters(supa().from("leads").select(SEL_LIST), filters), q.category);
    if (stages.length) rowsQb = rowsQb.in("stage", stages);
    const res = await rowsQb.order(sortCol, { ascending, nullsFirst: false }).range(from, from + pageSize - 1);
    if (res.error) throw new Error(res.error.message);
    data = res.data || [];
  }

  // מוני הטאבים — ספירות בלבד (head:true), בלי להעביר שורות ברשת.
  const countFor = async (stageKey: string | null): Promise<number> => {
    let qb = scopeCategory(applyFilters(supa().from("leads").select("id", { count: "exact", head: true }), filters), q.category);
    if (stageKey) qb = qb.eq("stage", stageKey);
    const { count: c, error: e } = await qb;
    if (e) throw new Error(e.message);
    return c || 0;
  };
  const [allCount, ...perStage] = await Promise.all([
    countFor(null),
    ...LEAD_STAGES.map((s) => countFor(s.key)),
  ]);
  const stageCounts: Record<string, number> = { all: allCount };
  LEAD_STAGES.forEach((s, i) => { stageCounts[s.key] = perStage[i]; });

  return {
    leads: (data as unknown as LeadRow[]).map(rowToLead),
    total: viewCount,
    page,
    pageSize,
    stageCounts,
  };
}

/** מטריצת (מקור × שלב) לדשבורד — מחליפה את החישוב שרץ על המערך המלא בדפדפן. */
export async function leadsStats(fromIso?: string, toIso?: string): Promise<{ source: string; stage: string; cnt: number }[]> {
  const { data, error } = await supa().rpc("leads_stats", {
    p_from: fromIso || null,
    p_to: toIso || null,
  });
  if (error) throw new Error(error.message);
  return (data as { source: string; stage: string; cnt: number | string }[]).map((r) => ({
    source: r.source,
    stage: r.stage,
    cnt: Number(r.cnt),
  }));
}

/* ── יומן התיעוד — טעינה מדורגת ──────────────────────────────────────
   כרטיס ליד טוען את 50 הרשומות האחרונות בלבד. ליד עם 300 תיעודים
   (וכאלה יש) לא יגרור אותם כולם בכל פתיחה.                            */

export const ACTIVITY_PAGE_SIZE = 50;

/** מספר רשומות התיעוד של ליד — כדי לדעת אם להציג "טען עוד". */
export async function countLeadActivity(leadId: string): Promise<number> {
  const { count, error } = await supa()
    .from("lead_activity")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadId);
  if (error) throw new Error(error.message);
  return count || 0;
}

/** חלון רשומות תיעוד (החדשות ביותר קודם). */
export async function listLeadActivity(leadId: string, offset = 0, limit = ACTIVITY_PAGE_SIZE): Promise<LeadActivity[]> {
  const { data, error } = await supa()
    .from("lead_activity")
    .select("*")
    .eq("lead_id", leadId)
    .order("at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);
  return (data as ActivityRow[]).map((a) => ({
    id: a.id, type: a.type as LeadActivity["type"], at: a.at,
    source: a.source, by: a.by_actor,
    text: a.text || undefined, fields: a.fields || undefined,
  }));
}

export async function getLead(id: string): Promise<Lead | null> {
  const { data, error } = await supa().from("leads").select(SEL_LIST).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const lead = rowToLead(data as unknown as LeadRow);
  const [activity, activityTotal] = await Promise.all([
    listLeadActivity(id, 0, ACTIVITY_PAGE_SIZE),
    countLeadActivity(id),
  ]);
  return { ...lead, activity, activityTotal };
}

/** איתור ליד קיים לצורך דדופ בקליטה — התיעוד לא נחוץ כאן, לכן לא נשלף. */
async function findExisting(emailKey: string, phoneKey: string): Promise<Lead | null> {
  if (emailKey) {
    const { data } = await supa().from("leads").select(SEL_LIST).eq("email_key", emailKey).order("created_at", { ascending: true }).limit(1);
    if (data && data.length) return rowToLead(data[0] as unknown as LeadRow);
  }
  if (phoneKey) {
    const { data } = await supa().from("leads").select(SEL_LIST).eq("phone", phoneKey).order("created_at", { ascending: true }).limit(1);
    if (data && data.length) return rowToLead(data[0] as unknown as LeadRow);
  }
  return null;
}

export async function findLeadForClient(opts: { fromLeadId?: string; email?: string; phone?: string }): Promise<Lead | null> {
  if (opts.fromLeadId) {
    const l = await getLead(opts.fromLeadId);
    if (l) return l;
  }
  const email = normalizeEmail(opts.email);
  const phone = normalizeIsraeliPhone(opts.phone || "");
  if (!email && !phone) return null;
  return findExisting(email, phone);
}

async function insertActivity(leadId: string, entry: Omit<LeadActivity, "id" | "at"> & { at?: string }): Promise<void> {
  await supa().from("lead_activity").insert({
    lead_id: leadId, type: entry.type, at: entry.at || nowIso(),
    source: entry.source || "", by_actor: entry.by || "", text: entry.text || null, fields: entry.fields || null,
  });
}

function prefix(o: Record<string, string>, p: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) out[`${p}${k}`] = v;
  return out;
}

export async function upsertLead(intake: LeadIntake, meta: { source: string; by: string }): Promise<{ lead: Lead; merged: boolean }> {
  const email = normalizeEmail(intake.email);
  const phone = normalizeIsraeliPhone(intake.phone || "");
  const fullName = deriveFullName(intake);
  let firstName = intake.firstName?.trim() || "";
  let lastName = intake.lastName?.trim() || "";
  if (!firstName && !lastName && fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    firstName = parts[0] || "";
    lastName = parts.slice(1).join(" ");
  }
  const answers = cleanObj(intake.answers);
  const quali = cleanObj(intake.quali);
  const custom = cleanObj(intake.custom);
  const now = nowIso();

  // מפרידים UTM משאר השדות המותאמים כדי לתייג אותם בעברית בתיעוד
  const utm: Record<string, string> = {};
  const otherCustom: Record<string, string> = {};
  for (const [k, v] of Object.entries(custom)) { if (UTM_SET.has(k)) utm[k] = v; else otherCustom[k] = v; }
  const utmFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(utm)) utmFields[utmLabel(k)] = v;

  const intakeFields = {
    ...(firstName ? { firstName } : {}), ...(lastName ? { lastName } : {}), ...(fullName ? { fullName } : {}),
    ...(email ? { email } : {}), ...(phone ? { phone } : {}), ...(intake.idNumber?.trim() ? { idNumber: intake.idNumber.trim() } : {}),
    ...prefix(answers, "שאלון:"), ...prefix(quali, "הסמכה:"), ...utmFields, ...prefix(otherCustom, "מותאם:"),
  };

  const existing = await findExisting(email, phone);

  // רשימת תפוצה: האם הדף הנוכחי הוא דף לא-בשל (VSL2 / וובינר / חוברת עבודה)
  const incomingDist = isDistributionLead(custom);

  // ── מקרה מיוחד: ליד מכירות קיים שנרשם עכשיו לרשימת תפוצה ──
  // לא נוגעים בליבת המכירות (לא זז בתצוגה, לא משנה שלב/דף/UTM/מונה הגשות).
  // רק מסמנים תאריך רשימת-תפוצה חדש + תיעוד. כך לא מזהם את הפייפליין.
  if (existing && incomingDist && (existing.category || "sales") === "sales") {
    const page = (custom.landingpage || "רשימת תפוצה").trim();
    await supa().from("leads").update({
      distribution_last_at: now,
      custom: {
        ...existing.custom,
        distribution_last_page: page,
        distribution_count: String((Number(existing.custom?.distribution_count) || 0) + 1),
      },
    }).eq("id", existing.id);
    await insertActivity(existing.id, {
      type: "note", source: "distribution", by: "רשימת תפוצה",
      text: `[רשימת תפוצה] נרשם/ה ל"${page}"${custom.utm_campaign ? ` (קמפיין: ${custom.utm_campaign})` : ""}`,
    });
    return { lead: (await getLead(existing.id))!, merged: true };
  }

  if (existing) {
    // מונה הגשות — כל קליטה חוזרת של ליד קיים מעלה את החום (🔵→🔴→🔥)
    const submitCount = (Number(existing.custom?.submit_count) || 1) + 1;
    const mergedCustom: Record<string, unknown> = { ...existing.custom, ...custom, submit_count: submitCount };
    // UTM כבלוק אחד: אם ההגשה החדשה נושאת UTM כלשהו — היא מחליפה את כל בלוק ה-UTM,
    // ושדה שלא הגיע הפעם מתאפס (ולא שומר את הישן). כך לא מתערבב source חדש עם medium ישן.
    // הגשה בלי UTM כלל (כניסה ישירה) לא מוחקת ייחוס קיים.
    if (Object.keys(utm).length > 0) {
      for (const k of UTM_KEYS) if (!(k in utm)) delete mergedCustom[k];
    }
    const patch: Record<string, unknown> = {
      answers: { ...existing.answers, ...answers },
      quali: { ...existing.quali, ...quali },
      custom: mergedCustom,
      updated_at: now, last_lead_at: now,
    };
    // קטגוריה: נגיעת מכירות מקדמת ל'מכירות' (גם ליד שהיה רשימת תפוצה עולה לפייפליין).
    // נגיעת רשימת תפוצה כאן = ליד שהיה רשימת תפוצה ונשאר כזה — מעדכן תאריך תפוצה.
    patch.category = incomingDist ? (existing.category || "distribution") : "sales";
    if (incomingDist) patch.distribution_last_at = now;
    if (firstName) patch.first_name = firstName;
    if (lastName) patch.last_name = lastName;
    if (fullName) patch.full_name = fullName;
    if (email) patch.email = email;
    if (phone) patch.phone = phone;
    if (intake.idNumber?.trim()) patch.id_number = intake.idNumber.trim();
    const { error } = await supa().from("leads").update(patch).eq("id", existing.id);
    if (error) throw new Error(error.message);
    await insertActivity(existing.id, { type: "intake", source: meta.source, by: meta.by, fields: intakeFields });
    return { lead: (await getLead(existing.id))!, merged: true };
  }

  const id = randomUUID();
  const { error } = await supa().from("leads").insert({
    id, first_name: firstName, last_name: lastName, full_name: fullName,
    email, phone, id_number: intake.idNumber?.trim() || "", stage: "new",
    answers, quali, custom: { ...custom, submit_count: 1 }, created_at: now, updated_at: now, last_lead_at: now,
    category: incomingDist ? "distribution" : "sales",
    distribution_last_at: incomingDist ? now : null,
  });
  if (error) throw new Error(error.message);
  await insertActivity(id, { type: "intake", source: meta.source, by: meta.by, fields: intakeFields });
  return { lead: (await getLead(id))!, merged: false };
}

export async function updateLeadFields(id: string, patch: Partial<LeadIntake> & { stage?: LeadStage }): Promise<Lead | null> {
  const existing = await getLead(id);
  if (!existing) return null;
  const upd: Record<string, unknown> = { updated_at: nowIso() };
  if (patch.firstName !== undefined) upd.first_name = patch.firstName.trim();
  if (patch.lastName !== undefined) upd.last_name = patch.lastName.trim();
  if (patch.firstName !== undefined || patch.lastName !== undefined || patch.fullName !== undefined) {
    upd.full_name = deriveFullName({ firstName: patch.firstName ?? existing.firstName, lastName: patch.lastName ?? existing.lastName, fullName: patch.fullName });
  }
  if (patch.email !== undefined) upd.email = normalizeEmail(patch.email);
  if (patch.phone !== undefined) upd.phone = normalizeIsraeliPhone(patch.phone);
  if (patch.idNumber !== undefined) upd.id_number = patch.idNumber.trim();
  if (patch.stage !== undefined) upd.stage = patch.stage;
  if (patch.answers) upd.answers = { ...existing.answers, ...cleanObj(patch.answers) };
  if (patch.quali) upd.quali = { ...existing.quali, ...cleanObj(patch.quali) };
  if (patch.custom) upd.custom = { ...existing.custom, ...cleanObj(patch.custom) };
  const { error } = await supa().from("leads").update(upd).eq("id", id);
  if (error) throw new Error(error.message);
  return getLead(id);
}

export async function addLeadActivity(id: string, entry: Omit<LeadActivity, "id" | "at">): Promise<Lead | null> {
  const existing = await getLead(id);
  if (!existing) return null;
  await insertActivity(id, entry);
  await supa().from("leads").update({ updated_at: nowIso() }).eq("id", id);
  return getLead(id);
}

export async function deleteLeadActivity(id: string, activityId: string): Promise<Lead | null> {
  const existing = await getLead(id);
  if (!existing) return null;
  await supa().from("lead_activity").delete().eq("id", activityId).eq("lead_id", id);
  await supa().from("leads").update({ updated_at: nowIso() }).eq("id", id);
  return getLead(id);
}

export async function convertLeadToClient(id: string, by: { email: string; name: string }): Promise<{ lead: Lead; clientUid: string } | null> {
  const lead = await getLead(id);
  if (!lead) return null;
  if (lead.convertedClientUid) return { lead, clientUid: lead.convertedClientUid };

  const now = nowIso();
  const repName = by.name || by.email;
  const answers: Record<string, string> = { ...lead.answers };
  if (lead.fullName && !answers.fullName) answers.fullName = lead.fullName;
  if (lead.phone && !answers.phone) answers.phone = lead.phone;
  if (lead.idNumber && !answers.idNumber) answers.idNumber = lead.idNumber;

  // סדר נכון (בגלל FK של converted_client_id): קודם יוצרים את הלקוח, אז מסמנים את הליד.
  // ההגנה מתחרות היא האינדקס הייחודי ux_clients_from_lead — INSERT מקביל שני נכשל (23505),
  // אנחנו תופסים את זה ומחזירים את הלקוח הקיים במקום ליצור כפילות.
  const clientUid = randomUUID();
  const { error: ce } = await supa().from("clients").insert({
    id: clientUid, email: lead.email || null, google_name: lead.fullName || "", status: "manual",
    answers, from_lead_id: id, from_lead_source: "מערכת לידים",
    converted_by_email: by.email, converted_by_name: repName, converted_at: now, created_at: now, updated_at: now,
  });
  if (ce) {
    // כבר קיים לקוח לליד הזה (תחרות) — מחזירים אותו בלי כפילות.
    const { data: exist } = await supa().from("clients").select("id").eq("from_lead_id", id).limit(1);
    const existingId = (exist as { id: string }[])?.[0]?.id;
    if (existingId) {
      await supa().from("leads").update({ stage: "won", converted_client_id: existingId, updated_at: now }).eq("id", id).is("converted_client_id", null);
      const fresh = await getLead(id);
      return fresh ? { lead: fresh, clientUid: existingId } : null;
    }
    throw new Error(ce.message);
  }

  await supa().from("leads").update({ stage: "won", converted_client_id: clientUid, updated_at: now }).eq("id", id);
  await insertActivity(id, { type: "system", source: "manual", by: repName, text: `הליד סומן כ-WON והומר ללקוח ע"י ${repName}` });

  // הליד נכנס אוטומטית לצינור "פגישות מצפן"
  await enterCompass(id, repName);

  return { lead: (await getLead(id))!, clientUid };
}

/** מכניס ליד לצינור "פגישות מצפן" (אם לא כבר בפנים). נקרא בעת סגירה/WON. */
export async function enterCompass(id: string, by = "מערכת"): Promise<Lead | null> {
  const lead = await getLead(id);
  if (!lead) return null;
  if (lead.compassStatus) return lead; // כבר בצינור — לא לדרוס סטטוס קיים
  const now = nowIso();
  await supa().from("leads").update({ compass_status: "not_scheduled", compass_entered_at: now, updated_at: now }).eq("id", id);
  await insertActivity(id, { type: "system", source: "manual", by, text: "🧭 נכנס לצינור פגישות מצפן (טרם תואמה פגישה)" });
  return getLead(id);
}

/** פותח/סוגר גישה לפורטל הלקוח (דגל דביק). טריגר גישה — לא משנה את שלב הפייפליין. */
export async function setPortalAccess(id: string, on: boolean, by: string): Promise<Lead | null> {
  const lead = await getLead(id);
  if (!lead) return null;
  if (!!lead.portalAccess === on) return lead; // אין שינוי
  await supa().from("leads").update({ portal_access: on, updated_at: nowIso() }).eq("id", id);
  await insertActivity(id, {
    type: "system", source: "manual", by,
    text: on ? "🔓 נפתחה גישה לפורטל הלקוח" : "🔒 נסגרה גישה לפורטל הלקוח",
  });
  return getLead(id);
}

/** משייך ליד לנציג (או מבטל שיוך עם null). מתועד ביומן. */
export async function assignLead(id: string, email: string | null, by: string): Promise<Lead | null> {
  const lead = await getLead(id);
  if (!lead) return null;
  await supa().from("leads").update({ assigned_to: email, updated_at: nowIso() }).eq("id", id);
  const rep = REPS.find((r) => r.email === email);
  await insertActivity(id, {
    type: "system", source: "manual", by,
    text: email ? `👤 הליד שויך ל${rep?.name || email}` : "👤 שיוך הנציג בוטל",
  });
  return getLead(id);
}

/** מסיר ליד מלוח פגישות המצפן. הליד עצמו נשאר במערכת. */
export async function leaveCompass(id: string, by: string): Promise<boolean> {
  const lead = await getLead(id);
  if (!lead) return false;
  await supa().from("leads").update({ compass_status: null, compass_entered_at: null, updated_at: nowIso() }).eq("id", id);
  await insertActivity(id, { type: "system", source: "manual", by, text: "🧭 הוסר מלוח פגישות מצפן" });
  return true;
}

/**
 * רשימת כל הלידים שנמצאים בצינור פגישות מצפן.
 * התיעוד מוגבל ל-50 הרשומות האחרונות לכל ליד — הכרטיס במסך המצפן הוא תצוגה
 * מקוצרת; לתיעוד המלא נכנסים לכרטיס הליד עצמו.
 */
export async function listCompassMeetings(): Promise<Lead[]> {
  const { data, error } = await supa()
    .from("leads")
    .select(SEL)
    .not("compass_status", "is", null)
    .order("compass_entered_at", { ascending: false })
    .order("at", { referencedTable: "lead_activity", ascending: false })
    .limit(ACTIVITY_PAGE_SIZE, { referencedTable: "lead_activity" });
  if (error) throw new Error(error.message);
  return (data as LeadRow[]).map(rowToLead);
}

/** עדכון סטטוס פגישת מצפן של ליד. */
export async function setCompassStatus(id: string, status: CompassStatus, by: string): Promise<Lead | null> {
  const lead = await getLead(id);
  if (!lead) return null;
  await supa().from("leads").update({ compass_status: status, updated_at: nowIso() }).eq("id", id);
  await insertActivity(id, { type: "system", source: "manual", by, text: `🧭 סטטוס פגישת מצפן עודכן ל: ${compassStatusLabel(status)}` });
  return getLead(id);
}

export async function deleteLead(id: string): Promise<boolean> {
  const { error } = await supa().from("leads").delete().eq("id", id);
  return !error;
}
