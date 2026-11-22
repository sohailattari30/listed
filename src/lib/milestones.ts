export interface Milestone {
  state: 'done' | 'here' | 'wait';
  title: string;
  sub: string;
  dim: boolean;
}

export function buildMilestones(input: {
  name: string | null;
  totalCalls: number;
  hotLeads: number;
  totalSessions: number;
}): Milestone[] {
  const { totalCalls, hotLeads, totalSessions } = input;
  const first = (input.name || 'Agent').split(' ')[0];
  const plural = (n: number) => (n !== 1 ? 's' : '');

  const firstCalls: Milestone =
    totalSessions > 0
      ? { state: 'done', title: 'First 50 calls', sub: `${totalCalls} total calls · ${totalSessions} session${plural(totalSessions)}`, dim: false }
      : { state: 'here', title: 'First 50 calls', sub: 'Start your session today — attack the day', dim: false };

  const warmLead: Milestone =
    hotLeads > 0
      ? { state: 'done', title: 'First warm lead', sub: `${hotLeads} hot lead${plural(hotLeads)} so far`, dim: false }
      : totalSessions > 0
        ? { state: 'here', title: 'First warm lead', sub: "Keep dialing — they're out there", dim: false }
        : { state: 'wait', title: 'First warm lead', sub: 'Comes after your first session', dim: true };

  return [
    { state: 'done', title: `Welcome, ${first}`, sub: 'Account active', dim: false },
    firstCalls,
    warmLead,
    { state: 'wait', title: 'Listing appointment', sub: '~8–12 warm leads away', dim: true },
    { state: 'wait', title: 'Listing #1 signed', sub: "This is why you're here.", dim: true },
  ];
}
