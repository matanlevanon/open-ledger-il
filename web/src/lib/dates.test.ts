import { describe, expect, it } from 'vitest';
import { showDate, showDateTime } from './dates';

describe('dates on screen', () => {
  it('a plain date is day/month/year, with no time zone shift', () => {
    expect(showDate('2026-11-04')).toBe('04/11/2026');
    expect(showDateTime('2026-01-01')).toBe('01/01/2026');
  });
  it('a timestamp is Israel time on a 24-hour clock', () => {
    expect(showDateTime('2026-11-04T09:25:35.112Z')).toBe('04/11/2026 11:25');
    expect(showDateTime('2026-07-04T21:30:00Z')).toBe('05/07/2026 00:30');
    expect(showDate('2026-07-04T21:30:00Z')).toBe('05/07/2026');
  });
  it('a SQLite timestamp without a zone is read as UTC', () => {
    expect(showDateTime('2026-11-04 09:25:35')).toBe('04/11/2026 11:25');
  });
  it('nothing stays empty, and other text stays as it was', () => {
    expect(showDate(null)).toBe('');
    expect(showDateTime(undefined)).toBe('');
    expect(showDate('soon')).toBe('soon');
  });
});
