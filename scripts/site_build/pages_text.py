"""
R32: the text of the one-page-per-question site. Titles stay under 60 characters and descriptions
under 155, and the build checks both. Facts come from text.py, CHANGELOG.md and docs/.
"""
from .config import VERSION

PAGES = {
    'en': {
        'home': dict(
            title='Open Ledger IL: invoices and books on your own Cloudflare',
            desc='Open-source invoicing, receipts and bookkeeping for עוסק פטור and עוסק מורשה. Registered with the Israel Tax Authority. Runs on your Cloudflare.',
            crumb='Home'),
        'features': dict(
            title='Open Ledger IL features: documents, reports, rules',
            desc='Every Open Ledger IL feature: Israeli document types, gapless numbering, ITA allocation numbers, contracts, expenses read by Claude and reports.',
            h1='Every feature', crumb='Features'),
        'pricing': dict(
            title='Open Ledger IL pricing: free, or set up for you',
            desc='Run Open Ledger IL free from source, or have it set up for you for ₪699 once. What you need, how it works and the known limits.',
            h1='Pricing and setup options', crumb='Pricing'),
        'registration': dict(
            title='Open Ledger IL: Tax Authority certificate 281801',
            desc='Open Ledger IL is registered with the Israel Tax Authority as accounting software, certificate 281801, valid to 31 Oct 2028. See the certificate.',
            h1='Registered with the Israel Tax Authority', crumb='Registration'),
        'demo': dict(
            title='Open Ledger IL live demo: try it in your browser',
            desc='Open the Open Ledger IL demo: sample businesses, the real screens, private drafts and preview PDFs. No install. The sample data stays as it is.',
            h1='Try the live demo', crumb='Demo'),
        'guides': dict(
            title='Open Ledger IL guides: invoicing for Israeli businesses',
            desc='Plain guides to Israeli invoicing: allocation numbers, the עוסק פטור ceiling, registered software, the unified file and which document is income.',
            h1='Guides', crumb='Guides'),
        'changelog': dict(
            title='Open Ledger IL changelog: what changed in each version',
            desc='Every Open Ledger IL release and what changed in it, newest first. The current version is ' + VERSION + '.',
            h1='Changelog', crumb='Changelog'),
        'license': dict(
            title='Open Ledger IL licence: AGPL-3.0, free from source',
            desc='The Open Ledger IL code is free under the GNU AGPL-3.0. What you can do with it, what you owe others, and where to read the full text.',
            h1='Licence', crumb='Licence'),
    },
    'he': {
        'home': dict(
            title='Open Ledger IL: חשבוניות והנהלת חשבונות בענן שלך',
            desc='מערכת קוד פתוח לחשבוניות, קבלות והנהלת חשבונות לעוסק פטור ולעוסק מורשה. רשומה ברשות המסים. רצה בחשבון Cloudflare שלך.',
            crumb='דף הבית'),
        'features': dict(
            title='היכולות של Open Ledger IL: מסמכים, דוחות וכללים',
            desc='כל היכולות של Open Ledger IL: כל סוגי המסמכים, מספור בלי חורים, מספרי הקצאה, חוזים, הוצאות ש-Claude קורא ודוחות לרואה החשבון.',
            h1='כל היכולות', crumb='יכולות'),
        'pricing': dict(
            title='מחירים: Open Ledger IL בחינם או בהקמה עבורך',
            desc='הפעלת Open Ledger IL בחינם מקוד המקור, או הקמה עבורך ב-₪699 חד פעמי. מה צריך, איך זה עובד ומה המגבלות.',
            h1='מחירים ואפשרויות התקנה', crumb='מחירים'),
        'registration': dict(
            title='Open Ledger IL רשומה ברשות המסים: תעודה 281801',
            desc='Open Ledger IL רשומה ברשות המסים כתוכנה לניהול מערכת חשבונות ממוחשבת, תעודה 281801, בתוקף עד 31.10.2028. צפו בתעודה.',
            h1='רשומה ברשות המסים', crumb='רישום'),
        'demo': dict(
            title='הדגמה חיה של Open Ledger IL: נסו בדפדפן',
            desc='פתחו את ההדגמה של Open Ledger IL: עסקי דוגמה, המסכים האמיתיים, טיוטות פרטיות ו-PDF לתצוגה. בלי התקנה. נתוני הדוגמה לא משתנים.',
            h1='נסו את ההדגמה', crumb='הדגמה'),
        'guides': dict(
            title='מדריכים: חשבוניות והנהלת חשבונות לעסק בישראל',
            desc='מדריכים פשוטים: מספרי הקצאה, תקרת עוסק פטור, תוכנה רשומה, מבנה אחיד, ואיזה מסמך נחשב הכנסה.',
            h1='מדריכים', crumb='מדריכים'),
        'changelog': dict(
            title='יומן שינויים של Open Ledger IL: מה חדש בכל גרסה',
            desc='כל הגרסאות של Open Ledger IL ומה השתנה בכל אחת, מהחדשה לישנה. הגרסה הנוכחית היא ' + VERSION + '.',
            h1='יומן שינויים', crumb='יומן שינויים'),
        'license': dict(
            title='רישיון Open Ledger IL: AGPL-3.0, חינם מקוד המקור',
            desc='הקוד של Open Ledger IL חופשי ברישיון GNU AGPL-3.0. מה מותר לעשות בו, מה חייבים לאחרים, ואיפה הנוסח המלא.',
            h1='רישיון', crumb='רישיון'),
    },
}

