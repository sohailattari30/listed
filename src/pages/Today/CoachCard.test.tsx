import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ fetchCoach: vi.fn() }));
vi.mock('../../lib/ai', async () => {
  const { z } = await import('zod');
  return {
    fetchCoach: mocks.fetchCoach,
    CoachSchema: z.object({ text: z.string(), steps: z.array(z.object({ tool: z.string(), summary: z.string() })) }),
  };
});

import { CoachCard } from './CoachCard';

const renderCard = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CoachCard />
    </QueryClientProvider>,
  );

const result = {
  text: 'Solid week.\n- Hot rate is 4%.\n- 10-19 year owners convert best.\nToday: start with long-term owners.',
  steps: [{ tool: 'get_overall_stats', summary: '212 calls logged: 9 hot, 61 voicemail, 142 not interested' }],
};

beforeEach(() => {
  sessionStorage.clear();
  mocks.fetchCoach.mockReset();
});

describe('CoachCard', () => {
  it('asks the agent on demand and shows the answer plus the steps it took', async () => {
    const user = userEvent.setup();
    mocks.fetchCoach.mockResolvedValue(result);
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Analyze my calls' }));
    expect(await screen.findByText('Solid week.')).toBeInTheDocument();
    expect(screen.getByText('Hot rate is 4%.')).toBeInTheDocument();
    expect(screen.getByText('Today: start with long-term owners.')).toBeInTheDocument();
    expect(screen.getByText('What the coach checked')).toBeInTheDocument();
    expect(screen.getByText(/212 calls logged/)).toBeInTheDocument();
  });

  it('caches the answer for the rest of the day so it does not pay for a second run', async () => {
    const user = userEvent.setup();
    mocks.fetchCoach.mockResolvedValue(result);
    const first = renderCard();
    await user.click(screen.getByRole('button', { name: 'Analyze my calls' }));
    await screen.findByText('Solid week.');
    first.unmount();

    renderCard();
    expect(screen.getByText('Solid week.')).toBeInTheDocument();
    expect(mocks.fetchCoach).toHaveBeenCalledTimes(1);
  });

  it('shows the error and offers a retry', async () => {
    const user = userEvent.setup();
    mocks.fetchCoach.mockRejectedValueOnce(new Error('The coach took too many steps. Try again.'));
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Analyze my calls' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('too many steps');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });
});
