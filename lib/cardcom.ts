// אינטגרציית CardCom — Low Profile (v11 REST). יוצר דף סליקה מתארח, מנפיק קבלה, ומאמת בקולבק.
// סודות ב-env: CARDCOM_TERMINAL / CARDCOM_API_NAME / CARDCOM_API_PASSWORD (ראה mcp-tokens/cardcom.json).

const BASE = process.env.CARDCOM_BASE || "https://secure.cardcom.solutions";

function cfg() {
  return {
    terminal: Number(process.env.CARDCOM_TERMINAL || "0"),
    apiName: process.env.CARDCOM_API_NAME || "",
    apiPassword: process.env.CARDCOM_API_PASSWORD || "",
  };
}

export interface CreateCheckoutOpts {
  amount: number;
  productName: string;
  returnValue: string;         // מזהה לזיהוי הליד בקולבק (למשל leadId)
  customerName: string;
  customerEmail: string;
  successUrl: string;
  failedUrl: string;
  webhookUrl: string;
}

/** יוצר דף סליקה Low Profile ומחזיר את ה-URL להפניה. זורק אם נכשל. */
export async function createLowProfile(o: CreateCheckoutOpts): Promise<{ url: string; lowProfileId: string }> {
  const c = cfg();
  if (!c.terminal || !c.apiName) throw new Error("CardCom לא מוגדר (terminal/apiName)");
  const body = {
    TerminalNumber: c.terminal,
    ApiName: c.apiName,
    Amount: o.amount,
    ReturnValue: o.returnValue,
    Language: "he",
    ISOCoinId: 1, // ILS
    ProductName: o.productName,
    SuccessRedirectUrl: o.successUrl,
    FailedRedirectUrl: o.failedUrl,
    WebHookUrl: o.webhookUrl,
    Document: {
      Name: o.customerName || o.customerEmail,
      Email: o.customerEmail,
      IsSendByEmail: true,
      Products: [{ Description: o.productName, UnitCost: o.amount, Quantity: 1 }],
    },
  };
  const res = await fetch(`${BASE}/api/v11/LowProfile/Create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (data.ResponseCode !== 0 || !data.Url) {
    throw new Error(`CardCom Create נכשל: ${data.Description || data.ResponseCode || res.status}`);
  }
  return { url: data.Url as string, lowProfileId: String(data.LowProfileId || "") };
}

/** מאמת עסקה מול CardCom לפי LowProfileId (לשימוש בקולבק — לא לסמוך על הצד-לקוח). */
export async function getLpResult(lowProfileId: string): Promise<{ paid: boolean; amount: number; returnValue: string }> {
  const c = cfg();
  const res = await fetch(`${BASE}/api/v11/LowProfile/GetLpResult`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ TerminalNumber: c.terminal, ApiName: c.apiName, LowProfileId: lowProfileId }),
  });
  const d = await res.json().catch(() => ({}));
  // ResponseCode 0 = עסקה הושלמה. 5119 = ממתינה. TranzactionId>0 = יש עסקה בפועל (גיבוי).
  const paid = d.ResponseCode === 0 || d.ResponseCode === "0" || Number(d.TranzactionId) > 0;
  return {
    paid,
    amount: Number(d.TranzactionInfo?.Amount || d.Amount || 0),
    returnValue: String(d.ReturnValue || d.TranzactionInfo?.ReturnValue || ""),
  };
}
