"""
Builds the product site: docs/index.html (English) and docs/he.html (Hebrew), next to the
screenshots in docs/screenshots/. Run: python3 scripts/build-site.py docs
GitHub Pages serves it: Settings > Pages > Deploy from a branch > main, /docs.
"""
import html, os, sys

# The page names no account. GitHub links are built in the browser from the Pages address
# (<owner>.github.io/<repo>/), so a fork's page points at the fork.
REPO = '#" data-gh="'
DEPLOY = '#" data-gh="/blob/main/docs/deploy.md'
SETUP = '#" data-gh="/blob/main/docs/setup.md'
LICENSE = '#" data-gh="/blob/main/LICENSE'
ITA_REGISTRY = 'https://www.gov.il/he/service/itc-software-registry-for-computerized-accounting-systems'
ITA_REG = 'https://www.gov.il/he/service/registration-software-designed-managing-computerized-accounting-system'
CLONE = 'git clone https://github.com/OWNER/open-ledger-il.git'

LOGO = '''<svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="8" fill="#141d2e" stroke="#26344b" stroke-width="1.5"/>
        <rect x="8" y="6" width="16" height="20" rx="2.5" fill="none" stroke="#4f93ff" stroke-width="2"/>
        <path d="M12 12h8M12 16h8" stroke="#35c46a" stroke-width="2" stroke-linecap="round"/>
        <path d="M12 20h5" stroke="#9b6dff" stroke-width="2" stroke-linecap="round"/>
      </svg>'''

