import { fireEvent, render, screen } from '@testing-library/react';
import { useRouterState, useSearch, useNavigate } from '@tanstack/react-router';
import { TestRouter } from '../../helpers/test-router';
import { validateAnalyticsSearch } from '../../../src/routes/search-contracts';
import { expect, it, vi } from 'vitest';
import { StatsOverview } from '../../../src/features/stats/StatsOverview';

vi.mock('../../../src/features/stats/TrafficTab', () => ({
  TrafficTab: ({ range }: { range: string }) => <p>Traffic range {range}</p>,
}));
vi.mock('../../../src/features/stats/SignalTab', () => ({
  SignalTab: ({ range }: { range: string }) => <p>Signal range {range}</p>,
}));
vi.mock('../../../src/features/stats/PathsTab', () => ({
  PathsTab: ({ range }: { range: string }) => <p>Paths range {range}</p>,
}));
vi.mock('../../../src/features/stats/MeshTab', () => ({ MeshTab: () => <p>Mesh charts</p> }));
vi.mock('../../../src/features/stats/ScopesTab', () => ({ ScopesTab: () => <p>Scope charts</p> }));
function Location() {
  return (
    <output aria-label="Analytics URL">
      {useRouterState({ select: (s) => s.location.searchStr })}
    </output>
  );
}

it('opens Paths & Hashes from a shared URL and retains the region while changing range', async () => {
  render(
    <TestRouter
      routePath="/analytics"
      initialEntry={'/analytics?tab=Analytics&statsTab=paths&range=24h&iata=YOW'}
    >
      <Harness />
      <Location />
    </TestRouter>,
  );
  expect(await screen.findByText('Paths range 24h')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Paths & Hashes' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: '30d' }));
  expect(await screen.findByText('Paths range 30d')).toBeInTheDocument();
  expect(screen.getByLabelText('Analytics URL')).toHaveTextContent('iata=YOW');
});

it('opens Signal from a shared URL and retains regional state when changing range', async () => {
  render(
    <TestRouter
      routePath="/analytics"
      initialEntry={'/analytics?tab=Analytics&statsTab=signal&range=24h&iata=YOW'}
    >
      <Harness />
      <Location />
    </TestRouter>,
  );
  expect(await screen.findByText('Signal range 24h')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'RF / Signal' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: '7d' }));
  expect(await screen.findByText('Signal range 7d')).toBeInTheDocument();
  expect(screen.getByLabelText('Analytics URL')).toHaveTextContent('iata=YOW');
});

it('opens Traffic from a shared URL and keeps unrelated selections when changing the range', async () => {
  render(
    <TestRouter
      routePath="/analytics"
      initialEntry={'/analytics?tab=Analytics&statsTab=traffic&range=24h&observerId=kept'}
    >
      <Harness />
      <Location />
    </TestRouter>,
  );
  expect(await screen.findByText('Traffic range 24h')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Traffic' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '30d' }));
  expect(await screen.findByText('Traffic range 30d')).toBeInTheDocument();
  expect(screen.getByLabelText('Analytics URL')).toHaveTextContent('observerId=kept');
  fireEvent.click(screen.getByRole('button', { name: 'Mesh' }));
  expect(await screen.findByText('Mesh charts')).toBeInTheDocument();
});

it('opens Scopes without a misleading range control and preserves the chosen range for Traffic', async () => {
  render(
    <TestRouter
      routePath="/analytics"
      initialEntry={'/analytics?tab=Analytics&statsTab=scopes&range=30d&iata=YOW'}
    >
      <Harness />
      <Location />
    </TestRouter>,
  );
  expect(await screen.findByText('Scope charts')).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Time range' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Traffic' }));
  expect(await screen.findByText('Traffic range 30d')).toBeInTheDocument();
  expect(screen.getByLabelText('Analytics URL')).toHaveTextContent('iata=YOW');
});

function Harness() {
  const search = useSearch({ strict: false });
  const state = validateAnalyticsSearch(search);
  const navigate = useNavigate();
  return (
    <StatsOverview
      statsTab={state.statsTab ?? 'mesh'}
      range={state.range ?? '24h'}
      observerId={state.observerId ?? null}
      onPatch={(patch) => void navigate({ search: (old) => ({ ...old, ...patch }) })}
    />
  );
}
