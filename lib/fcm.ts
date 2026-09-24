import { supa } from "@/lib/supabaseAdmin";
import { env } from "@/lib/env";
import type { CallRequest } from "@/lib/leads";

// שליחת פוש (FCM) למכשיר של הנציג — כך בקשת החיוג מגיעה מיידית,
// בלי שירות רקע באפליקציה ובלי צריכת סוללה.

interface Sa { project_id: string; client_email: string; private_key: string }

function sa(): Sa | null {
  const b64 = env("FIREBASE_SA_B64");
  if (!b64) return null;
  try { return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as Sa; }
  catch { return null; }
}

/** OAuth token עבור FCM v1 (ללא תלות ב-firebase-admin). */
async function accessToken(s: Sa): Promise<string | null> {
  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({
    credentials: { client_email: s.client_email, private_key: s.private_key },
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  const client = await auth.getClient();
  const t = await client.getAccessToken();
  return t.token || null;
}

/** שולח בקשת חיוג לכל המכשירים של הנציג. מחזיר כמה מכשירים קיבלו. */
export async function pushCallRequest(r: CallRequest): Promise<number> {
  const s = sa();
  if (!s) return 0;

  const { data: devices } = await supa()
    .from("rep_devices").select("token").eq("email", r.requestedByEmail.toLowerCase());
  if (!devices?.length) return 0;

  const token = await accessToken(s);
  if (!token) return 0;

  let sent = 0;
  await Promise.all(devices.map(async (d: { token: string }) => {
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${s.project_id}/messages:send`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token: d.token,
            // data-only: האפליקציה בונה את ההתראה בעצמה (גם כשהיא סגורה)
            data: {
              type: "call_request",
              requestId: r.id,
              financeLeadId: r.leadId || "",
              leadName: r.leadName || "ליד",
              leadPhone: r.leadPhone,
            },
            android: { priority: "HIGH" },
          },
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) sent++;
      else if (res.status === 404) {
        // טוקן לא תקף יותר — מנקים
        await supa().from("rep_devices").delete().eq("token", d.token);
      }
    } catch { /* מתעלמים ממכשיר בודד שנכשל */ }
  }));
  return sent;
}
