---
title: הוספה או החלפה של מפתח אחרי ההתקנה
description: הוספת מפתח Gemini, Anthropic, Resend, Slack או גוגל דרייב ללדג'ר דרך לוח הבקרה של Cloudflare, בלי להריץ שוב את ההתקנה.
updated: 2026-10-17
published: true
nav: הוספת מפתח
order: 13
---

הלדג'ר קורא את המפתחות שלו מה-Worker שלו ב-Cloudflare. Worker הוא התוכנה שמריצה את הלדג'ר. שם מוסיפים או מחליפים מפתח.

## איפה

1. נכנסים ל-dash.cloudflare.com.
2. בתפריט השמאלי, תחת **Build**, פותחים **Compute > Workers & Pages** ולוחצים **mtn-open-ledger**.
3. פותחים את הלשונית **Settings**. החלק הראשון הוא **Runtime variables and secrets**.
4. לוחצים **Add variable**. מקלידים את השם ב-**Key** ומדביקים את הערך ב-**Value**. למפתח מסמנים **Secret**. להגדרה רגילה משאירים לא מסומן.
5. לוחצים **Add variable and deploy**. הלדג'ר משתמש בערך החדש תוך דקה.

כדי לשנות ערך שכבר קיים, לוחצים על העיפרון בשורה שלו, מדביקים את הערך החדש ושומרים.

השמות מדויקים, באותיות גדולות.

## אילו שמות

- **קריאת קבלות עם Gemini:** Secret בשם `GEMINI_API_KEY` עם המפתח, ומשתנה רגיל בשם `AI_PROVIDER` עם הערך `gemini`.
- **קריאת קבלות עם Anthropic:** Secret בשם `ANTHROPIC_API_KEY` עם המפתח, ומשתנה רגיל בשם `AI_PROVIDER` עם הערך `anthropic`.
- **שליחת מיילים:** Secret בשם `MAIL_API_KEY` עם מפתח Resend, ומשתנה רגיל בשם `MAIL_FROM` עם השולח, למשל `Acme Ltd <billing@acme.co.il>`.
- **התראות Slack:** Secret בשם `SLACK_WEBHOOK_URL`.
- **הוצאות מגוגל דרייב:** Secret בשם `GOOGLE_SERVICE_ACCOUNT_JSON` עם כל התוכן של קובץ ה-JSON, מה-`{` הראשון עד ה-`}` האחרון. לתיקייה משותפת בקישור, במקומו Secret בשם `GOOGLE_API_KEY` עם מפתח API של Google.
- **טוקן MCP:** Secret בשם `MCP_TOKEN`, ראו [חיבור Claude](/help/connect-claude/).

## כללים

- לא מדביקים מפתח במייל, בצ'אט או במסמך. רק ב-Cloudflare או בתוכנת ההתקנה.
- אם מפתח דלף, יוצרים חדש אצל הספק, מוחקים שם את הישן, ומחליפים כאן.
