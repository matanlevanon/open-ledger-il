export type ClientLang = 'en' | 'he';

/**
 * R19: a client may have only one of nameEn, nameHe. English UI and English documents prefer
 * name_en, Hebrew UI and Hebrew documents prefer name_he, each falling back to the other. Never
 * returns an empty string unless both names are empty.
 */
export function clientDisplayName(row: { name_en: string | null; name_he: string | null }, lang: ClientLang): string {
  const en = (row.name_en ?? '').trim();
  const he = (row.name_he ?? '').trim();
  return lang === 'he' ? he || en : en || he;
}
