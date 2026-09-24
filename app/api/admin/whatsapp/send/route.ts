import { NextResponse } from "next/server";
import { verifyAdmin } from "@/lib/admin";

export const runtime = "nodejs";

const BASE = `https://api.green-api.com/waInstance${process.env.GREENAPI_INSTANCE}`;
const TOKEN = process.env.GREENAPI_TOKEN;

export async function POST(req: Request) {
  const admin = await verifyAdmin(req);
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 403 });

  const { chatId, message } = await req.json();
  if (!chatId || !message) return NextResponse.json({ error: "chatId and message required" }, { status: 400 });

  try {
    const res = await fetch(`${BASE}/sendMessage/${TOKEN}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, message }),
    });
    if (!res.ok) return NextResponse.json({ error: "greenapi error", status: res.status }, { status: 502 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
