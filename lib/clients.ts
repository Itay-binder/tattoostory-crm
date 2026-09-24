// שלבי הלקוח בתהליך (אחרי שהפך ללקוח). client-safe — נטען גם בדפדפן.

export const CLIENT_STAGES = [
  { key: "new", label: "חדש" },
  { key: "no_compass_scheduled", label: "טרם תואם מצפן" },
  { key: "no_meeting", label: "טרם ביצעו פגישה" },
  { key: "no_meeting_no_answer", label: "טרם ביצע פגישה אין מענה" },
  { key: "not_progressed", label: "טרם התקדמו" },
  { key: "stuck", label: "לא מתקדם" },
  { key: "financing", label: "מימון" },
  { key: "assignment", label: "לשיבוץ" },
  { key: "signing_scheduled", label: "שובץ לחתימה" },
  { key: "signed", label: "חתמו דירה" },
  { key: "signed_more", label: "חתם רוצה עוד 🐰" },
  { key: "retention", label: "לשימור" },
  { key: "frozen", label: "הקפאה (נעלם באמצע תהליך)" },
  { key: "lost_no_contact", label: "אבוד - לא ליצור קשר" },
  { key: "cancelled", label: "בוטל" },
  { key: "financial_recovery", label: "הבראה פיננסית" },
] as const;

export type ClientStage = (typeof CLIENT_STAGES)[number]["key"];

export function clientStageLabel(key: string): string {
  return CLIENT_STAGES.find((s) => s.key === key)?.label || key;
}

/** צבע הצ'יפ לכל שלב */
export const CLIENT_STAGE_KIND: Record<string, string> = {
  new: "draft",
  no_compass_scheduled: "draft",
  no_meeting: "draft",
  no_meeting_no_answer: "draft",
  not_progressed: "wait",
  stuck: "danger",
  financial_recovery: "wait",
  financing: "wait",
  assignment: "sent",
  signing_scheduled: "sent",
  signed: "done",
  signed_more: "done",
  retention: "wait",
  frozen: "draft",
  lost_no_contact: "danger",
  cancelled: "draft",
};

// קצב הלקוח — כמה מהר הוא מתקדם בתהליך. נבחר מכרטיס הלקוח, עם תאריך עדכון אחרון.
export const CLIENT_PACES = ["איטי", "זריז", "מהיר מאוד"] as const;
export type ClientPace = (typeof CLIENT_PACES)[number];

// שלבים שאינם זמינים לשיבוץ לעסקה: חתמו דירה, הקפאה, בוטל.
// "חתם רוצה עוד" כן זמין (לקוח חוזר), וכל היתר (חדש/מימון/לשיבוץ/לשימור) זמינים.
export const DEAL_UNASSIGNABLE_STAGES = ["signed", "frozen", "cancelled", "lost_no_contact"];
export function isAssignableToDeal(stage: string): boolean {
  return !DEAL_UNASSIGNABLE_STAGES.includes(stage);
}
