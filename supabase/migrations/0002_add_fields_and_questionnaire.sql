-- tattoostory-crm migration 0002
-- מוסיף שדות שמתאימים לסטטוסים האמיתיים מהשיטס

-- הוספת שדות לאנשי קשר
alter table contacts
  add column if not exists gender       text,          -- מגדר
  add column if not exists age          int,           -- גיל
  add column if not exists landing_page text,          -- דף השארת פרטים
  add column if not exists utm_ad       text;          -- מודעה (utm_content / ad name)

-- הוספת שדות לידים
alter table leads
  add column if not exists last_call        text,      -- שיחה אחרונה (מה קרה)
  add column if not exists notes_rep1       text,      -- הערות ליהי
  add column if not exists notes_rep2       text,      -- הערות שיר
  add column if not exists filled_questionnaire boolean not null default false,
  add column if not exists open_day         text;      -- יום פתוח

-- טבלת שאלוני מועמדות
create table if not exists questionnaires (
  id             uuid primary key default uuid_generate_v4(),
  contact_id     uuid references contacts(id) on delete cascade,
  -- שדות השאלון מהגוגל שיטס
  why_tattoo     text,           -- למה?
  goals          text,           -- מה המטרות?
  seriousness    int,            -- 1-10 כמה רציני
  will_do_tasks  text,           -- תבצע משימות?
  success_vision text,           -- איזה תוצאה זה הצלחה מסחררת
  understands_time text,         -- מבין שצריך לפחות 4 שעות
  needs_practice text,           -- כדי לראות תוצאות צריך ליישם
  not_quick_money text,          -- לא התעשרות מהירה
  session_recordings text,       -- הקלטות מפגשים חיים
  call_done      boolean,        -- בוצעה שיחה?
  raw_text       text,           -- טקסט גולמי מעמודה Z
  submitted_at   timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists questionnaires_contact_id_idx on questionnaires(contact_id);

-- עדכון הערה בסכמה: סטטוסים בעברית כפי שמשמשים בשיטס
comment on column leads.status is
  'ליד חדש | שיחה 1 יצאה | שתי שיחות יצאו | שלוש שיחות יצאו | 4 שיחות יצאו | אין מענה | נשלחה הודעה | נקבעה שיחה | בטיפול | מתעניינת | פולואפ עתידי | נסגר | לא רלוונטי';
