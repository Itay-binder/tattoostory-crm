-- יומן אישי לכל נציג (מייל אדמין → הגדרת יומן). פגישות פולואפ נקבעות ביומן של הנציג שסימן.
alter table settings add column if not exists rep_calendars jsonb not null default '{}'::jsonb;
