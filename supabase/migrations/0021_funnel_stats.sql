-- 0021 — מוני המשפך לדשבורד, בטווח תאריכים.
--
-- חמישה מספרים שהדשבורד מציג, כולם נשענים על מה שבאמת תועד במערכת:
--
--  1. לידים שנקלטו      — כל רשומת קליטה (type='intake') בטווח. ליד קיים שנקלט
--                          מחדש נספר שוב, כי זו קליטה נוספת.
--  2. לידים ייחודיים     — כמה אנשים שונים מאחורי אותן קליטות.
--  3. שיחות שיצאו        — ליד שיש עליו עדות לשיחה בטווח: תאריך שיחה אחרונה
--                          (custom.last_call_at), או תיעוד/שינוי שלב שנכתב בידי
--                          נציגה בשם (לא ייבוא ולא שאלון אוטומטי).
--  4. פגישות שתואמו      — ליד שנכנס לצינור פגישות ההתאמה בטווח (compass_entered_at).
--  5. פגישות שבוצעו      — מאלה, מי שהסטטוס שלו מעיד שהפגישה התקיימה
--                          (met_no_progress / progressed), או שליאור תיעד עליו בטווח.
--  6. לקוחות שנסגרו      — לקוחה שהומרה בטווח (clients.converted_at).

create or replace function funnel_stats(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns table (
  intakes            bigint,
  unique_leads       bigint,
  calls_made         bigint,
  meetings_scheduled bigint,
  meetings_held      bigint,
  clients_won        bigint
)
language sql
stable
as $$
  with
  -- שמות המתעדים שאינם שיחה: ייבוא, שאלון, ורשימות
  bots as (
    select array['ייבוא מהגיליון', 'שאלון מועמדות', 'רשימת התלמידים', 'גיליון המעקב', 'API', 'CSV']::text[] as names
  ),
  intake as (
    select a.lead_id
    from lead_activity a
    where a.type = 'intake'
      and (p_from is null or a.at >= p_from)
      and (p_to   is null or a.at <= p_to)
  ),
  -- עדות לשיחה: תאריך שיחה מתועד בטווח
  called_by_date as (
    select l.id
    from leads l
    where nullif(l.custom ->> 'last_call_at', '') is not null
      and (p_from is null or (l.custom ->> 'last_call_at')::timestamptz >= p_from)
      and (p_to   is null or (l.custom ->> 'last_call_at')::timestamptz <= p_to)
  ),
  -- עדות לשיחה: תיעוד או שינוי שלב בידי נציגה בשם
  called_by_note as (
    select distinct a.lead_id as id
    from lead_activity a, bots b
    where a.type in ('note', 'stage')
      and coalesce(btrim(a.by_actor), '') <> ''
      and not (a.by_actor = any(b.names))
      and (p_from is null or a.at >= p_from)
      and (p_to   is null or a.at <= p_to)
  ),
  called as (
    select id from called_by_date union select id from called_by_note
  ),
  scheduled as (
    select l.id, l.compass_status
    from leads l
    where l.compass_entered_at is not null
      and (p_from is null or l.compass_entered_at >= p_from)
      and (p_to   is null or l.compass_entered_at <= p_to)
  ),
  -- ליאור תיעד = הפגישה התקיימה
  lior_documented as (
    select distinct a.lead_id as id
    from lead_activity a
    where a.by_actor = 'ליאור'
      and (p_from is null or a.at >= p_from)
      and (p_to   is null or a.at <= p_to)
  ),
  held as (
    select id from scheduled where compass_status in ('met_no_progress', 'progressed')
    union
    select id from lior_documented
  )
  select
    (select count(*) from intake)::bigint                           as intakes,
    (select count(distinct lead_id) from intake)::bigint            as unique_leads,
    (select count(*) from called)::bigint                           as calls_made,
    (select count(*) from scheduled)::bigint                        as meetings_scheduled,
    (select count(*) from held)::bigint                             as meetings_held,
    (select count(*) from clients c
      where c.converted_at is not null
        and (p_from is null or c.converted_at >= p_from)
        and (p_to   is null or c.converted_at <= p_to))::bigint     as clients_won
$$;
