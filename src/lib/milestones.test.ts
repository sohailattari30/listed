import { describe, expect, it } from 'vitest';
import { buildMilestones } from './milestones';

const states = (input: Parameters<typeof buildMilestones>[0]) => buildMilestones(input).map((m) => m.state);

describe('buildMilestones', () => {
  it('starts a new user at "first 50 calls"', () => {
    const m = buildMilestones({ name: 'Alex Johnson', totalCalls: 0, hotLeads: 0, totalSessions: 0 });
    expect(m[0]).toMatchObject({ title: 'Welcome, Alex', state: 'done' });
    expect(states({ name: 'x', totalCalls: 0, hotLeads: 0, totalSessions: 0 })).toEqual(['done', 'here', 'wait', 'wait', 'wait']);
    expect(m[2]).toMatchObject({ dim: true, sub: 'Comes after your first session' });
  });

  it('moves to "first warm lead" after a session with no hot leads', () => {
    expect(states({ name: 'x', totalCalls: 50, hotLeads: 0, totalSessions: 1 })).toEqual(['done', 'done', 'here', 'wait', 'wait']);
  });

  it('pluralises sessions and leads', () => {
    const one = buildMilestones({ name: 'x', totalCalls: 50, hotLeads: 1, totalSessions: 1 });
    expect(one[1]?.sub).toBe('50 total calls · 1 session');
    expect(one[2]?.sub).toBe('1 hot lead so far');
    const many = buildMilestones({ name: 'x', totalCalls: 150, hotLeads: 4, totalSessions: 3 });
    expect(many[1]?.sub).toBe('150 total calls · 3 sessions');
    expect(many[2]?.sub).toBe('4 hot leads so far');
  });

  it('falls back to "Agent" when there is no name', () => {
    expect(buildMilestones({ name: null, totalCalls: 0, hotLeads: 0, totalSessions: 0 })[0]?.title).toBe('Welcome, Agent');
  });
});
