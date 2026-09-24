-- 0012 — קישור לקוחות (זוגות), סקשן מימון, תזכורת חתימה, התראת סיום שאלון

-- קישור בין לקוחות (זוג/שותפים) — סימטרי, שורה לכל כיוון
create table if not exists client_links (
  client_id uuid not null references clients(id) on delete cascade,
  linked_client_id uuid not null references clients(id) on delete cascade,
  relation text,
  created_at timestamptz default now(),
  created_by text,
  primary key (client_id, linked_client_id)
);
create index if not exists client_links_client_idx on client_links(client_id);
alter table client_links enable row level security;

-- תיק מימון ללקוח (תיק אחד ללקוח)
create table if not exists financing_cases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references clients(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by text
);
alter table financing_cases enable row level security;

-- בנקים/גורמי מימון בתיק — כל שורה = גורם עם סטטוס
create table if not exists financing_banks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references financing_cases(id) on delete cascade,
  bank_name text not null,
  status text not null default 'review',   -- review|approved|rejected|done|canceled
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by text
);
create index if not exists financing_banks_case_idx on financing_banks(case_id);
alter table financing_banks enable row level security;

-- תזכורת חתימה — מתי נשלחה תזכורת "3 ימים אחרי הפקה" למעטפה
alter table contract_envelopes add column if not exists sign_reminder_sent_at timestamptz;

-- התראת סיום/התקרבות שאלון — כדי לא לשלוח פעמיים
alter table clients add column if not exists near_complete_notified boolean default false;
alter table clients add column if not exists submit_notified boolean default false;
