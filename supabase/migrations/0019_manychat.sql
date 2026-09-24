-- סקשן "מאניצ'אט" — מערכת פנימית ל-WABA + IG/FB automations. הטוקן ב-env (PC_META_SYSTEM_TOKEN).

-- חיבור מטא הנבחר (שורה יחידה id=1): איזה WABA/מספר/IG/עמוד בשימוש.
create table if not exists mc_settings (
  id int primary key default 1,
  waba_id text, waba_name text,
  phone_number_id text, phone_display text,
  ig_user_id text, ig_username text,
  fb_page_id text, fb_page_name text,
  connected_at timestamptz, connected_by text,
  updated_at timestamptz not null default now(),
  constraint mc_settings_single check (id = 1)
);
insert into mc_settings (id) values (1) on conflict (id) do nothing;

-- תגיות לאנשי קשר (לידים/לקוחות)
create table if not exists mc_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null, color text default '#ff3b3b',
  created_at timestamptz not null default now()
);
create table if not exists mc_contact_tags (
  tag_id uuid not null references mc_tags(id) on delete cascade,
  contact_type text not null,          -- 'lead' | 'client'
  contact_id uuid not null,
  added_at timestamptz not null default now(),
  primary key (tag_id, contact_type, contact_id)
);

-- מטמון טמפלייטים מ-WABA
create table if not exists mc_templates (
  id uuid primary key default gen_random_uuid(),
  waba_template_id text, name text not null, language text not null default 'he',
  category text, status text, body text, components jsonb,
  synced_at timestamptz not null default now(),
  unique (name, language)
);

-- דיוורים (שליחת טמפלייט לקהל)
create table if not exists mc_broadcasts (
  id uuid primary key default gen_random_uuid(),
  name text, template_name text, template_language text default 'he',
  audience jsonb, status text default 'draft',   -- draft|sending|done|failed
  total int default 0, sent int default 0, failed int default 0,
  created_at timestamptz not null default now(), created_by text
);
create table if not exists mc_broadcast_recipients (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references mc_broadcasts(id) on delete cascade,
  contact_type text, contact_id uuid, phone text,
  status text default 'pending', wamid text, error text, sent_at timestamptz
);

-- אוטומציות תגובה→DM (IG/FB)
create table if not exists mc_automations (
  id uuid primary key default gen_random_uuid(),
  name text, channel text not null,              -- 'ig' | 'fb'
  trigger jsonb,                                 -- {postId?, keywords[], matchType}
  action jsonb,                                  -- {dmText, publicReply?, buttons?}
  enabled boolean not null default true,
  stats jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(), created_by text
);

-- Inbox — שיחות והודעות (WABA/IG/FB)
create table if not exists mc_conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null,                         -- 'wa' | 'ig' | 'fb'
  external_id text not null,                     -- wa_id / psid / igsid
  contact_type text, contact_id uuid, name text, phone text,
  last_message_at timestamptz, last_text text, unread int default 0,
  created_at timestamptz not null default now(),
  unique (channel, external_id)
);
create table if not exists mc_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references mc_conversations(id) on delete cascade,
  direction text not null,                       -- 'in' | 'out'
  type text default 'text', text text, payload jsonb,
  wamid text, status text, at timestamptz not null default now()
);
create index if not exists ix_mc_messages_conv on mc_messages(conversation_id, at);
create index if not exists ix_mc_conv_last on mc_conversations(last_message_at desc);
