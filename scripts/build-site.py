"""Builds docs/index.html (English) and docs/he.html (Hebrew) for the GitHub Pages landing page."""
import html, os, sys

# The page names no account. GitHub links are built in the browser from the Pages address
# (<owner>.github.io/<repo>/), so a fork's page points at the fork.
REPO = '#" data-gh="'
DEPLOY = '#" data-gh="/blob/main/docs/deploy.md'
SETUP = '#" data-gh="/blob/main/docs/setup.md'
LICENSE = '#" data-gh="/blob/main/LICENSE'
CLONE = 'git clone https://github.com/OWNER/open-ledger-il.git'

LOGO = '''<svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="1" y="1" width="30" height="30" rx="8" fill="#131e33" stroke="#22314b" stroke-width="1.5"/>
        <rect x="8" y="7" width="16" height="19" rx="2.5" fill="none" stroke="#4f93ff" stroke-width="2"/>
        <path d="M12 13h8M12 17h8M12 21h5" stroke="#35c46a" stroke-width="2" stroke-linecap="round"/>
      </svg>'''

EN = dict(
    lang='en', dir='ltr', file='index.html', other='he.html', other_label='עברית',
    title='Open Ledger IL - invoices and books for an Israeli business, on your own Cloudflare',
    desc='Open-source invoicing, receipts, expenses and bookkeeping for עוסק פטור and עוסק מורשה. Legal numbering, signed PDFs, ITA allocation numbers. Runs on your own Cloudflare account.',
    nav=['Features', 'How it works', 'Screenshots', 'Setup'], github='View on GitHub',
    badge='<b>Free</b> · Open source (AGPL-3.0) · Self-hosted',
    h1='Invoices, receipts and books for an Israeli business,<br>on infrastructure you own.',
    lead='Quotes, payment requests, receipts and tax invoices with legal numbering, signed PDFs and ITA allocation numbers. It runs in your own Cloudflare account, and your data stays in your own database.',
    cta=['Get the code', 'Read the deploy guide'], copy='Copy', copied='Copied',
    cmd_note='Deploys to your own Cloudflare Worker on the Workers Paid plan, from $5 a month. Setup takes an afternoon.',
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
    need_p='A Cloudflare account on Workers Paid is the one fixed cost. The rest is free or pay per use.',
    need_cols=['Requirement', 'Notes'], required='Required', optional='Optional',
    needs=[
        ('Cloudflare account on Workers Paid', True, 'From $5 a month per account. Runs the Worker, D1, R2, Browser Rendering and the cron jobs.'),
        ('A domain on Cloudflare', True, 'Your ledger address, for example ledger.example.com, behind Cloudflare Access. Zero Trust is free for small teams.'),
        ('PDF signing key and certificate', True, 'For the PAdES signature on every PDF. docs/setup.md shows how to make one.'),
        ('Node.js and Wrangler', True, 'On your computer, to apply database migrations and set secrets.'),
        ('Resend account', False, 'To email documents, reminders and the accountant pack. The free tier covers a small business.'),
        ('ITA API credentials', False, 'Only as עוסק מורשה, for allocation numbers on tax invoices.'),
        ('Anthropic API key', False, 'For Claude to read expenses and past documents. Pay per use, a few cents per document.'),
        ('Google Cloud service account', False, 'For the Drive expense import and backup copies. Free.'),
    ],
    paid_title='Why Workers Paid.',
    paid_intro='The Free plan works for a first look, and stops short in daily use:',
    paid=[
        'CPU time is capped at 10 ms per request and per cron run on Free. Signing a PDF, building the accountant pack or running the morning imports goes past that. Paid allows 30 seconds by default.',
        'Browser Rendering, which draws every PDF, is limited to 10 minutes a day on Free. Paid includes 10 hours a month.',
        'D1 point-in-time recovery keeps 7 days on Free and 30 days on Paid. For a legal ledger, 30 days is the one to have.',
    ],
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
    nav=['יכולות', 'איך זה עובד', 'צילומי מסך', 'הקמה'], github='לקוד ב-GitHub',
    badge='<b>חינם</b> · קוד פתוח (AGPL-3.0) · מאוחסן אצלך',
    h1='חשבוניות, קבלות והנהלת חשבונות לעסק ישראלי,<br>על תשתית שבבעלותך.',
    lead='הצעות מחיר, דרישות תשלום, קבלות וחשבוניות מס עם מספור חוקי, PDF חתום ומספרי הקצאה מרשות המסים. המערכת רצה בחשבון Cloudflare שלך, והמידע נשאר במסד הנתונים שלך.',
    cta=['לקוד', 'למדריך ההתקנה'], copy='העתקה', copied='הועתק',
    cmd_note='נפרסת ל-Worker שלך ב-Cloudflare, בתוכנית Workers Paid, החל מ-5$ לחודש. ההקמה לוקחת אחר צהריים.',
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
    need_p='חשבון Cloudflare בתוכנית Workers Paid הוא העלות הקבועה היחידה. כל השאר חינמי או לפי שימוש.',
    need_cols=['דרישה', 'הערות'], required='חובה', optional='רשות',
    needs=[
        ('חשבון Cloudflare בתוכנית Workers Paid', True, 'החל מ-5$ לחודש לחשבון. מריץ את ה-Worker, D1, R2, Browser Rendering ומשימות התזמון.'),
        ('דומיין ב-Cloudflare', True, 'הכתובת של המערכת, למשל ledger.example.com, מאחורי Cloudflare Access. Zero Trust חינמי לצוותים קטנים.'),
        ('מפתח ותעודה לחתימת PDF', True, 'לחתימת PAdES על כל PDF. הקובץ docs/setup.md מסביר איך יוצרים.'),
        ('Node.js ו-Wrangler', True, 'במחשב שלך, להרצת מיגרציות למסד הנתונים ולהגדרת סודות.'),
        ('חשבון Resend', False, 'לשליחת מסמכים, תזכורות וחבילת רואה החשבון במייל. התוכנית החינמית מספיקה לעסק קטן.'),
        ('פרטי גישה ל-API של רשות המסים', False, 'רק לעוסק מורשה, למספרי הקצאה על חשבוניות מס.'),
        ('מפתח API של Anthropic', False, 'כדי ש-Claude יקרא הוצאות ומסמכי עבר. תשלום לפי שימוש, כמה סנטים למסמך.'),
        ('חשבון שירות ב-Google Cloud', False, 'לייבוא הוצאות מ-Drive ולעותקי גיבוי. חינם.'),
    ],
    paid_title='למה Workers Paid.',
    paid_intro='התוכנית החינמית מספיקה להתרשמות, ולא לעבודה יומיומית:',
    paid=[
        'זמן המעבד מוגבל ל-10 מילישניות לבקשה ולהרצת תזמון בתוכנית החינמית. חתימת PDF, הכנת חבילת רואה החשבון או ייבוא הבוקר חורגים מזה. בתוכנית בתשלום מותרות 30 שניות כברירת מחדל.',
        'Browser Rendering, שמפיק כל PDF, מוגבל ל-10 דקות ביום בתוכנית החינמית. התוכנית בתשלום כוללת 10 שעות בחודש.',
        'שחזור לנקודת זמן ב-D1 שומר 7 ימים בתוכנית החינמית ו-30 ימים בתשלום. לספרים חוקיים, 30 ימים זה מה שצריך.',
    ],
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

IDS = ['features', 'how', 'screens', 'setup']


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
    foot = ' '.join(f'<a href="{u}">{e(t)}</a>' for u, t in zip(links, c['foot_links']))
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
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="site.css">
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
    <a class="lang" href="{c['other']}" hreflang="{'he' if c['lang'] == 'en' else 'en'}">{c['other_label']}</a>
    <a class="btn btn-ghost btn-sm" href="{REPO}">{e(c['github'])}</a>
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
    <div>{foot}</div>
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
  document.getElementById('copy').addEventListener('click', function () {{
    var text = document.getElementById('cmd').textContent;
    var done = function () {{
      var t = document.getElementById('toast');
      t.classList.add('show');
      setTimeout(function () {{ t.classList.remove('show'); }}, 1400);
    }};
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done); else done();
  }});
</script>
</body>
</html>
'''


FAVICON = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect x="1" y="1" width="30" height="30" rx="8" fill="#131e33" stroke="#22314b" stroke-width="1.5"/>
  <rect x="8" y="7" width="16" height="19" rx="2.5" fill="none" stroke="#4f93ff" stroke-width="2"/>
  <path d="M12 13h8M12 17h8M12 21h5" stroke="#35c46a" stroke-width="2" stroke-linecap="round"/>
</svg>
'''

if __name__ == '__main__':
    out = sys.argv[1]
    for c in (EN, HE):
        open(os.path.join(out, c['file']), 'w', encoding='utf-8', newline='\n').write(page(c))
    open(os.path.join(out, 'favicon.svg'), 'w', encoding='utf-8', newline='\n').write(FAVICON)
    open(os.path.join(out, '.nojekyll'), 'w').write('')
    print('built', out)
