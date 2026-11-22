import { FunctionsHttpError } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase } from './supabase';
import type { Id } from './database.types';

export const BriefingSchema = z.object({
  opener: z.string(),
  angle: z.string(),
  objections: z.array(z.object({ objection: z.string(), response: z.string() })),
});
export type Briefing = z.infer<typeof BriefingSchema>;

export const CoachSchema = z.object({
  text: z.string(),
  steps: z.array(z.object({ tool: z.string(), summary: z.string() })),
});
export type CoachResult = z.infer<typeof CoachSchema>;

const FALLBACK_MESSAGE = 'AI is unavailable right now.';

async function errorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body: unknown = await error.context.json();
      const parsed = z.object({ error: z.string() }).safeParse(body);
      if (parsed.success) return parsed.data.error;
    } catch {
      // body wasn't JSON
    }
  }
  return FALLBACK_MESSAGE;
}

async function invoke<T>(body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ai', { body });
  if (error) throw new Error(await errorMessage(error));
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error('The AI returned an unexpected response.');
  return parsed.data;
}

export async function fetchBriefing(homeownerId: Id): Promise<Briefing> {
  const { briefing } = await invoke({ mode: 'briefing', homeowner_id: homeownerId }, z.object({ briefing: BriefingSchema }));
  return briefing;
}

export function fetchCoach(): Promise<CoachResult> {
  return invoke({ mode: 'coach' }, CoachSchema);
}
