import { apiGet } from '../../api/client';
import { apiSend } from '../documents/api';
import type { SyncCounts } from '../financy/api';

/** R49: /api/wise. The Wise Business connection. No answer carries the token. */

export interface WiseConnection {
  connected: boolean;
  status: 'connected' | 'error' | 'disconnected' | null;
  tokenLast4: string | null;
  profileName: string | null;
  lastError: string | null;
  lastSyncAt: string | null;
  lastSyncResult: SyncCounts | null;
  webhook: { url: string | null; event: string; state: 'auto' | 'manual'; lastEventAt: string | null };
}

export interface WiseProfileChoice {
  id: number;
  name: string | null;
}

export const wiseApi = {
  get: () => apiGet<{ connection: WiseConnection }>('/wise'),
  connect: (token: string, profileId?: number) =>
    apiSend<{ connection: WiseConnection; sync: SyncCounts | null; syncError: string | null }>('PUT', '/wise', profileId ? { token, profileId } : { token }),
  sync: () => apiSend<{ connection: WiseConnection; sync: SyncCounts }>('POST', '/wise/sync'),
  disconnect: () => apiSend<{ connection: WiseConnection }>('DELETE', '/wise'),
};
