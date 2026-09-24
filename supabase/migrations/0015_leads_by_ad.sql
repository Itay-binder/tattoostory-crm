-- 0015 — פילוח דשבורד לפי המודעה שדרכה נכנס הליד
--
-- utm_content מחזיק את שם המודעה/הקריאייטיב (למשל "קייסטאדי מקרה 5 - אור | איתי | 17/09").
-- מחזיר סה"כ לידים + כמה הגיעו לפגישת מצפן ומעבר — כמו leads_by_platform / leads_by_landing.

create or replace function leads_by_ad(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns table (ad text, cnt bigint, compass bigint)
language sql
stable
as $$
  select
    coalesce(nullif(btrim(l.custom ->> 'utm_content'), ''), 'ללא מודעה')::text as ad,
    count(*)::bigint,
    count(*) filter (where l.stage::text in ('compass','progressed','in_process','done','won'))::bigint
  from leads l
  where (p_from is null or l.created_at >= p_from)
    and (p_to   is null or l.created_at <= p_to)
  group by 1
$$;
