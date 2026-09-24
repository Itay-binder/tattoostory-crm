// טיפוסים משותפים למערכת החתימה הדיגיטלית (בטוח לקליינט — בלי תלויות שרת)

export type FieldType = "text" | "date" | "number" | "signature";

// מקור/בעלות הערך:
//  - "sender"   — השולח (אדמין) ממלא
//  - "signerN"  — החותם ה-N ממלא (signer1, signer2, ...)
//  - "clientData:<key>" — auto-fill ממפתח נתוני לקוח
export type FieldSource = "sender" | "auto:today" | `signer${number}` | `clientData:${string}`;

export const MAX_SIGNERS = 4;

export interface ContractField {
  id: string;
  page: number; // אינדקס עמוד (0-based)
  x: number; // יחסי 0-1 (פינה שמאלית-עליונה)
  y: number;
  w: number; // רוחב יחסי 0-1
  h: number; // גובה יחסי 0-1
  type: FieldType;
  label: string;
  source: FieldSource;
  required: boolean;
}

export interface ContractTemplate {
  id: string;
  name: string;
  storagePath: string;
  pageCount: number;
  signerCount: number; // כמה חותמים במסמך (1 = הסכם רגיל, 2 = זוגי, וכו')
  fields: ContractField[];
  createdAt: string;
}

export type InstanceStatus = "sent" | "opened" | "signed";

export interface ContractInstance {
  token: string;
  templateId: string;
  templateName: string;
  clientUid?: string;
  signerName: string;
  signerContact?: string;
  coupleGroupId?: string;
  role: "primary" | "partner";
  status: InstanceStatus;
  values: Record<string, string>;
  signaturePaths?: Record<string, string>;
  signedPdfPath?: string;
  signedDriveId?: string;
  audit?: { ip?: string; signedAt?: string };
  createdAt: string;
  openedAt?: string;
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "טקסט",
  date: "תאריך",
  number: "מספר",
  signature: "חתימה",
};

// מפתחות נתוני לקוח הזמינים ל-auto-fill (מתוך השאלון הפיננסי)
export const CLIENT_DATA_KEYS: { key: string; label: string }[] = [
  { key: "fullName", label: "שם מלא" },
  { key: "idNumber", label: "תעודת זהות" },
  { key: "phone", label: "טלפון" },
  { key: "birthDate", label: "תאריך לידה" },
  { key: "maritalStatus", label: "מצב משפחתי" },
  { key: "city", label: "עיר" },
  { key: "address", label: "כתובת מלאה" },
];

export function clientDataKeyOf(source: FieldSource): string | null {
  return source.startsWith("clientData:") ? source.slice("clientData:".length) : null;
}

/** האם המקור הוא חותם אינטראקטיבי (signerN) — ומספרו */
export function signerIndexOf(source: FieldSource): number | null {
  const m = /^signer(\d+)$/.exec(source);
  return m ? Number(m[1]) : null;
}

/** תווית עברית למקור הערך */
export function sourceLabel(source: FieldSource): string {
  if (source === "sender") return "השולח ממלא";
  if (source === "auto:today") return "אוטומטי — תאריך היום";
  const si = signerIndexOf(source);
  if (si) return `חותם ${si} ממלא`;
  const key = clientDataKeyOf(source);
  if (key) {
    const k = CLIENT_DATA_KEYS.find((c) => c.key === key);
    return `אוטומטי — ${k?.label || key}`;
  }
  return source;
}

/** אפשרויות מקור לבחירה בעורך, לפי מספר החותמים */
export function sourceOptions(signerCount: number): { value: FieldSource; label: string }[] {
  const opts: { value: FieldSource; label: string }[] = [{ value: "sender", label: "השולח ממלא" }];
  for (let i = 1; i <= signerCount; i++) opts.push({ value: `signer${i}` as FieldSource, label: `חותם ${i} ממלא` });
  opts.push({ value: "auto:today" as FieldSource, label: "אוטומטי — תאריך היום (DD/MM/YYYY)" });
  for (const k of CLIENT_DATA_KEYS) opts.push({ value: `clientData:${k.key}` as FieldSource, label: `אוטומטי — ${k.label}` });
  return opts;
}
