// מריץ את קבצי supabase/migrations לפי סדר שם הקובץ, ומתעד מה הורץ ב-_migrations.
// הרצה: node scripts/apply-migrations.mjs
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

function loadEnv(file = ".env.local") {
  const txt = fs.readFileSync(file, "utf8");
  for (const line of txt.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error("missing SUPABASE_DB_URL"); process.exit(1); }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

await client.query(`create table if not exists _migrations (
  name text primary key,
  applied_at timestamptz not null default now()
)`);

const dir = "supabase/migrations";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const done = new Set((await client.query("select name from _migrations")).rows.map((r) => r.name));

let ok = 0, skipped = 0;
for (const f of files) {
  if (done.has(f)) { console.log(`· skip   ${f}`); skipped++; continue; }
  const sql = fs.readFileSync(path.join(dir, f), "utf8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into _migrations(name) values ($1)", [f]);
    await client.query("commit");
    console.log(`✓ applied ${f}`);
    ok++;
  } catch (e) {
    await client.query("rollback");
    console.error(`✗ FAILED  ${f}\n   ${e.message}`);
    await client.end();
    process.exit(1);
  }
}
console.log(`\napplied=${ok} skipped=${skipped} total=${files.length}`);
await client.end();
