import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { MeshTab } from '../../../src/features/stats/MeshTab';

vi.mock('../../../src/features/stats/useStats', () => ({
  useStatsOverview: () => ({}),
  useStatsObservations: () => ({}),
  usePayloadBreakdown: () => ({}),
  useTopNodes: () => ({}),
  useTopObservers: () => ({}),
  useRadioPresets: () => ({}),
  useNodeTypes: () => ({}),
  useScopes: () => ({
    data: [
      { name: 'Alpha', packetCount: 12, observerCount: 2, nodeCount: 10 },
      { name: 'Beta', packetCount: 15, observerCount: 15, nodeCount: 0 },
      { name: 'Gamma', packetCount: 1, observerCount: 30, nodeCount: 3 },
    ],
  }),
}));
vi.mock('../../../src/features/stats/cards', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChartCard: () => null,
  StatCard: () => null,
}));
vi.mock('../../../src/features/stats/chartOptions', () => ({
  observationsAreaOption: () => ({}),
  leaderboardOption: () => ({}),
  typeBarOption: () => ({}),
  donutOption: () => ({}),
  presetBarsOption: () => ({}),
}));
vi.mock('../../../src/components/DataTable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/components/DataTable')>();
  return {
    ...actual,
    DataTable: (props: Parameters<typeof actual.DataTable>[0]) => (
      <actual.DataTable
        {...props}
        columns={props.columns.map((column) => ({ ...column, header: `Renamed ${column.header}` }))}
      />
    ),
  };
});
afterEach(() => vi.restoreAllMocks());

it('sorts scope counts descending and names ascending independently of headers', () => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  const { container } = render(
    <MeshTab range="24h" onRangeChange={vi.fn()} onSelectObserver={vi.fn()} />,
  );
  const choices: [string, string[]][] = [
    ['Most packets', ['Beta', 'Alpha', 'Gamma']],
    ['Most observers', ['Gamma', 'Beta', 'Alpha']],
    ['Most nodes', ['Alpha', 'Gamma', 'Beta']],
    ['Scope A–Z', ['Alpha', 'Beta', 'Gamma']],
  ];
  const names = () =>
    [...container.querySelectorAll('dd')].flatMap((cell) =>
      ['Alpha', 'Beta', 'Gamma'].filter((name) => cell.textContent?.includes(name)),
    );
  expect(names()).toEqual(['Beta', 'Alpha', 'Gamma']);
  expect(
    within(screen.getByLabelText('Sort'))
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(choices.map(([label]) => label));
  expect(screen.getByRole('button', { name: 'Most packets' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const [label, order] of choices) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(names()).toEqual(order);
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  }
});