NAV = {
    'en': [('features', 'Features'), ('pricing', 'Pricing'), ('registration', 'Registration'), ('demo', 'Demo'), ('guides', 'Guides')],
    'he': [('features', 'יכולות'), ('pricing', 'מחירים'), ('registration', 'רישום'), ('demo', 'הדגמה'), ('guides', 'מדריכים')],
}

UI = {
    'en': dict(
        crumbs_label='Breadcrumbs', switch='עברית',
        all_features='See every feature',
        strip_h='Free from source, or set up for you',
        strip_p='The code is free under AGPL-3.0. Prefer not to do it yourself? We set it up for you for ₪699, once, with no subscription.',
        strip_p_shop='The code is free under AGPL-3.0. Install it yourself with the connected installer for ₪99, or have it set up for you for ₪699. One payment, no subscription.',
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
        reg_cert_alt='Israel Tax Authority software registration certificate 281801 for Open Ledger IL, version 1.1.0, with personal details hidden',
        reg_download='Download the certificate (PDF)',
        reg_registry='The Tax Authority registry of registered software',
        reg_redacted='Personal details on the certificate are hidden.',
        guides_none='The guides are being written and reviewed. They will appear here once published.',
        guides_draft_bar='Draft. This guide is under review and not published yet.',
        guide_how='How Open Ledger IL does it',
        guide_sources='Sources',
        guide_faq='Questions and answers',
        guide_updated='Updated',
        guide_cta_demo='Try the live demo',
        guide_cta_pricing='See pricing and setup',
        changelog_intro='Every release, newest first. The current version is ' + VERSION + '.',
        changelog_lang_note='',
        license_p='The Open Ledger IL code is free software under the GNU Affero General Public License, version 3 (AGPL-3.0).',
        license_points=[
            'Use it for your own business, at no cost.',
            'Read the code and change it.',
            'Share copies, changed or not, under the same licence.',
            'Run a changed version for other people over a network, and you offer them its source code.',
            'It comes with no warranty.',
        ],
        license_service='Setting it up for you is a paid service. It does not change the licence of the code.',
        license_full='Read the full licence text',
        license_gnu='The AGPL-3.0 on gnu.org',
        key_facts_h='Key facts',
        draft='Draft',
    ),
    'he': dict(
        crumbs_label='פירורי לחם', switch='English',
        all_features='לכל היכולות',
        strip_h='חינם מקוד המקור, או הקמה עבורך',
        strip_p='הקוד חופשי ברישיון AGPL-3.0. לא רוצים להתקין לבד? אנחנו מקימים עבורך ב-₪699, חד פעמי, בלי מנוי.',
        strip_p_shop='הקוד חופשי ברישיון AGPL-3.0. התקנה עצמית עם תוכנת ההתקנה המחוברת ב-₪99, או הקמה עבורך ב-₪699. תשלום אחד, בלי מנוי.',
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
        reg_cert_alt='תעודת רישום תוכנה 281801 של רשות המסים עבור Open Ledger IL, מהדורה 1.1.0, עם פרטים אישיים מוסתרים',
        reg_download='הורדת התעודה (PDF)',
        reg_registry='מאגר התוכנות הרשומות של רשות המסים',
        reg_redacted='הפרטים האישיים בתעודה מוסתרים.',
        guides_none='המדריכים נכתבים ועוברים בדיקה. הם יופיעו כאן אחרי הפרסום.',
        guides_draft_bar='טיוטה. המדריך הזה בבדיקה ועדיין לא פורסם.',
        guide_how='איך Open Ledger IL עושה את זה',
        guide_sources='מקורות',
        guide_faq='שאלות ותשובות',
        guide_updated='עודכן',
        guide_cta_demo='נסו את ההדגמה',
        guide_cta_pricing='למחירים ולאפשרויות ההתקנה',
        changelog_intro='כל הגרסאות, מהחדשה לישנה. הגרסה הנוכחית היא ' + VERSION + '.',
        changelog_lang_note='יומן השינויים נכתב באנגלית.',
        license_p='הקוד של Open Ledger IL הוא תוכנה חופשית ברישיון GNU Affero General Public License, גרסה 3 (AGPL-3.0).',
        license_points=[
            'משתמשים בו לעסק שלכם, בלי תשלום.',
            'קוראים את הקוד ומשנים אותו.',
            'משתפים עותקים, עם שינויים או בלי, באותו רישיון.',
            'מריצים גרסה ששיניתם עבור אחרים ברשת? מציעים להם את קוד המקור שלה.',
            'הקוד מגיע בלי אחריות.',
        ],
        license_service='הקמה עבורך היא שירות בתשלום. היא לא משנה את רישיון הקוד.',
        license_full='לנוסח המלא של הרישיון',
        license_gnu='רישיון AGPL-3.0 באתר gnu.org',
        key_facts_h='עובדות עיקריות',
        draft='טיוטה',
    ),
}