EN = dict(
    lang='en', dir='ltr', file='index.html', other='he.html', other_label='עברית',
    title='Open Ledger IL - invoices and books for an Israeli business, on your own Cloudflare',
    desc='Open-source invoicing, receipts, expenses and bookkeeping for עוסק פטור and עוסק מורשה. Legal numbering, signed PDFs, ITA allocation numbers. Runs on your own Cloudflare account.',
    nav=['Features', 'On your phone', 'How it works', 'Screenshots', 'Setup'], github='View on GitHub',
    badge='<b>Free</b> · Open source (AGPL-3.0) · Self-hosted',
    h1='Invoices, receipts and books for an Israeli business,<br>on infrastructure you own.',
    lead='Quotes, payment requests, receipts and tax invoices with legal numbering, signed PDFs and ITA allocation numbers. It runs in your own Cloudflare account, and your data stays in your own database.',
    cta=['Get the code', 'Read the deploy guide'], copy='Copy', copied='Copied',
    cmd_note='Deploys to your own Cloudflare Worker. Starts on the Workers Free plan. Setup takes an afternoon.',
    shot_alt='The dashboard: open and overdue documents, cash flow, income by month and top clients',
    shot_cap='All screenshots on this page use an invented demo business.',
    feat_eyebrow='What it does', feat_h='Everything a small Israeli business issues and files',
    feat_p='Built for a עוסק פטור today and a עוסק מורשה tomorrow, with the rules of both built in.',
    features=[
        ('▤', 'Every Israeli document type', 'Quotes, payment requests, pro formas (חשבון עסקה), receipts and credit receipts as פטור. Tax invoices, invoice/receipts and credit invoices as מורשה. English or bilingual Hebrew and English.'),
        ('#', 'Numbering that cannot break', 'One series per document type, no gaps and no reuse. A final document never changes. A hash chain and database triggers enforce both.'),
        ('✎', 'Signed PDFs', 'Your logo and signature on every document. Cloudflare Browser Rendering draws the PDF and a PAdES signature with your own key seals it.'),
        ('✓', 'ITA allocation numbers', 'The Israel Invoices API v2 client for מספר הקצאה, sandbox and production, with a retry queue and a clear flow when the ITA refuses.'),
        ('₪', 'Foreign currency done right', 'Bank of Israel rates, cached daily. Carry the rate from a payment request to its receipt. Balances stay in the client’s currency.'),
        ('⇄', 'Client ledgers that add up', 'A payment request is charged once and closed by the receipt that pays it. Open balances, aging and an overdue list on the dashboard.'),
        ('↻', 'Recurring and duplicate', 'Copy any document in one click. Schedule a monthly retainer that waits for your approval or issues and emails itself.'),
        ('✉', 'Send with consent', 'Email or WhatsApp a document. Digital-document consent is recorded per client, and payment reminders go out before and after the due date.'),
        ('◔', 'פטור ceiling meter', 'Turnover against the annual ceiling, alerts at 70, 85, 95 and 100 percent, and a guided switch to עוסק מורשה.'),
        ('⤓', 'Expenses from Drive', 'Upload a receipt or import a month from Google Drive. Claude reads each document, you review and file it.'),
        ('∑', 'Reports and an accountant login', 'Income, expenses, profit and loss, per-client ledgers and a monthly accountant pack. Your accountant gets a separate role with an end date and an access log.'),
        ('⇪', 'Exports, import and backups', 'The unified file (מבנה אחיד) and PCN874. Import customers and past documents from another system. Quarterly backups to R2 and Google Drive.'),
        ('▯', 'Built for your phone', 'A bottom tab bar, bigger text and buttons, and tables that turn into cards. Every screen works at phone width.'),
        ('◉', 'Snap a receipt', 'Take a photo or pick one from the gallery. Claude reads supplier, date and amount. No signal? The photo waits on the phone and uploads later.'),
        ('⌂', 'Installs like an app', 'Add it to your home screen. It opens on Quick: add an expense, issue a document and see your recent activity.'),
    ],
    mob_eyebrow='On your phone', mob_h='Your books in your pocket',
    mob_p='Install it on your home screen. It opens on the Quick page, ready for the next receipt.',
    phones=[
        ('phone-quick.png', 'Quick page with camera and gallery buttons and document shortcuts', 'Quick', 'Take a photo, pick from the gallery or start a document.'),
        ('phone-expense.png', 'Expense review with the receipt photo and the fields Claude filled in', 'Review and file', 'Claude fills in the fields. You check them and file.'),
        ('phone-activity.png', 'Recent activity list with documents and expenses', 'Recent activity', 'The latest documents and expenses, with amount and status.'),
        ('phone-dashboard.png', 'Dashboard on a phone with quick actions and overdue items', 'Dashboard', 'Open and overdue items, cash flow and the פטור ceiling.'),
    ],
    how_eyebrow='How it works', how_h='Three steps, then you issue your first document',
    how_p='You deploy your own copy. Nobody else runs it, sees it or holds your data.',
    steps=[
        ('Deploy your copy', 'Create one D1 database and two R2 buckets, connect the Worker to your fork on GitHub, and add your domain. Every push to main deploys.'),
        ('Lock it down', 'Cloudflare Access signs you in with your own email. Add the secrets: the PDF signing key, the mail key, and ITA credentials when you are מורשה.'),
        ('Set up the business', 'Business profile, logo, signature and the starting number of each series, so numbering continues from your previous system.'),
    ],
    shots_eyebrow='Screenshots', shots_h='What you get', shots_p='Invented demo data throughout.',
    shots=[
        ('documents.png', 'Documents list with status, related documents and open amounts', 'Documents and their relations', 'Every document with its status, the documents it came from or led to, and what is still open.'),
        ('payment-requests.png', 'Payment requests list with overdue and open totals', 'Payment requests that close', 'Record a payment and the receipt links back to the request. Partial payments keep the rest open.'),
        ('clients.png', 'Client page with details, contacts and ledger', 'Clients and their ledger', 'One page per client with contacts, consent status, documents and a running ledger per currency.'),
        ('expenses.png', 'Expenses list with suppliers and categories', 'Expenses to review and file', 'Documents read by Claude land in New. Check the supplier, amount and category, then file.'),
        ('reports.png', 'Reports catalog', 'Reports for you and your accountant', 'Income, expenses, profit and loss, open items and ledgers. Download as PDF, XLSX or CSV.'),
        ('settings-business.png', 'Business settings with logo and signature', 'Your business, your brand', 'Business details, logo, signature, payment methods and bank details printed on your documents.'),
    ],
    rules_eyebrow='The rules', rules_h='Six rules the code enforces',
    rules_p='Israeli bookkeeping rules are not settings here. The database refuses to break them.',
    rules=[
        ('A final document never changes', 'A mistake is fixed with a credit document or a cancellation, never an edit. Database triggers block updates to a final row.'),
        ('Numbers come only from finalize', 'Drafts carry no number, so a deleted draft never leaves a gap in the series.'),
        ('No tax invoice PDF without its allocation number', 'When the ITA requires a מספר הקצאה, the PDF waits for it.'),
        ('A demand and its receipt count once', 'A payment request or pro forma is a charge, the receipt is the income. Reports never add both.'),
        ('Rates are dated', 'VAT, the פטור ceiling and exchange rates are stored with the date they apply from.'),
        ('Sandbox and production never mix', 'ITA sandbox and production credentials, tokens and numbers are kept apart.'),
    ],
    need_eyebrow='Before you start', need_h='What you need',
    need_p='It starts on free tiers. Workers Paid, from $5 a month, is the one upgrade worth planning for.',
    need_cols=['Requirement', 'Notes'], required='Required', optional='Optional',
    needs=[
        ('Cloudflare account', True, 'Workers Free runs it: the Worker, D1, R2, Browser Rendering and 5 scheduled jobs. Workers Paid, from $5 a month, lifts the limits below.'),
        ('A domain on Cloudflare', True, 'Your ledger address, for example ledger.example.com, behind Cloudflare Access. Zero Trust is free for small teams.'),
        ('PDF signing key and certificate', True, 'For the PAdES signature on every PDF. docs/setup.md shows how to make one.'),
        ('Node.js and Wrangler', True, 'On your computer, to apply database migrations and set secrets.'),
        ('Resend account', False, 'To email documents, reminders and the accountant pack. The free tier covers a small business.'),
        ('ITA API credentials', False, 'Only as עוסק מורשה, for allocation numbers on tax invoices.'),
        ('Anthropic API key', False, 'For Claude to read expenses and past documents. Pay per use, a few cents per document.'),
        ('Google Cloud service account', False, 'For the Drive expense import and backup copies. Free.'),
    ],
    paid_title='When to move to Workers Paid.',
    paid_intro='The ledger uses 5 scheduled jobs, the most Workers Free allows. Free has three other limits worth knowing:',
    paid=[
        'Cron CPU: 10 ms per scheduled run on Free. Most jobs fit. The monthly accountant pack and the quarterly backup build files and are the ones likely to need Paid.',
        'Browser Rendering, which draws every PDF: 10 minutes a day on Free, 10 hours a month on Paid.',
        'D1 point-in-time recovery: 7 days on Free, 30 days on Paid. For legal books, 30 days is the one to have.',
    ],
    reg_title='Do you need to register the software with the Tax Authority?',
    reg_p=[
        'The Israel Tax Authority requires software registration from producers of accounting software meant for sale, for rent or for use by others, free use included.',
        'You deploy your own copy and run it for your own business only. You do not sell it, rent it or run it for anyone else, so that registration does not apply to you. Run it for another business, for example your clients\u2019 books, and you register first.',
        'To get ITA API credentials for allocation numbers as עוסק מורשה, you still sign up on the ITA developer portal. Confirm your setup with your accountant.',
    ],
    reg_link='The ITA software registration page (Hebrew)',
    reg_refs_h='References',
    reg_refs=[
        ('Israel Tax Authority, "Application to register software for a computerized accounting system", service page, updated 29.05.2025. Who must register:', ITA_REG, 'gov.il'),
        ('Israel Tax Authority, registry of registered accounting software.', ITA_REGISTRY, 'gov.il'),
        ('Legal framework: Income Tax (Bookkeeping) Instructions, 1973, the computerized-system rules under instruction 36.', None, None),
    ],
    reg_quote='יצרני תוכנות לניהול מערכת חשבונות ממוחשבת המיועדת למכירה, להשכרה או לשימושם של אחרים (כולל שימוש בחינם)',
    limits_eyebrow='Known limits', limits_h='What it will not do',
    limits=[
        'It is not tax or legal advice. Check your setup with your accountant before you issue a real document.',
        'One business per deployment.',
        'Israel only: the document types, VAT and ITA rules are Israeli.',
        'It records payments. It does not charge cards or collect money.',
        'The PCN874 export fills the allocation-number column. The other columns are a stub.',
        'You run it: updates, secrets and the Cloudflare bill are yours.',
    ],
    final_h='Read the code before you deploy it',
    final_p='It issues legal documents under your name. The code is open so you can check every rule.',
    foot_links=['GitHub', 'Deploy guide', 'Setup guide', 'AGPL-3.0 licence'],
    foot_note='Self-hosted on Cloudflare Workers · Open source under AGPL-3.0 · Not affiliated with Cloudflare or the Israel Tax Authority',
)

