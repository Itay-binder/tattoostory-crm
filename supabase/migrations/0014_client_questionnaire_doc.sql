-- 0014 — מסמך Google Docs חי לכל לקוח, מתעדכן תוך כדי מילוי השאלון
--
-- לכל לקוח נשמר מסמך Docs בתיקיית הדרייב שלו, שמשקף את תשובות השאלון
-- ומתעדכן בכל שמירה (אוטו-שמירה תוך כדי מילוי + הגשה + עריכת מנהל).
-- questionnaire_doc_synced_at משמש לוויסות — לא לעדכן את גוגל בכל הקלדה,
-- אלא לכל היותר פעם ב-15 שניות (וכל עדכון מלא בהגשה/עריכת מנהל).

alter table clients add column if not exists questionnaire_doc_id      text;
alter table clients add column if not exists questionnaire_doc_link    text;
alter table clients add column if not exists questionnaire_doc_synced_at timestamptz;
