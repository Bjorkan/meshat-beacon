import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NodeCombobox } from '../../../src/features/routes/NodeCombobox';
import type { NodeSummary } from '../../../src/features/nodes/types';

function nodeSummary(overrides: Partial<NodeSummary> = {}): NodeSummary {
  return {
    id: 'node-a',
    publicKey: 'aabbcc'.padEnd(64, '0'),
    name: 'Alpha',
    nodeType: 2,
    nodeTypeName: 'repeater',
    knownNeighborCount: 0,
    lat: 59.6,
    lng: 16.5,
    iatas: [{ iata: 'ARN', lastHeard: 1 }],
    ...overrides,
  };
}

async function renderSuggestions(nodes: NodeSummary[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['routes-node-suggest', 'alpha'], { items: nodes });
  const onPick = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <div style={{ width: 180 }}>
        <NodeCombobox label="From" value={null} onPick={onPick} onClear={vi.fn()} />
      </div>
    </QueryClientProvider>,
  );
  const input = screen.getByRole('combobox', { name: 'From' });
  fireEvent.change(input, { target: { value: 'Alpha' } });
  const option = await screen.findByRole('option');
  return { input, option, onPick };
}

describe('NodeCombobox', () => {
  it('shows every IATA code as accessible text with bounded wrapping', async () => {
    const codes = ['ARN', 'GOT', 'CPH', 'OSL', 'HEL', 'YYZ', 'YVR'];
    const { option } = await renderSuggestions([
      nodeSummary({ iatas: codes.map((iata) => ({ iata, lastHeard: 1 })) }),
    ]);
    const iatas = within(option).getByText(codes.join(', '));
    expect(iatas).toBeVisible();
    expect(iatas.closest('[aria-hidden="true"]')).toBeNull();
    expect(iatas).toHaveClass('max-w-[40%]', 'whitespace-normal', 'break-words');
    expect(option).toHaveAccessibleName(new RegExp(codes.join(', ')));
    expect(option).not.toHaveTextContent(/\u{1f4cd}|\u{1f6ab}/u);
    expect(within(option).getByText('Alpha')).toBeVisible();
    expect(within(option).getByText('AABBCC')).toBeVisible();
  });

  it('shows an em dash without disabling a located node when IATAs are empty', async () => {
    const { option, onPick } = await renderSuggestions([nodeSummary({ iatas: [] })]);
    expect(within(option).getByText('—')).toBeVisible();
    expect(option).toHaveAttribute('aria-disabled', 'false');
    const button = within(option).getByRole('button');
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onPick).toHaveBeenCalledWith({
      publicKey: 'aabbcc'.padEnd(64, '0'),
      name: 'Alpha',
      nodeType: 2,
      lat: 59.6,
      lng: 16.5,
    });
  });

  it('keeps keyboard selection working with IATA text', async () => {
    const { input, option, onPick } = await renderSuggestions([nodeSummary()]);
    expect(option).toHaveAccessibleName(/ARN/);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alpha', nodeType: 2 }));
  });

  it.each([
    { lat: null, lng: 16.5 },
    { lat: 59.6, lng: null },
    { lat: null, lng: null },
  ])('keeps nodes without coordinates disabled: %j', async (coordinates) => {
    const { input, option, onPick } = await renderSuggestions([nodeSummary(coordinates)]);
    const reason = 'No position — cannot be drawn on the map';
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(option).toHaveAccessibleDescription(reason);
    expect(option).toHaveAccessibleName(/ARN/);
    const button = within(option).getByRole('button');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringContaining(reason));
    fireEvent.click(button);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(reason);
  });
});
