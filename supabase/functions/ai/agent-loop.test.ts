import { describe, expect, it, vi } from 'vitest';
import { runAgent, type Message, type ModelTurn, type ToolFn } from './agent-loop.ts';

/** A model that replays a fixed script and records what it was sent. */
function scriptedModel(turns: ModelTurn[]) {
  const calls: Message[][] = [];
  let i = 0;
  return {
    calls,
    createTurn: async (messages: Message[]) => {
      calls.push(messages);
      const turn = turns[Math.min(i++, turns.length - 1)];
      if (!turn) throw new Error('empty script');
      return turn;
    },
  };
}

const toolUse = (id: string, name: string, input: unknown = {}) => ({ type: 'tool_use', id, name, input });
const text = (t: string) => ({ type: 'text', text: t });

const blocks = <T>(message: Message): T[] => message.content as unknown as T[];

const okTool = (summary: string): ToolFn => async () => ({ data: { ok: true }, summary });

describe('runAgent', () => {
  it('runs tools, feeds results back, and returns the final text', async () => {
    const model = scriptedModel([
      { stop_reason: 'tool_use', content: [toolUse('a', 'stats')] },
      { stop_reason: 'end_turn', content: [text('Great job.'), text('Today: call owners.')] },
    ]);
    const result = await runAgent({
      firstMessage: 'coach me',
      createTurn: model.createTurn,
      tools: { stats: okTool('read stats') },
      maxTurns: 5,
    });
    expect(result).toEqual({
      ok: true,
      text: 'Great job.\nToday: call owners.',
      steps: [{ tool: 'stats', summary: 'read stats' }],
    });
  });

  it('keeps thinking blocks and returns parallel tool results in one user message, in order', async () => {
    const thinking = { type: 'thinking', thinking: '', signature: 'sig' };
    const model = scriptedModel([
      { stop_reason: 'tool_use', content: [thinking, toolUse('1', 'a'), toolUse('2', 'b')] },
      { stop_reason: 'end_turn', content: [text('done')] },
    ]);
    const result = await runAgent({
      firstMessage: 'go',
      createTurn: model.createTurn,
      tools: { a: okTool('A'), b: okTool('B') },
      maxTurns: 5,
    });
    expect(result.steps.map((s) => s.tool)).toEqual(['a', 'b']);

    const second = model.calls[1]!;
    expect(second).toHaveLength(3);
    expect(second[1]).toEqual({ role: 'assistant', content: [thinking, toolUse('1', 'a'), toolUse('2', 'b')] });
    const results = second[2]!;
    expect(results.role).toBe('user');
    expect(blocks<{ tool_use_id: string }>(results).map((r) => r.tool_use_id)).toEqual(['1', '2']);
  });

  it('reports an unknown tool as an error result and keeps going', async () => {
    const model = scriptedModel([
      { stop_reason: 'tool_use', content: [toolUse('x', 'nope')] },
      { stop_reason: 'end_turn', content: [text('ok')] },
    ]);
    const result = await runAgent({ firstMessage: 'go', createTurn: model.createTurn, tools: {}, maxTurns: 5 });
    expect(result.ok).toBe(true);
    const block = blocks<{ is_error?: boolean; content: string }>(model.calls[1]![2]!)[0]!;
    expect(block.is_error).toBe(true);
    expect(block.content).toContain('Unknown tool nope');
  });

  it('hides tool exceptions from the model and the steps list', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom: ToolFn = async () => {
      throw new Error('secret db detail');
    };
    const model = scriptedModel([
      { stop_reason: 'tool_use', content: [toolUse('x', 'boom')] },
      { stop_reason: 'end_turn', content: [text('ok')] },
    ]);
    const result = await runAgent({ firstMessage: 'go', createTurn: model.createTurn, tools: { boom }, maxTurns: 5 });
    const block = blocks<{ is_error?: boolean; content: string }>(model.calls[1]![2]!)[0]!;
    expect(block.is_error).toBe(true);
    expect(block.content).not.toContain('secret');
    expect(result.steps).toEqual([]);
    spy.mockRestore();
  });

  it('stops on refusal and max_tokens without running tools', async () => {
    const run = vi.fn(okTool('x'));
    for (const reason of ['refusal', 'max_tokens'] as const) {
      const model = scriptedModel([{ stop_reason: reason, content: [toolUse('t', 'stats')] }]);
      const result = await runAgent({ firstMessage: 'go', createTurn: model.createTurn, tools: { stats: run }, maxTurns: 5 });
      expect(result).toEqual({ ok: false, reason, steps: [] });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('gives up after maxTurns of tool calls', async () => {
    const model = scriptedModel([{ stop_reason: 'tool_use', content: [toolUse('t', 'stats')] }]);
    const result = await runAgent({
      firstMessage: 'go',
      createTurn: model.createTurn,
      tools: { stats: okTool('s') },
      maxTurns: 3,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('max_turns');
    expect(model.calls).toHaveLength(3);
    expect(result.steps).toHaveLength(3);
  });

  it('treats tool_use with no tool blocks as a final answer', async () => {
    const model = scriptedModel([{ stop_reason: 'tool_use', content: [text('hello')] }]);
    const result = await runAgent({ firstMessage: 'go', createTurn: model.createTurn, tools: {}, maxTurns: 3 });
    expect(result).toEqual({ ok: true, text: 'hello', steps: [] });
  });

  describe('stopAfter (a "submit answer" tool)', () => {
    it('ends the run right after the tool succeeds, with no extra model call', async () => {
      const model = scriptedModel([
        { stop_reason: 'tool_use', content: [toolUse('a', 'stats')] },
        { stop_reason: 'tool_use', content: [toolUse('b', 'submit', { answer: 1 })] },
        { stop_reason: 'end_turn', content: [text('should never be asked for')] },
      ]);
      const result = await runAgent({
        firstMessage: 'go',
        createTurn: model.createTurn,
        tools: { stats: okTool('read stats'), submit: okTool('submitted') },
        maxTurns: 5,
        stopAfter: 'submit',
      });
      expect(result).toEqual({
        ok: true,
        text: '',
        steps: [
          { tool: 'stats', summary: 'read stats' },
          { tool: 'submit', summary: 'submitted' },
        ],
      });
      expect(model.calls).toHaveLength(2);
    });

    it('lets the model see a rejection and try again; the run only ends on success', async () => {
      let attempts = 0;
      const submit: ToolFn = async () => {
        attempts++;
        return attempts === 1
          ? { data: { error: 'zip 99999 is unknown' }, summary: 'rejected', isError: true }
          : { data: { ok: true }, summary: 'submitted' };
      };
      const model = scriptedModel([
        { stop_reason: 'tool_use', content: [toolUse('a', 'submit', { bad: true })] },
        { stop_reason: 'tool_use', content: [toolUse('b', 'submit', { good: true })] },
      ]);
      const result = await runAgent({ firstMessage: 'go', createTurn: model.createTurn, tools: { submit }, maxTurns: 5, stopAfter: 'submit' });

      const rejection = blocks<{ is_error?: boolean; content: string }>(model.calls[1]![2]!)[0]!;
      expect(rejection.is_error).toBe(true);
      expect(rejection.content).toContain('zip 99999 is unknown');
      expect(result.ok).toBe(true);
      expect(result.steps).toEqual([{ tool: 'submit', summary: 'submitted' }]);
      expect(model.calls).toHaveLength(2);
    });
  });
});
