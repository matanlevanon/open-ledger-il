"""
Builds the product site: docs/index.html (English) and docs/he.html (Hebrew), next to the
screenshots in docs/screenshots/. Run: python3 scripts/build-site.py docs
GitHub Pages serves it: Settings > Pages > Deploy from a branch > main, /docs.
"""
import html, json, os, sys
from pathlib import Path

# The page names no account. GitHub links are built in the browser from the Pages address
# (<owner>.github.io/<repo>/), so a fork's page points at the fork.
REPO = '#" data-gh="'
DEPLOY = '#" data-gh="/blob/main/docs/deploy.md'
SETUP = '#" data-gh="/blob/main/docs/setup.md'
LICENSE = '#" data-gh="/blob/main/LICENSE'
ITA_REGISTRY = 'https://www.gov.il/he/service/itc-software-registry-for-computerized-accounting-systems'
ITA_REG = 'https://www.gov.il/he/service/registration-software-designed-managing-computerized-accounting-system'
CLONE = 'git clone https://github.com/OWNER/open-ledger-il.git'
# The project's official live demo. scripts/leak-denylist.txt allows this one hostname in this
# file and the two pages it builds, nowhere else.
DEMO_URL = 'https://sampleledger.matanlevanon.com'
# The version shown on the site comes from package.json, so a release bump updates it.
VERSION = json.loads((Path(__file__).resolve().parent.parent / 'package.json').read_text(encoding='utf-8'))['version']

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
    nav=['Features', 'Screenshots', 'How it works', 'Pricing'], github='View on GitHub',
    badge='<b>Free</b> · Open source · Registered with the Israel Tax Authority · v' + VERSION,
    h1='Invoices, receipts and books for an Israeli business,<br>on infrastructure you own.',
    lead='Quotes, receipts, tax invoices, contracts and expenses, with legal numbering and ITA allocation numbers. It runs in your own Cloudflare account. Your data stays yours.',
    cta=['Get the code', 'Read the deploy guide', 'Let us set it up for you'], copy='Copy', copied='Copied',
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
    cta=['לקוד', 'למדריך ההתקנה', 'נקים לך את המערכת'], copy='העתקה', copied='הועתק',
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
        <h2>Install it yourself, or have it set up for you</h2>
      </div>
      <div class="plans">
        <div class="plan">
          <h3>Do it yourself</h3>
          <div class="price">Free</div>
          <ul>
            <li>No license fee, no usage limits</li>
            <li>Step-by-step setup guide</li>
            <li>Free updates, applied when you choose</li>
          </ul>
          <a class="btn btn-ghost" href="#" data-gh="/blob/main/docs/deploy.md">Read the setup guide</a>
        </div>
        <div class="plan plan-main">
          <h3>Set up for you</h3>
          <div class="price">₪699 <span>one time</span></div>
          <ul>
            <li>Installed on your own Cloudflare and Tax Authority accounts</li>
            <li>Handed over working, in your name</li>
            <li>No subscription. Paid invoicing software costs ₪700 to ₪1,200 a year</li>
          </ul>
          <a class="btn btn-primary" href="#setup-form">Ask for a setup</a>
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
          fetch('https://contact.matanlevanon.com/lead', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: d.get('name'), email: email, company: d.get('type'), message: msg, source: 'Open Ledger IL setup request (en)' })
          }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return r.ok && j.ok; }); })
            .then(function (ok) { st.textContent = ok ? 'Thanks. Your request reached me, and I will reply by email.' : 'The request did not go through. Try again in a minute.'; if (ok) f.reset(); })
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
        <h2>להתקין בעצמך, או לקבל אותה מוקמת</h2>
      </div>
      <div class="plans">
        <div class="plan">
          <h3>בעצמך</h3>
          <div class="price">חינם</div>
          <ul>
            <li>בלי דמי רישיון ובלי מגבלת שימוש</li>
            <li>מדריך התקנה שלב אחר שלב</li>
            <li>עדכונים בחינם, מתקינים מתי שרוצים</li>
          </ul>
          <a class="btn btn-ghost" href="#" data-gh="/blob/main/docs/deploy.md">למדריך ההתקנה</a>
        </div>
        <div class="plan plan-main">
          <h3>הקמה עבורך</h3>
          <div class="price">₪699 <span>חד פעמי</span></div>
          <ul>
            <li>מותקנת בחשבונות Cloudflare ורשות המסים שלך</li>
            <li>נמסרת לך פועלת, על שמך</li>
            <li>בלי מנוי. תוכנת חשבוניות בתשלום עולה ₪700 עד ₪1,200 בשנה</li>
          </ul>
          <a class="btn btn-primary" href="#setup-form">לבקשת הקמה</a>
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
          fetch('https://contact.matanlevanon.com/lead', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: d.get('name'), email: email, company: d.get('type'), message: msg, source: 'Open Ledger IL setup request (he)' })
          }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return r.ok && j.ok; }); })
            .then(function (ok) { st.textContent = ok ? 'תודה. הבקשה הגיעה אליי, ואחזור אליך באימייל.' : 'הבקשה לא נשלחה. נסה שוב בעוד דקה.'; if (ok) f.reset(); })
            .catch(function () { st.textContent = 'הבקשה לא נשלחה. נסה שוב בעוד דקה.'; })
            .finally(function () { btn.disabled = false; });
        });
      })();
      </script>
    </div>
  </section>

