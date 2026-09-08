import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PacketRow } from '../../../src/features/packets/PacketRow';
import type { PacketSummary } from '../../../src/types/api';

const packet: PacketSummary = {
  packetHash: 'AA11BB22',
  payloadType: 1,
  payloadTypeName: 'ADVERT',
  routeType: 1,
  routeTypeName: 'FLOOD',
  firstHeardAt: 1700000000,
  lastHeardAt: 1700000000,
  observationCount: 3,
};

describe('PacketRow', () => {
  it('uses a native disclosure button and lets the whole card toggle it', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<PacketRow packet={packet} expanded={false} onToggle={onToggle} />);
    const button = screen.getByRole('button');
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-pressed');
    fireEvent.click(screen.getByText('×3'));
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<PacketRow packet={packet} expanded onToggle={onToggle} />);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'packet-expansion-AA11BB22');
  });
});
