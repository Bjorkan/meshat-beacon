import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { TalkersTab } from '../../../src/features/stats/TalkersTab';

vi.mock('../../../src/features/stats/useStats', () => ({
  useTopAdvertisers: () => ({
    data: [
      {
        nodeId: 'a',
        nodeName: 'Alpha',
        nodeTypeName: 'repeater',
        advertCount: 12,
        floodAdvertCount: 2,
        directAdvertCount: 10,
      },
      {
        nodeId: 'b',
        nodeName: 'Beta',
        nodeTypeName: 'repeater',
        advertCount: 15,
        floodAdvertCount: 15,
        directAdvertCount: 0,
      },
    ],
  }),
  useTopTalkers: () => ({ data: [] }),
}));
vi.mock('../../../src/features/stats/cards', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChartCard: () => null,
}));
vi.mock('../../../src/features/stats/chartOptions', () => ({ leaderboardOption: () => ({}) }));
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

it('sorts totals, flood, direct and names independently of visible column headers', () => {
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
  const { container } = render(<TalkersTab range="24h" />);
  const bar = screen.getByLabelText('Sort');
  const choices: [string, string[]][] = [
    ['Most adverts', ['Beta', 'Alpha']],
    ['Most flood adverts', ['Beta', 'Alpha']],
    ['Most direct adverts', ['Alpha', 'Beta']],
    ['Name A–Z', ['Alpha', 'Beta']],
  ];
  const names = () =>
    [...container.querySelectorAll('dd')].flatMap((cell) =>
      ['Alpha', 'Beta'].filter((name) => cell.textContent?.includes(name)),
    );
  expect(names()).toEqual(['Beta', 'Alpha']);
  expect(
    within(bar)
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(choices.map(([label]) => label));
  expect(screen.getByRole('button', { name: 'Most adverts' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.queryByText(/Renamed Total adverts/)).toBeNull();
  for (const [label, order] of choices) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(names()).toEqual(order);
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  }
});
