-- בקשות חיוג מרחוק: האתר (דסקטופ) מבקש מהפלאפון של הנציג לחייג ליד.
-- צד הפלאפון (PHONECRM) יצרוך את זה בשלב נפרד — כאן רק צד האתר.
create table if not exists call_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  lead_name text,
  lead_phone text not null,
  requested_by_email text not null,
  requested_by_name text,
  device_id text,                              -- לעתיד: בורר מכשיר
  status text not null default 'pending',      -- pending|approved|rejected|dialing|done|expired|canceled
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_call_requests_lead on call_requests (lead_id, created_at desc);
create index if not exists idx_call_requests_pending on call_requests (requested_by_email, status) where status = 'pending';

alter table call_requests enable row level security;
