# חיבור Claude או אפליקציית AI אחרת (MCP)

נותנים ל-Claude Desktop או ל-Claude Code גישה ללדג'ר עם כתובת ה-MCP והטוקן, ומה עושים כשהטוקן אבד.

עודכן 2026-10-17

עם MCP מחובר, שואלים את Claude דברים כמו "כמה Acme חייבים לי" או "תכין דרישת תשלום על 3 שעות ייעוץ", ו-Claude עובד בלדג'ר שלכם. Claude יוצר טיוטות, ומסיים מסמך רק אחרי שאתם מאשרים.

## מה צריך

- **הכתובת:** כתובת הלדג'ר עם `/mcp` בסוף, למשל `https://ledger.acme.co.il/mcp`.
- **הטוקן:** מוצג פעם אחת במסך האחרון של תוכנת ההתקנה.

## Claude Desktop

1. במסך האחרון של תוכנת ההתקנה לחצתם **Download for Claude Desktop**. הקובץ `claude-desktop-<הכתובת שלכם>.json` נמצא בתיקיית ההורדות.
2. ב-Claude Desktop: **Settings > Developer > Edit Config**. נפתח הקובץ `claude_desktop_config.json`.
3. מעתיקים את הרשומה `open-ledger` מהקובץ שהורדתם לתוך `mcpServers` בקובץ הזה. שומרים.
4. מפעילים מחדש את Claude Desktop. צריך Node.js במחשב, מ-nodejs.org.

## Claude Code

לוחצים **Download for Claude Code** במסך האחרון של תוכנת ההתקנה ושומרים את הקובץ בשם `.mcp.json` בתיקייה שבה עובדים. או מוסיפים שרת עם הכתובת והכותרת `Authorization: Bearer <token>`.

## הטוקן אבד

Cloudflare לא מציג סוד שוב, אז יוצרים טוקן חדש. הישן מפסיק לעבוד באותו רגע.

### בלדג'ר

1. פותחים **Settings > MCP**. רק בעלים רואים את הלשונית הזו.
2. לוחצים **Make a new token**, ואז **Make the token** לאישור.
3. מעתיקים את הטוקן, או לוחצים **Download for Claude Desktop** או **Download for Claude Code**. הוא מוצג פעם אחת.
4. מכניסים אותו להגדרות של Claude ומפעילים אותו מחדש.

באותה לשונית מופיעה כתובת ה-MCP עם כפתור **Copy**, מתי הטוקן היה בשימוש לאחרונה, ומתג שמכבה את ה-MCP לכל האפליקציות.

### אין עדיין לשונית MCP

הלשונית קיימת בלדג'רים שעודכנו אחרי 17 באוקטובר 2026. בלדג'ר ישן, מעדכנים קודם, ראו [עדכונים](https://open-ledger.matanlevanon.com/he/help/updates-backups/). או קובעים את הטוקן ב-Cloudflare:

1. מחפשים בתיקיית ההורדות קובץ `claude-desktop-....json`. אם הוא שם, הטוקן הישן בתוכו ואין צורך בשום דבר נוסף.
2. אחרת יוצרים טוקן ב-PowerShell במחשב שלכם:

`$b = New-Object byte 32; Security.Cryptography.RandomNumberGenerator::Create().GetBytes($b); Convert::ToBase64String($b)`

1. ב-dash.cloudflare.com: **Workers & Pages**, לוחצים **mtn-open-ledger**, ואז **Settings > Variables and Secrets**. עורכים את **MCP_TOKEN**, מדביקים את השורה שהודפסה ולוחצים **Deploy**.

עדיין תקועים? [כתבו לנו מעמוד המחירים.](https://open-ledger.matanlevanon.com/he/pricing/#setup)

## עוד עזרה

- [לפני ההתקנה: מה צריך להכין](https://open-ledger.matanlevanon.com/he/help/before-you-start/)
- [התקנת Open Ledger IL צעד אחר צעד](https://open-ledger.matanlevanon.com/he/help/install/)
- [יצירת ה-API token ב-Cloudflare](https://open-ledger.matanlevanon.com/he/help/cloudflare-token/)
- [כניסה ראשונה והגדרות](https://open-ledger.matanlevanon.com/he/help/first-sign-in/)
- [גישה לרואה חשבון או לעוזר](https://open-ledger.matanlevanon.com/he/help/users/)
- [חיבור לרשות המסים למספרי הקצאה](https://open-ledger.matanlevanon.com/he/help/tax-authority/)
- [מהצעת מחיר לקבלה: המסמכים הראשונים](https://open-ledger.matanlevanon.com/he/help/first-invoice/)
- [גבייה עם גרואו, קארדקום או סולק אחר](https://open-ledger.matanlevanon.com/he/help/payment-providers/)
- [הכנסת הוצאות ללדג'ר](https://open-ledger.matanlevanon.com/he/help/expenses/)
- [שליחת מסמכים במייל, בלי ספאם](https://open-ledger.matanlevanon.com/he/help/email/)
- [הוספה או החלפה של מפתח אחרי ההתקנה](https://open-ledger.matanlevanon.com/he/help/keys-later/)
- [עדכונים וגיבויים](https://open-ledger.matanlevanon.com/he/help/updates-backups/)
- [בעיות נפוצות ואיך פותרים אותן](https://open-ledger.matanlevanon.com/he/help/troubleshooting/)

Source: https://open-ledger.matanlevanon.com/he/help/connect-claude/
