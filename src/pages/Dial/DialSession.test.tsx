import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  insertCall: vi.fn(),
  insertSession: vi.fn(),
  fetchBriefing: vi.fn(),
}));
vi.mock('../../lib/api', () => ({ insertCall: mocks.insertCall, insertSession: mocks.insertSession }));
vi.mock('../../lib/ai', () => ({ fetchBriefing: mocks.fetchBriefing }));

import type { HomeownerRow } from '../../lib/database.types';
import { freshQueue, loadSnapshot, saveSnapshot } from '../../lib/queue';
import { DialSession } from './DialSession';

const homeowners: HomeownerRow[] = [
  { id: 1, address: '11 Oak St, Fremont, CA', owner_name: 'Ann Lee', years_owned: 12, zip: '94536' },
  { id: 2, address: '22 Elm St, Fremont, CA', owner_name: 'Bob Ray', years_owned: 3, zip: '94536' },
  { id: 3, address: '33 Pine St, Fremont, CA', owner_name: 'Cy Day', years_owned: 25, zip: '94536' },
];

function renderSession(calls: { homeowner_id: number; outcome: 'sell' | 'vm' | 'no' | 'skip' }[] = []) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <DialSession userId="u1" zip="94536" city="Fremont, CA" homeowners={homeowners} calls={calls} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const currentStreet = () => screen.getByText(/\d+ (Oak|Elm|Pine) St/).textContent ?? '';
const idForStreet = (street: string) => homeowners.find((h) => h.address.startsWith(street))!.id;

beforeEach(() => {
  localStorage.clear();
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.insertCall.mockResolvedValue(undefined);
  mocks.insertSession.mockResolvedValue(undefined);
});

describe('DialSession', () => {
  it('logs a call, advances, and shows progress', async () => {
    const user = userEvent.setup();
    renderSession();
    expect(screen.getByText('Call 1 of 3')).toBeInTheDocument();
    const first = currentStreet();

    await user.click(screen.getByRole('button', { name: /Voicemail/ }));
    expect(mocks.insertCall).toHaveBeenCalledWith('u1', idForStreet(first), 'vm');
    expect(await screen.findByText('Call 2 of 3')).toBeInTheDocument();
    expect(currentStreet()).not.toBe(first);
  });

  it('can step back to the previous homeowner', async () => {
    const user = userEvent.setup();
    renderSession();
    const first = currentStreet();
    await user.click(screen.getByRole('button', { name: /Not interested/ }));
    await screen.findByText('Call 2 of 3');
    await user.click(screen.getByRole('button', { name: /Previous/ }));
    expect(screen.getByText('Call 1 of 3')).toBeInTheDocument();
    expect(currentStreet()).toBe(first);
  });

  it('does not advance when the call fails to save, and says so', async () => {
    const user = userEvent.setup();
    mocks.insertCall.mockRejectedValueOnce(new Error('offline'));
    renderSession();
    await user.click(screen.getByRole('button', { name: /Wants to sell/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save that call");
    expect(screen.getByText('Call 1 of 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Wants to sell/ }));
    expect(await screen.findByText('Call 2 of 3')).toBeInTheDocument();
  });

  it('finishes the queue: summary, hot leads, and one session row', async () => {
    const user = userEvent.setup();
    renderSession();
    await user.click(screen.getByRole('button', { name: /Wants to sell/ }));
    await screen.findByText('Call 2 of 3');
    await user.click(screen.getByRole('button', { name: /Voicemail/ }));
    await screen.findByText('Call 3 of 3');
    await user.click(screen.getByRole('button', { name: /Not interested/ }));

    expect(await screen.findByText(/Your territory knows you now/)).toBeInTheDocument();
    expect(screen.getByText('Hot leads from today')).toBeInTheDocument();
    expect(mocks.insertSession).toHaveBeenCalledTimes(1);
    expect(mocks.insertSession).toHaveBeenCalledWith('u1', 3, 1);
    expect(localStorage.getItem('listed_session')).toBeNull();
  });

  it('resumes where you left off after a refresh', () => {
    const base = freshQueue(homeowners, '94536');
    saveSnapshot(localStorage, { ...base, cur: 2, vms: 2 });
    renderSession();
    expect(screen.getByText('Call 3 of 3')).toBeInTheDocument();
  });

  it('persists progress as you go', async () => {
    const user = userEvent.setup();
    renderSession();
    await user.click(screen.getByRole('button', { name: /Skip this number/ }));
    await screen.findByText('Call 2 of 3');
    expect(loadSnapshot(localStorage)).toMatchObject({ cur: 1 });
  });

  it('shows earlier call history for the homeowner', () => {
    const first = freshQueue(homeowners, '94536').owners[0]!;
    renderSession([{ homeowner_id: first.id as number, outcome: 'sell' }]);
    expect(screen.getByText('Called 1x · Previously interested')).toBeInTheDocument();
  });

  it('fetches a briefing only when asked, and shows it', async () => {
    const user = userEvent.setup();
    mocks.fetchBriefing.mockResolvedValue({
      opener: 'Hi, this is Alex.',
      angle: 'Long-term owner.',
      objections: [{ objection: 'Not selling', response: 'No problem.' }],
    });
    renderSession();
    expect(mocks.fetchBriefing).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Get call briefing/ }));
    expect(await screen.findByText('Hi, this is Alex.')).toBeInTheDocument();
    expect(mocks.fetchBriefing).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Not selling')).toBeInTheDocument();
  });

  it('shows a briefing error with a retry button', async () => {
    const user = userEvent.setup();
    mocks.fetchBriefing.mockRejectedValueOnce(new Error('AI is not configured yet.'));
    renderSession();
    await user.click(screen.getByRole('button', { name: /Get call briefing/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('AI is not configured yet.');
    await waitFor(() => expect(screen.getByRole('button', { name: /Try briefing again/ })).toBeEnabled());
  });
});
