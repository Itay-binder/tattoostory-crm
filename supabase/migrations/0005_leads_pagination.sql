-- 0005 — עימוד בצד השרת למסך הלידים
--
-- הרקע: מסך הלידים והדשבורד שאבו את כל טבלת הלידים לדפדפן בכל טעינה.
-- אחרי המעבר לעימוד, השרת מסנן/ממיין/סופר — ולכן צריך אינדקסים על עמודות
-- המיון, ופונקציית אגרגציה שתחליף את החישוב שרץ עד היום בדפדפן.

-- ── אינדקסים לעמודות המיון והטווח ─────────────────────────────────
create index if not exists leads_updated_at_idx on leads (updated_at desc);
create index if not exists leads_created_at_idx on leads (created_at desc);
create index if not exists leads_full_name_idx  on leads (full_name);
-- (email_key / phone / stage כבר מאונדקסים ב-0001)

-- ── אגרגציה לדשבורד ───────────────────────────────────────────────
-- מחזירה מטריצת (מקור × שלב) עם ספירה, מסוננת לפי טווח תאריכי יצירה.
-- זו טבלה של עשרות שורות בודדות גם כשמאחוריה עומדים עשרות אלפי לידים,
-- ומתוכה הדשבורד בונה את המשפך, הפילוח לפי מקור ויחסי ההמרה — בדיוק
-- אותם חישובים שרצו קודם על המערך המלא בדפדפן.
create or replace function leads_stats(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns table (source text, stage text, cnt bigint)
language sql
stable
as $$
  select
    coalesce(nullif(btrim(l.quali ->> 'source'), ''), 'לא ידוע')::text as source,
    l.stage::text                                                     as stage,
    count(*)::bigint                                                  as cnt
  from leads l
  where (p_from is null or l.created_at >= p_from)
    and (p_to   is null or l.created_at <= p_to)
  group by 1, 2
$$;
