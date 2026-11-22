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

const renderCard = (callCount: number | undefined = 40) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CoachCard callCount={callCount} />
    </QueryClientProvider>,
  );

const first = {
  text: 'Solid week.\n- Hot rate is 4%.\n- 10-19 year owners convert best.\nToday: start with long-term owners.',
  steps: [{ tool: 'get_overall_stats', summary: '212 calls logged: 9 hot, 61 voicemail, 142 not interested' }],
};
const second = { text: 'Even better now.\n- Hot rate is 5%.\nToday: keep going.', steps: [] };

beforeEach(() => {
  localStorage.clear();
  mocks.fetchCoach.mockReset();
});

describe('CoachCard', () => {
  it('asks the agent on demand and shows the answer plus the steps it took', async () => {
    const user = userEvent.setup();
    mocks.fetchCoach.mockResolvedValue(first);
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Analyze my calls' }));
    expect(await screen.findByText('Solid week.')).toBeInTheDocument();
    expect(screen.getByText('Hot rate is 4%.')).toBeInTheDocument();
    expect(screen.getByText('Today: start with long-term owners.')).toBeInTheDocument();
    expect(screen.getByText('What the coach checked')).toBeInTheDocument();
    expect(screen.getByText(/212 calls logged/)).toBeInTheDocument();
  });

  it('remembers the answer for the day, even in a new tab, so it does not pay for a second run', async () => {
    const user = userEvent.setup();
    mocks.fetchCoach.mockResolvedValue(first);
    const view = renderCard();
    await user.click(screen.getByRole('button', { name: 'Analyze my calls' }));
    await screen.findByText('Solid week.');
    view.unmount();

    renderCard();
    expect(screen.getByText('Solid week.')).toBeInTheDocument();
    expect(mocks.fetchCoach).toHaveBeenCalledTimes(1);
  });

  it('can be hidden down to the headline, and remembers that choice', async () => {
    const user = userEvent.setup();
    mocks.fetchCoach.mockResolvedValue(first);
    const view = renderCard();
    await user.click(screen.getByRole('button', { name: 'Analyze my calls' }));
    await screen.findByText('Solid week.');

    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.getByText('Solid week.')).toBeInTheDocument();
    expect(screen.queryByText('Hot rate is 4%.')).not.toBeInTheDocument();
    expect(screen.queryByText('What the coach checked')).not.toBeInTheDocument();

    view.unmount();
    renderCard();
    expect(screen.queryByText('Hot rate is 4%.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText('Hot rate is 4%.')).toBeInTheDocument();
  });

  it('refreshes on demand and replaces the old answer', async () => {
    const user = userEvent.setup();
    mocks.fetchCoach.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Analyze my calls' }));
    await screen.findByText('Solid week.');

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Even better now.')).toBeInTheDocument();
    expect(screen.queryByText('Solid week.')).not.toBeInTheDocument();
    expect(mocks.fetchCoach).toHaveBeenCalledTimes(2);
  });

  it('says so when you have logged calls since it was written', async () => {
    const user = userEvent.setup();
    mocks.fetchCoach.mockResolvedValue(first);
    const view = renderCard(40);
    await user.click(screen.getByRole('button', { name: 'Analyze my calls' }));
    await screen.findByText('Solid week.');
    expect(screen.getByText(/^Updated /)).toBeInTheDocument();
    view.unmount();

    renderCard(90);
    expect(screen.getByText(/You've logged calls since this was written/)).toBeInTheDocument();
  });

  it('keeps the old answer visible if a refresh fails', async () => {
    const user = userEvent.setup();
    mocks.fetchCoach.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('The AI is busy. Try again in a minute.'));
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Analyze my calls' }));
    await screen.findByText('Solid week.');
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The AI is busy');
    expect(screen.getByText('Solid week.')).toBeInTheDocument();
  });

  it('shows the error and offers a retry when the first run fails', async () => {
    const user = userEvent.setup();
    mocks.fetchCoach.mockRejectedValueOnce(new Error('The coach took too many steps. Try again.'));
    renderCard();
    await user.click(screen.getByRole('button', { name: 'Analyze my calls' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('too many steps');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });
});
