-- שאילתת קריאה בלבד עבור הצ'אט החכם.
-- הגנות: רק SELECT/WITH, משפט יחיד, בלי מילות כתיבה, תקרת 500 שורות.
-- ההרשאה ניתנת ל-service_role בלבד (השרת שלנו), לא ל-anon/authenticated.
create or replace function public.admin_readonly_query(q text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare result json;
begin
  if q !~* '^\s*(select|with)\s' then
    raise exception 'רק שאילתות קריאה (SELECT) מותרות';
  end if;
  if q ~ ';\s*\S' then
    raise exception 'מותר משפט אחד בלבד';
  end if;
  if q ~* '\y(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum)\y' then
    raise exception 'שאילתה לקריאה בלבד';
  end if;

  execute format(
    'select coalesce(json_agg(t), ''[]''::json) from (select * from (%s) x limit 500) t', q
  ) into result;
  return result;
end $$;

revoke all on function public.admin_readonly_query(text) from public;
revoke all on function public.admin_readonly_query(text) from anon, authenticated;
