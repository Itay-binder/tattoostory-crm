"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, firebaseAuth, type User } from "@/lib/authClient";
import AdminNav from "../AdminNav";

interface Chat {
  id: string;
  name?: string;
  lastMessage?: { textMessage?: string; timestamp?: number; type?: string };
  unreadCount?: number;
}

interface Message {
  idMessage: string;
  type: "incoming" | "outgoing";
  typeMessage: string;
  textMessage?: string;
  timestamp: number;
  senderName?: string;
  senderId?: string;
}

function formatTime(ts: number) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

function phoneFromChatId(chatId: string) {
  return chatId.replace("@c.us", "").replace("@g.us", "");
}

export default function WhatsAppPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [filteredChats, setFilteredChats] = useState<Chat[]>([]);
  const [search, setSearch] = useState("");
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [sendText, setSendText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => onAuthStateChanged(firebaseAuth(), (u) => { setUser(u); setAuthReady(true); }), []);

  const getToken = async () => (await firebaseAuth().currentUser?.getIdToken()) ?? "";

  const loadChats = useCallback(async () => {
    setChatsLoading(true);
    setErr(null);
    try {
      const t = await getToken();
      const res = await fetch("/api/admin/whatsapp/chats", { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) throw new Error(`שגיאה ${res.status}`);
      const d = await res.json();
      const sorted = (d.chats as Chat[]).sort((a, b) => {
        const ta = a.lastMessage?.timestamp ?? 0;
        const tb = b.lastMessage?.timestamp ?? 0;
        return tb - ta;
      });
      setChats(sorted);
      setFilteredChats(sorted);
    } catch (e) {
      setErr(String(e));
    } finally {
      setChatsLoading(false);
    }
  }, []);

  useEffect(() => { if (user) loadChats(); }, [user, loadChats]);

  useEffect(() => {
    const q = search.toLowerCase();
    if (!q) { setFilteredChats(chats); return; }
    setFilteredChats(chats.filter((c) => {
      const name = (c.name || "").toLowerCase();
      const phone = phoneFromChatId(c.id);
      return name.includes(q) || phone.includes(q);
    }));
  }, [search, chats]);

  const loadMessages = useCallback(async (chat: Chat) => {
    setSelectedChat(chat);
    setMessages([]);
    setMsgLoading(true);
    try {
      const t = await getToken();
      const res = await fetch("/api/admin/whatsapp/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ chatId: chat.id, count: 100 }),
      });
      if (!res.ok) throw new Error(`שגיאה ${res.status}`);
      const d = await res.json();
      const msgs = (d.messages as Message[]).sort((a, b) => a.timestamp - b.timestamp);
      setMessages(msgs);
    } catch (e) {
      setErr(String(e));
    } finally {
      setMsgLoading(false);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!selectedChat || !sendText.trim() || sending) return;
    const text = sendText.trim();
    setSending(true);
    setSendText("");
    try {
      const t = await getToken();
      const res = await fetch("/api/admin/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ chatId: selectedChat.id, message: text }),
      });
      if (!res.ok) throw new Error("שליחה נכשלה");
      const optimistic: Message = {
        idMessage: `opt-${Date.now()}`,
        type: "outgoing",
        typeMessage: "textMessage",
        textMessage: text,
        timestamp: Math.floor(Date.now() / 1000),
      };
      setMessages((prev) => [...prev, optimistic]);
    } catch (e) {
      setErr(String(e));
      setSendText(text);
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  if (!authReady) return <main className="pcf-wrap pcf-wide"><div className="pcf-spin" style={{ margin: "60px auto" }} /></main>;
  if (!user) return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
      <div className="pcf-card" style={{ maxWidth: 380, width: "100%", margin: "0 18px", textAlign: "center", padding: "40px 32px" }}>
        <img src="https://tattoostoryacademy.com/wp-content/uploads/2025/03/black_logo.png" alt="Tattoo Story Academy" style={{ height: 60, objectFit: "contain", marginBottom: 24, filter: "brightness(0) invert(1)" }} />
        <h1 style={{ fontSize: 22, marginBottom: 28, fontWeight: 700 }}>כניסת מנהלים</h1>
      </div>
    </main>
  );

  return (
    <main className="pcf-wrap pcf-wide" style={{ paddingBottom: 0 }}>
      <AdminNav />

      <div style={{ display: "flex", height: "calc(100vh - 120px)", gap: 0, border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", background: "var(--card)" }}>

        {/* רשימת שיחות */}
        <div style={{ width: 320, minWidth: 220, borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", background: "var(--bg-2)", flexShrink: 0 }}>
          <div style={{ padding: "14px 12px 10px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>📱 ווצאפ</span>
              <button className="pcf-icon-btn" onClick={loadChats} title="רענן" style={{ fontSize: 14 }}>↺</button>
            </div>
            <input
              type="search"
              placeholder="חפש שם או מספר..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--text)", fontSize: 14, outline: "none", boxSizing: "border-box" }}
            />
          </div>

          <div style={{ flex: 1, overflowY: "auto" }}>
            {chatsLoading && <div className="pcf-spin" style={{ margin: "30px auto" }} />}
            {err && !chatsLoading && <p style={{ color: "#f87171", fontSize: 13, padding: "10px 12px" }}>{err}</p>}
            {!chatsLoading && filteredChats.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 13, padding: "20px 12px", textAlign: "center" }}>אין שיחות</p>
            )}
            {filteredChats.map((chat) => {
              const active = selectedChat?.id === chat.id;
              const lastText = chat.lastMessage?.textMessage || (chat.lastMessage?.type ? `[${chat.lastMessage.type}]` : "");
              const lastTs = chat.lastMessage?.timestamp;
              return (
                <div
                  key={chat.id}
                  onClick={() => loadMessages(chat)}
                  style={{
                    padding: "12px 14px",
                    cursor: "pointer",
                    borderBottom: "1px solid var(--line)",
                    background: active ? "rgba(110,132,120,0.15)" : "transparent",
                    borderRight: active ? "3px solid var(--accent)" : "3px solid transparent",
                    transition: "background 0.12s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 3 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
                      {chat.name || phoneFromChatId(chat.id)}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>
                      {lastTs ? formatTime(lastTs) : ""}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>
                      {lastText || ""}
                    </span>
                    {(chat.unreadCount ?? 0) > 0 && (
                      <span style={{ background: "var(--accent)", color: "#fff", borderRadius: 10, fontSize: 11, padding: "2px 7px", flexShrink: 0 }}>
                        {chat.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* חלון שיחה */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {!selectedChat ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: "var(--muted)" }}>
              <span style={{ fontSize: 48 }}>💬</span>
              <p style={{ fontSize: 15 }}>בחר שיחה מהרשימה</p>
            </div>
          ) : (
            <>
              {/* כותרת שיחה */}
              <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10, background: "var(--bg-2)" }}>
                <div style={{ width: 38, height: 38, borderRadius: "50%", background: "linear-gradient(135deg, var(--accent), var(--accent-2))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                  👤
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{selectedChat.name || phoneFromChatId(selectedChat.id)}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{phoneFromChatId(selectedChat.id)}</div>
                </div>
              </div>

              {/* הודעות */}
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
                {msgLoading && <div className="pcf-spin" style={{ margin: "30px auto" }} />}
                {!msgLoading && messages.length === 0 && (
                  <p style={{ color: "var(--muted)", textAlign: "center", marginTop: 40 }}>אין הודעות</p>
                )}
                {messages.map((msg) => {
                  const isOut = msg.type === "outgoing";
                  const text = msg.textMessage || (msg.typeMessage !== "textMessage" ? `[${msg.typeMessage}]` : "");
                  return (
                    <div key={msg.idMessage} style={{ display: "flex", justifyContent: isOut ? "flex-start" : "flex-end" }}>
                      <div style={{
                        maxWidth: "72%",
                        padding: "9px 14px",
                        borderRadius: isOut ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
                        background: isOut ? "var(--surface-2)" : "linear-gradient(135deg, var(--accent), var(--accent-2))",
                        color: isOut ? "var(--text)" : "#fff",
                        fontSize: 14,
                        lineHeight: 1.5,
                        wordBreak: "break-word",
                      }}>
                        {!isOut && msg.senderName && (
                          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3, opacity: 0.8 }}>{msg.senderName}</div>
                        )}
                        <div style={{ whiteSpace: "pre-wrap" }}>{text}</div>
                        <div style={{ fontSize: 11, marginTop: 4, opacity: 0.65, textAlign: "left" }}>{formatTime(msg.timestamp)}</div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* שליחת הודעה */}
              <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", background: "var(--bg-2)", display: "flex", gap: 10, alignItems: "flex-end" }}>
                <textarea
                  ref={inputRef}
                  value={sendText}
                  onChange={(e) => setSendText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="כתוב הודעה... (Enter לשליחה, Shift+Enter לשורה חדשה)"
                  rows={1}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid var(--line)",
                    background: "var(--surface)",
                    color: "var(--text)",
                    fontSize: 14,
                    resize: "none",
                    outline: "none",
                    fontFamily: "inherit",
                    lineHeight: 1.5,
                    maxHeight: 120,
                    overflowY: "auto",
                  }}
                  onInput={(e) => {
                    const t = e.currentTarget;
                    t.style.height = "auto";
                    t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
                  }}
                />
                <button
                  className="pcf-btn"
                  onClick={sendMessage}
                  disabled={sending || !sendText.trim()}
                  style={{ flexShrink: 0, padding: "10px 18px", opacity: sending || !sendText.trim() ? 0.5 : 1 }}
                >
                  {sending ? "שולח..." : "שלח ▸"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
