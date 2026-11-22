import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ fetchMarkets: vi.fn(), fetchAdvisor: vi.fn() }));
vi.mock('../../lib/markets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/markets')>()),
  fetchMarkets: mocks.fetchMarkets,
  fetchAdvisor: mocks.fetchAdvisor,
}));

import type { ZipView } from '../../lib/markets';
import { Markets } from './Markets';

const zip = (over: Partial<ZipView>): ZipView => ({
  zip: '94536', city: 'Fremont', county: 'Alameda', callable: true, listing_likelihood_score: 72, median_list_price: 1_345_800,
  active_listings: 75, pending_sales_last_3_months: 99, pending_sales_yoy_pct: 6.5, new_listings_yoy_pct: 2, sell_through_pct: 41,
  days_on_market: 37, price_reduced_pct: 10.5, home_value: 1_361_462, home_value_yoy_pct: -1, home_value_3mo_pct: -0.4,
  value_trend: 'falling', small_sample: false, homeowners_in_app: 120, owners_10plus_years_pct: 58, my_conversations: 40, my_hot_lead_pct: 5,
  ...over,
});

const sources = { realtor: 'Oct 2026', zillow: 'Oct 2026' };
const marketsData = {
  as_of: sources,
  sources: { realtor: 'Realtor.com Economic Research', zillow: 'Zillow Research ZHVI' },
  your_markets: [zip({}), zip({ zip: '94587', city: 'Union City', listing_likelihood_score: 55, value_trend: 'cooling' })],
  hottest: [zip({ zip: '94539', city: 'Fremont', callable: false, sell_through_pct: 57.1, small_sample: true })],
  falling: [zip({ zip: '94587', city: 'Union City', home_value_yoy_pct: -1.5, value_trend: 'falling', small_sample: true })],
  unmatched_calls: 0,
};

const advisorData = {
  analysis: {
    summary: 'Call 94536 first: fast sales and long-tenured owners.',
    selling_most: [{ zip: '94539', city: 'Fremont', why: '24 pending sales, sell-through 57%.' }],
    going_down: [{ zip: '94587', city: 'Union City', why: 'Values down 1.5% over 12 months.' }],
    recommendations: [
      { zip: '94536', city: 'Fremont', action: 'call_now' as const, reason: 'Pending sales up 6.5% and 58% of owners are 10+ years.' },
      { zip: '94587', city: 'Union City', action: 'watch' as const, reason: 'Cooling; sales are slowing.' },
    ],
    expansion_ideas: [{ zip: '94539', city: 'Fremont', why: 'Hottest zip, no homeowner data yet.' }],
    caveats: ['Pending sales stand in for closed sales.'],
  },
  steps: [{ tool: 'rank_zips', summary: 'Ranked zips by sales volume' }],
  as_of: sources,
  sources,
};

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Markets />
    </QueryClientProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  mocks.fetchMarkets.mockReset().mockResolvedValue(marketsData);
  mocks.fetchAdvisor.mockReset();
});