HE = dict(
    lang='he', dir='rtl', file='he.html', other='index.html', other_label='English',
    title='Open Ledger IL - חשבוניות, קבלות והנהלת חשבונות לעסק ישראלי, בענן Cloudflare שלך',
    desc='מערכת קוד פתוח לחשבוניות, קבלות, הוצאות והנהלת חשבונות לעוסק פטור ולעוסק מורשה. מספור חוקי, PDF חתום ומספרי הקצאה מרשות המסים. רצה בחשבון Cloudflare שלך.',
    nav=['יכולות', 'בטלפון', 'איך זה עובד', 'צילומי מסך', 'הקמה'], github='לקוד ב-GitHub',
    badge='<b>חינם</b> · קוד פתוח (AGPL-3.0) · מאוחסן אצלך',
    h1='חשבוניות, קבלות והנהלת חשבונות לעסק ישראלי,<br>על תשתית שבבעלותך.',
    lead='הצעות מחיר, דרישות תשלום, קבלות וחשבוניות מס עם מספור חוקי, PDF חתום ומספרי הקצאה מרשות המסים. המערכת רצה בחשבון Cloudflare שלך, והמידע נשאר במסד הנתונים שלך.',
    cta=['לקוד', 'למדריך ההתקנה'], copy='העתקה', copied='הועתק',
    cmd_note='נפרסת ל-Worker שלך ב-Cloudflare. מתחילה בתוכנית Workers Free. ההקמה לוקחת אחר צהריים.',
    shot_alt='לוח הבקרה: מסמכים פתוחים ובאיחור, תזרים, הכנסות לפי חודש ולקוחות מובילים',
    shot_cap='כל צילומי המסך בעמוד הזה מציגים עסק דמו בדוי.',
    feat_eyebrow='מה היא עושה', feat_h='כל מה שעסק ישראלי קטן מפיק ומתייק',
    feat_p='בנויה לעוסק פטור היום ולעוסק מורשה מחר, עם הכללים של שניהם בפנים.',
    features=[
        ('▤', 'כל סוגי המסמכים', 'הצעות מחיר, דרישות תשלום, חשבונות עסקה, קבלות וקבלות זיכוי כעוסק פטור. חשבוניות מס, חשבוניות מס קבלה וחשבוניות זיכוי כעוסק מורשה. באנגלית או בעברית ואנגלית.'),
        ('#', 'מספור שלא נשבר', 'סדרה אחת לכל סוג מסמך, בלי חורים ובלי שימוש חוזר. מסמך סופי לא משתנה לעולם. שרשרת גיבוב וטריגרים במסד הנתונים אוכפים את שניהם.'),
        ('✎', 'PDF חתום', 'הלוגו והחתימה שלך על כל מסמך. Browser Rendering של Cloudflare מפיק את ה-PDF, וחתימת PAdES במפתח שלך חותמת אותו.'),
        ('✓', 'מספרי הקצאה', 'חיבור ל-API חשבוניות ישראל v2 של רשות המסים, סביבת ניסוי וייצור, עם תור ניסיונות חוזרים ותהליך ברור כשהרשות מסרבת.'),
        ('₪', 'מטבע חוץ כמו שצריך', 'שערי בנק ישראל, נשמרים מדי יום. אפשר להעביר את השער מדרישת התשלום לקבלה. היתרות נשארות במטבע של הלקוח.'),
        ('⇄', 'כרטסת לקוח שמסתדרת', 'דרישת תשלום נרשמת פעם אחת ונסגרת בקבלה שמשלמת אותה. יתרות פתוחות, גיול ורשימת איחורים בלוח הבקרה.'),
        ('↻', 'מסמכים חוזרים ושכפול', 'שכפול כל מסמך בלחיצה. ריטיינר חודשי שממתין לאישורך, או מופק ונשלח במייל לבד.'),
        ('✉', 'שליחה בהסכמה', 'שליחת מסמך במייל או בוואטסאפ. ההסכמה לקבלת מסמכים דיגיטליים נשמרת לכל לקוח, ותזכורות תשלום יוצאות לפני מועד התשלום ואחריו.'),
        ('◔', 'מד תקרת עוסק פטור', 'המחזור מול התקרה השנתית, התראות ב-70, 85, 95 ו-100 אחוז, ומעבר מודרך לעוסק מורשה.'),
        ('⤓', 'הוצאות מ-Drive', 'העלאת קבלה או ייבוא חודש שלם מ-Google Drive. Claude קורא כל מסמך, ואתה בודק ומתייק.'),
        ('∑', 'דוחות וכניסה לרואה החשבון', 'הכנסות, הוצאות, רווח והפסד, כרטסות לקוחות וחבילה חודשית לרואה החשבון. לרואה החשבון תפקיד נפרד עם תאריך סיום ויומן גישה.'),
        ('⇪', 'ייצוא, ייבוא וגיבויים', 'קובץ במבנה אחיד ו-PCN874. ייבוא לקוחות ומסמכי עבר ממערכת אחרת. גיבוי רבעוני ל-R2 ול-Google Drive.'),
        ('▯', 'בנויה לטלפון', 'סרגל ניווט תחתון, טקסט וכפתורים גדולים יותר, וטבלאות שהופכות לכרטיסים. כל מסך עובד ברוחב של טלפון.'),
        ('◉', 'צילום קבלה', 'מצלמים או בוחרים תמונה מהגלריה. Claude קורא ספק, תאריך וסכום. אין קליטה? התמונה נשמרת בטלפון ועולה אחר כך.'),
        ('⌂', 'מותקנת כמו אפליקציה', 'מוסיפים למסך הבית. היא נפתחת במסך "מהיר": הוספת הוצאה, הפקת מסמך ופעילות אחרונה.'),
    ],
    mob_eyebrow='בטלפון', mob_h='הנהלת החשבונות בכיס',
    mob_p='מתקינים על מסך הבית. היא נפתחת במסך "מהיר", מוכנה לקבלה הבאה.',
    phones=[
        ('phone-quick.png', 'מסך מהיר עם כפתורי מצלמה וגלריה וקיצורי מסמכים', 'מהיר', 'מצלמים, בוחרים מהגלריה או פותחים מסמך חדש.'),
        ('phone-expense.png', 'בדיקת הוצאה עם צילום הקבלה והשדות ש-Claude מילא', 'בדיקה ותיוק', 'Claude ממלא את השדות. אתה בודק ומתייק.'),
        ('phone-activity.png', 'רשימת פעילות אחרונה עם מסמכים והוצאות', 'פעילות אחרונה', 'המסמכים וההוצאות האחרונים, עם סכום וסטטוס.'),
        ('phone-dashboard.png', 'לוח הבקרה בטלפון עם פעולות מהירות ופריטים באיחור', 'לוח בקרה', 'פריטים פתוחים ובאיחור, תזרים ותקרת עוסק פטור.'),
    ],
    how_eyebrow='איך זה עובד', how_h='שלושה שלבים, ואז המסמך הראשון',
    how_p='אתה פורס עותק משלך. אף אחד אחר לא מריץ אותו, לא רואה אותו ולא מחזיק את המידע שלך.',
    steps=[
        ('פריסת עותק משלך', 'יוצרים מסד נתונים D1 אחד ושני דליי R2, מחברים את ה-Worker ל-fork שלך ב-GitHub ומוסיפים דומיין. כל push ל-main נפרס.'),
        ('נעילה', 'Cloudflare Access מכניס אותך עם המייל שלך. מוסיפים סודות: מפתח החתימה, מפתח המייל ופרטי רשות המסים כשאתה עוסק מורשה.'),
        ('הגדרת העסק', 'פרטי העסק, לוגו, חתימה ומספר ההתחלה של כל סדרה, כדי שהמספור ימשיך מהמערכת הקודמת.'),
    ],
    shots_eyebrow='צילומי מסך', shots_h='מה מקבלים', shots_p='נתוני דמו בדויים בכל העמוד.',
    shots=[
        ('documents.png', 'רשימת מסמכים עם סטטוס, מסמכים קשורים ויתרות', 'מסמכים והקשרים ביניהם', 'כל מסמך עם הסטטוס שלו, המסמכים שממנו נוצר או שנוצרו ממנו, ומה עוד פתוח.'),
        ('payment-requests.png', 'רשימת דרישות תשלום עם סכומים פתוחים ובאיחור', 'דרישות תשלום שנסגרות', 'רושמים תשלום והקבלה מקושרת לדרישה. תשלום חלקי משאיר את היתרה פתוחה.'),
        ('clients.png', 'עמוד לקוח עם פרטים, אנשי קשר וכרטסת', 'לקוחות והכרטסת שלהם', 'עמוד לכל לקוח עם אנשי קשר, סטטוס הסכמה, מסמכים וכרטסת רצה לפי מטבע.'),
        ('expenses.png', 'רשימת הוצאות עם ספקים וקטגוריות', 'הוצאות לבדיקה ותיוק', 'מסמכים ש-Claude קרא נכנסים ל"חדש". בודקים ספק, סכום וקטגוריה ומתייקים.'),
        ('reports.png', 'קטלוג הדוחות', 'דוחות לך ולרואה החשבון', 'הכנסות, הוצאות, רווח והפסד, פריטים פתוחים וכרטסות. הורדה כ-PDF, XLSX או CSV.'),
        ('settings-business.png', 'הגדרות העסק עם לוגו וחתימה', 'העסק שלך, המיתוג שלך', 'פרטי העסק, לוגו, חתימה, אמצעי תשלום ופרטי בנק שמודפסים על המסמכים.'),
    ],
    rules_eyebrow='הכללים', rules_h='שישה כללים שהקוד אוכף',
    rules_p='כללי הנהלת החשבונות בישראל הם לא הגדרה כאן. מסד הנתונים מסרב לשבור אותם.',
    rules=[
        ('מסמך סופי לא משתנה', 'טעות מתקנים במסמך זיכוי או בביטול, לעולם לא בעריכה. טריגרים במסד הנתונים חוסמים עדכון של שורה סופית.'),
        ('מספר ניתן רק בהפקה', 'לטיוטה אין מספר, כך שטיוטה שנמחקה לא משאירה חור בסדרה.'),
        ('אין PDF לחשבונית מס בלי מספר הקצאה', 'כשרשות המסים דורשת מספר הקצאה, ה-PDF ממתין לו.'),
        ('דרישה והקבלה שלה נספרות פעם אחת', 'דרישת תשלום או חשבון עסקה הם חיוב, הקבלה היא ההכנסה. הדוחות אף פעם לא מחברים את שתיהן.'),
        ('שיעורים מתוארכים', 'מע"מ, תקרת עוסק פטור ושערי מטבע נשמרים עם התאריך שממנו הם חלים.'),
        ('ניסוי וייצור לא מתערבבים', 'פרטי הגישה, הטוקנים והמספרים של סביבת הניסוי והייצור ברשות המסים נשמרים בנפרד.'),
    ],
    need_eyebrow='לפני שמתחילים', need_h='מה צריך',
    need_p='מתחילים בתוכניות חינמיות. Workers Paid, החל מ-5$ לחודש, הוא השדרוג היחיד ששווה לתכנן.',
    need_cols=['דרישה', 'הערות'], required='חובה', optional='רשות',
    needs=[
        ('חשבון Cloudflare', True, 'Workers Free מריץ אותה: ה-Worker, D1, R2, Browser Rendering ו-5 משימות מתוזמנות. Workers Paid, החל מ-5$ לחודש, מסיר את המגבלות שלמטה.'),
        ('דומיין ב-Cloudflare', True, 'הכתובת של המערכת, למשל ledger.example.com, מאחורי Cloudflare Access. Zero Trust חינמי לצוותים קטנים.'),
        ('מפתח ותעודה לחתימת PDF', True, 'לחתימת PAdES על כל PDF. הקובץ docs/setup.md מסביר איך יוצרים.'),
        ('Node.js ו-Wrangler', True, 'במחשב שלך, להרצת מיגרציות למסד הנתונים ולהגדרת סודות.'),
        ('חשבון Resend', False, 'לשליחת מסמכים, תזכורות וחבילת רואה החשבון במייל. התוכנית החינמית מספיקה לעסק קטן.'),
        ('פרטי גישה ל-API של רשות המסים', False, 'רק לעוסק מורשה, למספרי הקצאה על חשבוניות מס.'),
        ('מפתח API של Anthropic', False, 'כדי ש-Claude יקרא הוצאות ומסמכי עבר. תשלום לפי שימוש, כמה סנטים למסמך.'),
        ('חשבון שירות ב-Google Cloud', False, 'לייבוא הוצאות מ-Drive ולעותקי גיבוי. חינם.'),
    ],
    paid_title='מתי לעבור ל-Workers Paid.',
    paid_intro='המערכת משתמשת ב-5 משימות מתוזמנות, המקסימום ב-Workers Free. לתוכנית החינמית יש עוד שלוש מגבלות שכדאי להכיר:',
    paid=[
        'זמן מעבד למשימה מתוזמנת: 10 מילישניות בתוכנית החינמית. רוב המשימות נכנסות. חבילת רואה החשבון החודשית והגיבוי הרבעוני בונים קבצים, והן אלה שכנראה ידרשו Paid.',
        'Browser Rendering, שמפיק כל PDF: 10 דקות ביום בחינם, 10 שעות בחודש ב-Paid.',
        'שחזור לנקודת זמן ב-D1: 7 ימים בחינם, 30 ימים ב-Paid. לספרים חוקיים, 30 ימים זה מה שצריך.',
    ],
    reg_title='צריך לרשום את התוכנה ברשות המסים?',
    reg_p=[
        'רשות המסים מחייבת רישום תוכנה מיצרני תוכנות לניהול מערכת חשבונות המיועדות למכירה, להשכרה או לשימושם של אחרים, כולל שימוש בחינם.',
        'אתה פורס עותק משלך ומריץ אותו לעסק שלך בלבד. אתה לא מוכר, לא משכיר ולא מריץ אותו בשביל אחרים, ולכן חובת הרישום הזאת לא חלה עליך. אם תריץ אותו לעסק אחר, למשל ספרים של לקוחות, תרשום אותו קודם.',
        'כדי לקבל פרטי גישה ל-API של רשות המסים למספרי הקצאה כעוסק מורשה, עדיין נרשמים בפורטל המפתחים של הרשות. בדוק את ההגדרות עם רואה החשבון שלך.',
    ],
    reg_link='עמוד רישום התוכנה ברשות המסים',
    reg_refs_h='מקורות',
    reg_refs=[
        ('רשות המסים, "בקשה לרישום תוכנה המיועדת לניהול מערכת חשבונות ממוחשבת", עמוד השירות, עודכן 29.05.2025. מי חייב ברישום:', ITA_REG, 'gov.il'),
        ('רשות המסים, מאגר התוכנות הרשומות לניהול מערכת חשבונות ממוחשבת.', ITA_REGISTRY, 'gov.il'),
        ('המסגרת החוקית: הוראות מס הכנסה (ניהול פנקסי חשבונות), התשל"ג-1973, הכללים למערכת ממוחשבת לפי הוראה 36.', None, None),
    ],
    reg_quote='יצרני תוכנות לניהול מערכת חשבונות ממוחשבת המיועדת למכירה, להשכרה או לשימושם של אחרים (כולל שימוש בחינם)',
    limits_eyebrow='מגבלות ידועות', limits_h='מה היא לא עושה',
    limits=[
        'זה לא ייעוץ מס או ייעוץ משפטי. בדוק את ההגדרות עם רואה החשבון שלך לפני שאתה מפיק מסמך אמיתי.',
        'עסק אחד לכל התקנה.',
        'ישראל בלבד: סוגי המסמכים, המע"מ וכללי רשות המסים הם ישראליים.',
        'המערכת רושמת תשלומים. היא לא סולקת כרטיסים ולא גובה כסף.',
        'ייצוא PCN874 ממלא את עמודת מספר ההקצאה. שאר העמודות עדיין חלקיות.',
        'אתה מריץ אותה: עדכונים, סודות וחשבון Cloudflare הם שלך.',
    ],
    final_h='קרא את הקוד לפני שאתה פורס',
    final_p='המערכת מפיקה מסמכים חוקיים בשמך. הקוד פתוח כדי שתוכל לבדוק כל כלל.',
    foot_links=['GitHub', 'מדריך פריסה', 'מדריך הגדרה', 'רישיון AGPL-3.0'],
    foot_note='מאוחסן ב-Cloudflare Workers · קוד פתוח ברישיון AGPL-3.0 · לא קשור ל-Cloudflare או לרשות המסים',
)


