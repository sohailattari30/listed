// The coach agent's tools. They depend on a small data interface instead of Supabase,
// so tests can inject fixtures and the Edge Function injects row-level-security-scoped queries.

import { currentStreak, groupConversion, hotLeadRate, tallyOutcomes, type Id, type Segment } from './analytics.ts';

export interface ToolOut {
  /** JSON sent back to the model. */
  data: unknown;
  /** Short human-readable line shown in the UI ("what the coach checked"). */
  summary: string;
}

export type ToolFn = (input: unknown) => Promise<ToolOut>;

export interface CoachData {
  calls(): Promise<{ homeowner_id: Id; outcome: string }[]>;
  sessions(limit: number): Promise<{ session_date: string; calls_made: number; hot_leads: number }[]>;
  homeowners(ids: Id[]): Promise<{ id: Id; zip: string; years_owned: number }[]>;
}

export const MAX_CALLS_READ = 5000;
const DEFAULT_SESSIONS = 14;
const MAX_SESSIONS = 60;

export const COACH_TOOL_DEFS = [
  {
    name: 'get_overall_stats',
    description:
      'Lifetime totals for this user: counts of each call outcome (sell = wants to sell, vm = voicemail, no = not interested, skip), hot lead rate, and number of completed sessions.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_session_history',
    description:
      "Recent daily calling sessions (date, calls made, hot leads) newest first, plus the user's current streak in days.",
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'How many recent sessions to return, 1-60. Default 14.' } },
      required: [],
    },
  },
  {
    name: 'get_conversion_by_segment',
    description:
      'Hot lead rate broken down by how long the homeowner has owned the home (tenure) or by zip code. Use it to see which kind of homeowner converts best for this user.',
    input_schema: {
      type: 'object',
      properties: { segment: { type: 'string', enum: ['tenure', 'zip'] } },
      required: ['segment'],
    },
  },
] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function createCoachTools(data: CoachData, now: () => Date = () => new Date()): Record<string, ToolFn> {
  const getOverallStats: ToolFn = async () => {
    const [calls, sessions] = await Promise.all([data.calls(), data.sessions(1000)]);
    const tally = tallyOutcomes(calls);
    const logged = tally.sell + tally.vm + tally.no;
    return {
      data: {
        outcomes: tally,
        conversations_logged: logged,
        hot_lead_rate: hotLeadRate(tally),
        sessions_completed: sessions.length,
        note: calls.length >= MAX_CALLS_READ ? `Truncated at ${MAX_CALLS_READ} calls.` : undefined,
      },
      summary: `${logged} calls logged: ${tally.sell} hot, ${tally.vm} voicemail, ${tally.no} not interested`,
    };
  };

  const getSessionHistory: ToolFn = async (input) => {
    const requested = isRecord(input) ? Number(input.limit) : NaN;
    const limit = Math.min(Math.max(Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : DEFAULT_SESSIONS, 1), MAX_SESSIONS);
    const sessions = await data.sessions(limit);
    const streak = currentStreak(sessions.map((s) => s.session_date), now());
    return {
      data: { sessions, current_streak_days: streak },
      summary: `Read your last ${sessions.length} sessions (streak: ${streak} day${streak === 1 ? '' : 's'})`,
    };
  };

  const getConversionBySegment: ToolFn = async (input) => {
    const segment: Segment = isRecord(input) && input.segment === 'zip' ? 'zip' : 'tenure';
    const calls = (await data.calls()).filter((c) => c.outcome !== 'skip');
    const ids = [...new Set(calls.map((c) => c.homeowner_id))];
    const owners = new Map<Id, { zip: string; years_owned: number }>();
    for (const o of ids.length ? await data.homeowners(ids) : []) owners.set(o.id, o);
    const segments = groupConversion(calls, owners, segment);
    const matched = segments.reduce((n, s) => n + s.calls, 0);
    const unmatched = calls.length - matched;
    return {
      data: {
        grouped_by: segment === 'zip' ? 'zip code' : 'years owned',
        segments,
        unmatched_calls: unmatched,
        note: unmatched > 0 ? 'unmatched_calls are calls whose homeowner no longer exists (likely old test data); they are left out of the segments.' : undefined,
      },
      summary:
        `Compared ${segments.length} ${segment === 'zip' ? 'zip codes' : 'ownership-length groups'} across ${matched} calls` +
        (unmatched > 0 ? ` (${unmatched} older calls had no matching homeowner)` : ''),
    };
  };

  return {
    get_overall_stats: getOverallStats,
    get_session_history: getSessionHistory,
    get_conversion_by_segment: getConversionBySegment,
  };
}
