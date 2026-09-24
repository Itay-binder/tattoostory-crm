-- 0013 — פילוחי דשבורד: פלטפורמת פרסום (מ-UTM) ודף נחיתה
--
-- שני פילוחים חדשים לדשבורד, מעל ומעבר ל"מקור הגעה" (שמגיע מהשאלון):
--   1) לפי פלטפורמת הפרסום האמיתית — נגזרת מ-custom->>'utm_source'
--      (Meta / TikTok / YouTube-Google / אחר / ללא ייחוס).
--   2) לפי דף הנחיתה — custom->>'landingpage' (שם קריא בעברית).
-- כל פילוח מחזיר סה"כ לידים + כמה מהם הגיעו לפגישת מצפן ומעבר,
-- כדי לראות לא רק כמות אלא גם איכות (איזו פלטפורמה/דף באמת ממיר).
-- שתי הפונקציות מכבדות את אותו טווח תאריכי יצירה כמו leads_stats.

-- "הגיע למצפן ומעבר" — אותם שלבים כמו במשפך הדשבורד.
-- compass / progressed / in_process / done / won.

create or replace function leads_by_platform(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns table (platform text, cnt bigint, compass bigint)
language sql
stable
as $$
  with c as (
    select
      lower(coalesce(l.custom ->> 'utm_source', '')) as src,
      l.stage::text                                   as stage
    from leads l
    where (p_from is null or l.created_at >= p_from)
      and (p_to   is null or l.created_at <= p_to)
  )
  select
    case
      when src ~ 'tiktok'                                                         then 'TikTok'
      when src ~ 'google|youtube'                                                 then 'YouTube / Google'
      when src ~ 'meta|facebook|insta|bioinsta|manychat|messenger' or src ~ '^(fb|ig)$' or src ~ '^many' then 'Meta'
      when nullif(src, '') is null                                                then 'ללא ייחוס'
      else 'אחר'
    end::text as platform,
    count(*)::bigint,
    count(*) filter (where stage in ('compass','progressed','in_process','done','won'))::bigint
  from c
  group by 1
$$;

create or replace function leads_by_landing(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns table (landing text, cnt bigint, compass bigint)
language sql
stable
as $$
  select
    coalesce(nullif(btrim(l.custom ->> 'landingpage'), ''), 'ללא דף נחיתה')::text as landing,
    count(*)::bigint,
    count(*) filter (where l.stage::text in ('compass','progressed','in_process','done','won'))::bigint
  from leads l
  where (p_from is null or l.created_at >= p_from)
    and (p_to   is null or l.created_at <= p_to)
  group by 1
$$;
