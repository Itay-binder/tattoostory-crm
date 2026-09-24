-- הרחבת מודל העסקה: הסכם מכר, צ'קליסט משימות, ימי חתימות, וסטטוסים חדשים.

-- 1) הסכם מכר (PDF) — נתיב אחסון + שם מקורי. מצורף אוטומטית למסמכי הלקוחות המשויכים לעסקה.
alter table deals add column if not exists sale_agreement_file text;
alter table deals add column if not exists sale_agreement_file_name text;

-- 2) צ'קליסט משימות פנימי לעסקה (JSONB: מערך {key,label,done,doneAt,doneBy,assignee}).
alter table deals add column if not exists checklist jsonb not null default '[]'::jsonb;

-- 3) ימי חתימות (JSONB: מערך {id,date,scope:'all'|'specific',clientIds:[],note}).
alter table deals add column if not exists signing_days jsonb not null default '[]'::jsonb;

-- 4) מיפוי סטטוסים ישנים לחדשים (executing/closed/cancelled נשמרים; היתר ממופים).
update deals set status = 'new'              where status = 'identified';
update deals set status = 'assignment'       where status = 'analyzing';
update deals set status = 'signing_pending'  where status = 'negotiation';
