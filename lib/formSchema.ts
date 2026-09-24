// סכמת השאלון הפיננסי — משותפת לקליינט (רינדור) ולשרת (Doc/PDF/Webhook)

export type FieldType = "text" | "tel" | "number" | "date" | "select" | "radio" | "textarea" | "yesno";

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  // מוצג רק כשתשובה אחרת שווה לערך מסוים
  showIf?: { key: string; equals: string };
}

export interface Section {
  key: string;
  title: string;
  icon: string;
  fields: Field[];
}

export const SECTIONS: Section[] = [
  {
    key: "personal",
    title: "פרטים אישיים",
    icon: "👤",
    fields: [
      { key: "fullName", label: "שם מלא", type: "text", required: true },
      { key: "idNumber", label: "תעודת זהות", type: "text", required: true, placeholder: "9 ספרות" },
      { key: "phone", label: "טלפון נייד", type: "tel", required: true, placeholder: "050-0000000" },
      { key: "birthDate", label: "תאריך לידה", type: "date", required: true },
      { key: "age", label: "גיל", type: "number" },
      { key: "maritalStatus", label: "מצב משפחתי", type: "select", required: true, options: ["רווק/ה", "נשוי/אה", "ידועים בציבור", "גרוש/ה", "אלמן/ה"] },
      { key: "childrenCount", label: "מספר ילדים (אם רלוונטי)", type: "number" },
      { key: "city", label: "מקום מגורים (עיר)", type: "text", required: true },
      { key: "address", label: "כתובת מלאה", type: "text", required: true },
      { key: "housingType", label: "סוג מגורים", type: "radio", required: true, options: ["שכירות", "בעלות", "אחר"] },
      { key: "housingTenure", label: "ותק במקום המגורים הנוכחי", type: "text", placeholder: "למשל: 3 שנים" },
    ],
  },
  {
    key: "employment",
    title: "תעסוקה והכנסות",
    icon: "💼",
    fields: [
      { key: "workplace", label: "מקום עבודה נוכחי", type: "text", required: true },
      { key: "role", label: "תפקיד", type: "text", required: true },
      { key: "jobTenure", label: "ותק במקום העבודה", type: "text", required: true, placeholder: "למשל: שנתיים" },
      { key: "employmentType", label: "סוג העסקה", type: "radio", required: true, options: ["שכיר", "עצמאי"] },
      { key: "netIncome", label: "הכנסה חודשית נטו (₪)", type: "number", required: true },
      { key: "extraIncome", label: "הכנסות נוספות (אם קיימות)", type: "textarea", placeholder: "מקור וסכום" },
    ],
  },
  {
    key: "banks",
    title: "חשבונות בנק",
    icon: "🏦",
    fields: [
      { key: "activeBanks", label: "באילו בנקים קיימים חשבונות פעילים", type: "textarea", required: true },
      { key: "mainBank", label: "מהו הבנק המרכזי", type: "text", required: true },
      { key: "mainBankTenure", label: "ותק החשבון המרכזי", type: "text" },
      { key: "otherAccounts", label: "חשבונות נוספים או סגורים בשנים האחרונות", type: "textarea" },
    ],
  },
  {
    key: "loans",
    title: "התחייבויות והלוואות",
    icon: "📋",
    fields: [
      { key: "hasLoans", label: "האם קיימות הלוואות פעילות", type: "yesno", required: true },
      { key: "loanTypes", label: "סוגי ההלוואות (משכנתא / גישור / צרכנית / קרנות השתלמות וכו')", type: "textarea", showIf: { key: "hasLoans", equals: "כן" }, required: true },
      { key: "monthlyRepayment", label: "החזר חודשי כולל (₪)", type: "number", showIf: { key: "hasLoans", equals: "כן" }, required: true },
      { key: "totalLoanBalance", label: "יתרת הלוואות כוללת (₪)", type: "number", showIf: { key: "hasLoans", equals: "כן" }, required: true },
      { key: "hasGuarantors", label: "האם קיימים ערבים להלוואות", type: "yesno", showIf: { key: "hasLoans", equals: "כן" } },
    ],
  },
  {
    key: "assets",
    title: "חסכונות ונכסים",
    icon: "💰",
    fields: [
      { key: "deposits", label: "פיקדונות / חסכונות קיימים", type: "textarea" },
      { key: "pensionFunds", label: "קרנות השתלמות / קופות גמל", type: "textarea" },
      { key: "realEstate", label: "נכסי נדל\"ן קיימים (אם יש)", type: "textarea" },
    ],
  },
  {
    key: "extra",
    title: "מידע נוסף",
    icon: "📝",
    fields: [
      { key: "irregularities", label: "החזרות או חריגות בחשבון בשנים האחרונות (אם היו)", type: "textarea" },
      { key: "notes", label: "הערות נוספות שחשוב שנדע לצורך הבדיקה", type: "textarea" },
    ],
  },
];

export interface FileCategory {
  key: string;
  label: string;
  hint?: string;
  multiple: boolean;
  required: boolean | { key: string; equals: string };
}

export const FILE_CATEGORIES: FileCategory[] = [
  { key: "bankStatements", label: "עו\"ש 3 חודשים אחרונים", hint: "קובץ PDF מכל אחד מהחשבונות", multiple: true, required: true },
  { key: "balancesSummary", label: "ריכוז יתרות", multiple: true, required: true },
  { key: "loansSummary", label: "ריכוז הלוואות", hint: "רק אם יש הלוואות פעילות", multiple: true, required: { key: "hasLoans", equals: "כן" } },
  { key: "idDocs", label: "תעודת זהות משני הצדדים + ספח", multiple: true, required: true },
  { key: "paySlips", label: "3 תלושי שכר אחרונים", hint: "לשכירים", multiple: true, required: { key: "employmentType", equals: "שכיר" } },
];

export type Answers = Record<string, string>;

export interface UploadedFile {
  category: string;
  name: string;
  size: number;
  contentType: string;
  storagePath: string;
  uploadedAt: string;
  driveFileId?: string;
}

export function isFieldVisible(field: Field, answers: Answers): boolean {
  if (!field.showIf) return true;
  return answers[field.showIf.key] === field.showIf.equals;
}

export function isCategoryRequired(cat: FileCategory, answers: Answers): boolean {
  if (typeof cat.required === "boolean") return cat.required;
  return answers[cat.required.key] === cat.required.equals;
}

export function missingRequiredFields(answers: Answers): { section: string; label: string }[] {
  const missing: { section: string; label: string }[] = [];
  for (const section of SECTIONS) {
    for (const field of section.fields) {
      if (!field.required || !isFieldVisible(field, answers)) continue;
      if (!answers[field.key] || !String(answers[field.key]).trim()) {
        missing.push({ section: section.title, label: field.label });
      }
    }
  }
  return missing;
}
