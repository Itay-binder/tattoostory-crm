-- לוח תשלומים לעסקה: תזכורות תשלום ללקוחות המשובצים בעסקה.
create table if not exists deal_payments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  title text not null,
  amount numeric,
  due_date date not null,
  -- מתי להתריע מראש
  notify_week_before boolean not null default false,
  notify_day_before boolean not null default false,
  notify_same_day boolean not null default true,
  status text not null default 'pending',  -- pending | paid | canceled
  paid_at timestamptz,
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_deal_payments_deal on deal_payments (deal_id, due_date);
create index if not exists idx_deal_payments_due on deal_payments (due_date) where status = 'pending';

-- לקוחות שמשויכים לתשלום (מתוך הלקוחות של העסקה)
create table if not exists deal_payment_clients (
  payment_id uuid not null references deal_payments(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  primary key (payment_id, client_id)
);

-- מה כבר נשלח — מונע שליחה כפולה של אותה תזכורת
create table if not exists deal_payment_sends (
  payment_id uuid not null references deal_payments(id) on delete cascade,
  kind text not null,               -- week_before | day_before | same_day
  recipients text,
  sent_at timestamptz not null default now(),
  primary key (payment_id, kind)
);

alter table deal_payments enable row level security;
alter table deal_payment_clients enable row level security;
alter table deal_payment_sends enable row level security;
