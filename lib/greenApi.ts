// כתובת הבסיס של GreenAPI.
//
// הדומיין הישן `api.green-api.com` הפסיק להגיב (10/2026) — הוא עדיין נפתר ב-DNS
// אבל לכתובת שלא מקבלת חיבורים, ולכן כל קריאה נתקעת ב-timeout בלי שגיאה ברורה.
// GreenAPI עברו לכתובת לפי אינסטנס: ארבע הספרות הראשונות של מזהה האינסטנס
// כתת-דומיין של `greenapi.com` (בלי המקף). למשל 7105326802 → 7105.api.greenapi.com
//
// ניתן לעקוף בכל רגע דרך GREENAPI_BASE, אם יחליפו שוב.
export function greenApiBase(instance?: string): string {
  const override = (process.env.GREENAPI_BASE || "").trim().replace(/\/+$/, "");
  if (override) return override;
  const id = (instance || process.env.GREENAPI_INSTANCE || "").trim();
  const prefix = id.slice(0, 4);
  return prefix ? `https://${prefix}.api.greenapi.com` : "https://api.greenapi.com";
}

/** כתובת מלאה למתודה של GreenAPI: base/waInstance<id>/<method>/<token> */
export function greenApiUrl(instance: string, token: string, method: string): string {
  return `${greenApiBase(instance)}/waInstance${instance}/${method}/${token}`;
}