'''


IDS = ['features', 'screens', 'how', 'options']

# Set in __main__ to the output folder. The Hebrew page uses a screenshot's -he variant
# (dashboard-he.png next to dashboard.png) when one exists, and the English one otherwise.
OUT = 'docs'


def shot_src(c, name):
    if c['lang'] != 'en':
        base, ext = os.path.splitext(name)
        localized = f"{base}-{c['lang']}{ext}"
        if os.path.exists(os.path.join(OUT, 'screenshots', localized)):
            return localized
    return name

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
.shot { margin: 48px auto 0; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); background: var(--surface); }
.shot img { width: 100%; }
.shot-cap { font-size: 13px; color: var(--text-mute); text-align: center; margin-top: 12px; }
section { padding: 88px 0; }
section + section { border-top: 1px solid var(--border-soft); }
section.plain { padding-top: 24px; border-top: 0; }
.sec-head { text-align: center; max-width: 620px; margin: 0 auto 40px; }
.sec-head.sub { margin-top: 80px; }
.eyebrow { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--blue); font-weight: 600; margin-bottom: 10px; }
[dir=rtl] .eyebrow, [dir=rtl] th { letter-spacing: 0; }
h2 { font-size: clamp(26px, 3.6vw, 36px); line-height: 1.2; letter-spacing: -.02em; margin: 0 0 10px; font-weight: 700; }
.sec-head p { color: var(--text-dim); margin: 0; font-size: 17px; }
.sec-head p:empty { display: none; }
/* Hero links: three equal secondary buttons under the demo button. */
.cta-links .btn { min-width: 0; }
.btn-setup { border-color: rgba(22,163,74,.45); color: var(--green-2); }
.btn-setup:hover { border-color: var(--green); }
/* Highlights: six items, no boxes. */
.features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px 40px; max-width: 980px; margin: 0 auto; }
@media (max-width: 860px) { .features { grid-template-columns: repeat(2, 1fr); gap: 28px 24px; } }
@media (max-width: 520px) { .features { grid-template-columns: 1fr; } }
.feat .ico { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; margin-bottom: 12px; background: #e8efff; font-size: 18px; color: var(--blue); }
.feat h3 { margin: 0 0 6px; font-size: 17px; font-weight: 650; letter-spacing: -.01em; }
.feat p { margin: 0; color: var(--text-dim); font-size: 15px; }
/* Every feature: closed groups the reader opens. */
.flist { display: grid; grid-template-columns: 1fr 1fr; gap: 0 40px; max-width: 980px; margin: 0 auto; align-items: start; }
@media (max-width: 760px) { .flist { grid-template-columns: 1fr; } }
.fgroup { border-bottom: 1px solid var(--border); }
.fgroup summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 16px 0; font-weight: 600; font-size: 16px; }
.fgroup summary::-webkit-details-marker { display: none; }
.fgroup summary::after { content: '+'; margin-inline-start: auto; color: var(--text-mute); font-size: 20px; font-weight: 400; line-height: 1; }
.fgroup[open] summary::after { content: '\\2212'; }
.fgroup .count { font-size: 12px; font-weight: 600; color: var(--text-mute); background: var(--surface-2); border-radius: 999px; padding: 1px 8px; }
.fgroup ul { list-style: none; margin: 0 0 16px; padding: 0; }
.fgroup li { position: relative; padding-inline-start: 22px; margin: 6px 0; color: var(--text-dim); font-size: 14.5px; line-height: 1.5; }
.fgroup li::before { content: '\\2713'; position: absolute; inset-inline-start: 0; color: var(--green); font-weight: 700; }
/* Phones, right under the main screenshot. */
.phones { display: grid; grid-template-columns: repeat(4, 1fr); gap: 28px; align-items: start; max-width: 1000px; margin: 0 auto; }
@media (max-width: 900px) { .phones { grid-template-columns: repeat(2, 1fr); gap: 20px 14px; } }
.phone { margin: 0; }
.phone .frame { background: #0a0f18; border-radius: 30px; padding: 8px; box-shadow: var(--shadow); }
.phone img { width: 100%; height: auto; border-radius: 23px; }
.phone figcaption { padding: 14px 4px 0; text-align: center; font-size: 13.5px; color: var(--text-mute); line-height: 1.45; }
.phone figcaption b { display: block; color: var(--text); font-size: 15px; font-weight: 650; margin-bottom: 2px; }
@media (max-width: 620px) { .phone .frame { border-radius: 22px; padding: 5px; } .phone img { border-radius: 18px; } .phone figcaption { font-size: 12px; } .phone figcaption b { font-size: 13.5px; } }
/* Screenshots: image first, one caption line. */
.gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 40px 28px; align-items: start; }
@media (max-width: 820px) { .gallery { grid-template-columns: 1fr; } }
.gcard { margin: 0; }
.gcard img { width: 100%; border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 10px 30px -18px rgba(15,23,42,.35); }
.gcard figcaption { padding: 12px 2px 0; color: var(--text-dim); font-size: 14.5px; }
.gcard figcaption b { color: var(--text); font-weight: 650; }
/* Rules: a checked list in two columns. */
.rules { list-style: none; padding: 0; margin: 0 auto; max-width: 980px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px 40px; }
@media (max-width: 760px) { .rules { grid-template-columns: 1fr; } }
.rules li { position: relative; padding-inline-start: 34px; }
.rules li::before { content: '\\2713'; position: absolute; inset-inline-start: 0; top: 1px; width: 22px; height: 22px; border-radius: 50%; background: #dcfce7; color: var(--green-2); display: grid; place-items: center; font-size: 12px; font-weight: 700; }
.rules b { display: block; font-weight: 650; margin-bottom: 2px; }
.rules span { color: var(--text-dim); font-size: 14.5px; }
/* How it works: numbered steps without boxes. */
.steps { list-style: none; counter-reset: step; padding: 0; margin: 0 auto 36px; max-width: 980px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px 40px; }
@media (max-width: 760px) { .steps { grid-template-columns: 1fr; } }
.step { counter-increment: step; }
.step::before { content: counter(step); width: 32px; height: 32px; border-radius: 10px; background: var(--blue); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 14px; margin-bottom: 12px; }
.step h3 { margin: 0 0 6px; font-size: 17px; font-weight: 650; }
.step p { margin: 0; color: var(--text-dim); font-size: 15px; }
.cmd { display: flex; align-items: center; gap: 12px; max-width: 640px; margin: 0 auto; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 12px 12px 16px; direction: ltr; }
.cmd code { font-size: 13px; color: var(--text-dim); overflow-x: auto; white-space: nowrap; flex: 1; text-align: left; background: none; border: 0; padding: 0; }
.cmd button { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-dim); border-radius: 8px; padding: 7px 12px; font: inherit; font-size: 13px; cursor: pointer; flex: 0 0 auto; }
.cmd button:hover { color: var(--text); border-color: var(--text-mute); }
.cmd-note { font-size: 13px; color: var(--text-mute); margin-top: 10px; text-align: center; }
table { width: 100%; max-width: 980px; margin: 0 auto; border-collapse: collapse; font-size: 14.5px; }
th, td { text-align: start; padding: 13px 4px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--text-mute); font-weight: 600; font-size: 12.5px; letter-spacing: .06em; text-transform: uppercase; }
td:first-child { width: 36%; padding-inline-end: 18px; }
td b { font-weight: 600; }
td span { color: var(--text-dim); }
.tag { display: inline-block; font-size: 11.5px; font-weight: 600; border-radius: 999px; padding: 1px 8px; margin-inline-start: 8px; border: 1px solid var(--border); color: var(--text-mute); vertical-align: 1px; }
.tag.req { color: var(--green); border-color: rgba(22,163,74,.4); }
@media (max-width: 620px) { td { display: block; border-bottom: 0; padding: 4px 0; width: auto !important; } tr { display: block; border-bottom: 1px solid var(--border); padding: 10px 0; } thead { display: none; } }
/* Workers Paid, registration and limits, closed by default. */
.more { max-width: 980px; margin: 28px auto 0; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.more summary { cursor: pointer; padding: 16px 20px; font-weight: 600; }
.more-body { padding: 0 20px 18px; color: var(--text-dim); font-size: 14.5px; }
.more-body h3 { color: var(--text); font-size: 15.5px; margin: 18px 0 6px; }
.more-body p { margin: 0 0 8px; }
.more-body ul { margin: 0; padding-inline-start: 20px; }
.more-body li { margin: 4px 0; }
.more-body a { color: var(--blue); }
.refs { border-top: 1px solid var(--border-soft); margin-top: 12px; padding-top: 10px; font-size: 13px; color: var(--text-mute); }
.refs b { color: var(--text-dim); font-weight: 600; }
.refs ol { margin: 6px 0 0; padding-inline-start: 20px; }
.refs q { color: var(--text-dim); unicode-bidi: isolate; }
.more-body sup a { text-decoration: none; font-size: 11px; }
.refs li:target { background: var(--surface-2); border-radius: 6px; }
/* Pricing. */
#options { background: var(--bg-2); }
.plans { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; max-width: 860px; margin: 0 auto; }
@media (max-width: 720px) { .plans { grid-template-columns: 1fr; } }
.plan { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 28px; display: flex; flex-direction: column; }
.plan-main { border: 2px solid var(--green); box-shadow: 0 20px 50px -30px rgba(22,163,74,.6); }
.plan h3 { margin: 0; font-size: 17px; font-weight: 650; }
.price { font-size: 38px; font-weight: 800; letter-spacing: -.02em; margin: 6px 0 14px; }
.price span { font-size: 15px; font-weight: 500; color: var(--text-mute); }
.plan ul { list-style: none; margin: 0 0 22px; padding: 0; flex: 1; }
.plan li { position: relative; padding-inline-start: 22px; margin: 8px 0; color: var(--text-dim); font-size: 15px; }
.plan li::before { content: '\\2713'; position: absolute; inset-inline-start: 0; color: var(--green); font-weight: 700; }
.final { text-align: center; }
.final .cta { margin-top: 26px; margin-bottom: 0; }
footer { border-top: 1px solid var(--border-soft); padding: 34px 0 46px; color: var(--text-mute); font-size: 14px; }
.foot { display: flex; justify-content: space-between; align-items: center; gap: 18px; flex-wrap: wrap; }
.foot a { color: var(--text-dim); text-decoration: none; margin-inline-end: 18px; }
.foot a:hover { color: var(--text); }
.toast { position: fixed; left: 50%; bottom: 26px; transform: translate(-50%, 20px); opacity: 0; pointer-events: none; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 18px; font-size: 14px; transition: opacity .2s, transform .2s; }
.toast.on { opacity: 1; transform: translate(-50%, 0); }
.btn-lg { padding: 18px 36px; font-size: 18px; border-radius: 14px; }
.cta-demo { margin-bottom: 10px; }
.demo-note { font-size: 14px; color: var(--text-mute); margin: 0 0 22px; }
@media (max-width: 640px) { .btn-demo { width: 100%; } .cta-links { flex-direction: column; } .cta-links .btn { width: 100%; } }
.setup-form { max-width: 860px; margin: 24px auto 0; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; display: grid; gap: 14px; grid-template-columns: 1fr 1fr; scroll-margin-top: 84px; }
.setup-form h3 { grid-column: 1 / -1; margin: 0; }
.setup-form label { display: grid; gap: 6px; font-size: 14px; color: var(--text-dim); }
.setup-form .full { grid-column: 1 / -1; }
.setup-form input, .setup-form select, .setup-form textarea { font: inherit; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: #fff; color: var(--text); }
.setup-form .hp { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
.setup-form .status { grid-column: 1 / -1; margin: 0; font-size: 14px; color: var(--text-dim); }
@media (max-width: 640px) { .setup-form { grid-template-columns: 1fr; } }
section[id] { scroll-margin-top: 64px; }
'''


