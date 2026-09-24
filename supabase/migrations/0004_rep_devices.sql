-- מכשירי הנציגים (טוקני פוש FCM) — נכתבים ע"י אפליקציית PHONECRM ומסונכרנים לכאן,
-- כדי שהדסקטופ ידע לאיזה מכשיר לשלוח את בקשת החיוג.
create table if not exists rep_devices (
  token text primary key,
  email text not null,
  platform text not null default 'android',
  updated_at timestamptz not null default now()
);
create index if not exists idx_rep_devices_email on rep_devices (email);
alter table rep_devices enable row level security;
