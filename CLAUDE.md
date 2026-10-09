# tattoostory-crm — ה-CRM של Tattoo Story Academy (ליאור רובין)

## מה זה

CRM מלא לניהול לידים, מועמדות ולקוחות של האקדמיה להכשרת מקעקעים של ליאור רובין.
הפרויקט הוא **פורט אחד-לאחד של ה-CRM של פאוור קאפל** (`finance-form`) — אותן טבלאות,
אותם מסכים, אותם פיצ'רים — עם התוכן, המיתוג והקונפיגורציה של ליאור.

## קישורים

- **פרודקשן:** https://tattoostory-crm.vercel.app
- **ריפו:** https://github.com/Itay-binder/tattoostory-crm
- **Vercel:** team `liftygo` (`team_E7HXhz1GLkBowkDqgelE4xaB`), project `prj_kef6DcHHvecvkuGgTddVF9L840oM`
- **Supabase:** project `crsozdimrplcmngmzkcl` (חשבון liorrubin3@gmail.com), אזור eu-central-1
- **מקור הפורט:** `C:\Users\itay\עסק איתי\PowerCouple - דין ומיק\finance-form`
- **פריסה:** `vercel deploy --prod --yes` **ידנית** — חיבור הגיטהאב בפרויקט הזה לא מפעיל פריסות (ראה גוצ'ות)

## Stack

Next.js 15 (App Router) · TypeScript · Supabase (Postgres + Auth + Storage) · Vercel

- **אימות:** Supabase Google OAuth. `lib/authClient.ts` עוטף את ה-API בשמות של Firebase
  כדי שהדפים לא ישתנו — **אין Firebase בפרויקט הזה**. גם `lib/firebaseAdmin.ts` הוא
  שם היסטורי בלבד; `verifyRequest()` מאמת טוקן Supabase.
- **הרשאות אדמין:** `lib/admin.ts` → `ADMIN_EMAILS` (itay@binder.co.il, liorrubin3@gmail.com).
  להוספת נציגה: להוסיף את המייל גם ל-`ADMIN_EMAILS` וגם ל-`REPS` ב-`lib/reps.ts`.
- **אחסון:** דלי Supabase פרטי בשם `files` (`lib/storage.ts`). prefixes: `finance-form/`,
  `contract-templates/`, `contract-signatures/`, `contract-signed/`.
- **פונט:** IBM Plex Sans Hebrew · **ערכה:** בהירה כברירת מחדל (sage/קרם), כהה דרך ה-toggle.

## מסכים

```
דשבורד | לידים | פולואפים | פגישות התאמה | לקוחות | מאניצ'אט | ווצאפ | הגדרות
```

- `/admin` — **לקוחות** (מי שנסגרה). `/admin/[uid]` — כרטיס לקוחה.
- `/admin/leads` + `/admin/leads/[id]` — לידים וכרטיס ליד (יומן פעילות, שיוך נציגה, קביעת פגישה, ווצאפ).
- `/admin/followups` — **פולואפים**. המאגר מוגדר ב-`lib/leads.ts` (`FOLLOWUP_STAGES`,
  `FOLLOWUP_EXCLUDED_STAGES`, `FOLLOWUP_COMPASS`): ליד חי שיצאה אליו שיחה וטרם נסגר/נפסל,
  או ליד שהיתה לו פגישת התאמה וטרם התקדם. אותה טבלה של הלידים (`listLeadsPage` עם
  `scope: "followups"`), בתוספת עמודות: תאריך שיחה אחרונה (`custom.last_call_at`),
  תיעוד אחרון (`lastNotesFor`), ותאריך+שעה לפולואפ (`custom.followup_at`) שנערך
  ישר מהטבלה ונצבע לפי עבר/היום/עתיד.
- `/admin/matching` — צינור **פגישות התאמה**. ליד נכנס לכאן אוטומטית ברגע שנסגר (WON).
- `/admin/dashboard` — **דשבורד**. טווחי זמן מוכנים (היום / אתמול / השבוע מראשון /
  החודש / 30 ימים / מותאם / הכל), ברירת מחדל = החודש הנוכחי, מחושבים בשעון מקומי.
  שלושה אזורים:
  1. **מוני משפך** (`funnel_stats` במיגרציה 0021 → `/api/admin/funnel`): לידים שנקלטו
     (כל `intake`, כך שקליטה חוזרת נספרת שוב) + ייחודיים · שיחות שיצאו (תאריך שיחה
     בטווח, או תיעוד/שינוי שלב בידי נציגה בשם — ייבוא ושאלון לא נספרים) · פגישות
     שתואמו (`compass_entered_at` בטווח) · פגישות שבוצעו (סטטוס met/progressed או
     שליאור תיעד) · לקוחות שנסגרו (`clients.converted_at`) עם אחוז המרה.
  2. **חשבון המודעות** (`/api/admin/meta` → `lib/metaInsights.ts`): סיכום חשבון +
     שורה לכל קמפיין שהוציא תקציב, עם תקציב, חשיפות, תפוצה, קליקים על קישור, CTR,
     CPC, לידים ועלות לליד, וסיכום בתחתית. חשבון: `act_1026356652124107`.
     ⚠️ סכום התפוצה של הקמפיינים ≠ תפוצת החשבון (אנשים ייחודיים) — השורה מציגה את
     תפוצת החשבון בכוונה.
  3. פילוחים לפי פלטפורמה / דף נחיתה / מודעה, אריחי שלבים, ועוזר הנתונים (DataChat).
  נתוני המטא נטענים בקריאה נפרדת, כדי שה-Graph API לא יעכב את שאר הדשבורד.
- `/admin/whatsapp` — אינבוקס GreenAPI (תוספת של ליאור, לא קיים ב-finance-form).
- `/admin/templates` — תבניות חוזה + שליחה לחתימה. `/sign/[token]` — דף החתימה הציבורי.
- `/` — שאלון המועמדות הציבורי. `/portal` — פורטל הלקוחה (מסע 9 שלבים).
- **סקשני מימון ועסקאות הוסרו** (08/10/2026, בקשת איתי) — היו עולם הנדל"ן של פאוור קאפל.
  נמחקו הדפים, הראוטים, `lib/deals*`, `lib/financing*` ו-cron תזכורות התשלום.
  הטבלאות `deals`, `deal_*`, `financing_*` נשארו בדאטהבייס ריקות ולא מזיקות.

## מודל הנתונים — מה חשוב לדעת

- **`lib/leads.ts`** הוא מקור האמת למשפך. **המפתחות של `LEAD_STAGES` זהים לפאוור קאפל,
  רק התוויות בשפה של ליאור** — כך כל הקוד, הפונקציות ב-SQL והדשבורד ממשיכים לעבוד:
  `new`=ליד חדש · `contacted`=שיחה 1 יצאה · `no_answer_1/2/3`=שתיים/שלוש/4 שיחות יצאו ·
  `followup`=פולואפ עתידי · `watching`=נשלחה הודעה · `relevant`=מתעניינת ·
  `meeting_scheduled`=נקבעה שיחה · `compass`=הגיעה לפגישת התאמה (המפתח והעמודה `compass_status` נשארו — רק המסלול והתווית שונו) · `in_process`=בטיפול ·
  `won`=נסגר (לקוחה) · `lost`=לא רלוונטי · `dormant`=ליד רדום.
  אותו עקרון ב-`CLIENT_STAGES` (`lib/clients.ts`) וב-`JOURNEY_STAGES` (`lib/journey.ts`).
- **`leads.quali`** — שדות שאלון המועמדות (`QUALI_FIELDS`): source, gender, age, whyTattoo,
  goals, seriousness, willDoTasks, successVision, understandsTime, needsPractice,
  notQuickMoney, sessionRecordings, openDay.
- **`leads.custom`** — UTM + `landingpage` + `legacy_status` + `last_call`. הדשבורד מפלח לפי
  `custom->>'utm_source'`, `custom->>'landingpage'`, `custom->>'utm_content'`.
- **`lead_activity`** — יומן לכל ליד (intake / note / stage / system).

## הדאטה — מקור האמת

**שני גיליונות בדרייב של איתי הם מקור האמת**, וה-CRM נבנה מהם מחדש ב-08/10/2026:

| גיליון | ID | מה יש בו |
|---|---|---|
| לידים ליאור | `1qe9oO9Fmew5pGeIg4j7FYOHEo7JMbT5eYHo0uwbD-aM` | `Sheet1` = פיד הלידים הגולמי: תאריך, UTM, קמפיין/סדרה/מודעה, דף נחיתה + 9 שדות שאלון המועמדות |
| מעקב לידים - שיר וענבל | `1kwd8OsyZiJ9-J9SaKLIi7o48AlSXcbfa4Xn3WFVC1mI` | `מעקב לידים` = מעקב המכירות · `רשימת תלמידים` = 10 מחזורים · `חברות קהילה` = הערות ליאור וגילי |

⚠️ **עמודות בלי כותרת בגיליון המעקב** (0-indexed): `0`=תאריך יצירת הליד · `4`=הנציגה המטפלת · `6`=מספר השיחות.
הכותרות הנראות (`סטטוס`, `הערות ליהי`, `הערות שיר/ גילי`) הן עמודות 7, 10, 11.
הייבוא הראשון פספס בדיוק את העמודות בלי הכותרת — לכן אין להסתמך על הכותרות בלבד.

**המצב כיום:** 559 לידים · 2,220 רשומות יומן · 112 לקוחות · 222 בפולואפים · 212 בפגישות ההתאמה.

- **תאריכים:** אפס תאריכים גנריים. 520 לידים עם תאריך יצירה מדויק מהגיליון
  (06/2025–10/2026), ו-39 עם תאריך משוער שסומן ב-`custom.created_at_approx`:
  שורה בלי תאריך מקבלת את אמצע הטווח בין השורות המתוארכות שמעליה ומתחתיה
  (הגיליונות כרונולוגיים), ותלמידה בלי שורת מעקב מקבלת את התאריך החציוני של
  המחזור שלה (מחזור בלי נתונים נשען על המחזור הבא).
- **`updated_at`** נגזר מהתיעוד האחרון בפועל, ו-**`clients.converted_at`** מהאות
  המתוארך האחרון (בפועל תאריך השיחה האחרונה).
  ⚠️ **הטריגרים `leads_touch` / `clients_touch` דורסים `updated_at` ל-`now()` בכל
  UPDATE.** בכל טעינה היסטורית חייבים להשתיק אותם (`alter table … disable trigger`)
  ולהחזיר בסוף — אחרת כל התאריכים נמחקים ללא התראה.
- **פרטי קשר:** אין ליד או לקוחה בלי טלפון או מייל. 20 רשומות שם-בלבד
  (17 מהן מרשימת מחזור א׳ טרום השקה) לא נכנסות ל-CRM ונשארות בגיליון ובגיבויים.
- **מי תיעד:** כל רשומת יומן נושאת את שם המתעד ב-`by_actor` — שיר 570, ליהי 302,
  גילי 148, ליאור 112, נעם 53, יהלי 10, ענבל 6, אלמוג 2.
- **תיעוד בלי תאריך:** מוצג לפי תאריך קליטת הליד + שנייה, ומסומן ב-`fields`:
  `{"תאריך התיעוד": "לא תועד בגיליון — מוצג לפי תאריך קליטת הליד"}`. קליטת הליד
  מקבלת את התאריך עצמו, כדי שתשב תמיד בתחתית היומן.
- **"שיחה אחרונה"** בגיליון היא פורמט `d.M` — נפתר לתאריך אמיתי (193 רשומות קיבלו תאריך משלהן).
- **שאלונים:** 248 — גם כתיעוד מלא ביומן (`by_actor = "שאלון מועמדות"`) וגם בשדות `quali`.
- **לקוחות:** 112 סוגרות (`stage=won`) נוצרו כ-`clients` ומקושרות דרך `converted_client_id`.
  רובן ברשימת התלמידים, משויכות למחזור ב-`custom.cycle` (מחזור א׳ עד י׳).
- **ווצאפ:** `app/admin/WhatsappButton.tsx` — לחיצה פותחת `wa.me/<מספר>` עם הליד
  הספציפי. מופיע כעמודה בלידים, בפולואפים ובלקוחות, וליד הטלפון בפגישות ובכרטיס הליד.
- **מחיקת שדה `custom`:** `cleanObj` מסנן ערכים ריקים, ולכן מחיקה נעשית דרך
  `clearCustom: ["<key>"]` בפעולת ה-update, לא בשליחת מחרוזת ריקה.
- **פגישות התאמה:** `won` → `progressed` · `meeting_scheduled` → `scheduled` ·
  מי שליאור תיעד עליו או שהייתה לו שיחה מלאה → `met_no_progress`.
- **נציגות:** `lib/reps.ts` מכיל 7 נציגות עם מזהה תצוגה `rep:<slug>` (לא מייל מומצא).
  כשנפתח חשבון אמיתי: להחליף את המזהה במייל, להוסיף ל-`ADMIN_EMAILS`, ולהריץ
  `update leads set assigned_to = '<מייל>' where assigned_to = 'rep:<slug>';`
- **גיבויים:** `_legacy-backup/` (מחוץ לגיט) — JSON של הייבוא הראשון + snapshot
  `pre-rebuild-*.json` לפני כל בנייה מחדש. הסכמה הראשונה נשמרה בסכמה `legacy` ב-Postgres.

**לבנייה מחדש** (למשל אחרי עדכון בגיליונות): להוריד את שני הגיליונות כ-xlsx,
להמיר ל-JSON, ואז `node scripts/_rebuild-from-sheets.mjs` (הרצה יבשה) ואז `--apply`.
הסקריפט מגבה, מוחק ובונה מחדש בטרנזקציה אחת.

## מיגרציות

```bash
node scripts/apply-migrations.mjs   # מריץ לפי סדר שם הקובץ, מתעד ב-_migrations
```

הסקריפט קורא `SUPABASE_DB_URL` מ-`.env.local`, רץ בטרנזקציה לכל קובץ, ועוצר בשגיאה הראשונה.
סקריפטים בתחילית `_` הם חד-פעמיים ומחוץ לגיט.

## Env

מוגדר ועובד: `SUPABASE_*`, `GREENAPI_INSTANCE/TOKEN` (instance 7105326802), `BASE_URL`,
`META_ACCESS_TOKEN` / `META_SYSTEM_TOKEN` (System User של Tattoo Story, לא פג),
`MAIL_FROM`, `NOTIFY_EMAIL`, `MEETINGS_CALENDAR_USER`, `META_AD_ACCOUNT`
(`act_1026356652124107`), `META_BUSINESS_ID` (`532639584829569`), `CRON_SECRET`,
`META_WEBHOOK_VERIFY_TOKEN`.

להעברת טוקן המטא מחדש (אם יוחלף): `node scripts/_set-meta-token.mjs` — קורא מ-
`~/.claude/mcp-tokens/tattoostory.json`, כותב ל-`.env.local` ודוחף ל-Vercel דרך stdin
של ה-CLI, בלי שהערך עובר במקום אחר, ומאמת מול חשבון המודעות.

**חסר — דורש חשבון של ליאור:**

| Env | מה זה מפעיל |
|---|---|
| `GOOGLE_SA_B64`, `GOOGLE_IMPERSONATE_USER`, `DRIVE_PARENT_FOLDER_ID` | Google Drive (תיקיית לקוחה), יומן גוגל (קביעת פגישות), שליחת מייל |
| `CARDCOM_TERMINAL`, `CARDCOM_API_NAME`, `CARDCOM_API_PASSWORD` | סליקה בפורטל |

⚠️ **Google:** ליאור על Gmail רגיל, לא Workspace. domain-wide delegation לא יעבוד שם —
צריך או Workspace, או לעבור ל-OAuth אישי, או להשתמש ביומן/דרייב של איתי.

## גוצ'ות

- ⚠️ **ה-GitHub integration לא מפעיל פריסות בפרויקט הזה.** `git push` לא מספיק —
  חייב `vercel deploy --prod --yes`. (בגלל זה הפרודקשן היה תקוע 3 שבועות על קומיט ישן.)
- ⚠️ **ה-Supabase בחינם ונכנס ל-INACTIVE אחרי חוסר שימוש.** אם ה-DNS לא נפתר — זו הסיבה.
  restore: `POST https://api.supabase.com/v1/projects/{ref}/restore` עם ה-PAT.
- `vercel.json` מגדיר 3 crons (תזכורות חתימה + שתי תזכורות פגישות). כל ראוט cron דורש `Bearer CRON_SECRET`.
- קליטת לידים (`/api/leads/intake`) חוסמת בקשות דפדפן שלא מ-`tattoostoryacademy.com`
  (או `*.vercel.app`). בקשות שרת-לשרת (Make/PHP) עוברות עם מפתח ה-API מטבלת `settings`.
- `.github/workflows/regev-meeting-reminders.yml` הוא שארית מפאוור קאפל. בלי secrets הוא נכשל — למחוק או להשתיק.
- `app/hagrala/` ו-`app/api/webinar/rav-subscribe` הם דפים של פאוור קאפל שנשארו בפורט. לא בשימוש.
