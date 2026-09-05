import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MapSettingsPanel } from '../../../src/features/map/MapSettingsPanel';

const baseProps = {
  typeFilter: '',
  onTypeChange: vi.fn(),
  clustered: true,
  onClusteredChange: vi.fn(),
  liveMode: false,
  neighborLines: 'selected' as const,
  onNeighborLinesChange: vi.fn(),
  borders: true,
  onBordersChange: vi.fn(),
  coverage: 'off' as const,
  onCoverageChange: vi.fn(),
  coverageAvailable: true,
  buildShareParams: () => ({}),
};

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  });
  localStorage.clear();
  localStorage.setItem('beacon-map-settings-open', 'true');
});

afterEach(() => vi.unstubAllGlobals());

describe('MapSettingsPanel Live presentation', () => {
  it('explains that Live temporarily overrides visual clustering without changing the saved preference', () => {
    const { rerender } = render(<MapSettingsPanel {...baseProps} />);
    expect(screen.queryByText(/Live shows every node/i)).not.toBeInTheDocument();

    rerender(<MapSettingsPanel {...baseProps} liveMode />);
    expect(screen.getByText(/Live shows every node as an individual dot/i)).toBeInTheDocument();

    const clustering = screen.getByRole('group', { name: 'Clustering' });
    expect(within(clustering).getByRole('button', { name: 'On' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('explains that Live suppresses only the ambient neighbor mesh', () => {
    const { rerender } = render(<MapSettingsPanel {...baseProps} liveMode neighborLines="on" />);
    expect(screen.getByText(/Live hides the ambient neighbor mesh/i)).toBeInTheDocument();

    rerender(<MapSettingsPanel {...baseProps} liveMode neighborLines="off" />);
    expect(screen.queryByText(/Live hides the ambient neighbor mesh/i)).not.toBeInTheDocument();
  });
});

describe('MapSettingsPanel coverage', () => {
  it('offers off/quality/ping-age choices and reports the selection', () => {
    const onCoverageChange = vi.fn();
    render(<MapSettingsPanel {...baseProps} onCoverageChange={onCoverageChange} />);
    const group = screen.getByRole('group', { name: 'Coverage' });
    fireEvent.click(within(group).getByRole('button', { name: 'Quality' }));
    expect(onCoverageChange).toHaveBeenCalledWith('effective');
  });

  it('notes when no coverage key is configured', () => {
    render(<MapSettingsPanel {...baseProps} coverageAvailable={false} />);
    expect(screen.getByText(/No coverage key configured/i)).toBeInTheDocument();
  });
});
