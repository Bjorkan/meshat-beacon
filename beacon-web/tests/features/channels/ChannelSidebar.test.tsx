import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChannelSidebar } from '../../../src/features/channels/ChannelSidebar';
import type { ChannelKind, ChannelSummary } from '../../../src/features/channels/types';

function channel(id: number, kind: ChannelKind): ChannelSummary {
  return {
    id,
    name: kind === 'hashtag' ? '#mesh' : kind,
    channelHash: String(id),
    lastSeen: 0,
    keyKnown: kind !== 'unknown',
    kind,
  };
}

describe('ChannelSidebar', () => {
  it('renders exactly one semantic badge for every channel kind', () => {
    render(
      <ChannelSidebar
        channels={[
          channel(1, 'public'),
          channel(2, 'private'),
          channel(3, 'hashtag'),
          channel(4, 'unknown'),
        ]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    expect(screen.getAllByText(/^(Public|Private|Hashtag|No key)$/)).toHaveLength(4);
    expect(screen.queryByText('Key')).not.toBeInTheDocument();
  });

  it('keeps row selection behavior unchanged', () => {
    const onSelect = vi.fn();
    render(
      <ChannelSidebar channels={[channel(7, 'private')]} selectedId={null} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith(7);
  });
});

it.each([0, 1, 57, 150])('renders one non-selectable summary for %i unknown channels', (count) => {
  render(
    <ChannelSidebar
      channels={[channel(1, 'public')]}
      unknownCount={count}
      selectedId={null}
      onSelect={() => {}}
    />,
  );
  expect(screen.getAllByRole('button')).toHaveLength(1);
  if (count === 0) expect(screen.queryByRole('status')).not.toBeInTheDocument();
  else
    expect(screen.getByRole('status')).toHaveTextContent(
      `${count} additional channel${count === 1 ? '' : 's'} cannot be decrypted`,
    );
});
