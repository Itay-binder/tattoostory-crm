// קריאה בלבד — כל מה שיש במערכת על ליד לפי שם/טלפון/מייל.
//   node scripts/_check-lead.mjs "ענת בוזגלו"
import fs from "node:fs";
import pg from "pg";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const q = (process.argv[2] || "").trim();
if (!q) { console.error('שימוש: node scripts/_check-lead.mjs "שם"'); process.exit(1); }

const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const digits = q.replace(/\D/g, "");
const { rows } = await c.query(
  `select * from leads
   where full_name ilike $1 or first_name ilike $1 or last_name ilike $1
      or email ilike $1 or ($2 <> '' and phone like $3)
   order by created_at`,
  [`%${q}%`, digits, `%${digits.slice(-9)}%`]);

if (!rows.length) { console.log(`לא נמצא ליד שתואם ל-"${q}"`); await c.end(); process.exit(0); }
console.log(`נמצאו ${rows.length} לידים\n`);

for (const l of rows) {
  console.log("=".repeat(78));
  console.log(`${l.full_name}   ${l.phone}   ${l.email || "(ללא מייל)"}`);
  console.log("=".repeat(78));
  console.log(`  שלב:            ${l.stage}`);
  console.log(`  נציגה:          ${l.assigned_to || "—"}`);
  console.log(`  נוצר:           ${new Date(l.created_at).toISOString().slice(0, 16).replace("T", " ")}`);
  console.log(`  קליטה אחרונה:   ${new Date(l.last_lead_at).toISOString().slice(0, 16).replace("T", " ")}`);
  console.log(`  עודכן:          ${new Date(l.updated_at).toISOString().slice(0, 16).replace("T", " ")}`);
  console.log(`  פגישת התאמה:    ${l.compass_status || "—"}`);
  console.log(`  מתי לחזור:      ${l.follow_up_at ? new Date(l.follow_up_at).toISOString().slice(0, 16).replace("T", " ") : "—"}`);
  console.log(`  לקוחה:          ${l.converted_client_id ? "כן" : "לא"}`);

  const qa = l.quali || {};
  console.log(`\n  שדות השאלון (${Object.keys(qa).length}):`);
  for (const [k, v] of Object.entries(qa)) console.log(`     ${k.padEnd(20)} ${String(v).slice(0, 90)}`);

  const cu = l.custom || {};
  console.log(`\n  שדות נוספים (${Object.keys(cu).length}):`);
  for (const [k, v] of Object.entries(cu)) console.log(`     ${k.padEnd(20)} ${String(v).slice(0, 90)}`);

  const acts = (await c.query(
    `select type, at, source, by_actor, text, fields from lead_activity
     where lead_id = $1 order by at, id`, [l.id])).rows;
  console.log(`\n  יומן התיעוד (${acts.length} רשומות):`);
  for (const a of acts) {
    const undated = a.fields && a.fields["תאריך התיעוד"] ? " ⟨ללא תאריך בגיליון⟩" : "";
    console.log(`     [${a.type}] ${String(a.by_actor || "—").padEnd(22)} ${new Date(a.at).toISOString().slice(0, 16).replace("T", " ")}${undated}`);
    if (a.text) for (const ln of String(a.text).split("\n")) console.log(`         ${ln.slice(0, 110)}`);
    if (a.fields && a.type === "intake") console.log(`         ${JSON.stringify(a.fields)}`);
  }
  if (l.converted_client_id) {
    const cl = (await c.query("select email, google_name, stage, converted_at, answers from clients where id = $1", [l.converted_client_id])).rows[0];
    console.log(`\n  כרטיס לקוחה: שלב=${cl.stage}  הומרה=${new Date(cl.converted_at).toISOString().slice(0, 10)}`);
  }
}
await c.end();
