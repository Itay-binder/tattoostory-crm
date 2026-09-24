// מודל נתונים ללידים — מיני CRM בתוך האדמין של השאלון הפיננסי.
// לידים נשמרים באוסף Firestore נפרד `leads`. שדות השאלון של הלקוח יכולים להיות ריקים.
// חשוב: קובץ זה נטען גם בצד-לקוח — אין לייבא כאן קוד שרת (firebase-admin וכו').

/** נרמול מספר טלפון ישראלי לפורמט בינלאומי (972…). client-safe. */
export function normalizeIsraeliPhone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("972")) return d;
  if (d.startsWith("0")) return "972" + d.slice(1);
  if (d.length === 9 && d.startsWith("5")) return "972" + d;
  return d;
}

/** שלבי המשפך — משותפים ללידים וללקוחות (לדשבורד). */
export const LEAD_STAGES = [
  { key: "new", label: "ליד חדש" },
  { key: "contacted", label: "יצאה שיחה" },
  { key: "no_answer_1", label: "אין מענה 1" },
  { key: "no_answer_2", label: "אין מענה 2" },
  { key: "no_answer_3", label: "אין מענה 3" },
  { key: "followup", label: "פולואפ" },
  { key: "watching", label: "במעקב" },
  { key: "relevant", label: "ליד רלוונטי" },
  // תיאום עצמי מהאתר — הלקוח קבע פגישה ביומן (Cal.com בדף vsltnx) אחרי הרשמה ב-VSL
  { key: "meeting_scheduled", label: "תיאם פגישה" },
  { key: "compass", label: "הגיע לפגישת מצפן" },
  { key: "progressed", label: "התקדם לתהליך" },
  { key: "in_process", label: "בתהליך" },
  { key: "done", label: "סיים תהליך" },
  { key: "won", label: "סגר (לקוח)" },
  { key: "lost", label: "לא רלוונטי" },
  // רדום — ליד שנכנס מ-Optione ואיש לא נגע בו 45+ יום. נמצא מחוץ למשפך בכוונה:
  // אינו מזייף את יחסי ההמרה בדשבורד (funnelIdx מחזיר -1), ואינו נכנס לתור
  // "תותח השיחות" ב-PHONECRM, שמושך רק new/in_progress/followup.
  // ניתן להחזיר ליד רדום ל"ליד חדש" בכל רגע מכרטיס הליד.
  { key: "dormant", label: "ליד רדום" },
  // ייבוא היסטורי מ-Pipedrive. שניהם מחוץ למשפך הדשבורד בכוונה (funnelIdx=-1)
  // וגם לא נמשכים לתותח השיחות ב-PHONECRM — כדי לא לפגוע בסטטיסטיקות/בתור החיוג.
  { key: "pipe", label: "רשום פייפ" },        // איש קשר מ-Pipedrive שלא נסגר
  { key: "won_pipe", label: "WON PIPE" },      // סגר עסקה ב-Pipedrive
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number]["key"];

export function stageLabel(key: string): string {
  return LEAD_STAGES.find((s) => s.key === key)?.label || key;
}

/**
 * חיווי "חום" הליד לפי כמה פעמים השאיר פרטים (custom.submit_count):
 * פעם 1 = 🔵 טרי · פעם 2 = 🔴 חוזר · פעם 3+ = 🔥 חם מאוד.
 * ליד שחוזר ומשאיר פרטים שוב מעיד על התעניינות מוגברת.
 */
export function leadTempEmoji(submitCount: number | string | undefined): string {
  const n = Number(submitCount) || 1;
  return n >= 3 ? "🔥" : n === 2 ? "🔴" : "🔵";
}

/**
 * שלבים שלא מוצגים כטאב סינון מהיר במסך הלידים (עדיין קיימים במשפך ובדשבורד).
 * שלבי "התהליך" מנוהלים בלקוחות/עסקאות, לא במסך הלידים.
 */
const NO_QUICK_TAB = new Set(["progressed", "in_process", "done"]);
export const QUICK_FILTER_STAGES = LEAD_STAGES.filter((s) => !NO_QUICK_TAB.has(s.key));

/** סטטוסי "פגישות מצפן" — צינור נפרד שאליו נכנס ליד ברגע שנסגר (WON). */
export const COMPASS_STATUSES = [
  { key: "not_scheduled", label: "טרם תואמה פגישה" },
  { key: "scheduled", label: "תואמה פגישה" },
  { key: "met_no_progress", label: "בוצעה פגישה טרם התקדם" },
  { key: "progressed", label: "התקדם" },
] as const;

export type CompassStatus = (typeof COMPASS_STATUSES)[number]["key"];

export function compassStatusLabel(key: string): string {
  return COMPASS_STATUSES.find((s) => s.key === key)?.label || key;
}

