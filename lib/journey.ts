// מנוע מסע הלקוח — גזירת השלב הנוכחי מתוך נתוני המערכת. פונקציה טהורה, client-safe.
// 8 השלבים (0-8) לפי החלטת איתי 09/2026. ראה docs/superpowers/specs/2026-09-01-client-journey-portal-design.md

export interface JourneyInput {
  hasLead: boolean;
  isWon: boolean;              // WON / compass_status≠null / הומר ללקוח
  compassProgressed: boolean;  // compass_status = 'progressed' (התקדמה)
  questionnairePct: number;    // 0-100
  contractSigned: boolean;     // הסכם התקשרות נחתם
  clientStage?: string | null; // שלב הלקוח (new/financing/assignment/signed/signed_more/...)
}

export interface JourneyStage {
  index: number;
  key: string;
  title: string;
  subtitle: string;
  state: "done" | "current" | "next" | "locked";
}

export const JOURNEY_STAGES: { key: string; title: string; subtitle: string }[] = [
  { key: "lead",       title: "שיחת היכרות",            subtitle: "האם ההכשרה מתאימה עבורך" },
  { key: "compass",    title: "פגישת התאמה",            subtitle: "שיחה אישית עם ליאור" },
  { key: "process",    title: "הרשמה והסכם",            subtitle: "שאלון מועמדות + חתימה על ההסכם" },
  { key: "banking",    title: "תשלום והבטחת מקום",      subtitle: "השלמת התשלום ושיבוץ למחזור" },
  { key: "bizplan",    title: "פתיחת המחזור",           subtitle: "ציוד, חומרים והמפגש הראשון" },
  { key: "signing",    title: "במהלך ההכשרה",           subtitle: "מפגשים, תרגול ומשימות" },
  { key: "mortgage",   title: "סיום והסמכה",            subtitle: "תיק עבודות ותעודה" },
  { key: "manage",     title: "ליווי אחרי ההכשרה",      subtitle: "שיווק עצמי וקבלת לקוחות" },
  { key: "sell",       title: "עובדת מהמקצוע",          subtitle: "סטודיו או עבודה עצמאית" },
];

// מיפוי שלב הלקוח (סקשן לקוחות) → שלב במסע. זו הסמכות ברגע שהלקוח בשלב עסקי.
// שלבים ללא מיפוי (new/retention/frozen/cancelled) נגזרים מההתקדמות בלבד.
const CLIENT_STAGE_FLOOR: Record<string, number> = {
  financing: 3,         // ממתינה לתשלום → תשלום והבטחת מקום
  assignment: 4,        // שובצה למחזור → פתיחת המחזור
  signing_scheduled: 5, // המחזור נפתח → במהלך ההכשרה
  signed: 6,            // בהכשרה → סיום והסמכה
  signed_more: 7,       // סיימה הכשרה → ליווי אחרי ההכשרה
};

/** מחזיר את האינדקס הגבוה שהושג (reachedMax). לוקח את המקסימום — לא נסוג אחורה. */
export function reachedMax(i: JourneyInput): number {
  if (!i.hasLead) return 0;
  let rm = 0;
  if (i.isWon) rm = 1;                                              // פגישת התאמה
  if (i.compassProgressed) rm = Math.max(rm, 2);                    // התקדם לתהליך
  if (i.questionnairePct >= 80 && i.contractSigned) rm = Math.max(rm, 3); // בנקאות
  const floor = CLIENT_STAGE_FLOOR[i.clientStage || ""];           // שלב הלקוח (עוקף התקדמות)
  if (floor != null) rm = Math.max(rm, floor);
  return rm;
}

/** בונה את מצבי השלבים (מואר/נוכחי/הבא/כבוי) מתוך reachedMax נתון. */
export function stagesFromReached(rm: number): JourneyStage[] {
  return JOURNEY_STAGES.map((s, idx) => {
    let state: JourneyStage["state"];
    if (idx < rm) state = "done";
    else if (idx === rm) state = "current";
    else if (idx === rm + 1) state = "next";
    else state = "locked";
    return { index: idx, key: s.key, title: s.title, subtitle: s.subtitle, state };
  });
}

/** בונה את רשימת השלבים עם המצב לתצוגה (מואר/נוכחי/הבא/כבוי). */
export function buildJourney(i: JourneyInput): { reachedMax: number; stages: JourneyStage[] } {
  const rm = reachedMax(i);
  return { reachedMax: rm, stages: stagesFromReached(rm) };
}
