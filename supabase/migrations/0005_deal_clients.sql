-- שיבוץ עסקה: כמה לקוחות יכולים להיות משובצים לאותה עסקה.
create table if not exists deal_clients (
  deal_id uuid not null references deals(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  role text,
  added_by text,
  added_at timestamptz not null default now(),
  primary key (deal_id, client_id)
);
create index if not exists idx_deal_clients_deal on deal_clients (deal_id);
create index if not exists idx_deal_clients_client on deal_clients (client_id);
alter table deal_clients enable row level security;