/** מקורות הגעה (filtertnx) — הבסיס לפילוח בדשבורד. */
export const LEAD_SOURCES = [
  "המלצה מחבר",
  "אינסטגרם",
  "פייסבוק",
  "טיקטוק",
  "יוטיוב",
  "מודעת פופ-אפ",
  "אתגרים / מדריכים חינמיים",
  "אחר",
] as const;

/** פרמטרי UTM שנקלטים מהטופס — נשמרים תחת lead.custom עם המפתחות הללו. */
export const UTM_FIELDS = [
  { key: "utm_source", label: "מקור (UTM Source)" },
  { key: "utm_medium", label: "מדיום (UTM Medium)" },
  { key: "utm_campaign", label: "קמפיין (UTM Campaign)" },
  { key: "utm_content", label: "תוכן (UTM Content)" },
] as const;

export const UTM_KEYS = UTM_FIELDS.map((f) => f.key) as readonly string[];

export function utmLabel(key: string): string {
  return UTM_FIELDS.find((f) => f.key === key)?.label || key;
}

/** שדות ההסמכה מהשאלון ב-powercouple.co.il/filtertnx — נשמרים תחת lead.quali */
export interface QualiField {
  key: string;
  label: string;
  type: "text" | "number" | "radio";
  options?: string[];
}

export const QUALI_FIELDS: QualiField[] = [
  { key: "source", label: "איך הגעת אלינו", type: "radio", options: [...LEAD_SOURCES] },
  { key: "familiarity", label: "רמת היכרות", type: "radio", options: ["מכיר/ה אתכם ואת התהליך ורוצה להתחיל", "ראיתי אתכם כמה פעמים", "מכיר/ה מזמן אבל יש לי חששות", "ראיתי מודעה והתעניינתי"] },
  { key: "knownDuration", label: "כמה זמן אתם מכירים אותנו", type: "radio", options: ["גיליתי אתכם לאחרונה", "פחות מ-3 חודשים", "3–6 חודשים", "מעל 6 חודשים"] },
  { key: "age", label: "גיל", type: "number" },
  { key: "gender", label: "מין", type: "radio", options: ["זכר", "נקבה"] },
  { key: "maritalStatus", label: "מצב משפחתי", type: "radio", options: ["נשוי/אה", "רווק/ה", "ידוע/ה בציבור", "אלמן/ה", "גרוש/ה", "הורה יחידני/ת"] },
  { key: "liquidSavings", label: "הון נזיל", type: "radio", options: ["עד 100 אלף ₪", "100-200 אלף ₪", "200-300 אלף ₪", "מעל 300 אלף ₪"] },
  { key: "investmentGoal", label: "מטרת ההשקעה", type: "radio", options: ["הגדלת ההון העצמי דרך עסקת אקזיט", "יצירת הכנסה משכירות"] },
  { key: "propertyOwnership", label: "בעלות על נכס", type: "radio", options: ["בעל/ת שליש נכס / עסקת אופציה", "בעל/ת נכס ורוצה נוסף", "אין נכס נוסף"] },
  { key: "employed", label: "מועסק/ת כרגע", type: "radio", options: ["כן", "לא"] },
  { key: "monthlySavings", label: "חיסכון חודשי", type: "radio", options: ["עד 1,000 ₪", "1,000-3,000 ₪", "3,000-6,000 ₪", "מעל 6,000 ₪"] },
  { key: "understandConsultation", label: "הבנה: פגישת מומחה", type: "text" },
  { key: "understandProcess", label: "הבנה: תהליך הליווי", type: "text" },
  { key: "finalConfirmation", label: "אישור סופי", type: "text" },
];

/** סטטוסי בקשת חיוג מרחוק (דסקטופ → פלאפון). client-safe. */
export const CALL_REQUEST_STATUSES: Record<string, { label: string; kind: "wait" | "sent" | "done" | "draft" }> = {
  pending: { label: "ממתין לאישור בפלאפון", kind: "wait" },
  approved: { label: "אושר בפלאפון", kind: "sent" },
  dialing: { label: "מחייג…", kind: "sent" },
  done: { label: "השיחה בוצעה", kind: "done" },
  rejected: { label: "נדחה בפלאפון", kind: "draft" },
  expired: { label: "פג תוקף", kind: "draft" },
  canceled: { label: "בוטל", kind: "draft" },
};

