import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionsHttpError } from '@supabase/supabase-js';

const invoke = vi.fn();
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } } }));

import { fetchBriefing, fetchCoach } from './ai';

const httpError = (body: unknown) => new FunctionsHttpError(new Response(JSON.stringify(body), { status: 422 }));

beforeEach(() => invoke.mockReset());

describe('fetchBriefing', () => {
  const briefing = { opener: 'Hi Sam, this is Alex.', angle: '12 years in the home.', objections: [{ objection: 'Not selling', response: 'No problem.' }] };

  it('sends the homeowner id and returns the parsed briefing', async () => {
    invoke.mockResolvedValue({ data: { briefing }, error: null });
    await expect(fetchBriefing(7)).resolves.toEqual(briefing);
    expect(invoke).toHaveBeenCalledWith('ai', { body: { mode: 'briefing', homeowner_id: 7 } });
  });

  it('surfaces the server\'s error message', async () => {
    invoke.mockResolvedValue({ data: null, error: httpError({ error: 'The AI is busy. Try again in a minute.' }) });
    await expect(fetchBriefing(7)).rejects.toThrow('The AI is busy. Try again in a minute.');
  });

  it('uses a generic message for network failures and unreadable bodies', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
    await expect(fetchBriefing(7)).rejects.toThrow('AI is unavailable right now.');
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response('<html>', { status: 500 })) });
    await expect(fetchBriefing(7)).rejects.toThrow('AI is unavailable right now.');
  });

  it('rejects a response that does not match the schema', async () => {
    invoke.mockResolvedValue({ data: { briefing: { opener: 5 } }, error: null });
    await expect(fetchBriefing(7)).rejects.toThrow('unexpected response');
  });
});

describe('fetchCoach', () => {
  it('returns text and steps', async () => {
    const result = { text: 'Nice.', steps: [{ tool: 'get_overall_stats', summary: '10 calls logged' }] };
    invoke.mockResolvedValue({ data: result, error: null });
    await expect(fetchCoach()).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith('ai', { body: { mode: 'coach' } });
  });
  it('rejects steps with the wrong shape', async () => {
    invoke.mockResolvedValue({ data: { text: 'x', steps: [{ tool: 1 }] }, error: null });
    await expect(fetchCoach()).rejects.toThrow('unexpected response');
  });
});
