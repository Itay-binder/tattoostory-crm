import { addLeadActivity, convertLeadToClient, setCompassStatus, getLead } from "@/lib/leadsRepo";

// סימון תשלום מהפורטל — משותף ל-webhook ול-verify. אידמפוטנטי.
// returnValue = "<leadId>:<step>" (compass=500→WON, process=1000→התקדם).
export async function markPortalPayment(returnValue: string, paid: boolean, amount: number): Promise<{ marked: boolean; step?: string; leadId?: string }> {
  if (!paid || !returnValue) return { marked: false };
  const [refId, step] = returnValue.split(":");
  if (!refId) return { marked: false };
  const lead = await getLead(refId);
  if (!lead) return { marked: false };
  const amountText = `₪${(amount || 0).toLocaleString("he-IL")}`;
  if (step === "process") {
    // אידמפוטנטי: אם כבר התקדם — לא לתעד/לסמן שוב (מונע כפילות מכמה נתיבי אימות).
    if (lead.compassStatus === "progressed") return { marked: true, step: "process", leadId: lead.id };
    await addLeadActivity(lead.id, { type: "system", source: "api", by: "סליקת CardCom (פורטל)", text: `💳 בוצעה סליקה — ${amountText} — התקדמות לתהליך` });
    await setCompassStatus(lead.id, "progressed", "סליקת CardCom (פורטל)");
  } else {
    // אידמפוטנטי: אם כבר לקוח — לא לתעד/להמיר שוב.
    if (lead.convertedClientUid) return { marked: true, step: "compass", leadId: lead.id };
    await addLeadActivity(lead.id, { type: "system", source: "api", by: "סליקת CardCom (פורטל)", text: `💳 בוצעה סליקה — ${amountText} — פגישת מצפן` });
    await convertLeadToClient(lead.id, { email: "blog@powercouple.co.il", name: "סליקת CardCom (פורטל)" });
  }
  return { marked: true, step: step || "compass", leadId: lead.id };
}
