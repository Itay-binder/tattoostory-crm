import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";
import { listCompassMeetings } from "@/lib/leadsRepo";

export const runtime = "nodejs";

// GET — כל הלידים בצינור "פגישות מצפן"
export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  const meetings = await listCompassMeetings();
  return NextResponse.json({ meetings });
}
