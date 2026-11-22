import type { ContactRow } from './database.types';

export const initials = (name: string): string =>
  (name || '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

export type Tone = 'hot' | 'vm' | 'def';

export const avatarTone = (status: ContactRow['status']): Tone => (status === 'Hot lead' ? 'hot' : status === 'Callback' ? 'vm' : 'def');
export const tagTone = (status: ContactRow['status']): 'hot' | 'vm' => (status === 'Hot lead' ? 'hot' : 'vm');
