-- גישה לפורטל הלקוח — דגל דביק על הליד. נקבע ע"י איש מכירות דרך "פתח פורטל" בכרטיס הליד.
-- טריגר גישה בלבד (לא שלב בפייפליין): נשאר true גם אחרי שינוי סטטוס.
alter table leads add column if not exists portal_access boolean not null default false;
create index if not exists ix_leads_portal_access on leads(portal_access) where portal_access;
