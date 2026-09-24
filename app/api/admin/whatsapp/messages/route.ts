import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";

export const runtime = "nodejs";

const BASE = `https://api.green-api.com/waInstance${process.env.GREENAPI_INSTANCE}`;
const TOKEN = process.env.GREENAPI_TOKEN;

export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const { chatId, count = 50 } = await req.json();
  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  try {
    const res = await fetch(`${BASE}/getChatHistory/${TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, count }),
    });
    if (!res.ok) return NextResponse.json({ error: "greenapi error", status: res.status }, { status: 502 });
    const messages = await res.json();
    return NextResponse.json({ messages: Array.isArray(messages) ? messages : [] });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
