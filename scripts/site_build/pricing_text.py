"""Pricing page text: the three-option comparison, the installer steps and the pricing FAQ.

Shown when the shop is live. The ₪99 column, steps and answers stay out before then.
"""

PRICING = {
    'en': dict(
        cmp_eyebrow='Compare', cmp_h='The three options side by side',
        cmp_p='The software is the same in all three. What changes is who installs it and how it reaches the Tax Authority.',
        cmp_cols=['', 'Free from source', '₪99 installer', '₪699 set up for you'],
        cmp_rows=[
            ('Price', 'Free', '₪99 once (regular ₪199)', '₪699 once (regular ₪999)'),
            ('Who installs it', 'You, with Node.js and Wrangler', 'You, with a Windows installer', 'We do, with you on a call'),
            ('Time to install', 'An afternoon', 'About 30 minutes', 'We handle it'),
            ('Allocation numbers', 'Your own ITA API app', 'Through MTN’s approved app', 'Your own app, or through MTN'),
            ('What you bring', 'A Cloudflare account, Node.js and a PDF signing key', 'A Windows computer, a Cloudflare account and the licence key', 'Your business details and your emails'),
            ('Where the data lives', 'Your Cloudflare account', 'Your Cloudflare account', 'Your Cloudflare account'),
            ('Subscription', 'None', 'None', 'None'),
        ],
        how_installer_h='With the ₪99 installer',
        how_source_h='From source, free',
        steps_installer=[
            ('Buy and get the key', 'Pay ₪99 and the licence key arrives by email. One key is one business, tied to its tax number.'),
            ('Run the Windows installer', 'Paste a Cloudflare API token. The installer creates the database, file storage and sign-in in your own account. No command line.'),
            ('Set up the business', 'Business profile, logo, signature and the starting number of each series, so numbering continues from your previous system.'),
        ],
        installer_note='About 30 minutes the first time, mostly creating accounts.',
        installer_link='See what you need before you install',
        need_p_shop='This list is for the free path from source. The installer needs less: a Windows computer, a Cloudflare account and the licence key.',
        faq_h='Pricing questions',
        faq=[
            ('Is there a monthly fee?', 'No. Each option is free or paid once. The Ledger runs on Cloudflare’s free plans. Workers Paid, from $5 a month, is optional and is paid to Cloudflare, not to us.'),
            ('What does the ₪99 installer add to the free version?', 'Two things. A Windows installer that sets everything up in your Cloudflare account, and the Tax Authority connection through MTN’s approved app, so you do not register an ITA API app of your own. The software is the same.'),
            ('Which option fits an עוסק פטור?', 'Any of them. A פטור business issues receipts, not tax invoices, so it does not need allocation numbers. The ₪99 installer is the quickest way to start without technical work.'),
            ('Who holds my data?', 'You do. Every option creates the database and the files in your own Cloudflare account. MTN does not hold your data.'),
            ('Is the software registered with the Tax Authority?', 'Yes. Open Ledger IL is registered as software for a computerized accounting system, under certificate 281801.'),
        ],
    ),
    'he': dict(
        cmp_eyebrow='השוואה', cmp_h='שלוש האפשרויות זו לצד זו',
        cmp_p='התוכנה זהה בשלושתן. מה שמשתנה הוא מי מתקין אותה ואיך היא מתחברת לרשות המסים.',
        cmp_cols=['', 'חינם מקוד המקור', 'תוכנת התקנה ב-₪99', 'הקמה עבורך ב-₪699'],
        cmp_rows=[
            ('מחיר', 'חינם', '₪99 חד פעמי (במקום ₪199)', '₪699 חד פעמי (במקום ₪999)'),
            ('מי מתקין', 'אתה, עם Node.js ו-Wrangler', 'אתה, עם תוכנת התקנה לווינדוס', 'אנחנו, איתך בשיחה'),
            ('זמן התקנה', 'אחר צהריים', 'כ-30 דקות', 'אנחנו מטפלים בזה'),
            ('מספרי הקצאה', 'אפליקציית API משלך ברשות המסים', 'דרך האפליקציה המאושרת של MTN', 'אפליקציה משלך, או דרך MTN'),
            ('מה צריך להביא', 'חשבון Cloudflare, Node.js ומפתח חתימה ל-PDF', 'מחשב Windows, חשבון Cloudflare ומפתח הרישיון', 'פרטי העסק וכתובות המייל שלך'),
            ('איפה המידע', 'בחשבון Cloudflare שלך', 'בחשבון Cloudflare שלך', 'בחשבון Cloudflare שלך'),
            ('מנוי', 'אין', 'אין', 'אין'),
        ],
        how_installer_h='עם תוכנת ההתקנה ב-₪99',
        how_source_h='מקוד המקור, בחינם',
        steps_installer=[
            ('קונים ומקבלים מפתח', 'משלמים ₪99 ומפתח הרישיון מגיע במייל. מפתח אחד לעסק אחד, לפי מספר העוסק.'),
            ('מריצים את תוכנת ההתקנה', 'מדביקים טוקן API של Cloudflare. תוכנת ההתקנה יוצרת בחשבון שלך את מסד הנתונים, אחסון הקבצים והכניסה. בלי שורת פקודה.'),
            ('הגדרת העסק', 'פרטי העסק, לוגו, חתימה ומספר ההתחלה של כל סדרה, כדי שהמספור ימשיך מהמערכת הקודמת.'),
        ],
        installer_note='כ-30 דקות בפעם הראשונה, רובן פתיחת חשבונות.',
        installer_link='מה צריך לפני ההתקנה',
        need_p_shop='הרשימה הזו היא למסלול החינמי מקוד המקור. תוכנת ההתקנה צריכה פחות: מחשב Windows, חשבון Cloudflare ומפתח הרישיון.',
        faq_h='שאלות על המחיר',
        faq=[
            ('יש תשלום חודשי?', 'לא. כל אפשרות היא בחינם או בתשלום אחד. המערכת רצה על התוכניות החינמיות של Cloudflare. Workers Paid, מ-$5 לחודש, הוא רשות ומשולם ל-Cloudflare, לא לנו.'),
            ('מה תוכנת ההתקנה ב-₪99 מוסיפה על הגרסה החינמית?', 'שני דברים. תוכנת התקנה לווינדוס שמקימה הכול בחשבון Cloudflare שלך, וחיבור לרשות המסים דרך האפליקציה המאושרת של MTN, כך שלא צריך לרשום אפליקציית API משלך. התוכנה עצמה זהה.'),
            ('איזו אפשרות מתאימה לעוסק פטור?', 'כל אחת מהן. עוסק פטור מוציא קבלות ולא חשבוניות מס, ולכן לא צריך מספרי הקצאה. תוכנת ההתקנה ב-₪99 היא הדרך המהירה להתחיל בלי עבודה טכנית.'),
            ('מי מחזיק את המידע שלי?', 'אתה. בכל אפשרות מסד הנתונים והקבצים נוצרים בחשבון Cloudflare שלך. MTN לא מחזיקה את המידע שלך.'),
            ('התוכנה רשומה ברשות המסים?', 'כן. Open Ledger IL רשומה כתוכנה לניהול מערכת חשבונות ממוחשבת, בתעודה 281801.'),
        ],
    ),
}