describe('Markets page: the free data', () => {
  it('shows your markets, the hottest zips, and falling values, with the data date', async () => {
    renderPage();
    expect(await screen.findByText('Bay Area housing data · Oct 2026')).toBeInTheDocument();

    const mine = within(screen.getByText('Your markets').closest('section')!);
    expect(mine.getByText('94536 · Fremont')).toBeInTheDocument();
    expect(mine.getByText('72')).toBeInTheDocument();
    expect(mine.getByText('Cooling')).toBeInTheDocument();

    const hot = within(screen.getByText('Selling fastest in the Bay Area').closest('section')!);
    expect(hot.getByText('94539 · Fremont')).toBeInTheDocument();
    expect(hot.getByText('57%')).toBeInTheDocument();
    expect(hot.getByText('Small sample')).toBeInTheDocument();
    expect(hot.queryByText('In your app')).not.toBeInTheDocument();

    const falling = within(screen.getByText('Home values falling').closest('section')!);
    expect(falling.getByText('-1.5%')).toBeInTheDocument();
    // The small-sample flag is about listing counts, so it is not shown next to Zillow value changes.
    expect(falling.queryByText('Small sample')).not.toBeInTheDocument();
  });

  it('explains how "selling" is measured and that the score is a heuristic', async () => {
    renderPage();
    expect(await screen.findByText(/stand-in for closed sales/)).toBeInTheDocument();
    expect(screen.getByText(/not a prediction/)).toBeInTheDocument();
  });

  it('says so when none of your homeowners match the market data', async () => {
    mocks.fetchMarkets.mockResolvedValue({ ...marketsData, your_markets: [] });
    renderPage();
    expect(await screen.findByText(/No homeowner data in your app matches/)).toBeInTheDocument();
  });

  it('shows an error if the data cannot load', async () => {
    mocks.fetchMarkets.mockRejectedValue(new Error('Please sign in again.'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Please sign in again.');
  });
});

describe('Markets page: the AI analyst', () => {
  it('runs on demand and shows ranked recommendations, the evidence, and what it checked', async () => {
    const user = userEvent.setup();
    mocks.fetchAdvisor.mockResolvedValue(advisorData);
    renderPage();
    expect(mocks.fetchAdvisor).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: 'Analyze markets' }));
    expect(await screen.findByText(/Call 94536 first/)).toBeInTheDocument();
    expect(screen.getByText('Call now')).toBeInTheDocument();
    expect(screen.getByText('Watch')).toBeInTheDocument();
    expect(screen.getByText('Selling the most homes')).toBeInTheDocument();
    expect(screen.getByText('Going down')).toBeInTheDocument();
    expect(screen.getByText('Worth adding next')).toBeInTheDocument();
    expect(screen.getByText('Keep in mind')).toBeInTheDocument();
    expect(screen.getByText('Ranked zips by sales volume')).toBeInTheDocument();
    expect(screen.getByText(/Realtor.com Oct 2026 · Zillow Oct 2026/)).toBeInTheDocument();
  });

  it('keeps today\'s analysis, so reopening the page does not pay for another run', async () => {
    const user = userEvent.setup();
    mocks.fetchAdvisor.mockResolvedValue(advisorData);
    const first = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Analyze markets' }));
    await screen.findByText(/Call 94536 first/);
    first.unmount();

    renderPage();
    expect(screen.getByText(/Call 94536 first/)).toBeInTheDocument();
    expect(mocks.fetchAdvisor).toHaveBeenCalledTimes(1);
  });

  it('can be run again to replace the analysis', async () => {
    const user = userEvent.setup();
    mocks.fetchAdvisor
      .mockResolvedValueOnce(advisorData)
      .mockResolvedValueOnce({ ...advisorData, analysis: { ...advisorData.analysis, summary: 'Updated: call 94587 first.' } });
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Analyze markets' }));
    await screen.findByText(/Call 94536 first/);
    await user.click(screen.getByRole('button', { name: 'Run again' }));
    expect(await screen.findByText(/Updated: call 94587 first/)).toBeInTheDocument();
    expect(screen.queryByText(/Call 94536 first/)).not.toBeInTheDocument();
  });

  it('shows the error and offers a retry, and keeps the old analysis if a re-run fails', async () => {
    const user = userEvent.setup();
    mocks.fetchAdvisor.mockRejectedValueOnce(new Error('The analyst took too many steps. Try again.'));
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Analyze markets' }));
    expect(await screen.findByText(/too many steps/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();

    mocks.fetchAdvisor.mockResolvedValueOnce(advisorData).mockRejectedValueOnce(new Error('The AI is busy. Try again in a minute.'));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/Call 94536 first/);
    await user.click(screen.getByRole('button', { name: 'Run again' }));
    expect(await screen.findByText(/The AI is busy/)).toBeInTheDocument();
    expect(screen.getByText(/Call 94536 first/)).toBeInTheDocument();
  });
});
