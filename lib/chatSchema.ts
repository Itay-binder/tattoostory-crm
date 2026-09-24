// תיאור הסכימה שנמסר ל-AI כדי שיכתוב שאילתות נכונות.
// מתעדכן ידנית כשמוסיפים טבלאות/עמודות משמעותיות.

export const DB_SCHEMA = `
מסד נתונים: Postgres (Supabase) של ה-CRM של פאוור קאפל.
כל התאריכים ב-UTC (timestamptz). אזור הזמן העסקי הוא Asia/Jerusalem —
בשאילתות על תאריכים השתמש ב-(col AT TIME ZONE 'Asia/Jerusalem').

TABLE leads  -- לידים (3,000+)
  id uuid, first_name text, last_name text, full_name text,
  email text, phone text (מנורמל: 972XXXXXXXXX),
  id_number text,
  stage text  -- new=ליד חדש, contacted=יצאה שיחה, followup=פולואפ, watching=במעקב,
              -- relevant=ליד רלוונטי, compass=הגיע לפגישת מצפן, progressed=התקדם לתהליך,
              -- in_process=בתהליך, done=סיים תהליך, won=סגר (הפך ללקוח), lost=לא רלוונטי,
              -- dormant=ליד רדום
  assigned_to text  -- מייל הנציג המשויך (assaf@/regev@/itay@binder.co.il/blog@)
  quali jsonb   -- שדות הסמכה מהשאלון. מפתחות: source (מקור הגעה), familiarity,
                -- knownDuration, age, gender, maritalStatus, liquidSavings,
                -- investmentGoal, propertyOwnership, employed, monthlySavings
  custom jsonb  -- שדות מותאמים. מפתחות שימושיים: utm_source, utm_medium,
                -- utm_campaign, utm_content, landingpage, form_name
  answers jsonb -- תשובות השאלון הפיננסי (אם מולא)
  compass_status text  -- not_scheduled/scheduled/met_no_progress/progressed (רק אם בלוח פגישות מצפן)
  compass_entered_at timestamptz
  converted_client_id uuid  -- אם הומר ללקוח
  created_at timestamptz    -- מתי נכנס לראשונה
  last_lead_at timestamptz  -- מתי נקלט לאחרונה (כניסה חוזרת של אותו ליד!)
  updated_at timestamptz

TABLE lead_activity  -- יומן תיעוד של כל ליד
  id uuid, lead_id uuid -> leads.id,
  type text  -- intake=קליטת ליד, note=הערה, stage=שינוי שלב, system=מערכת
  at timestamptz, source text (manual/api/csv), by_actor text, text text, fields jsonb

TABLE clients  -- לקוחות (מי שסגר)
  id uuid, email text, google_name text,
  answers jsonb  -- תשובות השאלון. מפתחות: fullName, phone, idNumber, birthDate, city ועוד
  status text    -- draft=טיוטה, submitted=הגיש שאלון, manual=לקוח ידני
  stage text     -- new=חדש, financing=מימון, assignment=לשיבוץ, signed=חתמו דירה
  from_lead_id uuid -> leads.id, from_lead_source text, converted_by_name text,
  converted_at timestamptz, submitted_at timestamptz, created_at timestamptz, updated_at timestamptz

TABLE client_files  -- קבצים שהעלה לקוח
  id uuid, client_id uuid -> clients.id, category text, name text, size bigint, uploaded_at timestamptz

TABLE admin_notes  -- הערות פנימיות על לקוח
  id uuid, client_id uuid -> clients.id, text text, author_name text, created_at timestamptz

TABLE deals  -- עסקאות נדל"ן
  id uuid, title text, status text, data jsonb (city, dealType, price, expectedProfit),
  created_at timestamptz, updated_at timestamptz

TABLE deal_clients  -- שיבוץ לקוחות לעסקה
  deal_id uuid -> deals.id, client_id uuid -> clients.id, added_at timestamptz

TABLE deal_payments  -- לוח תשלומים של עסקה
  id uuid, deal_id uuid -> deals.id, title text, amount numeric, due_date date,
  status text (pending/paid/canceled), paid_at timestamptz

TABLE contract_envelopes  -- הסכמים
  id uuid, primary_client_id uuid -> clients.id, status text, created_at timestamptz

TABLE contract_signers
  envelope_id uuid -> contract_envelopes.id, client_id uuid, name text, status text, signed_at timestamptz

הערות חשובות:
- "ליד חדש" מול "ליד חוזר": ליד שנקלט שוב מזוהה ע"י last_lead_at > created_at,
  או ע"י יותר מרשומת intake אחת ב-lead_activity לאותו lead_id.
- "כמה לידים נכנסו בחודש X": ספור לפי created_at (כניסה ראשונה).
  אם רוצים גם כניסות חוזרות — ספור רשומות intake ב-lead_activity.
- מקור הגעה: quali->>'source'. ייחוס פרסומי: custom->>'utm_source' / 'utm_campaign'.
`.trim();
