import type { Me } from '../client';

/** VITE_MOCK=1 fixture for GET /api/me. Lets other runs build screens without the Worker. */
export const meFixture: { user: Me } = {
  user: { email: 'owner@example.com', name: 'Sample Owner', role: 'owner', features: [], theme: null, locale: null },
};
