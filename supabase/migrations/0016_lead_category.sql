-- 0016 — קטגוריית ליד: מכירות מול "רשימות תפוצה" (לידים לא-בשלים)
--
-- מטרה: לידים מדפי מגנט/וובינר לא-בשלים (VSL2, pinuybinuy-live2026, חוברת עבודה)
-- לא יזהמו את פייפליין המכירות. הם נכנסים ל"רשימות תפוצה" בלבד.
--   category            = 'sales' (ברירת מחדל) | 'distribution'
--   distribution_last_at = תאריך הקליטה האחרון לרשימת תפוצה (מזין את הטאב + המיון שלו)
-- ליד מכירות שנרשם לוובינר: category נשאר 'sales' (לא זז בפייפליין), רק
-- distribution_last_at מתעדכן + תיעוד — כך הוא מופיע גם ב"רשימות תפוצה" בלי לזהם.

alter table leads add column if not exists category text not null default 'sales';
alter table leads add column if not exists distribution_last_at timestamptz;
create index if not exists leads_category_idx on leads (category);
create index if not exists leads_dist_idx on leads (distribution_last_at desc);

-- backfill: לידים קיימים שדף הנחיתה שלהם הוא אחד מדפי רשימת התפוצה → distribution
update leads set category = 'distribution',
  distribution_last_at = coalesce(distribution_last_at, last_lead_at, created_at)
where category <> 'distribution' and (
     (custom->>'landingpage') ilike '%VSL2%'
  or (custom->>'landingpage') ilike '%חוברת עבודה%'
  or (custom->>'landingpage') ilike '%הדרכה בלייב%'
  or (custom->>'page_slug')   ilike '%pinuybinuy%'
  or (custom->>'page_url')    ilike '%pinuybinuy%'
);

-- ── הדשבורד והאגרגציות סופרים מכירות בלבד (רשימות תפוצה לא מזהמות מדדים) ──

create or replace function leads_stats(p_from timestamptz default null, p_to timestamptz default null)
returns table (source text, stage text, cnt bigint) language sql stable as $$
  select coalesce(nullif(btrim(l.quali ->> 'source'), ''), 'לא ידוע')::text, l.stage::text, count(*)::bigint
  from leads l
  where coalesce(l.category,'sales') = 'sales'
    and (p_from is null or l.created_at >= p_from) and (p_to is null or l.created_at <= p_to)
  group by 1, 2
$$;

create or replace function leads_by_platform(p_from timestamptz default null, p_to timestamptz default null)
returns table (platform text, cnt bigint, compass bigint) language sql stable as $$
  with c as (
    select lower(coalesce(l.custom ->> 'utm_source','')) as src, l.stage::text as stage
    from leads l
    where coalesce(l.category,'sales') = 'sales'
      and (p_from is null or l.created_at >= p_from) and (p_to is null or l.created_at <= p_to)
  )
  select case
      when src ~ 'tiktok' then 'TikTok'
      when src ~ 'google|youtube' then 'YouTube / Google'
      when src ~ 'meta|facebook|insta|bioinsta|manychat|messenger' or src ~ '^(fb|ig)$' or src ~ '^many' then 'Meta'
      when nullif(src,'') is null then 'ללא ייחוס'
      else 'אחר' end::text,
    count(*)::bigint,
    count(*) filter (where stage in ('compass','progressed','in_process','done','won'))::bigint
  from c group by 1
$$;

create or replace function leads_by_landing(p_from timestamptz default null, p_to timestamptz default null)
returns table (landing text, cnt bigint, compass bigint) language sql stable as $$
  select coalesce(nullif(btrim(l.custom ->> 'landingpage'), ''), 'ללא דף נחיתה')::text,
    count(*)::bigint,
    count(*) filter (where l.stage::text in ('compass','progressed','in_process','done','won'))::bigint
  from leads l
  where coalesce(l.category,'sales') = 'sales'
    and (p_from is null or l.created_at >= p_from) and (p_to is null or l.created_at <= p_to)
  group by 1
$$;

create or replace function leads_by_ad(p_from timestamptz default null, p_to timestamptz default null)
returns table (ad text, cnt bigint, compass bigint) language sql stable as $$
  select coalesce(nullif(btrim(l.custom ->> 'utm_content'), ''), 'ללא מודעה')::text,
    count(*)::bigint,
    count(*) filter (where l.stage::text in ('compass','progressed','in_process','done','won'))::bigint
  from leads l
  where coalesce(l.category,'sales') = 'sales'
    and (p_from is null or l.created_at >= p_from) and (p_to is null or l.created_at <= p_to)
  group by 1
$$;
