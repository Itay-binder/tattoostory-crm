-- פגישות מצפן: ליד שנסגר (WON / כפתור סגירה) נכנס גם לצינור "פגישות מצפן"
-- עם סטטוס פגישה עצמאי (טרם תואמה / תואמה / בוצעה טרם התקדם / התקדם).
alter table leads add column if not exists compass_status text;       -- null = לא בצינור פגישות מצפן
alter table leads add column if not exists compass_entered_at timestamptz;

create index if not exists idx_leads_compass on leads (compass_entered_at) where compass_status is not null;
