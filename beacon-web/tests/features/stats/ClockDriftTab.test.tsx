import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ClockDriftTab } from '../../../src/features/stats/ClockDriftTab';

vi.mock('../../../src/features/stats/useStats', () => ({
  useClockDrift: () => ({
    data: [
      {
        nodeId: 'a',
        nodeName: 'Alpha',
        nodeTypeName: 'repeater',
        clockDriftSeconds: 600,
        clockCheckedAt: 3000,
      },
      {
        nodeId: 'b',
        nodeName: 'Beta',
        nodeTypeName: 'repeater',
        clockDriftSeconds: -3600,
        clockCheckedAt: 2000,
      },
      {
        nodeId: 'c',
        nodeName: 'Gamma',
        nodeTypeName: 'repeater',
        clockDriftSeconds: 1200,
        clockCheckedAt: 4000,
      },
    ],
  }),
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

it('keeps magnitude and freshness sort actions independent of display headers', () => {
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
  const { container } = render(<ClockDriftTab />);
  const choices: [string, string[]][] = [
    ['Largest drift', ['Beta', 'Gamma', 'Alpha']],
    ['Smallest drift', ['Alpha', 'Gamma', 'Beta']],
    ['Recently checked', ['Gamma', 'Alpha', 'Beta']],
    ['Oldest checked', ['Beta', 'Alpha', 'Gamma']],
  ];
  const names = () =>
    [...container.querySelectorAll('dd')].flatMap((cell) =>
      ['Alpha', 'Beta', 'Gamma'].filter((name) => cell.textContent?.includes(name)),
    );
  expect(names()).toEqual(['Beta', 'Gamma', 'Alpha']);
  expect(
    within(screen.getByLabelText('Sort'))
      .getAllByRole('button')
      .map((button) => button.textContent),
  ).toEqual(choices.map(([label]) => label));
  expect(screen.getByRole('button', { name: 'Largest drift' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const [label, order] of choices) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(names()).toEqual(order);
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  }
});
