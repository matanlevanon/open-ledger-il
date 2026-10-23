"""
R32: the text of the one-page-per-question site. Titles stay under 60 characters and descriptions
under 155, and the build checks both. Facts come from text.py, CHANGELOG.md and docs/.
"""
from .config import VERSION

PAGES = {
    'en': {
        'home': dict(
            title='Open Ledger IL: invoices and books on your own Cloudflare',
            desc='Source-available invoicing, receipts and bookkeeping for עוסק פטור and עוסק מורשה. Registered with the Israel Tax Authority. Runs on your Cloudflare.',
            crumb='Home'),
        'features': dict(
            title='Open Ledger IL features: documents, reports, rules',
            desc='Every Open Ledger IL feature: Israeli document types, gapless numbering, ITA allocation numbers, contracts, expenses by email and AI, Claude via MCP.',
            h1='Every feature', crumb='Features'),
        'pricing': dict(
            title='Open Ledger IL pricing: free, ₪99 installer, or setup',
            desc='Run Open Ledger IL free from source, install it yourself with the ₪99 connected installer, or have it set up for you for ₪699, once. No subscription.',
            h1='Pricing and setup options', crumb='Pricing'),
        'registration': dict(
            title='Open Ledger IL: Tax Authority certificate 281801',
            desc='Open Ledger IL is registered with the Israel Tax Authority as accounting software, certificate 281801, valid to 31 Oct 2028. Check the registry.',
            h1='Registered with the Israel Tax Authority', crumb='Registration'),
        'demo': dict(
            title='Open Ledger IL live demo: try it in your browser',
            desc='Open the Open Ledger IL demo: sample businesses, the real screens, private drafts and preview PDFs. No install. The sample data stays as it is.',
            h1='Try the live demo', crumb='Demo'),
        'guides': dict(
            title='Open Ledger IL guides: invoicing for Israeli businesses',
            desc='Plain guides to Israeli invoicing: allocation numbers, the עוסק פטור ceiling, registered software, the unified file and which document is income.',
            h1='Guides', crumb='Guides'),
        'help': dict(
            title='Open Ledger IL help: install, set up and daily use',
            desc='Step by step: the installer, Cloudflare, the Tax Authority, payments, expenses, email, Claude and fixes for where people get stuck.',
            h1='Help', crumb='Help'),
        'changelog': dict(
            title='Open Ledger IL changelog: what changed in each version',
            desc='Every Open Ledger IL release and what changed in it, newest first. The current version is ' + VERSION + '.',
            h1='Changelog', crumb='Changelog'),
        'license': dict(
            title='Open Ledger IL licence: FSL-1.1, free for your business',
            desc='Open Ledger IL ships under the FSL-1.1 licence. Free for your own business, no reselling, and each version turns Apache 2.0 after two years.',
            h1='Licence', crumb='Licence'),
    },
    'he': {
        'home': dict(
            title='Open Ledger IL: חשבוניות והנהלת חשבונות בענן שלך',
            desc='מערכת בקוד מקור גלוי לחשבוניות, קבלות והנהלת חשבונות לעוסק פטור ולעוסק מורשה. רשומה ברשות המסים. רצה בחשבון Cloudflare שלך.',
            crumb='דף הבית'),
        'features': dict(
            title='היכולות של Open Ledger IL: מסמכים, דוחות וכללים',
            desc='כל היכולות של Open Ledger IL: כל סוגי המסמכים, מספור בלי חורים, מספרי הקצאה, חוזים, הוצאות במייל ובקריאת AI, וחיבור Claude.',
            h1='כל היכולות', crumb='יכולות'),
        'pricing': dict(
            title='מחירים: Open Ledger IL בחינם, ב-₪99 או בהקמה עבורך',
            desc='הפעלת Open Ledger IL בחינם מקוד המקור, התקנה עצמית עם תוכנת ההתקנה המחוברת ב-₪99, או הקמה עבורך ב-₪699. תשלום אחד, בלי מנוי.',
            h1='מחירים ואפשרויות התקנה', crumb='מחירים'),
        'registration': dict(
            title='Open Ledger IL רשומה ברשות המסים: תעודה 281801',
            desc='Open Ledger IL רשומה ברשות המסים כתוכנה לניהול מערכת חשבונות ממוחשבת, תעודה 281801, בתוקף עד 31.10.2028. אפשר לבדוק במאגר של רשות המסים.',
            h1='רשומה ברשות המסים', crumb='רישום'),
        'demo': dict(
            title='הדגמה חיה של Open Ledger IL: נסו בדפדפן',
            desc='פתחו את ההדגמה של Open Ledger IL: עסקי דוגמה, המסכים האמיתיים, טיוטות פרטיות ו-PDF לתצוגה. בלי התקנה. נתוני הדוגמה לא משתנים.',
            h1='נסו את ההדגמה', crumb='הדגמה'),
        'guides': dict(
            title='מדריכים: חשבוניות והנהלת חשבונות לעסק בישראל',
            desc='מדריכים פשוטים: מספרי הקצאה, תקרת עוסק פטור, תוכנה רשומה, מבנה אחיד, ואיזה מסמך נחשב הכנסה.',
            h1='מדריכים', crumb='מדריכים'),
        'help': dict(
            title='עזרה ל-Open Ledger IL: התקנה, הגדרה ושימוש',
            desc='צעד אחר צעד: תוכנת ההתקנה, Cloudflare, רשות המסים, תשלומים, הוצאות, מייל, Claude ופתרונות לבעיות נפוצות.',
            h1='עזרה', crumb='עזרה'),
        'changelog': dict(
            title='יומן שינויים של Open Ledger IL: מה חדש בכל גרסה',
            desc='כל הגרסאות של Open Ledger IL ומה השתנה בכל אחת, מהחדשה לישנה. הגרסה הנוכחית היא ' + VERSION + '.',
            h1='יומן שינויים', crumb='יומן שינויים'),
        'license': dict(
            title='רישיון Open Ledger IL: FSL-1.1, חינם לעסק שלכם',
            desc='Open Ledger IL ברישיון FSL-1.1. חינם לעסק שלכם, בלי מכירה חוזרת, וכל גרסה עוברת ל-Apache 2.0 אחרי שנתיים.',
            h1='רישיון', crumb='רישיון'),
    },
}