def page(c):
    e = html.escape
    nav = '\n      '.join(f'<a href="#{i}">{e(t)}</a>' for i, t in zip(IDS, c['nav']))
    # Every link to the demo opens in a new tab.
    demo_link = f'href="{DEMO_URL}" target="_blank" rel="noopener"'
    nav += f'\n      <a {demo_link}>{e(c["demo_nav"])}</a>'
    demo_btn = f'<a class="btn btn-primary btn-lg btn-demo" {demo_link}>{e(c["demo_cta"])}</a>'
    feats = '\n'.join(
        f'''        <div class="feat">
          <div class="ico" aria-hidden="true">{ico}</div>
          <h3>{e(h)}</h3>
          <p>{e(p)}</p>
        </div>''' for ico, h, p in c['features'])
    # Groups start closed, so the page shows the group names and the reader opens what they need.
    flist = '\n'.join(
        f'''        <details class="fgroup">
          <summary>{e(h)}<span class="count">{len(items)}</span></summary>
          <ul>
'''
        + '\n'.join(f'            <li>{e(i)}</li>' for i in items)
        + '''
          </ul>
        </details>''' for h, items in c['feature_list'])
    steps = '\n'.join(
        f'''        <li class="step">
          <h3>{e(h)}</h3>
          <p>{e(p)}</p>
        </li>''' for h, p in c['steps'])
    shots = '\n'.join(
        f'''        <figure class="gcard">
          <img src="screenshots/{shot_src(c, img)}" alt="{e(alt)}" loading="lazy">
          <figcaption><b>{e(h)}.</b> {e(p)}</figcaption>
        </figure>''' for img, alt, h, p in c['shots'])
    phones = '\n'.join(
        f'''        <figure class="phone">
          <div class="frame"><img src="screenshots/{shot_src(c, img)}" alt="{e(alt)}" loading="lazy" width="585" height="1266"></div>
          <figcaption><b>{e(h)}</b>{e(p)}</figcaption>
        </figure>''' for img, alt, h, p in c['phones'])
    # The first paragraph states the registration, so it points at reference 2, the registry. The second
    # states the ITA rule and points at reference 1, the service page it quotes.
    refs = {0: ' <sup><a href="#ref-2">[2]</a></sup>', 1: ' <sup><a href="#ref-1">[1]</a></sup>'}
    reg = ''.join(f'<p>{e(x)}' + refs.get(i, '') + '</p>' for i, x in enumerate(c['reg_p']))
    def ref(i, t, url, label):
        q = f' <q lang="he" dir="rtl">{e(c["reg_quote"])}</q>' if i == 0 else ''
        a = f' <a href="{url}" rel="noopener">{label}</a>' if url else ''
        return f'<li id="ref-{i + 1}">{e(t)}{q}{a}</li>'
    reg_refs = ''.join(ref(i, *r) for i, r in enumerate(c['reg_refs']))
    rules = '\n'.join(
        f'''        <li>
          <b>{e(h)}</b>
          <span>{e(p)}</span>
        </li>''' for h, p in c['rules'])
    needs = '\n'.join(
        f'''          <tr><td><b>{e(n)}</b><span class="tag{' req' if req else ''}">{e(c['required'] if req else c['optional'])}</span></td><td><span>{e(note)}</span></td></tr>'''
        for n, req, note in c['needs'])
    paid = ''.join(f'<li>{e(x)}</li>' for x in c['paid'])
    limits = '\n'.join(f'            <li>{e(x)}</li>' for x in c['limits'])
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
<meta property="og:image" content="screenshots/{shot_src(c, 'dashboard.png')}">
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
      <div class="cta cta-demo">
        {demo_btn}
      </div>
      <p class="demo-note">{e(c['demo_note'])}</p>
      <div class="cta cta-links">
        <a class="btn btn-ghost" href="{REPO}">{e(c['cta'][0])}</a>
        <a class="btn btn-ghost" href="{DEPLOY}">{e(c['cta'][1])}</a>
        <a class="btn btn-ghost btn-setup" href="#options">{e(c['cta'][2])}</a>
      </div>

      <div class="shot">
        <img src="screenshots/{shot_src(c, 'dashboard.png')}" alt="{e(c['shot_alt'])}">
      </div>
      <p class="shot-cap">{e(c['shot_cap'])}</p>
    </div>
  </div>

  <section id="mobile" class="plain">
    <div class="wrap">
      <div class="sec-head">
        <h2>{e(c['mob_h'])}</h2>
        <p>{e(c['mob_p'])}</p>
      </div>
      <div class="phones">
{phones}
      </div>
    </div>
  </section>

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

      <div class="sec-head sub" id="list">
        <h2>{e(c['list_h'])}</h2>
        <p>{e(c['list_p'])}</p>
      </div>
      <div class="flist">
{flist}
      </div>
    </div>
  </section>

  <section id="screens">
    <div class="wrap">
      <div class="sec-head">
        <div class="eyebrow">{e(c['shots_eyebrow'])}</div>
        <h2>{e(c['shots_h'])}</h2>
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
      <ul class="rules">
{rules}
      </ul>
    </div>
  </section>

  <section id="how">
    <div class="wrap">
      <div class="sec-head">
        <div class="eyebrow">{e(c['how_eyebrow'])}</div>
        <h2>{e(c['how_h'])}</h2>
        <p>{e(c['how_p'])}</p>
      </div>
      <ol class="steps">
{steps}
      </ol>
      <div class="cmd">
        <code id="cmd">{CLONE}</code>
        <button id="copy" type="button">{e(c['copy'])}</button>
      </div>
      <p class="cmd-note">{e(c['cmd_note'])}</p>

      <div class="sec-head sub" id="setup">
        <h2>{e(c['need_h'])}</h2>
        <p>{e(c['need_p'])}</p>
      </div>
      <table>
        <thead><tr><th>{e(c['need_cols'][0])}</th><th>{e(c['need_cols'][1])}</th></tr></thead>
        <tbody>
{needs}
        </tbody>
      </table>
      <details class="more" id="registration">
        <summary>{e(c['more_h'])}</summary>
        <div class="more-body">
          <h3>{e(c['paid_title'])}</h3>
          <p>{e(c['paid_intro'])}</p>
          <ul>{paid}</ul>
          <h3>{e(c['reg_title'])}</h3>
          {reg}
          <p><a href="{ITA_REG}" rel="noopener">{e(c['reg_link'])}</a></p>
          <div class="refs"><b>{e(c['reg_refs_h'])}</b><ol>{reg_refs}</ol></div>
          <h3>{e(c['limits_h'])}</h3>
          <ul>
{limits}
          </ul>
        </div>
      </details>
    </div>
  </section>

{OPTIONS_EN if c['lang'] == 'en' else OPTIONS_HE}  <section class="final">
    <div class="wrap">
      <h2>{e(c['final_h'])}</h2>
      <p class="lead">{e(c['final_p'])}</p>
      <div class="cta">
        {demo_btn}
        <a class="btn btn-ghost" href="{REPO}">{e(c['cta'][0])}</a>
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
    OUT = out
    os.makedirs(out, exist_ok=True)
    for c in (EN, HE):
        open(os.path.join(out, c['file']), 'w', encoding='utf-8', newline='\n').write(page(c))
    open(os.path.join(out, 'favicon.svg'), 'w', encoding='utf-8', newline='\n').write(FAVICON)
    # Serve the files as they are. Without this, Pages runs Jekyll over the Markdown docs.
    open(os.path.join(out, '.nojekyll'), 'w').write('')
    print('built', out)
