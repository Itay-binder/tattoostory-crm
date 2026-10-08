// שלבי הלקוחה בתהליך (אחרי שנסגרה). client-safe — נטען גם בדפדפן.

export const CLIENT_STAGES = [
  { key: "new", label: "חדשה" },
  { key: "no_compass_scheduled", label: "טרם תואמה פגישת התאמה" },
  { key: "no_meeting", label: "טרם ביצעה פגישה" },
  { key: "no_meeting_no_answer", label: "טרם ביצעה פגישה אין מענה" },
  { key: "not_progressed", label: "טרם התקדמה" },
  { key: "stuck", label: "לא מתקדמת" },
  { key: "financing", label: "ממתינה לתשלום" },
  { key: "assignment", label: "שובצה למחזור" },
  { key: "signing_scheduled", label: "המחזור נפתח" },
  { key: "signed", label: "בהכשרה" },
  { key: "signed_more", label: "סיימה הכשרה 🎓" },
  { key: "retention", label: "לשימור" },
  { key: "frozen", label: "הקפאה (נעלמה באמצע תהליך)" },
  { key: "lost_no_contact", label: "אבוד - לא ליצור קשר" },
  { key: "cancelled", label: "בוטל" },
  { key: "financial_recovery", label: "פריסת תשלומים" },
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
