-- ערכת נושא לכל מנהל (נשמרת ברמת החשבון — לא צריך להגדיר מחדש בכל התחברות)
alter table admins add column if not exists theme text;
