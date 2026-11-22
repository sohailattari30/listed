// A small, model-agnostic tool-use loop. The model call is injected, so the loop's rules
// are tested with a scripted model and no network.

export interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

export interface ModelTurn {
  stop_reason: string | null;
  content: ContentBlock[];
}

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ToolOut {
  /** JSON sent back to the model. */
  data: unknown;
  /** Short human-readable line shown in the UI ("what the analyst checked"). */
  summary: string;
  /** The tool understood the call but rejected it (e.g. invalid input). The model sees `data` and can retry. */
  isError?: boolean;
}

export type ToolFn = (input: unknown) => Promise<ToolOut>;

export interface Step {
  tool: string;
  summary: string;
}

export type AgentResult =
  | { ok: true; text: string; steps: Step[] }
  | { ok: false; reason: 'refusal' | 'max_tokens' | 'max_turns'; steps: Step[] };

type ToolUse = ContentBlock & { type: 'tool_use'; id: string; name: string; input: unknown };

const isToolUse = (b: ContentBlock): b is ToolUse =>
  b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string';

export async function runAgent(opts: {
  firstMessage: string;
  createTurn: (messages: Message[]) => Promise<ModelTurn>;
  tools: Record<string, ToolFn>;
  maxTurns: number;
  /** End the run as soon as this tool succeeds (a "submit answer" tool), without another model call. */
  stopAfter?: string;
}): Promise<AgentResult> {
  const messages: Message[] = [{ role: 'user', content: opts.firstMessage }];
  const steps: Step[] = [];

  for (let turn = 0; turn < opts.maxTurns; turn++) {
    const response = await opts.createTurn([...messages]);

    if (response.stop_reason === 'refusal') return { ok: false, reason: 'refusal', steps };
    if (response.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens', steps };

    const toolUses = response.content.filter(isToolUse);
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const text = response.content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('\n')
        .trim();
      return { ok: true, text, steps };
    }

    // The whole assistant turn is kept verbatim (thinking blocks included), and every tool
    // result goes back in ONE user message so the model keeps calling tools in parallel.
    messages.push({ role: 'assistant', content: response.content });
    const outcomes = await Promise.all(
      toolUses.map(async (use) => {
        const fn = opts.tools[use.name];
        if (!fn) {
          return { name: use.name, ok: false, block: { type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Unknown tool ${use.name}` } };
        }
        try {
          const out = await fn(use.input ?? {});
          const block: ContentBlock = { type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out.data) };
          if (out.isError) return { name: use.name, ok: false, block: { ...block, is_error: true } };
          return { name: use.name, ok: true, block, step: { tool: use.name, summary: out.summary } };
        } catch (error) {
          console.error('tool failed', use.name, error);
          return { name: use.name, ok: false, block: { type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'Tool failed to read data.' } };
        }
      }),
    );
    for (const o of outcomes) if ('step' in o && o.step) steps.push(o.step);

    if (opts.stopAfter && outcomes.some((o) => o.ok && o.name === opts.stopAfter)) return { ok: true, text: '', steps };
    messages.push({ role: 'user', content: outcomes.map((o) => o.block) });
  }

  return { ok: false, reason: 'max_turns', steps };
}
