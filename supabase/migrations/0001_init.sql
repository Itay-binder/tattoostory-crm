-- PowerCouple Finance/CRM — סכימת Supabase (Postgres יחסי מלא)
-- מיגרציה 1:1 מ-Firestore. כל הגישה בפועל דרך ה-API בצד שרת (service role);
-- RLS מופעל וחוסם anon/authenticated כברירת מחדל (service role עוקף).

create extension if not exists "pgcrypto";

-- ── טריגר updated_at משותף ──────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- ── אדמינים (רשימת הרשאה) ───────────────────────────────────────────
create table admins (
  email       text primary key,
  name        text default '',
  created_at  timestamptz not null default now()
);

-- ── לקוחות (finance_questionnaire) ─────────────────────────────────
create table clients (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid,                       -- Supabase auth.users (לקוח שהתחבר עם גוגל)
  email             text,
  email_key         text generated always as (lower(trim(email))) stored,
  google_name       text default '',
  status            text not null default 'draft',   -- draft | submitted | manual
  answers           jsonb not null default '{}'::jsonb,
  drive_folder_id   text,
  drive_folder_link text,
  from_lead_id      uuid,                       -- FK ל-leads (מוגדר אחרי יצירת leads)
  from_lead_source  text,
  converted_by_email text,
  converted_by_name  text,
  converted_at      timestamptz,
  submitted_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index clients_email_key_idx on clients(email_key);
create index clients_auth_user_idx on clients(auth_user_id);
create trigger clients_touch before update on clients for each row execute function set_updated_at();

-- ── לידים ──────────────────────────────────────────────────────────
create table leads (
  id                  uuid primary key default gen_random_uuid(),
  first_name          text default '',
  last_name           text default '',
  full_name           text default '',
  email               text default '',
  phone               text default '',           -- מנורמל 972…
  email_key           text generated always as (lower(trim(email))) stored,
  id_number           text default '',
  stage               text not null default 'new',
  answers             jsonb not null default '{}'::jsonb,   -- שדות השאלון
  quali               jsonb not null default '{}'::jsonb,   -- שדות filtertnx
  custom              jsonb not null default '{}'::jsonb,   -- שדות מותאמים
  converted_client_id uuid references clients(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  last_lead_at        timestamptz not null default now()
);
create index leads_email_key_idx on leads(email_key);
create index leads_phone_idx     on leads(phone);
create index leads_stage_idx     on leads(stage);
create trigger leads_touch before update on leads for each row execute function set_updated_at();

-- קשר לקוח→ליד (אחרי ששתי הטבלאות קיימות)
alter table clients add constraint clients_from_lead_fk
  foreign key (from_lead_id) references leads(id) on delete set null;

-- יומן פעילות של ליד (היה מערך משובץ — עכשיו טבלה יחסית)
create table lead_activity (
  id        uuid primary key default gen_random_uuid(),
  lead_id   uuid not null references leads(id) on delete cascade,
  type      text not null,                 -- intake | note | stage | system
  at        timestamptz not null default now(),
  source    text default '',               -- manual | api | csv | system
  by_actor  text default '',               -- אימייל משתמש / API / CSV
  text      text,
  fields    jsonb,                          -- לשדות שנקלטו (intake)
  created_at timestamptz not null default now()
);
create index lead_activity_lead_idx on lead_activity(lead_id, at desc);

-- ── קבצי לקוח (היו מערך במסמך) ─────────────────────────────────────
create table client_files (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  category      text not null default 'manual',
  name          text not null,
  size          bigint default 0,
  content_type  text,
  storage_path  text not null,
  drive_file_id text,
  uploaded_at   timestamptz not null default now()
);
create index client_files_client_idx on client_files(client_id);

-- ── הערות פנימיות על לקוח (היו מערך) ───────────────────────────────
create table admin_notes (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  text         text not null,
  author_email text,
  author_name  text,
  created_at   timestamptz not null default now()
);
create index admin_notes_client_idx on admin_notes(client_id, created_at desc);

-- ── עסקאות ─────────────────────────────────────────────────────────
create table deals (
  id                uuid primary key default gen_random_uuid(),
  title             text not null default 'עסקה חדשה',
  status            text not null default 'identified',
  data              jsonb not null default '{}'::jsonb,
  linked_lead_id    uuid references leads(id) on delete set null,
  linked_client_id  uuid references clients(id) on delete set null,
  business_plan     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger deals_touch before update on deals for each row execute function set_updated_at();

create table deal_activity (
  id        uuid primary key default gen_random_uuid(),
  deal_id   uuid not null references deals(id) on delete cascade,
  type      text not null,                 -- note | status | system
  at        timestamptz not null default now(),
  by_actor  text default '',
  text      text
);
create index deal_activity_deal_idx on deal_activity(deal_id, at desc);

-- ── תבניות חוזה ────────────────────────────────────────────────────
create table contract_templates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  storage_path text not null,
  page_count   int default 1,
  signer_count int default 1,
  fields       jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

-- ── מעטפות חוזה ────────────────────────────────────────────────────
create table contract_envelopes (
  id                 uuid primary key default gen_random_uuid(),
  template_id        uuid references contract_templates(id) on delete set null,
  template_name      text,
  storage_path       text,
  page_count         int default 1,
  signer_count       int default 1,
  fields             jsonb not null default '[]'::jsonb,
  sender_values      jsonb not null default '{}'::jsonb,
  client_data        jsonb not null default '{}'::jsonb,
  primary_client_id  uuid references clients(id) on delete set null,
  status             text not null default 'sent',      -- sent | partial | signed
  signed_pdf_path    text,
  signed_drive_id    text,
  signed_drive_link  text,
  created_at         timestamptz not null default now(),
  created_by         text
);

-- חותמים (מחליף גם את מערך signers וגם את אוסף contract_tokens)
create table contract_signers (
  id              uuid primary key default gen_random_uuid(),
  envelope_id     uuid not null references contract_envelopes(id) on delete cascade,
  signer_index    int not null,
  role            text,
  name            text,
  contact         text default '',
  client_id       uuid references clients(id) on delete set null,
  sign_order      int default 1,
  optional        boolean default false,
  token           text unique not null,              -- הקישור הציבורי לחתימה
  status          text not null default 'sent',      -- sent | opened | signed
  values          jsonb not null default '{}'::jsonb,
  signature_paths jsonb not null default '{}'::jsonb,
  opened_at       timestamptz,
  signed_at       timestamptz,
  ip              text
);
create index contract_signers_env_idx   on contract_signers(envelope_id, sign_order);
create unique index contract_signers_token_idx on contract_signers(token);

-- ── הגדרות (שורה יחידה) ────────────────────────────────────────────
create table settings (
  id            int primary key default 1 check (id = 1),
  api_key       text,
  custom_fields jsonb not null default '[]'::jsonb,
  field_map     jsonb not null default '{}'::jsonb,
  calendar      jsonb not null default '{}'::jsonb,
  meeting_types jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now()
);

-- ── הגבלת קצב לקליטת לידים ─────────────────────────────────────────
create table intake_rate (
  bucket     text primary key,     -- ip_minute
  c          int not null default 0,
  at         timestamptz not null default now()
);

-- ── RLS: חוסם anon/authenticated; ה-API עובד עם service role שעוקף ──
do $$ declare t text;
begin
  foreach t in array array['admins','clients','leads','lead_activity','client_files',
    'admin_notes','deals','deal_activity','contract_templates','contract_envelopes',
    'contract_signers','settings','intake_rate']
  loop execute format('alter table %I enable row level security;', t); end loop;
end $$;
