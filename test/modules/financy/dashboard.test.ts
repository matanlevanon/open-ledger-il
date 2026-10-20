import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../src/index';
import { FakeFinancy, connect, fenv, financyApp, resetFinancy } from './helpers';

/** R40 task 4: the dashboard's Bank card. */

const app = createApp();
const dashboard = async (email = 'owner@example.com') => {
  const res = await app.request('/api/dashboard', {}, { ...fenv, DEV_AUTH_EMAIL: email });
  return (await res.json()) as { bank: any };
};

describe('R40: the Bank card on the dashboard', () => {
  beforeEach(resetFinancy);

  it('is absent until Financy is connected', async () => {
    expect((await dashboard()).bank).toBeNull();
  });

  it('shows each checking balance (available first) and each card charge with its due date', async () => {
    await connect(financyApp(new FakeFinancy()).app);
    const { bank } = await dashboard();
    expect(bank.status).toBe('connected');
    expect(bank.lastSyncAt).not.toBeNull();
    expect(bank.accounts.map((a: any) => [a.type, a.last4, a.balanceMinor, a.balanceType, a.cardDueDate])).toEqual([
      ['CHECKING', '8901', 1410025, 'interimAvailable', null],
      ['CARD', '9012', -231040, 'interimBooked', '2'],
    ]);
    expect(bank.accounts[0].balances).toEqual([{ currency: 'ILS', balanceMinor: 1410025, balanceType: 'interimAvailable' }]);
  });

  it('falls back to closingBooked when no available balance came', async () => {
    const fake = new FakeFinancy();
    fake.accounts[0]!.balances = fake.accounts[0]!.balances!.filter((b) => b.balanceType === 'closingBooked');
    await connect(financyApp(fake).app);
    const checking = (await dashboard()).bank.accounts.find((a: any) => a.type === 'CHECKING');
    expect(checking).toMatchObject({ balanceMinor: 1523450, balanceType: 'closingBooked' });
  });
});