export interface CallRequest {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  requestedByEmail: string;
  requestedByName: string;
  deviceId?: string;
  status: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LeadActivity {
  id: string;
  /** intake = קליטת ליד (ידני/API/CSV), note = הערה ידנית, stage = שינוי שלב, system = מערכת */
  type: "intake" | "note" | "stage" | "system";
  at: string; // ISO
  /** מקור הביצוע: "manual" | "api" | "csv" | "system" */
  source: string;
  /** מי ביצע — אימייל משתמש (לידני), או "API"/"CSV" */
  by: string;
  /** לטקסט חופשי (note) או תיאור (system/stage) */
  text?: string;
  /** לקליטה — אילו שדות נכנסו בקליטה זו */
  fields?: Record<string, string>;
}

// קטגוריית ליד: מכירות (הפייפליין הרגיל) מול רשימת תפוצה (לידים לא-בשלים).
export const LEAD_CATEGORIES = { sales: "מכירות", distribution: "רשימת תפוצה" } as const;
export type LeadCategory = keyof typeof LEAD_CATEGORIES;

/**
 * האם הדף שממנו הגיע הליד הוא דף "רשימת תפוצה" (לא-בשל).
 * נבדק לפי landingpage / page_slug / page_url ב-custom.
 * הדפים (החלטת איתי 09/2026): VSL2, pinuybinuy-live2026, "דף חוברת עבודה ישיר".
 */
export function isDistributionLead(custom?: Record<string, string> | null): boolean {
  const c = custom || {};
  const lp = (c.landingpage || "").trim();
  const slug = `${c.page_slug || ""} ${c.page_url || ""}`;
  return (
    /VSL2/i.test(lp) ||
    /חוברת עבודה/.test(lp) ||
    /הדרכה בלייב/.test(lp) ||
    /הרשמה לוובינר/.test(lp) ||   // pinuybinuy-live2026 שולח landingpage="הרשמה לוובינר פינוי בינוי"
    /pinuybinuy/i.test(slug) ||
    /pinuybinuy/i.test(lp)
  );
}

export interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string; // מנורמל 972…
  idNumber: string;
  stage: LeadStage;
  /** שדות השאלון של הלקוח (formSchema) — כולם אופציונליים */
  answers: Record<string, string>;
  /** שדות ההסמכה מ-filtertnx */
  quali: Record<string, string>;
  /** שדות מותאמים אישית (מוגדרים בהגדרות) */
  custom: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  /** תאריך הקליטה האחרונה של ליד (intake) */
  lastLeadAt: string;
  /** קטגוריה: מכירות (ברירת מחדל) או רשימת תפוצה */
  category?: LeadCategory;
  /** תאריך הקליטה האחרון לרשימת תפוצה (אם רלוונטי) */
  distributionLastAt?: string;
  activity: LeadActivity[];
  /** סך רשומות התיעוד בדאטהבייס. activity מכיל רק את החלון שנטען (50 אחרונות). */
  activityTotal?: number;
  /** הנציג שהליד משויך אליו (מייל אדמין) */
  assignedTo?: string;
  /** אם הומר ללקוח — uid הלקוח */
  convertedClientUid?: string;
  /** סטטוס בצינור "פגישות מצפן" — קיים רק לאחר סגירת הליד (WON) */
  compassStatus?: CompassStatus;
  /** מתי נכנס לצינור פגישות מצפן */
  compassEnteredAt?: string;
  /** גישה לפורטל הלקוח נפתחה (דגל דביק — טריגר גישה, לא שלב) */
  portalAccess?: boolean;
}

/** קלט לקליטת/עדכון ליד (ידני/API/CSV). */
export interface LeadIntake {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  idNumber?: string;
  answers?: Record<string, string>;
  quali?: Record<string, string>;
  custom?: Record<string, string>;
}

export function normalizeEmail(raw?: string): string {
  return (raw || "").trim().toLowerCase();
}

/** בונה הודעת ווצאפ עם פרטי הליד: כותרת מודגשת + פרטי קשר + שדות הסמכה שמולאו. */
export function buildLeadWhatsappMessage(lead: {
  fullName: string; phone: string; email: string; idNumber: string;
  quali: Record<string, string>; answers: Record<string, string>; stage: string;
}): string {
  const lines: string[] = [];
  lines.push(`*ליד — ${lead.fullName || "ללא שם"}*`);
  lines.push("");
  const contact: string[] = [];
  if (lead.phone) contact.push(`טלפון: ${lead.phone}`);
  if (lead.email) contact.push(`מייל: ${lead.email}`);
  if (lead.idNumber) contact.push(`ת.ז: ${lead.idNumber}`);
  contact.push(`שלב: ${stageLabel(lead.stage)}`);
  lines.push(contact.join("\n"));

  const qrows = QUALI_FIELDS.map((f) => (lead.quali[f.key]?.trim() ? `${f.label}: ${lead.quali[f.key].trim()}` : "")).filter(Boolean);
  if (qrows.length) { lines.push("", "*פרטי הסמכה*", ...qrows); }

  return lines.join("\n").trim();
}

/** בונה שם מלא משם פרטי+משפחה אם לא סופק במפורש. */
export function deriveFullName(i: { firstName?: string; lastName?: string; fullName?: string }): string {
  const explicit = (i.fullName || "").trim();
  if (explicit) return explicit;
  return [i.firstName, i.lastName].map((s) => (s || "").trim()).filter(Boolean).join(" ").trim();
}

/** מפתח זיהוי כפילות — מייל מנורמל או טלפון מנורמל. */
export function dedupKeys(i: { email?: string; phone?: string }): { email: string; phone: string } {
  return { email: normalizeEmail(i.email), phone: normalizeIsraeliPhone(i.phone || "") };
}
