// מודל נתונים לעסקאות — תשתית (ייפתח לעומק בהמשך). client-safe.

export const DEAL_STATUSES = [
  { key: "new", label: "חדשה" },
  { key: "assignment", label: "לשיבוץ" },
  { key: "signing_pending", label: "לתיאום חתימות" },
  { key: "signing_scheduled", label: "תואמו חתימות" },
  { key: "executing", label: "ביצוע העסקה" },
  { key: "closed", label: "נסגרה" },
  { key: "cancelled", label: "בוטלה" },
] as const;

export type DealStatus = (typeof DEAL_STATUSES)[number]["key"];

export function dealStatusLabel(key: string): string {
  return DEAL_STATUSES.find((s) => s.key === key)?.label || key;
}

/** פריט בצ'קליסט המשימות של העסקה. */
export interface DealChecklistItem {
  key: string;
  label: string;
  done: boolean;
  doneAt?: string;
  doneBy?: string;
  assignee?: string; // מי אחראי למשימה (אופציונלי)
}

/** משימות ברירת המחדל בצ'קליסט של כל עסקה. */
export const DEAL_CHECKLIST_ITEMS: { key: string; label: string }[] = [
  { key: "partners_agreement_prep", label: "הכנת הסכם שותפים" },
  { key: "partners_agreement_sign", label: "חתימות הסכם שותפים" },
  { key: "collection", label: "גבייה" },
  { key: "group_open", label: "פתיחת קבוצה" },
  { key: "schedule_sent", label: "שליחת לוח זמנים" },
  { key: "pinui_binui_sign", label: "חתימות פינוי בינוי" },
];

/** יום חתימות בעסקה. scope=all → כל הלקוחות מגיעים; specific → לקוחות מסוימים. */
export interface DealSigningDay {
  id: string;
  date: string;                 // YYYY-MM-DD
  scope: "all" | "specific";
  clientIds: string[];          // רלוונטי כש-scope=specific
  note?: string;
}

export interface DealField {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "textarea";
  options?: string[];
}

// שדות העסקה — מותאם לעסקאות נדל"ן של פאוור קאפל
export const DEAL_FIELDS: DealField[] = [
  { key: "address", label: "כתובת הנכס", type: "text" },
  { key: "city", label: "עיר", type: "text" },
  { key: "dealType", label: "סוג עסקה", type: "select", options: ["עסקת אקזיט", "הכנסה משכירות", "פינוי בינוי", "שליש / אופציה", "אחר"] },
  { key: "price", label: "מחיר / שווי (₪)", type: "number" },
  { key: "equity", label: "הון עצמי נדרש (₪)", type: "number" },
  { key: "expectedProfit", label: "רווח צפוי (₪)", type: "number" },
  { key: "timeline", label: "לוח זמנים משוער", type: "text" },
  { key: "partners", label: "שותפים / גורמים", type: "text" },
  { key: "notes", label: "תיאור והערות", type: "textarea" },
];

export interface DealActivity {
  id: string;
  type: "note" | "status" | "system";
  at: string;
  by: string;
  text?: string;
}

/** תזכורת תשלום בלוח התשלומים של העסקה */
export interface DealPayment {
  id: string;
  dealId: string;
  title: string;
  amount?: number;
  dueDate: string;           // YYYY-MM-DD
  notifyWeekBefore: boolean;
  notifyDayBefore: boolean;
  notifySameDay: boolean;
  status: "pending" | "paid" | "canceled";
  paidAt?: string;
  note?: string;
  /** לקוחות שהתזכורת נשלחת אליהם (מתוך לקוחות העסקה) */
  clientIds: string[];
  /** אילו תזכורות כבר נשלחו */
  sent: string[];
  createdAt: string;
}

export const NOTIFY_OPTIONS = [
  { key: "notifyWeekBefore", label: "שבוע לפני" },
  { key: "notifyDayBefore", label: "יום לפני" },
  { key: "notifySameDay", label: "באותו יום" },
] as const;

/** לקוח משובץ לעסקה */
export interface DealClient {
  clientId: string;
  fullName: string;
  email: string;
  phone: string;
  role?: string;
  addedAt: string;
}

export interface Deal {
  id: string;
  title: string;
  status: DealStatus;
  data: Record<string, string>; // DEAL_FIELDS
  /** לקוחות משובצים לעסקה (שיבוץ עסקה) */
  clients: DealClient[];
  /** לוח תשלומים */
  payments: DealPayment[];
  linkedLeadId?: string;
  linkedClientUid?: string;
  /** תכנית עסקית שתופק בהמשך */
  businessPlan?: string;
  /** קובץ תכנית עסקית (PDF) — נתיב אחסון + שם מקורי */
  businessPlanFile?: string;
  businessPlanFileName?: string;
  /** קובץ הסכם מכר (PDF) — נתיב אחסון + שם מקורי. מצורף גם למסמכי הלקוחות המשויכים */
  saleAgreementFile?: string;
  saleAgreementFileName?: string;
  /** צ'קליסט משימות העסקה */
  checklist: DealChecklistItem[];
  /** ימי חתימות */
  signingDays: DealSigningDay[];
  /** תיקיית הדרייב המשויכת לעסקה */
  driveFolderId?: string;
  driveFolderLink?: string;
  createdAt: string;
  updatedAt: string;
  activity: DealActivity[];
}

/** מחלץ מזהה תיקייה מקישור דרייב (או מקבל מזהה גולמי). מחזיר "" אם לא תקין. */
export function parseDriveFolderId(input: string): string {
  const s = String(input || "").trim();
  if (!s) return "";
  const m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  const id = m ? m[1] : s;
  return /^[a-zA-Z0-9_-]{10,}$/.test(id) ? id : "";
}

export const driveFolderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;
