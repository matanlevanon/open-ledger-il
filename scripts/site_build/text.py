"""
The product site's text, English and Hebrew. Moved from scripts/build-site.py in R32, unchanged,
then extended with the inner pages. Every address comes from site.config.json (config.py).
"""
from .config import DEPLOY, ITA_REG, ITA_REGISTRY, SETUP, VERSION

EN = dict(
    lang='en', dir='ltr', file='index.html', other='he.html', other_label='עברית',
    title='Open Ledger IL - invoices and books for an Israeli business, on your own Cloudflare',
    desc='Open-source invoicing, receipts, expenses and bookkeeping for עוסק פטור and עוסק מורשה. Legal numbering, signed PDFs, ITA allocation numbers. Runs on your own Cloudflare account.',
    nav=['Features', 'Screenshots', 'How it works', 'Pricing'], github='View on GitHub',
    badge='<b>Free</b> · Open source · Registered with the Israel Tax Authority · v' + VERSION,
    h1='Invoices, receipts and books for an Israeli business,<br>on infrastructure you own.',
    lead='Quotes, receipts, tax invoices, contracts and expenses, with legal numbering and ITA allocation numbers. It runs in your own Cloudflare account. Your data stays yours.',
    cta=['Get the code', 'Read the deploy guide', 'See setup options'], copy='Copy', copied='Copied',
    demo_nav='Demo', demo_cta='Try the live demo',
    demo_note='No install. Sample data, opens in seconds.',
    cmd_note='Starts on the Workers Free plan. Setup takes an afternoon.',
    shot_alt='The dashboard: open and overdue documents, cash flow, income by month and top clients',
    shot_cap='All screenshots on this page use an invented demo business.',
    feat_eyebrow='What it does', feat_h='Everything a small Israeli business issues and files',
    feat_p='For a עוסק פטור today and a עוסק מורשה tomorrow.',
    features=[
        ('▤', 'Every Israeli document type', 'Quotes, payment requests, receipts and tax invoices, in English or Hebrew and English.'),
        ('#', 'Numbering that cannot break', 'Gapless series, locked final documents and signed PDFs.'),
        ('✓', 'ITA allocation numbers', 'Israel Invoices API v2, with a retry queue.'),
        ('§', 'Contracts and work orders', 'The client signs on any screen. A signed work order becomes a pro forma.'),
        ('◉', 'Expenses read by Claude', 'Snap a receipt or import a month from Google Drive.'),
        ('∑', 'Reports for your accountant', 'P&L, client ledgers, the unified file and an accountant login.'),
    ],
    list_eyebrow='Feature list', list_h='Every feature',
    list_p='Open a group to see what ships today.',
    feature_list=[
        ('Documents', [
            'Quotes, payment requests and pro formas (חשבון עסקה)',
            'Receipts and credit receipts as עוסק פטור',
            'Tax invoices, invoice/receipts and credit invoices as עוסק מורשה',
            'English or bilingual Hebrew and English documents',
            'Duplicate any document in one click',
            'Create a receipt from any open document, with its payment filled in',
            'Cheque payments with bank, branch and account number',
            'Delete a draft only after you confirm',
        ]),
        ('Numbering and compliance', [
            'One gapless series per document type, with your own starting numbers',
            'Final documents locked by database triggers and a hash chain',
            'PDF with your logo and signature, sealed with a PAdES digital signature',
            'ITA allocation numbers (מספר הקצאה), sandbox and production, with a retry queue',
            'פטור ceiling meter with alerts and a guided switch to מורשה',
            'Issuing on/off switch, to keep issuing in your current system',
        ]),
        ('Currency', [
            'Documents in ILS, USD, EUR and other currencies',
            'Bank of Israel rates, cached daily',
            'A receipt takes the rate of the document it pays',
            'Type your own rate, or tick "use latest rate"',
            'Foreign and ILS totals printed in their own columns',
            'Client balances kept in the client’s currency',
        ]),
        ('Sending', [
            'Email with To, CC and BCC on every document',
            'A CC list per client and a BCC copy list for your own records',
            'WhatsApp short link that opens a preview page with your logo',
            'A ready greeting in English or Hebrew, by the client’s language',
            'Digital-document consent recorded per client',
            'Payment reminders before and after the due date',
            'A clear confirmation once a document is marked as sent',
        ]),
        ('Recurring documents', [
            'Weekly, monthly, quarterly or yearly schedules for retainers and pro formas',
            'Payment terms in days, set on each copy',
            'An end date to stop the schedule',
            'Issue and email on its own, or wait for your approval',
            'Approvals page on the computer and the phone',
            'Slack notice when a copy waits for approval',
        ]),
        ('Clients and dashboard', [
            'A page per client with contacts, documents and a ledger per currency',
            'Open balances, aging and an overdue list',
            'Create a receipt straight from the overdue card',
            'Cash flow, income by month and top clients',
            'Sortable tables, newest first by default',
        ]),
        ('Contracts and work orders', [
            'Contract and work order templates with fields you define, in English and Hebrew',
            'Service Agreement included in the first work order, signed once',
            'Client signs on the phone or the computer: fill in, draw, confirm with an email code',
            'Signed PDF with an evidence page and a certified PAdES signature',
            'Work order numbers on their own series, filled in for you',
            'Signing reminders, and contracts signed elsewhere uploaded to the client record',
            'Turn a signed work order into a pro forma',
        ]),
        ('Business documents', [
            'VAT and company certificates, bookkeeping and withholding confirmations',
            'Claude reads the type, names and dates',
            'Expiry warnings on the dashboard',
            'Your assistant and accountant open the same list',
        ]),
        ('Expenses and import', [
            'Upload a receipt or snap a photo, Claude reads supplier, date and amount',
            'Import a month of expenses from Google Drive',
            'Import customers and past documents from another system',
            'Imported documents keep the exchange rate printed on them, never a guessed one',
            'Documents with no printed rate are flagged for you to fill in',
        ]),
        ('Reports, exports and backups', [
            'Income, expenses, profit and loss, open items and client ledgers',
            'Download as PDF, XLSX or CSV',
            'Monthly accountant pack and an accountant login with an end date and access log',
            'Unified file (מבנה אחיד) v1.31 for the Tax Authority',
            'PCN874 export (allocation-number column)',
            'Quarterly backups to R2 and Google Drive',
        ]),
        ('On your phone', [
            'Installs on the home screen like an app',
            'Quick page: photo, gallery, new document and recent activity',
            'Bottom tab bar and tables that turn into cards',
            'Photos taken offline upload when you are back online',
        ]),
    ],
    mob_eyebrow='On your phone', mob_h='Your books in your pocket',
    mob_p='Install it on your home screen. It opens ready for the next receipt.',
    phones=[
        ('phone-quick.png', 'Quick page with camera and gallery buttons and document shortcuts', 'Quick', 'Take a photo, pick from the gallery or start a document.'),
        ('phone-expense.png', 'Expense review with the receipt photo and the fields Claude filled in', 'Review and file', 'Claude fills in the fields. You check them and file.'),
        ('phone-activity.png', 'Recent activity list with documents and expenses', 'Recent activity', 'The latest documents and expenses, with amount and status.'),
        ('phone-dashboard.png', 'Dashboard on a phone with quick actions and overdue items', 'Dashboard', 'Open and overdue items, cash flow and the פטור ceiling.'),
    ],
    how_eyebrow='How it works', how_h='Three steps to your first document',
    how_p='You deploy your own copy. Nobody else runs it or holds your data.',
    steps=[
        ('Deploy your copy', 'Create one D1 database and two R2 buckets, connect the Worker to your fork on GitHub, and add your domain. Every push to main deploys.'),
        ('Lock it down', 'Cloudflare Access signs you in with your own email. Add the secrets: the PDF signing key, the mail key, and ITA credentials when you are מורשה.'),
        ('Set up the business', 'Business profile, logo, signature and the starting number of each series, so numbering continues from your previous system.'),
    ],
    shots_eyebrow='Screenshots', shots_h='What you get', shots_p='',
    shots=[
        ('documents.png', 'Documents list with status, related documents and open amounts', 'Documents and their relations', 'Every document with its status, the documents it came from or led to, and what is still open.'),
        ('payment-requests.png', 'Payment requests list with overdue and open totals', 'Payment requests that close', 'Record a payment and the receipt links back to the request. Partial payments keep the rest open.'),
        ('clients.png', 'Client page with details, contacts and ledger', 'Clients and their ledger', 'One page per client with contacts, consent status, documents and a running ledger per currency.'),
        ('expenses.png', 'Expenses list with suppliers and categories', 'Expenses to review and file', 'Documents read by Claude land in New. Check the supplier, amount and category, then file.'),
        ('reports.png', 'Reports catalog', 'Reports for you and your accountant', 'Income, expenses, profit and loss, open items and ledgers. Download as PDF, XLSX or CSV.'),
        ('settings-business.png', 'Business settings with logo and signature', 'Your business, your brand', 'Business details, logo, signature, payment methods and bank details printed on your documents.'),
    ],
    rules_eyebrow='The rules', rules_h='Six rules the code enforces',
    rules_p='The database refuses to break them.',
    rules=[
        ('A final document never changes', 'A mistake is fixed with a credit document or a cancellation, never an edit. Database triggers block updates to a final row.'),
        ('Numbers come only from finalize', 'Drafts carry no number, so a deleted draft never leaves a gap in the series.'),
        ('No tax invoice PDF without its allocation number', 'When the ITA requires a מספר הקצאה, the PDF waits for it.'),
        ('A demand and its receipt count once', 'A payment request or pro forma is a charge, the receipt is the income. Reports never add both.'),
        ('Rates are dated', 'VAT, the פטור ceiling and exchange rates are stored with the date they apply from.'),
        ('Sandbox and production never mix', 'ITA sandbox and production credentials, tokens and numbers are kept apart.'),
    ],
    need_eyebrow='Before you start', need_h='What you need',
    need_p='It starts on free tiers.',
    more_h='Workers Paid, Tax Authority registration and known limits',
    need_cols=['Requirement', 'Notes'], required='Required', optional='Optional',
    needs=[
        ('Cloudflare account', True, 'Workers Free runs it: the Worker, D1, R2, Browser Rendering and 5 scheduled jobs. Workers Paid, from $5 a month, lifts the limits below.'),
        ('PDF signing key and certificate', True, 'For the PAdES signature on every PDF. One command makes both, docs/deploy.md step 8.'),
        ('Node.js and Wrangler', True, 'On your computer, to apply database migrations and set secrets.'),
        ('A domain on Cloudflare', False, 'Your own ledger address, for example ledger.example.com. Without one, it runs on the free workers.dev address. Email from your own address still needs a domain.'),
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
        'Open Ledger IL (חשבונאות פתוחה) is registered with the Israel Tax Authority as software for a computerized accounting system, registration certificate 281801, valid to 31 Oct 2028. The certificate was issued for version 1.1.0. The current version is ' + VERSION + ', and new versions are added to the certificate as they are filed.',
        'The Israel Tax Authority requires software registration from producers of accounting software meant for sale, for rent or for use by others, free use included.',
        'You deploy your own copy and run it for your own business only. You do not sell it, rent it or run it for anyone else, so that registration does not apply to you. Run it for another business, for example your clients\u2019 books, and you register first.',
        'Prefer to stay on your current system? Keep issuing invoices and receipts there and turn issuing off in Settings > Issuing. The Ledger then issues no documents, and you use it to import them, track clients, file expenses and run reports.',
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
    final_h='See it working first',
    final_p='Open the demo, then read the code. Every rule is in the open.',
    foot_links=['GitHub', 'Deploy guide', 'Setup guide', 'AGPL-3.0 licence'],
    foot_note='Self-hosted on Cloudflare Workers · Open source under AGPL-3.0 · Not affiliated with Cloudflare or the Israel Tax Authority',
)

HE = dict(
    lang='he', dir='rtl', file='he.html', other='index.html', other_label='English',
    title='Open Ledger IL - חשבוניות, קבלות והנהלת חשבונות לעסק ישראלי, בענן Cloudflare שלך',
    desc='מערכת קוד פתוח לחשבוניות, קבלות, הוצאות והנהלת חשבונות לעוסק פטור ולעוסק מורשה. מספור חוקי, PDF חתום ומספרי הקצאה מרשות המסים. רצה בחשבון Cloudflare שלך.',
    nav=['יכולות', 'צילומי מסך', 'איך זה עובד', 'מחירים'], github='לקוד ב-GitHub',
    badge='<b>חינם</b> · קוד פתוח · רשומה ברשות המסים · גרסה ' + VERSION,
    h1='חשבוניות, קבלות והנהלת חשבונות לעסק ישראלי,<br>על תשתית שבבעלותך.',
    lead='הצעות מחיר, קבלות, חשבוניות מס, חוזים והוצאות, עם מספור חוקי ומספרי הקצאה מרשות המסים. המערכת רצה בחשבון Cloudflare שלך, והמידע נשאר שלך.',
    cta=['לקוד', 'למדריך ההתקנה', 'לאפשרויות ההתקנה'], copy='העתקה', copied='הועתק',
    demo_nav='הדגמה', demo_cta='נסו את ההדגמה',
    demo_note='בלי התקנה. נתוני דוגמה, נפתח תוך שניות.',
    cmd_note='מתחילה בתוכנית Workers Free. ההקמה לוקחת אחר צהריים.',
    shot_alt='לוח הבקרה: מסמכים פתוחים ובאיחור, תזרים, הכנסות לפי חודש ולקוחות מובילים',
    shot_cap='כל צילומי המסך בעמוד הזה מציגים עסק דמו בדוי.',
    feat_eyebrow='מה היא עושה', feat_h='כל מה שעסק ישראלי קטן מפיק ומתייק',
    feat_p='לעוסק פטור היום ולעוסק מורשה מחר.',
    features=[
        ('▤', 'כל סוגי המסמכים', 'הצעות מחיר, דרישות תשלום, קבלות וחשבוניות מס, בעברית או בעברית ואנגלית.'),
        ('#', 'מספור שלא נשבר', 'סדרות בלי חורים, מסמך סופי נעול ו-PDF חתום.'),
        ('✓', 'מספרי הקצאה', 'API חשבוניות ישראל v2, עם תור ניסיונות חוזרים.'),
        ('§', 'חוזים והזמנות עבודה', 'הלקוח חותם בכל מסך. הזמנה חתומה הופכת לחשבון עסקה.'),
        ('◉', 'הוצאות ש-Claude קורא', 'מצלמים קבלה או מייבאים חודש מ-Google Drive.'),
        ('∑', 'דוחות לרואה החשבון', 'רווח והפסד, כרטסות, מבנה אחיד וכניסה לרואה החשבון.'),
    ],
    list_eyebrow='רשימת יכולות', list_h='כל היכולות',
    list_p='פתחו קבוצה כדי לראות מה קיים היום.',
    feature_list=[
        ('מסמכים', [
            'הצעות מחיר, דרישות תשלום וחשבונות עסקה',
            'קבלות וקבלות זיכוי כעוסק פטור',
            'חשבוניות מס, חשבוניות מס קבלה וחשבוניות זיכוי כעוסק מורשה',
            'מסמכים באנגלית או בעברית ואנגלית',
            'שכפול כל מסמך בלחיצה',
            'הפקת קבלה מכל מסמך פתוח, עם התשלום כבר ממולא',
            'תשלום בצ׳ק עם בנק, סניף ומספר חשבון',
            'מחיקת טיוטה רק אחרי אישור',
        ]),
        ('מספור ותאימות', [
            'סדרה אחת בלי חורים לכל סוג מסמך, עם מספר התחלה משלך',
            'מסמך סופי נעול בטריגרים במסד הנתונים ובשרשרת גיבוב',
            'PDF עם הלוגו והחתימה שלך, חתום בחתימה דיגיטלית PAdES',
            'מספרי הקצאה מרשות המסים, ניסוי וייצור, עם תור ניסיונות חוזרים',
            'מד תקרת עוסק פטור עם התראות ומעבר מודרך לעוסק מורשה',
            'מתג הפקה, כדי להמשיך להפיק במערכת הנוכחית שלך',
        ]),
        ('מטבע', [
            'מסמכים בשקלים, דולרים, אירו ומטבעות נוספים',
            'שערי בנק ישראל, נשמרים מדי יום',
            'קבלה מקבלת את השער של המסמך שהיא משלמת',
            'הקלדת שער משלך, או סימון "שער אחרון"',
            'סכומים במטבע חוץ ובשקלים מודפסים כל אחד בעמודה שלו',
            'יתרות הלקוח נשמרות במטבע שלו',
        ]),
        ('שליחה', [
            'מייל עם נמען, CC ו-BCC בכל מסמך',
            'רשימת CC לכל לקוח ורשימת BCC לעותק שלך',
            'קישור וואטסאפ מקוצר שנפתח לעמוד תצוגה עם הלוגו שלך',
            'ברכה מוכנה בעברית או באנגלית, לפי שפת הלקוח',
            'הסכמה לקבלת מסמכים דיגיטליים נשמרת לכל לקוח',
            'תזכורות תשלום לפני מועד התשלום ואחריו',
            'אישור ברור אחרי שמסמך סומן כנשלח',
        ]),
        ('מסמכים חוזרים', [
            'תזמון שבועי, חודשי, רבעוני או שנתי לריטיינרים ולחשבונות עסקה',
            'תנאי תשלום בימים, לכל עותק',
            'תאריך סיום לתזמון',
            'הפקה ושליחה אוטומטית, או המתנה לאישורך',
            'עמוד אישורים במחשב ובטלפון',
            'הודעת Slack כשעותק ממתין לאישור',
        ]),
        ('לקוחות ולוח בקרה', [
            'עמוד לכל לקוח עם אנשי קשר, מסמכים וכרטסת לכל מטבע',
            'יתרות פתוחות, גיול ורשימת איחורים',
            'הפקת קבלה ישירות מכרטיס האיחורים',
            'תזרים, הכנסות לפי חודש ולקוחות מובילים',
            'טבלאות עם מיון, החדש ביותר ראשון כברירת מחדל',
        ]),
        ('חוזים והזמנות עבודה', [
            'תבניות חוזה והזמנת עבודה עם שדות משלך, בעברית ובאנגלית',
            'הסכם השירותים מצורף להזמנת העבודה הראשונה, חתימה אחת',
            'הלקוח חותם בטלפון או במחשב: ממלא, חותם בציור ומאשר בקוד במייל',
            'PDF חתום עם דף ראיות וחתימת PAdES מאושרת',
            'מספרי הזמנות עבודה בסדרה משלהם, ממולאים אוטומטית',
            'תזכורות חתימה, והעלאת חוזים שנחתמו מחוץ למערכת לכרטיס הלקוח',
            'הפיכת הזמנת עבודה חתומה לחשבון עסקה',
        ]),
        ('מסמכי העסק', [
            'תעודת עוסק, תעודת התאגדות, אישור ניהול ספרים וניכוי מס במקור',
            'Claude קורא את הסוג, השמות והתאריכים',
            'התראה בלוח הבקרה לפני שמסמך פג תוקף',
            'העוזר ורואה החשבון רואים את אותה רשימה',
        ]),
        ('הוצאות וייבוא', [
            'העלאת קבלה או צילום, Claude קורא ספק, תאריך וסכום',
            'ייבוא חודש שלם של הוצאות מ-Google Drive',
            'ייבוא לקוחות ומסמכי עבר ממערכת אחרת',
            'מסמכים מיובאים שומרים את השער המודפס עליהם, אף פעם לא שער מנוחש',
            'מסמך בלי שער מודפס מסומן כדי שתשלים אותו',
        ]),
        ('דוחות, ייצוא וגיבויים', [
            'הכנסות, הוצאות, רווח והפסד, פריטים פתוחים וכרטסות לקוחות',
            'הורדה כ-PDF, XLSX או CSV',
            'חבילה חודשית לרואה החשבון וכניסה לרואה החשבון עם תאריך סיום ויומן גישה',
            'קובץ במבנה אחיד גרסה 1.31 לרשות המסים',
            'ייצוא PCN874 (עמודת מספר ההקצאה)',
            'גיבוי רבעוני ל-R2 ול-Google Drive',
        ]),
        ('בטלפון', [
            'מותקנת במסך הבית כמו אפליקציה',
            'מסך "מהיר": צילום, גלריה, מסמך חדש ופעילות אחרונה',
            'סרגל ניווט תחתון וטבלאות שהופכות לכרטיסים',
            'תמונות שצולמו בלי קליטה עולות כשחוזרים לרשת',
        ]),
    ],
    mob_eyebrow='בטלפון', mob_h='הנהלת החשבונות בכיס',
    mob_p='מתקינים על מסך הבית. היא נפתחת מוכנה לקבלה הבאה.',
    phones=[
        ('phone-quick.png', 'מסך מהיר עם כפתורי מצלמה וגלריה וקיצורי מסמכים', 'מהיר', 'מצלמים, בוחרים מהגלריה או פותחים מסמך חדש.'),
        ('phone-expense.png', 'בדיקת הוצאה עם צילום הקבלה והשדות ש-Claude מילא', 'בדיקה ותיוק', 'Claude ממלא את השדות. אתה בודק ומתייק.'),
        ('phone-activity.png', 'רשימת פעילות אחרונה עם מסמכים והוצאות', 'פעילות אחרונה', 'המסמכים וההוצאות האחרונים, עם סכום וסטטוס.'),
        ('phone-dashboard.png', 'לוח הבקרה בטלפון עם פעולות מהירות ופריטים באיחור', 'לוח בקרה', 'פריטים פתוחים ובאיחור, תזרים ותקרת עוסק פטור.'),
    ],
    how_eyebrow='איך זה עובד', how_h='שלושה שלבים למסמך הראשון',
    how_p='אתה פורס עותק משלך. אף אחד אחר לא מריץ אותו ולא מחזיק את המידע שלך.',
    steps=[
        ('פריסת עותק משלך', 'יוצרים מסד נתונים D1 אחד ושני דליי R2, מחברים את ה-Worker ל-fork שלך ב-GitHub ומוסיפים דומיין. כל push ל-main נפרס.'),
        ('נעילה', 'Cloudflare Access מכניס אותך עם המייל שלך. מוסיפים סודות: מפתח החתימה, מפתח המייל ופרטי רשות המסים כשאתה עוסק מורשה.'),
        ('הגדרת העסק', 'פרטי העסק, לוגו, חתימה ומספר ההתחלה של כל סדרה, כדי שהמספור ימשיך מהמערכת הקודמת.'),
    ],
    shots_eyebrow='צילומי מסך', shots_h='מה מקבלים', shots_p='',
    shots=[
        ('documents.png', 'רשימת מסמכים עם סטטוס, מסמכים קשורים ויתרות', 'מסמכים והקשרים ביניהם', 'כל מסמך עם הסטטוס שלו, המסמכים שממנו נוצר או שנוצרו ממנו, ומה עוד פתוח.'),
        ('payment-requests.png', 'רשימת דרישות תשלום עם סכומים פתוחים ובאיחור', 'דרישות תשלום שנסגרות', 'רושמים תשלום והקבלה מקושרת לדרישה. תשלום חלקי משאיר את היתרה פתוחה.'),
        ('clients.png', 'עמוד לקוח עם פרטים, אנשי קשר וכרטסת', 'לקוחות והכרטסת שלהם', 'עמוד לכל לקוח עם אנשי קשר, סטטוס הסכמה, מסמכים וכרטסת רצה לפי מטבע.'),
        ('expenses.png', 'רשימת הוצאות עם ספקים וקטגוריות', 'הוצאות לבדיקה ותיוק', 'מסמכים ש-Claude קרא נכנסים ל"חדש". בודקים ספק, סכום וקטגוריה ומתייקים.'),
        ('reports.png', 'קטלוג הדוחות', 'דוחות לך ולרואה החשבון', 'הכנסות, הוצאות, רווח והפסד, פריטים פתוחים וכרטסות. הורדה כ-PDF, XLSX או CSV.'),
        ('settings-business.png', 'הגדרות העסק עם לוגו וחתימה', 'העסק שלך, המיתוג שלך', 'פרטי העסק, לוגו, חתימה, אמצעי תשלום ופרטי בנק שמודפסים על המסמכים.'),
    ],
    rules_eyebrow='הכללים', rules_h='שישה כללים שהקוד אוכף',
    rules_p='מסד הנתונים מסרב לשבור אותם.',
    rules=[
        ('מסמך סופי לא משתנה', 'טעות מתקנים במסמך זיכוי או בביטול, לעולם לא בעריכה. טריגרים במסד הנתונים חוסמים עדכון של שורה סופית.'),
        ('מספר ניתן רק בהפקה', 'לטיוטה אין מספר, כך שטיוטה שנמחקה לא משאירה חור בסדרה.'),
        ('אין PDF לחשבונית מס בלי מספר הקצאה', 'כשרשות המסים דורשת מספר הקצאה, ה-PDF ממתין לו.'),
        ('דרישה והקבלה שלה נספרות פעם אחת', 'דרישת תשלום או חשבון עסקה הם חיוב, הקבלה היא ההכנסה. הדוחות אף פעם לא מחברים את שתיהן.'),
        ('שיעורים מתוארכים', 'מע"מ, תקרת עוסק פטור ושערי מטבע נשמרים עם התאריך שממנו הם חלים.'),
        ('ניסוי וייצור לא מתערבבים', 'פרטי הגישה, הטוקנים והמספרים של סביבת הניסוי והייצור ברשות המסים נשמרים בנפרד.'),
    ],
    need_eyebrow='לפני שמתחילים', need_h='מה צריך',
    need_p='מתחילים בתוכניות חינמיות.',
    more_h='Workers Paid, רישום ברשות המסים ומגבלות ידועות',
    need_cols=['דרישה', 'הערות'], required='חובה', optional='רשות',
    needs=[
        ('חשבון Cloudflare', True, 'Workers Free מריץ אותה: ה-Worker, D1, R2, Browser Rendering ו-5 משימות מתוזמנות. Workers Paid, החל מ-5$ לחודש, מסיר את המגבלות שלמטה.'),
        ('מפתח ותעודה לחתימת PDF', True, 'לחתימת PAdES על כל PDF. פקודה אחת יוצרת את שניהם, docs/deploy.md שלב 8.'),
        ('Node.js ו-Wrangler', True, 'במחשב שלך, להרצת מיגרציות למסד הנתונים ולהגדרת סודות.'),
        ('דומיין ב-Cloudflare', False, 'כתובת משלך למערכת, למשל ledger.example.com. בלי דומיין היא רצה בכתובת workers.dev החינמית. כדי לשלוח מייל מכתובת משלך צריך דומיין.'),
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
        'חשבונאות פתוחה (Open Ledger IL) רשומה ברשות המסים כתוכנה לניהול מערכת חשבונות ממוחשבת, תעודת רישום 281801, בתוקף עד 31.10.2028. התעודה הונפקה למהדורה 1.1.0. המהדורה הנוכחית היא ' + VERSION + ', ומהדורות חדשות נוספות לתעודה עם הגשתן.',
        'רשות המסים מחייבת רישום תוכנה מיצרני תוכנות לניהול מערכת חשבונות המיועדות למכירה, להשכרה או לשימושם של אחרים, כולל שימוש בחינם.',
        'אתה פורס עותק משלך ומריץ אותו לעסק שלך בלבד. אתה לא מוכר, לא משכיר ולא מריץ אותו בשביל אחרים, ולכן חובת הרישום הזאת לא חלה עליך. אם תריץ אותו לעסק אחר, למשל ספרים של לקוחות, תרשום אותו קודם.',
        'מעדיף להישאר במערכת הנוכחית? המשך להפיק בה חשבוניות וקבלות, וכבה את הפקת המסמכים בהגדרות > הפקת מסמכים. המערכת לא תפיק מסמכים, ותשתמש בה לייבוא המסמכים, לניהול לקוחות, להוצאות ולדוחות.',
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
    final_h='קודם רואים אותה עובדת',
    final_p='פותחים את ההדגמה, ואז קוראים את הקוד. כל כלל גלוי.',
    foot_links=['GitHub', 'מדריך פריסה', 'מדריך הגדרה', 'רישיון AGPL-3.0'],
    foot_note='מאוחסן ב-Cloudflare Workers · קוד פתוח ברישיון AGPL-3.0 · לא קשור ל-Cloudflare או לרשות המסים',
)


# Two ways to run it: the free self install, or a paid setup, with the setup request form.
# Raw HTML per language, placed at the end of the page, before the closing call to action.
OPTIONS_EN = r'''  <section id="options">
    <div class="wrap">
      <div class="sec-head">
        <div class="eyebrow">Pricing</div>
        <h2><!--H-->Free from source, installed by you, or set up for you<!--/H--></h2>
      </div>
      <div class="plans">
        <div class="plan">
          <h3>Free from source</h3>
          <div class="price">Free</div>
          <ul>
            <li>No license fee, no usage limits</li>
            <li>You register your own ITA API app</li>
            <li>Step-by-step setup guide</li>
          </ul>
          <a class="btn btn-ghost" href="__DEPLOY__">Read the setup guide</a>
        </div>
<!--SHOP-->
        <div class="plan plan-main">
          <h3>Install it yourself, connected</h3>
          <div class="price">₪99 <span>one time</span></div>
          <ul>
            <li>A Windows installer sets it up in your own Cloudflare account</li>
            <li>Tax Authority connection through MTN, no ITA app of your own</li>
            <li>One licence key for one business</li>
          </ul>
          <a class="btn btn-primary" href="__SHOP__/buy" target="_blank" rel="noopener">Buy and install</a>
        </div>
<!--/SHOP-->
        <div class="plan">
          <h3>Set up for you</h3>
          <div class="price">₪699 <span>one time</span></div>
          <ul>
            <li>We create every account for you, with your own emails</li>
            <li>Tax Authority: your own ITA API app, or the connection through MTN</li>
            <li>Handed over working, with full control to you</li>
            <li>No subscription. Paid invoicing software costs ₪700 to ₪1,200 a year</li>
          </ul>
          <a class="btn btn-ghost" href="#setup-form">Book a call</a>
        </div>
      </div>
      <form class="setup-form" id="setup-form" novalidate>
        <h3>Ask for a setup</h3>
        <label>Name<input name="name" autocomplete="name" required></label>
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Phone<input name="phone" type="tel" autocomplete="tel"></label>
        <label>Business type<select name="type"><option>Osek patur (עוסק פטור)</option><option>Osek murshe (עוסק מורשה)</option><option>Company (חברה בע"מ)</option><option>Other</option></select></label>
        <label class="full">Anything I should know<textarea name="message" rows="4"></textarea></label>
        <label class="hp" aria-hidden="true">Leave empty<input name="hp" tabindex="-1" autocomplete="off"></label>
        <div class="full"><button class="btn btn-primary" type="submit">Send request</button></div>
        <p class="status" role="status"></p>
      </form>
      <script>
      (function () {
        var f = document.getElementById('setup-form'); if (!f) return;
        var st = f.querySelector('.status');
        f.addEventListener('submit', function (e) {
          e.preventDefault();
          var d = new FormData(f);
          if (d.get('hp')) return;
          var email = String(d.get('email') || '').trim();
          if (!d.get('name') || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { st.textContent = 'Add your name and a valid email.'; return; }
          var btn = f.querySelector('button'); btn.disabled = true; st.textContent = 'Sending...';
          var msg = 'Phone: ' + (d.get('phone') || '-') + '\nBusiness type: ' + d.get('type') + '\n\n' + (d.get('message') || '');
          fetch('__CONTACT__', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: d.get('name'), email: email, company: d.get('type'), message: msg, source: 'Open Ledger IL setup request (en)' })
          }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return r.ok && j.ok; }); })
            .then(function (ok) { st.textContent = ok ? 'Thanks. Your request reached me, and I will reply by email.' : 'The request did not go through. Try again in a minute.'; if (ok) { f.reset(); if (window.gtag) window.gtag('event', 'setup_request'); } })
            .catch(function () { st.textContent = 'The request did not go through. Try again in a minute.'; })
            .finally(function () { btn.disabled = false; });
        });
      })();
      </script>
    </div>
  </section>

'''

OPTIONS_HE = r'''  <section id="options">
    <div class="wrap">
      <div class="sec-head">
        <div class="eyebrow">מחירים</div>
        <h2><!--H-->חינם מקוד המקור, התקנה עצמית, או הקמה עבורך<!--/H--></h2>
      </div>
      <div class="plans">
        <div class="plan">
          <h3>חינם מקוד המקור</h3>
          <div class="price">חינם</div>
          <ul>
            <li>בלי דמי רישיון ובלי מגבלת שימוש</li>
            <li>רושמים אפליקציית API משלך ברשות המסים</li>
            <li>מדריך התקנה שלב אחר שלב</li>
          </ul>
          <a class="btn btn-ghost" href="__DEPLOY__">למדריך ההתקנה</a>
        </div>
<!--SHOP-->
        <div class="plan plan-main">
          <h3>התקנה עצמית, מחוברת</h3>
          <div class="price">₪99 <span>חד פעמי</span></div>
          <ul>
            <li>תוכנת התקנה ל-Windows מקימה הכול בחשבון Cloudflare שלך</li>
            <li>חיבור לרשות המסים דרך MTN, בלי אפליקציית API משלך</li>
            <li>מפתח רישיון אחד לעסק אחד</li>
          </ul>
          <a class="btn btn-primary" href="__SHOP__/buy?lang=he" target="_blank" rel="noopener">לרכישה והתקנה</a>
        </div>
<!--/SHOP-->
        <div class="plan">
          <h3>הקמה עבורך</h3>
          <div class="price">₪699 <span>חד פעמי</span></div>
          <ul>
            <li>אנחנו פותחים עבורך את כל החשבונות, עם כתובות המייל שלך</li>
            <li>רשות המסים: אפליקציית API משלך, או חיבור דרך MTN</li>
            <li>נמסרת לך פועלת, עם שליטה מלאה בידיך</li>
            <li>בלי מנוי. תוכנת חשבוניות בתשלום עולה ₪700 עד ₪1,200 בשנה</li>
          </ul>
          <a class="btn btn-ghost" href="#setup-form">לתיאום שיחה</a>
        </div>
      </div>
      <form class="setup-form" id="setup-form" novalidate>
        <h3>לבקשת הקמה</h3>
        <label>שם<input name="name" autocomplete="name" required></label>
        <label>אימייל<input name="email" type="email" autocomplete="email" required></label>
        <label>טלפון<input name="phone" type="tel" autocomplete="tel"></label>
        <label>סוג העסק<select name="type"><option>עוסק פטור</option><option>עוסק מורשה</option><option>חברה בע"מ</option><option>אחר</option></select></label>
        <label class="full">משהו שכדאי שאדע<textarea name="message" rows="4"></textarea></label>
        <label class="hp" aria-hidden="true">Leave empty<input name="hp" tabindex="-1" autocomplete="off"></label>
        <div class="full"><button class="btn btn-primary" type="submit">שליחת בקשה</button></div>
        <p class="status" role="status"></p>
      </form>
      <script>
      (function () {
        var f = document.getElementById('setup-form'); if (!f) return;
        var st = f.querySelector('.status');
        f.addEventListener('submit', function (e) {
          e.preventDefault();
          var d = new FormData(f);
          if (d.get('hp')) return;
          var email = String(d.get('email') || '').trim();
          if (!d.get('name') || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { st.textContent = 'נא למלא שם ואימייל תקין.'; return; }
          var btn = f.querySelector('button'); btn.disabled = true; st.textContent = 'שולח...';
          var msg = 'טלפון: ' + (d.get('phone') || '-') + '\nסוג העסק: ' + d.get('type') + '\n\n' + (d.get('message') || '');
          fetch('__CONTACT__', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: d.get('name'), email: email, company: d.get('type'), message: msg, source: 'Open Ledger IL setup request (he)' })
          }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return r.ok && j.ok; }); })
            .then(function (ok) { st.textContent = ok ? 'תודה. הבקשה הגיעה אליי, ואחזור אליך באימייל.' : 'הבקשה לא נשלחה. נסה שוב בעוד דקה.'; if (ok) { f.reset(); if (window.gtag) window.gtag('event', 'setup_request'); } })
            .catch(function () { st.textContent = 'הבקשה לא נשלחה. נסה שוב בעוד דקה.'; })
            .finally(function () { btn.disabled = false; });
        });
      })();
      </script>
    </div>
  </section>

'''