NAV = {
    'en': [('features', 'Features'), ('pricing', 'Pricing'), ('registration', 'Registration'), ('demo', 'Demo'), ('guides', 'Guides'), ('help', 'Help')],
    'he': [('features', 'יכולות'), ('pricing', 'מחירים'), ('registration', 'רישום'), ('demo', 'הדגמה'), ('guides', 'מדריכים'), ('help', 'עזרה')],
}

UI = {
    'en': dict(
        crumbs_label='Breadcrumbs', switch='עברית',
        all_features='See every feature',
        strip_h='Free from source, or set up for you',
        strip_p='The code is free for your own business. Prefer not to do it yourself? We set it up for you for ₪699 (launch release, 30% off ₪999), once, with no subscription.',
        strip_p_shop='The code is free for your own business. Install it yourself with the connected installer for ₪99 (launch release, 50% off ₪199), or have it set up for you for ₪699 (launch release, 30% off ₪999). One payment, no subscription.',
        strip_btn='See pricing and setup',
        demo_h='Try it before you install it',
        demo_points=[
            'Every visitor reads the same sample businesses: clients, documents, contracts and expenses.',
            'Create your own drafts. Nobody else sees them, and they are deleted 30 minutes after you leave.',
            'Issue, Send, Record payment and Sign show previews. A preview PDF carries the number 0000 and a watermark.',
        ],
        demo_more=[
            'The sample data is read-only. The server refuses every change to it.',
            'It opens in Hebrew, in the light theme.',
        ],
        demo_page_lead='The live demo opens the real app on sample businesses. Nothing to install.',
        reg_registry='The Tax Authority registry of registered software',
        guides_none='The guides are being written and reviewed. They will appear here once published.',
        help_lead='Step-by-step instructions, in the order you need them. Start at the top if this is your first install.',
        help_none='The help pages are being written.',
        help_more='More help',
        help_stuck='Still stuck?',
        help_stuck_link='Write to us from the pricing page.',
        help_topics='Topics',
        help_buy_h='The installer comes with your purchase',
        help_buy_p='Buy the connected installer for ₪99, a launch price (regular ₪199). The licence key and the download link reach your email within a minute.',
        help_buy_points=[
            'No Tax Authority API app to apply for. You connect through MTN\'s approved app.',
            'No Israeli server or relay to run. Every Tax Authority call leaves from an Israeli address, so it never gets the 403 a Worker abroad gets.',
            'No command line. A wizard creates the database, the files, the sign-in and the address in your Cloudflare account, in about 3 minutes.',
            'Run it again later to update, and your data stays.',
        ],
        help_buy_btn='Buy the installer',
        help_buy_self='Or set it up yourself, free',
        guides_draft_bar='Draft. This guide is under review and not published yet.',
        guide_how='How Open Ledger IL does it',
        guide_sources='Sources',
        guide_faq='Questions and answers',
        guide_updated='Updated',
        guide_cta_demo='Try the live demo',
        guide_cta_pricing='See pricing and setup',
        changelog_intro='Every release, newest first. The current version is ' + VERSION + '.',
        changelog_lang_note='',
        license_p='The Open Ledger IL code ships under the Functional Source License, version 1.1, with Apache 2.0 as the future licence (FSL-1.1-ALv2).',
        license_points=[
            'Use it for your own business, at no cost.',
            'Read the code and change it.',
            'Share copies, changed or not, under the same licence.',
            'Do not sell it, host it for others, or offer it in a product or service that competes with Open Ledger IL or with MTN’s paid services for it.',
            'Each version becomes available under the Apache License 2.0 two years after its release.',
            'It comes with no warranty.',
        ],
        license_service='Setting it up for you is a paid service. It does not change the licence of the code.',
        license_full='Read the full licence text',
        license_gnu='The FSL on fsl.software',
        key_facts_h='Key facts',
        facts=[
            'Open Ledger IL is registered with the Israel Tax Authority as software for a computerized accounting system, under certificate 281801.',
            'It runs on the owner’s own Cloudflare account, and the data stays in the owner’s own database.',
            'It is free for your own business under the FSL-1.1 licence.',
            'Having it set up for you costs ₪699, once, with no subscription. That is a launch price, 30% off the regular ₪999, for a limited time.',
            'It supports עוסק פטור and עוסק מורשה businesses.',
            'It requests allocation numbers (מספרי הקצאה) from the Tax Authority for the tax invoices that need them.',
        ],
        fact_shop='The connected installer, which you run yourself, costs ₪99, once. That is a launch price, 50% off the regular ₪199, for a limited time.',
        llms_intro='Open Ledger IL (חשבונאות פתוחה) is source-available invoicing and bookkeeping software for Israeli businesses: עוסק פטור, עוסק מורשה and companies. It issues quotes, payment requests, receipts and tax invoices with gapless numbering and signed PDFs, requests Tax Authority allocation numbers, reads expenses with Claude, and produces reports and the unified file (מבנה אחיד) for the accountant. It runs on the owner’s own Cloudflare account. It is registered with the Israel Tax Authority under certificate 281801. It is free for your own business under the FSL-1.1 licence, or set up for you for ₪699 once.',
        llms_intro_shop=' The connected installer costs ₪99 once, a launch price, 50% off the regular ₪199.',
        draft='Draft',
    ),
    'he': dict(
        crumbs_label='פירורי לחם', switch='English',
        all_features='לכל היכולות',
        strip_h='חינם מקוד המקור, או הקמה עבורך',
        strip_p='הקוד חינמי לעסק שלכם. לא רוצים להתקין לבד? אנחנו מקימים עבורך ב-₪699 (גרסת השקה, 30% הנחה מ-₪999), חד פעמי, בלי מנוי.',
        strip_p_shop='הקוד חינמי לעסק שלכם. התקנה עצמית עם תוכנת ההתקנה המחוברת ב-₪99 (גרסת השקה, 50% הנחה מ-₪199), או הקמה עבורך ב-₪699 (גרסת השקה, 30% הנחה מ-₪999). תשלום אחד, בלי מנוי.',
        strip_btn='למחירים ולאפשרויות ההתקנה',
        demo_h='קודם מנסים, אחר כך מתקינים',
        demo_points=[
            'כל המבקרים רואים את אותם עסקי דוגמה: לקוחות, מסמכים, חוזים והוצאות.',
            'יוצרים טיוטות משלכם. אף אחד אחר לא רואה אותן, והן נמחקות 30 דקות אחרי שיוצאים.',
            'הפקה, שליחה, רישום תשלום וחתימה מציגים תצוגה מקדימה. ב-PDF לתצוגה מופיע המספר 0000 וסימן מים.',
        ],
        demo_more=[
            'נתוני הדוגמה לקריאה בלבד. השרת דוחה כל שינוי בהם.',
            'ההדגמה נפתחת בעברית, בערכת הצבעים הבהירה.',
        ],
        demo_page_lead='ההדגמה החיה פותחת את המערכת האמיתית על עסקי דוגמה. אין מה להתקין.',
        reg_registry='מאגר התוכנות הרשומות של רשות המסים',
        guides_none='המדריכים נכתבים ועוברים בדיקה. הם יופיעו כאן אחרי הפרסום.',
        help_lead='הוראות צעד אחר צעד, לפי הסדר שבו תצטרכו אותן. בהתקנה ראשונה, התחילו מלמעלה.',
        help_none='דפי העזרה בכתיבה.',
        help_more='עוד עזרה',
        help_stuck='עדיין תקועים?',
        help_stuck_link='כתבו לנו מעמוד המחירים.',
        help_topics='נושאים',
        help_buy_h='תוכנת ההתקנה מגיעה עם הרכישה',
        help_buy_p='קונים את תוכנת ההתקנה המחוברת ב-₪99, מחיר השקה (מחיר רגיל ₪199). מפתח הרישיון וקישור ההורדה מגיעים למייל תוך דקה.',
        help_buy_points=[
            'בלי בקשה לאפליקציית API ברשות המסים. מתחברים דרך האפליקציה המאושרת של MTN.',
            'בלי שרת ישראלי או ממסר להפעיל. כל פנייה לרשות המסים יוצאת מכתובת ישראלית, ולכן לא נחסמת כמו Worker שרץ בחו"ל.',
            'בלי שורת פקודה. אשף מקים בחשבון Cloudflare שלכם את מסד הנתונים, הקבצים, הכניסה והכתובת, בערך ב-3 דקות.',
            'הרצה חוזרת בהמשך מעדכנת, והנתונים נשארים.',
        ],
        help_buy_btn='לרכישת תוכנת ההתקנה',
        help_buy_self='או התקנה עצמית, בחינם',
        guides_draft_bar='טיוטה. המדריך הזה בבדיקה ועדיין לא פורסם.',
        guide_how='איך Open Ledger IL עושה את זה',
        guide_sources='מקורות',
        guide_faq='שאלות ותשובות',
        guide_updated='עודכן',
        guide_cta_demo='נסו את ההדגמה',
        guide_cta_pricing='למחירים ולאפשרויות ההתקנה',
        changelog_intro='כל הגרסאות, מהחדשה לישנה. הגרסה הנוכחית היא ' + VERSION + '.',
        changelog_lang_note='יומן השינויים נכתב באנגלית.',
        license_p='הקוד של Open Ledger IL מופץ ברישיון Functional Source License, גרסה 1.1, עם Apache 2.0 כרישיון עתידי (FSL-1.1-ALv2).',
        license_points=[
            'משתמשים בו לעסק שלכם, בלי תשלום.',
            'קוראים את הקוד ומשנים אותו.',
            'משתפים עותקים, עם שינויים או בלי, באותו רישיון.',
            'אסור למכור את הקוד, לארח אותו עבור אחרים, או להציע אותו במוצר או בשירות שמתחרה ב-Open Ledger IL או בשירותים בתשלום של MTN.',
            'כל גרסה עוברת לרישיון Apache 2.0 שנתיים אחרי שהיא יוצאת.',
            'הקוד מגיע בלי אחריות.',
        ],
        license_service='הקמה עבורך היא שירות בתשלום. היא לא משנה את רישיון הקוד.',
        license_full='לנוסח המלא של הרישיון',
        license_gnu='רישיון FSL באתר fsl.software',
        key_facts_h='עובדות עיקריות',
        facts=[
            'Open Ledger IL רשומה ברשות המסים כתוכנה לניהול מערכת חשבונות ממוחשבת, בתעודה 281801.',
            'היא רצה בחשבון Cloudflare של בעל העסק, והנתונים נשארים במסד הנתונים שלו.',
            'היא חינמית לעסק שלכם, ברישיון FSL-1.1.',
            'הקמה עבורך עולה ₪699, חד פעמי, בלי מנוי. זה מחיר השקה, 30% הנחה מהמחיר הרגיל של ₪999, לזמן מוגבל.',
            'היא תומכת בעוסק פטור ובעוסק מורשה.',
            'היא מבקשת מרשות המסים מספרי הקצאה לחשבוניות המס שצריכות אותם.',
        ],
        fact_shop='תוכנת ההתקנה המחוברת, שמריצים לבד, עולה ₪99, חד פעמי. זה מחיר השקה, 50% הנחה מהמחיר הרגיל של ₪199, לזמן מוגבל.',
        draft='טיוטה',
    ),
}
