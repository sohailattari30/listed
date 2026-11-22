import { describe, expect, it } from 'vitest';
import { hasNewCalls, readCollapsed, readCoachCache, writeCollapsed, writeCoachCache } from './coachCache';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

const result = { text: 'Nice.', steps: [{ tool: 'get_overall_stats', summary: '10 calls' }] };
const morning = new Date(2026, 10, 22, 9, 0);

describe('coach cache', () => {
  it('round-trips within the same day', () => {
    const storage = new MemoryStorage();
    writeCoachCache(storage, result, 42, morning);
    expect(readCoachCache(storage, new Date(2026, 10, 22, 21, 0))).toMatchObject({ callCount: 42, result });
  });

  it('expires the next day', () => {
    const storage = new MemoryStorage();
    writeCoachCache(storage, result, 42, morning);
    expect(readCoachCache(storage, new Date(2026, 10, 23, 9, 0))).toBeNull();
  });

  it('ignores corrupt or wrongly-shaped data', () => {
    const storage = new MemoryStorage();
    expect(readCoachCache(storage, morning)).toBeNull();
    storage.setItem('listed_coach', '{nope');
    expect(readCoachCache(storage, morning)).toBeNull();
    storage.setItem('listed_coach', JSON.stringify({ date: morning.toDateString(), result: 'x' }));
    expect(readCoachCache(storage, morning)).toBeNull();
  });
});

describe('hasNewCalls', () => {
  it('flags a changed call count', () => {
    expect(hasNewCalls({ callCount: 40 }, 90)).toBe(true);
    expect(hasNewCalls({ callCount: 40 }, 40)).toBe(false);
  });
  it('stays quiet while either count is unknown', () => {
    expect(hasNewCalls({ callCount: null }, 90)).toBe(false);
    expect(hasNewCalls({ callCount: 40 }, undefined)).toBe(false);
  });
});

describe('collapsed preference', () => {
  it('defaults to expanded and remembers a choice', () => {
    const storage = new MemoryStorage();
    expect(readCollapsed(storage)).toBe(false);
    writeCollapsed(storage, true);
    expect(readCollapsed(storage)).toBe(true);
    writeCollapsed(storage, false);
    expect(readCollapsed(storage)).toBe(false);
  });
});
