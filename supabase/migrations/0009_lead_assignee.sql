-- שיוך ליד לנציג (מייל של אדמין)
alter table leads add column if not exists assigned_to text;
create index if not exists idx_leads_assigned on leads (assigned_to);
