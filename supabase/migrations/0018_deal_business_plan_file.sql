-- קובץ תכנית עסקית (PDF) לעסקה — נתיב אחסון + שם מקורי להצגה.
alter table deals add column if not exists business_plan_file text;
alter table deals add column if not exists business_plan_file_name text;
