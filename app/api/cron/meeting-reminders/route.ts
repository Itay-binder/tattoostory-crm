import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyAdmin } from "@/lib/admin";
import { runMeetingReminders } from "@/lib/meetingReminders";

export const runtime = "nodejs";
export const maxDuration = 60;

// סוכן רגב — תזכורות פגישות. מופעל ע"י Vercel Cron (Bearer CRON_SECRET) כל בוקר,
// או ידנית ע"י אדמין. ?mode=dry לבדיקה בלי שליחה.
export async function GET(req: Request) {
  const secret = env("CRON_SECRET");
  const auth = req.headers.get("authorization") || "";
  const isCron = secret && auth === `Bearer ${secret}`;
  const admin = isCron ? null : await verifyAdmin(req);
  if (!isCron && !admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const mode = new URL(req.url).searchParams.get("mode") === "dry" ? "dry" : "send";
  try {
    const r = await runMeetingReminders(mode);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
