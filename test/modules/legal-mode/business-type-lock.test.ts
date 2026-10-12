import { describe, expect, it } from 'vitest';
import { DomainError, mapDbError } from '../../../src/core/errors';
import { first } from '../../../src/core/db';
import { finalizeDocument } from '../../../src/core/numbering';
import { OWNER_ACTOR, db, makeDraft, makeSeries, sqlError } from '../../helpers';

/**
 * R24 Phase A, migrations/2410_business_type_lock.sql: no raw SQL takes a Ledger back to פטור.
 * The tests run in order in one database: each step builds on the one before.
 */
describe('business type lock triggers (raw SQL)', () => {
  it('a fresh Ledger is עוסק פטור', async () => {
    expect((await first<{ entity_type: string }>(db(), 'SELECT entity_type FROM business_profile WHERE id = 1'))?.entity_type).toBe('osek_patur');
  });

  it('legal_modes refuses UPDATE and DELETE', async () => {
    expect(await sqlError("UPDATE legal_modes SET note = 'x'")).toContain('legal_mode_locked');
    expect(await sqlError("UPDATE legal_modes SET mode = 'murshe'")).toContain('legal_mode_locked');
    expect(await sqlError('DELETE FROM legal_modes')).toContain('legal_mode_locked');
  });

  it('entity_type refuses a value outside the three types', async () => {
    expect(await sqlError("UPDATE business_profile SET entity_type = 'llc' WHERE id = 1")).toMatch(/CHECK|constraint/i);
  });

  it('company is refused once a final document exists', async () => {
    const series = await makeSeries();
    await finalizeDocument(db(), await makeDraft({ seriesId: series }), { actor: OWNER_ACTOR });
    expect(await sqlError("UPDATE business_profile SET entity_type = 'company' WHERE id = 1")).toContain('entity_type_locked');
  });

  it('no פטור row may follow a מורשה row', async () => {
    expect(await sqlError("INSERT INTO legal_modes (mode, effective_from) VALUES ('murshe', '2030-01-01')")).toBeNull();
    expect(await sqlError("INSERT INTO legal_modes (mode, effective_from) VALUES ('patur', '2031-01-01')")).toContain('legal_mode_locked');
    expect(await sqlError("INSERT INTO legal_modes (mode, effective_from) VALUES ('patur', '2019-01-01')")).toContain('legal_mode_locked');
  });

  it('פטור to מורשה is allowed, and nothing goes back or sideways', async () => {
    expect(await sqlError("UPDATE business_profile SET entity_type = 'osek_murshe' WHERE id = 1")).toBeNull();
    expect(await sqlError("UPDATE business_profile SET entity_type = 'osek_patur' WHERE id = 1")).toContain('entity_type_locked');
    expect(await sqlError("UPDATE business_profile SET entity_type = 'company' WHERE id = 1")).toContain('entity_type_locked');
  });

  it('the profile row cannot be deleted or replaced back to פטור', async () => {
    expect(await sqlError('DELETE FROM business_profile WHERE id = 1')).toContain('entity_type_locked');
    expect(await sqlError("INSERT OR REPLACE INTO business_profile (id, name_en, name_he, entity_type) VALUES (1, 'x', 'x', 'osek_patur')")).toContain(
      'entity_type_locked',
    );
    expect((await first<{ entity_type: string }>(db(), 'SELECT entity_type FROM business_profile WHERE id = 1'))?.entity_type).toBe('osek_murshe');
  });

  it('other business fields still save', async () => {
    expect(await sqlError("UPDATE business_profile SET name_en = 'Still editable' WHERE id = 1")).toBeNull();
  });

  it('maps both trigger codes to a 409 domain error', () => {
    for (const code of ['legal_mode_locked', 'entity_type_locked']) {
      const mapped = mapDbError(new Error(`D1_ERROR: ${code}: SQLITE_CONSTRAINT`));
      expect(mapped).toBeInstanceOf(DomainError);
      expect((mapped as DomainError).status).toBe(409);
      expect((mapped as DomainError).code).toBe(code);
    }
  });
});