IDS = ['features', 'mobile', 'how', 'screens', 'setup']

CSS = '''
:root { --bg: #f6f8fb; --bg-2: #eef2f7; --surface: #ffffff; --surface-2: #f1f4f9; --border: #dbe2ec; --border-soft: #e6ebf2;
  --text: #0f172a; --text-dim: #475569; --text-mute: #64748b; --blue: #2563eb; --blue-soft: #2563eb; --green: #16a34a; --green-2: #15803d;
  --orange: #d97706; --purple: #7c3aed; --radius: 16px; --maxw: 1120px; --shadow: 0 24px 60px -28px rgba(15,23,42,.35); color-scheme: light; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: Heebo, "Segoe UI", Assistant, system-ui, sans-serif; font-weight: 400; line-height: 1.6; -webkit-font-smoothing: antialiased; }
a { color: inherit; }
img { max-width: 100%; display: block; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 1px 6px; }
.wrap { max-width: var(--maxw); margin: 0 auto; padding: 0 22px; }
header { position: sticky; top: 0; z-index: 40; background: rgba(246,248,251,.86); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border-soft); }
.nav { display: flex; align-items: center; justify-content: space-between; gap: 18px; height: 64px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -.01em; text-decoration: none; white-space: nowrap; }
.brand svg { width: 26px; height: 26px; flex: 0 0 auto; }
.nav-links { display: flex; gap: 22px; font-size: 14px; color: var(--text-dim); }
.nav-links a { text-decoration: none; }
.nav-links a:hover { color: var(--text); }
.nav-end { display: flex; align-items: center; gap: 10px; }
.lang { font-size: 14px; color: var(--text-dim); text-decoration: none; padding: 8px 10px; }
.lang:hover { color: var(--text); }
@media (max-width: 760px) { .nav-links { display: none; } }
@media (max-width: 480px) { .nav-end .btn-sm { display: none; } }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 22px; border-radius: 12px; font-weight: 600; font-size: 15px; text-decoration: none; border: 1px solid transparent; cursor: pointer; transition: transform .15s, border-color .15s, box-shadow .15s, background .15s; }
.btn-primary { background: linear-gradient(180deg, var(--green), var(--green-2)); color: #ffffff; }
.btn-primary:hover { transform: translateY(-2px); box-shadow: 0 14px 30px -14px rgba(22,163,74,.7); }
.btn-ghost { background: var(--surface); border-color: var(--border); color: var(--text); }
.btn-ghost:hover { border-color: var(--text-mute); }
.btn-sm { padding: 9px 16px; font-size: 14px; border-radius: 10px; }
.hero { padding: 76px 0 44px; text-align: center; }
.badge { display: inline-flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--text-dim); background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 6px 14px; margin-bottom: 22px; }
.badge b { color: var(--green); font-weight: 600; }
h1 { font-size: clamp(32px, 5.2vw, 54px); line-height: 1.1; letter-spacing: -.03em; margin: 0 0 16px; font-weight: 800; }
.lead { font-size: clamp(16px, 2vw, 19px); color: var(--text-dim); max-width: 680px; margin: 0 auto 28px; }
.cta { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-bottom: 26px; }
.cmd { display: flex; align-items: center; gap: 12px; max-width: 640px; margin: 0 auto; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 12px 12px 16px; direction: ltr; }
.cmd code { font-size: 13px; color: var(--text-dim); overflow-x: auto; white-space: nowrap; flex: 1; text-align: left; background: none; border: 0; padding: 0; }
.cmd button { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-dim); border-radius: 8px; padding: 7px 12px; font: inherit; font-size: 13px; cursor: pointer; flex: 0 0 auto; }
.cmd button:hover { color: var(--text); border-color: var(--text-mute); }
.cmd-note { font-size: 12.5px; color: var(--text-mute); margin-top: 10px; }
.feat, .step, .gcard, .limits li, table { box-shadow: 0 1px 2px rgba(15,23,42,.04); }
.shot { margin: 44px auto 0; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); background: var(--surface); }
.shot img { width: 100%; }
.shot-cap { font-size: 13px; color: var(--text-mute); text-align: center; margin-top: 12px; }
section { padding: 72px 0; border-top: 1px solid var(--border-soft); }
.sec-head { text-align: center; max-width: 660px; margin: 0 auto 44px; }
.eyebrow { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--blue); font-weight: 600; margin-bottom: 10px; }
[dir=rtl] .eyebrow, [dir=rtl] th { letter-spacing: 0; }
h2 { font-size: clamp(24px, 3.4vw, 34px); line-height: 1.2; letter-spacing: -.02em; margin: 0 0 12px; font-weight: 700; }
.sec-head p { color: var(--text-dim); margin: 0; }
.features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
@media (max-width: 900px) { .features { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 620px) {
  /* Phones: two compact columns, so 6 to 8 features fit on one screen. */
  .features { grid-template-columns: 1fr 1fr; gap: 10px; }
  .features .feat { padding: 12px; border-radius: 12px; }
  .features .feat .ico { width: 28px; height: 28px; border-radius: 8px; font-size: 14px; margin-bottom: 8px; }
  .features .feat h3 { font-size: 13.5px; line-height: 1.3; margin-bottom: 4px; }
  .features .feat p { font-size: 12px; line-height: 1.45; }
}
.feat { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 22px; }
.feat .ico { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; margin-bottom: 14px; background: var(--surface-2); border: 1px solid var(--border); font-size: 18px; color: var(--blue); }
.feat h3 { margin: 0 0 8px; font-size: 16.5px; font-weight: 650; letter-spacing: -.01em; }
.feat p { margin: 0; color: var(--text-dim); font-size: 14.5px; }
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
@media (max-width: 760px) { .steps { grid-template-columns: 1fr; } }
.step { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 22px; }
.step .n { width: 30px; height: 30px; border-radius: 9px; background: var(--blue-soft); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 14px; margin-bottom: 14px; }
.step h3 { margin: 0 0 8px; font-size: 16.5px; font-weight: 650; }
.step p { margin: 0; color: var(--text-dim); font-size: 14.5px; }
.gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
@media (max-width: 820px) { .gallery { grid-template-columns: 1fr; } }
.gcard { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.gcard img { width: 100%; border-bottom: 1px solid var(--border-soft); }
.gcard .t { padding: 14px 18px 18px; }
.gcard h3 { margin: 0 0 6px; font-size: 15.5px; font-weight: 650; }
.gcard p { margin: 0; color: var(--text-dim); font-size: 14px; }
.phones { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; align-items: start; }
@media (max-width: 900px) { .phones { grid-template-columns: repeat(2, 1fr); gap: 14px; } }
.phone { margin: 0; }
.phone .frame { background: #0a0f18; border: 1px solid var(--border); border-radius: 30px; padding: 8px; box-shadow: var(--shadow); }
.phone img { width: 100%; height: auto; border-radius: 23px; }
.phone figcaption { padding: 12px 4px 0; }
.phone h3 { margin: 0 0 4px; font-size: 15px; font-weight: 650; }
.phone p { margin: 0; color: var(--text-dim); font-size: 13.5px; line-height: 1.5; }
@media (max-width: 620px) { .phone .frame { border-radius: 22px; padding: 5px; } .phone img { border-radius: 18px; } .phone h3 { font-size: 13.5px; } .phone p { font-size: 12px; } }
.reg { background: var(--surface); border-inline-start: 3px solid var(--green); border-radius: 12px; padding: 20px 22px; margin-top: 22px; }
.reg h3 { margin: 0 0 10px; font-size: 16.5px; font-weight: 650; }
.reg p { margin: 0 0 10px; color: var(--text-dim); font-size: 14.5px; }
.reg a { color: var(--blue); }
.refs { border-top: 1px solid var(--border-soft); margin-top: 14px; padding-top: 12px; font-size: 13px; color: var(--text-mute); }
.refs b { color: var(--text-dim); font-weight: 600; }
.refs ol { margin: 6px 0 0; padding-inline-start: 20px; }
.refs li { margin: 4px 0; }
.refs q { color: var(--text-dim); unicode-bidi: isolate; }
.reg sup a { text-decoration: none; font-size: 11px; }
.refs li:target { background: var(--surface-2); border-radius: 6px; }
.honest { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 820px) { .honest { grid-template-columns: 1fr; } }
.hcard { background: var(--surface); border-inline-start: 3px solid var(--orange); border-radius: 12px; padding: 20px; }
.hcard h3 { margin: 0 0 8px; font-size: 15.5px; font-weight: 650; }
.hcard p { margin: 0; color: var(--text-dim); font-size: 14.5px; }
table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; font-size: 14.5px; }
th, td { text-align: start; padding: 13px 18px; border-bottom: 1px solid var(--border-soft); vertical-align: top; }
th { color: var(--text-mute); font-weight: 600; font-size: 12.5px; letter-spacing: .06em; text-transform: uppercase; }
tr:last-child td { border-bottom: 0; }
td b { font-weight: 600; }
td span { color: var(--text-dim); }
.tag { display: inline-block; font-size: 11.5px; font-weight: 600; border-radius: 999px; padding: 1px 8px; margin-inline-start: 8px; border: 1px solid var(--border); color: var(--text-mute); vertical-align: 1px; }
.tag.req { color: var(--green); border-color: rgba(22,163,74,.4); }
@media (max-width: 620px) { th, td { padding: 11px 12px; } td { display: block; border-bottom: 0; } tr { display: block; border-bottom: 1px solid var(--border-soft); padding: 6px 0; } thead { display: none; } }
.note { background: var(--surface); border-inline-start: 3px solid var(--blue); border-radius: 12px; padding: 18px 20px; color: var(--text-dim); font-size: 14.5px; margin-top: 22px; }
.note b { color: var(--text); }
.note ul { margin: 10px 0 0; padding-inline-start: 20px; }
.note li { margin: 4px 0; }
.limits { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; list-style: none; padding: 0; margin: 0; }
@media (max-width: 760px) { .limits { grid-template-columns: 1fr; } }
.limits li { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 18px; color: var(--text-dim); font-size: 14.5px; }
.final { text-align: center; }
.final .cta { margin-top: 26px; margin-bottom: 0; }
footer { border-top: 1px solid var(--border-soft); padding: 34px 0 46px; color: var(--text-mute); font-size: 14px; }
.foot { display: flex; justify-content: space-between; align-items: center; gap: 18px; flex-wrap: wrap; }
.foot a { color: var(--text-dim); text-decoration: none; margin-inline-end: 18px; }
.foot a:hover { color: var(--text); }
.toast { position: fixed; left: 50%; bottom: 26px; transform: translate(-50%, 20px); opacity: 0; pointer-events: none; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 18px; font-size: 14px; transition: opacity .2s, transform .2s; }
.toast.on { opacity: 1; transform: translate(-50%, 0); }
'''


