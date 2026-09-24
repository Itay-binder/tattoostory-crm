import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";

export const runtime = "nodejs";

const BASE = `https://api.green-api.com/waInstance${process.env.GREENAPI_INSTANCE}`;
const TOKEN = process.env.GREENAPI_TOKEN;

export async function GET(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  try {
    const res = await fetch(`${BASE}/getChats/${TOKEN}`);
    if (!res.ok) return NextResponse.json({ error: "greenapi error", status: res.status }, { status: 502 });
    const chats = await res.json();
    return NextResponse.json({ chats: Array.isArray(chats) ? chats : [] });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
