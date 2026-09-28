-- R16 tasks 15 and 16: remember each user's theme and interface-language choice across devices.
-- NULL means "no explicit choice yet": the client falls back to the system color-scheme
-- preference for theme, and to English for locale, until the person picks one.
ALTER TABLE users ADD COLUMN theme TEXT CHECK (theme IN ('light', 'dark'));
ALTER TABLE users ADD COLUMN locale TEXT CHECK (locale IN ('en', 'he'));
