// קריאה בלבד — מי נמצא בגיליונות ולא במערכת.
// נועד לאתר את החלון שבין הייבוא הראשוני לבין הרגע שהמייק התחיל להזין.
import fs from "node:fs";
import pg from "pg";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const S = "C:\\Users\\itay\\AppData\\Local\\Temp\\claude\\c--Users-itay---------\\96756694-79cb-409d-adf9-34e1bc4f651d\\scratchpad\\sheets";
const shir = JSON.parse(fs.readFileSync(`${S}\\shir_live2.json`, "utf8"));
const lior = JSON.parse(fs.readFileSync(`${S}\\lior_live2.json`, "utf8"));

const s = (v) => (v == null ? "" : String(v).replace(/[\u200e\u200f\u202a-\u202e]/g, "").trim());
const core = (raw) => { let d = s(raw).replace(/\D/g, ""); if (d.startsWith("00")) d = d.slice(2); if (d.startsWith("972")) d = d.slice(3); if (d.startsWith("0")) d = d.slice(1); return d; };
const mail = (v) => s(v).toLowerCase();
const nameKey = (v) => s(v).replace(/\s+/g, " ").toLowerCase();
const iso = (v) => { const t = s(v); if (!t) return null; const d = new Date(t); return isNaN(d) ? null : d.toISOString(); };

// 0=תאריך 1=מקור 3=שם 4=נציגה 5=מגדר 6=שיחות 7=סטטוס 8=שיחה אחרונה 10=ליהי 11=שיר/גילי 13=טלפון 14=מייל 15=הערות 17=יום פתוח
const TRACK = shir["מעקב לידים"].slice(1).map((r, i) => ({
  row: i + 2, createdAt: iso(r[0]), source: s(r[1]), name: s(r[3]), rep: s(r[4]), gender: s(r[5]),
  calls: s(r[6]), status: s(r[7]), lastCall: s(r[8]), callBack: s(r[9]),
  notesLihi: s(r[10]), notesShir: s(r[11]), phone: s(r[13]), email: s(r[14]),
  notes: s(r[15]), openDay: s(r[17]),
})).filter((x) => x.name || x.phone || x.email);

const FEED = lior["Sheet1"].slice(1).map((r, i) => ({
  row: i + 2, name: s(r[1]), phone: s(r[2]), email: s(r[3]), createdAt: iso(r[4]), status: s(r[5]),
  utmSource: s(r[6]), campaign: s(r[7]), adset: s(r[8]), ad: s(r[9]), fbclid: s(r[10]), landing: s(r[11]),
  gender: s(r[12]), age: s(r[13]), why: s(r[14]), goals: s(r[15]), serious: s(r[16]), tasks: s(r[17]),
  success: s(r[18]), time4h: s(r[19]), practice: s(r[20]), notQuick: s(r[21]), recordings: s(r[22]),
})).filter((x) => x.name || x.phone || x.email);

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const db = (await c.query("select id, full_name, phone, email from leads")).rows;
const byPhone = new Map(), byMail = new Map(), byName = new Map();
for (const l of db) {
  if (core(l.phone)) byPhone.set(core(l.phone), l);
  if (mail(l.email)) byMail.set(mail(l.email), l);
  if (nameKey(l.full_name)) byName.set(nameKey(l.full_name), l);
}
const inDb = (x) => byPhone.get(core(x.phone)) || byMail.get(mail(x.email)) || byName.get(nameKey(x.name)) || null;

console.log(`במערכת: ${db.length} לידים`);
console.log(`בגיליון המעקב: ${TRACK.length} שורות · בפיד: ${FEED.length} שורות\n`);

const missTrack = TRACK.filter((x) => !inDb(x) && (core(x.phone) || mail(x.email)));
const missFeed = FEED.filter((x) => !inDb(x) && (core(x.phone) || mail(x.email)));

// מאחדים לפי אדם
const people = new Map();
const add = (x, src) => {
  const k = core(x.phone) || mail(x.email) || nameKey(x.name);
  if (!people.has(k)) people.set(k, { name: x.name, phone: x.phone, email: x.email, track: null, feed: null });
  const p = people.get(k);
  if (!p.name) p.name = x.name;
  if (!p.phone) p.phone = x.phone;
  if (!p.email) p.email = x.email;
  p[src] = x;
};
for (const x of missTrack) add(x, "track");
for (const x of missFeed) add(x, "feed");

console.log(`חסרים במערכת: ${people.size} אנשים`);
console.log(`   (${missTrack.length} שורות בגיליון המעקב, ${missFeed.length} בפיד)\n`);

const list = [...people.values()].sort((a, b) => {
  const da = a.feed?.createdAt || a.track?.createdAt || "";
  const db2 = b.feed?.createdAt || b.track?.createdAt || "";
  return da.localeCompare(db2);
});
for (const p of list) {
  const d = p.feed?.createdAt || p.track?.createdAt;
  console.log(`  ${(d ? d.slice(0, 16).replace("T", " ") : "ללא תאריך").padEnd(17)} ${String(p.name).padEnd(20)} ${String(p.phone || "—").padEnd(14)} ${p.email || "—"}`);
  if (p.track) console.log(`      מעקב: נציגה=${p.track.rep || "—"} · ${p.track.calls || "—"} · סטטוס=${p.track.status || "—"}${p.track.lastCall ? ` · שיחה אחרונה=${p.track.lastCall}` : ""}`);
  if (p.feed?.why) console.log(`      שאלון: מולא`);
}

// חלון הזמן של הפער
const dates = list.map((p) => p.feed?.createdAt || p.track?.createdAt).filter(Boolean).sort();
if (dates.length) console.log(`\nטווח התאריכים של החסרים: ${dates[0].slice(0, 16).replace("T", " ")} → ${dates[dates.length - 1].slice(0, 16).replace("T", " ")}`);
await c.end();
