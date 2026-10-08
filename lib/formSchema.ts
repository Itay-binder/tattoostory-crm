// סכמת שאלון המועמדות של האקדמיה — משותפת לקליינט (רינדור) ולשרת (Doc/PDF/Webhook)

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
      { key: "city", label: "עיר מגורים", type: "text", required: true },
      { key: "address", label: "כתובת מלאה", type: "text" },
      { key: "instagram", label: "שם המשתמש באינסטגרם", type: "text", placeholder: "@username" },
    ],
  },
  {
    key: "background",
    title: "רקע אמנותי",
    icon: "🎨",
    fields: [
      { key: "artExperience", label: "יש לך רקע באמנות או ציור", type: "yesno", required: true },
      { key: "artExperienceDetails", label: "ספרי/ספר על הרקע", type: "textarea", showIf: { key: "artExperience", equals: "כן" }, required: true },
      { key: "tattooExperience", label: "ניסיון קודם בקעקועים", type: "radio", required: true, options: ["אין ניסיון בכלל", "התנסיתי על עור סינטטי", "קעקעתי על אנשים", "עובד/ת בתחום"] },
      { key: "drawingStyle", label: "איזה סגנון מדבר אליך", type: "textarea", placeholder: "לדוגמה: פוינטיליזם, פיין ליין, בלאק וורק" },
      { key: "portfolioLink", label: "קישור לתיק עבודות (אם יש)", type: "text", placeholder: "דרייב / אינסטגרם / בהאנס" },
    ],
  },
  {
    key: "goals",
    title: "מטרות",
    icon: "🎯",
    fields: [
      { key: "whyTattoo", label: "למה קעקועים — מה הביא אותך לכאן", type: "textarea", required: true },
      { key: "goals", label: "מה המטרות שלך מההכשרה", type: "textarea", required: true },
      { key: "successVision", label: "איזו תוצאה תהיה בעיניך הצלחה מסחררת", type: "textarea", required: true },
      { key: "timeline", label: "מתי בא לך להתחיל לעבוד מזה", type: "radio", options: ["מיד בסיום ההכשרה", "תוך חצי שנה", "תוך שנה", "עדיין לא יודע/ת"] },
      { key: "currentWork", label: "במה את/ה עוסק/ת היום", type: "text" },
    ],
  },
  {
    key: "commitment",
    title: "מחויבות לתהליך",
    icon: "💪",
    fields: [
      { key: "seriousness", label: "כמה רציני/ת בסולם 1-10", type: "number", required: true },
      { key: "weeklyHours", label: "כמה שעות בשבוע תוכל/י להקדיש לתרגול", type: "radio", required: true, options: ["עד 4 שעות", "4-8 שעות", "8-15 שעות", "מעל 15 שעות"] },
      { key: "understandsTime", label: "מבין/ה שצריך לפחות 4 שעות תרגול בשבוע", type: "yesno", required: true },
      { key: "willDoTasks", label: "מתחייב/ת לבצע את המשימות בין המפגשים", type: "yesno", required: true },
      { key: "needsPractice", label: "מבין/ה שבלי יישום לא יהיו תוצאות", type: "yesno", required: true },
      { key: "notQuickMoney", label: "מבין/ה שזו לא התעשרות מהירה אלא מקצוע", type: "yesno", required: true },
      { key: "sessionRecordings", label: "מסכים/ה שהמפגשים החיים מוקלטים", type: "yesno", required: true },
    ],
  },
  {
    key: "logistics",
    title: "לוגיסטיקה",
    icon: "📅",
    fields: [
      { key: "howHeard", label: "איך הגעת אלינו", type: "select", required: true, options: ["אינסטגרם", "פייסבוק", "טיקטוק", "יוטיוב", "המלצה מחברה", "גוגל", "דף נחיתה", "אחר"] },
      { key: "hasEquipment", label: "יש לך ציוד קעקוע", type: "yesno" },
      { key: "availability", label: "אילו ימים ושעות נוחים לך למפגשים", type: "textarea" },
      { key: "paymentPreference", label: "העדפת תשלום", type: "radio", options: ["תשלום מלא", "פריסה לתשלומים", "עדיין בודק/ת"] },
    ],
  },
  {
    key: "extra",
    title: "מידע נוסף",
    icon: "📝",
    fields: [
      { key: "healthNotes", label: "משהו רפואי שחשוב שנדע (אלרגיות, רגישויות)", type: "textarea" },
      { key: "notes", label: "הערות נוספות", type: "textarea" },
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
  { key: "idDocs", label: "צילום תעודת זהות", hint: "לצורך ההסכם", multiple: false, required: true },
  { key: "portfolio", label: "תיק עבודות / איורים", hint: "תמונות של ציורים או קעקועים שעשית", multiple: true, required: true },
  { key: "paymentConfirm", label: "אישור תשלום / העברה בנקאית", multiple: true, required: false },
  { key: "equipmentPhotos", label: "תמונות הציוד שלך", hint: "רק אם יש לך ציוד", multiple: true, required: { key: "hasEquipment", equals: "כן" } },
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
