// מודל נתונים לסקשן מימון. client-safe — נטען גם בדפדפן.

// סטטוס גורם מימון (בנק) בתוך תיק
export const BANK_STATUSES = [
  { key: "review", label: "בבדיקה" },
  { key: "approved", label: "אושר" },
  { key: "rejected", label: "לא אושר" },
  { key: "done", label: "בוצע" },
  { key: "canceled", label: "בוטל" },
] as const;

export type BankStatus = (typeof BANK_STATUSES)[number]["key"];

export function bankStatusLabel(key: string): string {
  return BANK_STATUSES.find((s) => s.key === key)?.label || key;
}

export const BANK_STATUS_KIND: Record<string, string> = {
  review: "wait",
  approved: "done",
  rejected: "draft",
  done: "done",
  canceled: "draft",
};

// גורמי המימון המובנים (צ'קבוקסים בכרטיס) — אפשר להוסיף ידנית נוספים
export const PRESET_BANKS = [
  { name: "עדי יהב", label: "נשלח לעדי יהב" },
  { name: "חגית דיסקונט", label: "נשלח לחגית דיסקונט" },
  { name: "ליאת יהב", label: "נשלח לליאת יהב" },
  { name: "בבדיקה בבנק הלקוח", label: "בבדיקה בבנק הלקוח" },
] as const;

// גורמים שנספרים בנפרד בסטטיסטיקה; כל היתר = "בנק אחר"
export const TRACKED_BANKS = ["עדי יהב", "חגית דיסקונט", "ליאת יהב"];

export interface FinancingBank {
  id: string;
  caseId: string;
  bankName: string;
  status: BankStatus;
  note?: string;
  createdAt: string;
}

export interface FinancingCase {
  id: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  clientStage: string;
  submissionAmount?: number;   // סכום הגשה
  banks: FinancingBank[];
  createdAt: string;
  updatedAt: string;
}

/** פורמט מספר עם מפרידי אלפים (2000000 → 2,000,000). */
export function fmtAmount(n: number | undefined | null): string {
  if (n == null || isNaN(Number(n))) return "";
  return Number(n).toLocaleString("he-IL");
}

export interface FinancingStats {
  cases: number;
  adiYahav: number;
  hagitDiscount: number;
  liatYahav: number;
  otherBank: number;
  waitingApproval: number; // status=review
  approved: number;        // status=approved
}
