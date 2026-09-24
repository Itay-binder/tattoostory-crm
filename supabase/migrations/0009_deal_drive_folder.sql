-- שיוך תיקיית דרייב לעסקה (כמו שיש ללקוחות)
alter table deals add column if not exists drive_folder_id   text;
alter table deals add column if not exists drive_folder_link text;
