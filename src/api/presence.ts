import { getOptional } from './client';

export interface PresenceUser {
  userId: string;
  email: string;
  name?: string;
  role: string;
  connectedAt: string;
  lastSeen: string;
}

export type PresenceMap = Record<string, PresenceUser[]>;

export async function getPresenceSnapshot(signal?: AbortSignal): Promise<PresenceMap> {
  return (await getOptional<PresenceMap>('/api/presence', signal)) ?? {};
}
