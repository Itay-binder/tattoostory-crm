-- שלב הלקוח בתהליך (חדש → מימון → לשיבוץ → חתמו דירה)
alter table clients add column if not exists stage text not null default 'new';
create index if not exists idx_clients_stage on clients (stage);