def page(c):
    e = html.escape
    nav = '\n      '.join(f'<a href="#{i}">{e(t)}</a>' for i, t in zip(IDS, c['nav']))
    feats = '\n'.join(
        f'''        <div class="feat">
          <div class="ico" aria-hidden="true">{ico}</div>
          <h3>{e(h)}</h3>
          <p>{e(p)}</p>
        </div>''' for ico, h, p in c['features'])
    steps = '\n'.join(
        f'''        <div class="step">
          <div class="n">{n}</div>
          <h3>{e(h)}</h3>
          <p>{e(p)}</p>
        </div>''' for n, (h, p) in enumerate(c['steps'], 1))
    shots = '\n'.join(
        f'''        <div class="gcard">
          <img src="screenshots/{img}" alt="{e(alt)}" loading="lazy">
          <div class="t">
            <h3>{e(h)}</h3>
            <p>{e(p)}</p>
          </div>
        </div>''' for img, alt, h, p in c['shots'])
    phones = '\n'.join(
        f'''        <figure class="phone">
          <div class="frame"><img src="screenshots/{img}" alt="{e(alt)}" loading="lazy" width="585" height="1266"></div>
          <figcaption>
            <h3>{e(h)}</h3>
            <p>{e(p)}</p>
          </figcaption>
        </figure>''' for img, alt, h, p in c['phones'])
    # The first paragraph states the ITA rule, so it points at reference 1, the service page it quotes.
    reg = ''.join(f'<p>{e(x)}' + (' <sup><a href="#ref-1">[1]</a></sup>' if i == 0 else '') + '</p>' for i, x in enumerate(c['reg_p']))
    def ref(i, t, url, label):
        q = f' <q lang="he" dir="rtl">{e(c["reg_quote"])}</q>' if i == 0 else ''
        a = f' <a href="{url}" rel="noopener">{label}</a>' if url else ''
        return f'<li id="ref-{i + 1}">{e(t)}{q}{a}</li>'
    reg_refs = ''.join(ref(i, *r) for i, r in enumerate(c['reg_refs']))
    rules = '\n'.join(
        f'''        <div class="hcard">
          <h3>{e(h)}</h3>
          <p>{e(p)}</p>
        </div>''' for h, p in c['rules'])
    needs = '\n'.join(
        f'''          <tr><td><b>{e(n)}</b><span class="tag{' req' if req else ''}">{e(c['required'] if req else c['optional'])}</span></td><td><span>{e(note)}</span></td></tr>'''
        for n, req, note in c['needs'])
    paid = ''.join(f'<li>{e(x)}</li>' for x in c['paid'])
    limits = '\n'.join(f'        <li>{e(x)}</li>' for x in c['limits'])
    links = [REPO, DEPLOY, SETUP, LICENSE]
    foot = '\n      '.join(f'<a href="{u}">{e(t)}</a>' for u, t in zip(links, c['foot_links']))
    other_lang = 'he' if c['lang'] == 'en' else 'en'
    return f'''<!doctype html>
<html lang="{c['lang']}" dir="{c['dir']}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(c['title'])}</title>
<meta name="description" content="{e(c['desc'])}">
<meta property="og:title" content="Open Ledger IL">
<meta property="og:description" content="{e(c['desc'])}">
<meta property="og:type" content="website">
<meta property="og:image" content="screenshots/dashboard.png">
<link rel="alternate" hreflang="en" href="index.html">
<link rel="alternate" hreflang="he" href="he.html">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>

<header>
  <div class="wrap nav">
    <a class="brand" href="#top">
      {LOGO}
      Open Ledger IL
    </a>
    <nav class="nav-links">
      {nav}
    </nav>
    <div class="nav-end">
      <a class="lang" href="{c['other']}" hreflang="{other_lang}" lang="{other_lang}">{c['other_label']}</a>
      <a class="btn btn-ghost btn-sm" href="{REPO}">{e(c['github'])}</a>
    </div>
  </div>
</header>

<main id="top">
  <div class="wrap">
    <div class="hero">
      <div class="badge">{c['badge']}</div>
      <h1>{c['h1']}</h1>
      <p class="lead">{e(c['lead'])}</p>
      <div class="cta">
        <a class="btn btn-primary" href="{REPO}">{e(c['cta'][0])}</a>
        <a class="btn btn-ghost" href="{DEPLOY}">{e(c['cta'][1])}</a>
      </div>
      <div class="cmd">
        <code id="cmd">{CLONE}</code>
        <button id="copy" type="button">{e(c['copy'])}</button>
      </div>
      <p class="cmd-note">{e(c['cmd_note'])}</p>

      <div class="shot">
        <img src="screenshots/dashboard.png" alt="{e(c['shot_alt'])}">
      </div>
      <p class="shot-cap">{e(c['shot_cap'])}</p>
    </div>
  </div>

  <section id="features">
    <div class="wrap">
      <div class="sec-head">
        <div class="eyebrow">{e(c['feat_eyebrow'])}</div>
        <h2>{e(c['feat_h'])}</h2>
        <p>{e(c['feat_p'])}</p>
      </div>
      <div class="features">
{feats}
      </div>
    </div>
  </section>

  <section id="mobile">
    <div class="wrap">
      <div class="sec-head">
        <div class="eyebrow">{e(c['mob_eyebrow'])}</div>
        <h2>{e(c['mob_h'])}</h2>
        <p>{e(c['mob_p'])}</p>
      </div>
      <div class="phones">
{phones}
      </div>
    </div>
  </section>

  <section id="how">
    <div class="wrap">
      <div class="sec-head">
        <div class="eyebrow">{e(c['how_eyebrow'])}</div>
        <h2>{e(c['how_h'])}</h2>
        <p>{e(c['how_p'])}</p>
      </div>
      <div class="steps">
{steps}
      </div>
    </div>
  </section>

  <section id="screens">
    <div class="wrap">
      <div class="sec-head">
        <div class="eyebrow">{e(c['shots_eyebrow'])}</div>
        <h2>{e(c['shots_h'])}</h2>
        <p>{e(c['shots_p'])}</p>
      </div>
      <div class="gallery">
{shots}
      </div>
    </div>
  </section>

  <section id="rules">
    <div class="wrap">
      <div class="sec-head">
        <div class="eyebrow">{e(c['rules_eyebrow'])}</div>
        <h2>{e(c['rules_h'])}</h2>
        <p>{e(c['rules_p'])}</p>
      </div>
      <div class="honest">
{rules}
      </div>
    </div>
  </section>

  <section id="setup">
    <div class="wrap">
      <div class="sec-head">
        <div class="eyebrow">{e(c['need_eyebrow'])}</div>
        <h2>{e(c['need_h'])}</h2>
        <p>{e(c['need_p'])}</p>
      </div>
      <table>
        <thead><tr><th>{e(c['need_cols'][0])}</th><th>{e(c['need_cols'][1])}</th></tr></thead>
        <tbody>
{needs}
        </tbody>
      </table>
      <div class="note"><b>{e(c['paid_title'])}</b> {e(c['paid_intro'])}<ul>{paid}</ul></div>
      <div class="reg" id="registration">
        <h3>{e(c['reg_title'])}</h3>
        {reg}
        <p><a href="{ITA_REG}" rel="noopener">{e(c['reg_link'])}</a></p>
        <div class="refs"><b>{e(c['reg_refs_h'])}</b><ol>{reg_refs}</ol></div>
      </div>

      <div class="sec-head" style="margin-top:56px">
        <div class="eyebrow">{e(c['limits_eyebrow'])}</div>
        <h2>{e(c['limits_h'])}</h2>
      </div>
      <ul class="limits">
{limits}
      </ul>
    </div>
  </section>

  <section class="final">
    <div class="wrap">
      <h2>{e(c['final_h'])}</h2>
      <p class="lead">{e(c['final_p'])}</p>
      <div class="cta">
        <a class="btn btn-primary" href="{REPO}">{e(c['cta'][0])}</a>
        <a class="btn btn-ghost" href="{DEPLOY}">{e(c['cta'][1])}</a>
      </div>
    </div>
  </section>
</main>

<footer>
  <div class="wrap foot">
    <div>
      {foot}
    </div>
    <div>{e(c['foot_note'])}</div>
  </div>
</footer>

<div class="toast" id="toast" role="status">{e(c['copied'])}</div>

<script>
(function () {{
  var owner = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : null;
  var repo = location.pathname.split('/').filter(Boolean)[0] || 'open-ledger-il';
  var base = owner ? 'https://github.com/' + owner + '/' + repo : null;
  document.querySelectorAll('[data-gh]').forEach(function (a) {{
    if (base) a.href = base + a.getAttribute('data-gh');
  }});
  if (base) document.getElementById('cmd').textContent = 'git clone ' + base + '.git';
}})();
document.getElementById('copy').addEventListener('click', async function () {{
  var text = document.getElementById('cmd').textContent;
  try {{ await navigator.clipboard.writeText(text); }}
  catch (err) {{
    var t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select();
    document.execCommand('copy'); t.remove();
  }}
  var toast = document.getElementById('toast');
  toast.classList.add('on');
  setTimeout(function () {{ toast.classList.remove('on'); }}, 1600);
}});
</script>
</body>
</html>
'''


FAVICON = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect x="1" y="1" width="30" height="30" rx="8" fill="#141d2e" stroke="#26344b" stroke-width="1.5"/>
  <rect x="8" y="6" width="16" height="20" rx="2.5" fill="none" stroke="#4f93ff" stroke-width="2"/>
  <path d="M12 12h8M12 16h8" stroke="#35c46a" stroke-width="2" stroke-linecap="round"/>
  <path d="M12 20h5" stroke="#9b6dff" stroke-width="2" stroke-linecap="round"/>
</svg>
'''

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'docs'
    os.makedirs(out, exist_ok=True)
    for c in (EN, HE):
        open(os.path.join(out, c['file']), 'w', encoding='utf-8', newline='\n').write(page(c))
    open(os.path.join(out, 'favicon.svg'), 'w', encoding='utf-8', newline='\n').write(FAVICON)
    # Serve the files as they are. Without this, Pages runs Jekyll over the Markdown docs.
    open(os.path.join(out, '.nojekyll'), 'w').write('')
    print('built', out)
