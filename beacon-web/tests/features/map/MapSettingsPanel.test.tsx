import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MapSettingsPanel } from '../../../src/features/map/MapSettingsPanel';
import { getMeshCoreRegions } from '../../../src/api/client';

vi.mock('../../../src/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/api/client')>();
  return { ...actual, getMeshCoreRegions: vi.fn(() => Promise.resolve([])) };
});

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
  meshcoreRegion: '',
  onMeshcoreRegionChange: vi.fn(),
  buildShareParams: () => ({}),
};

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function renderPanel(ui: React.ReactElement) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

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
  vi.clearAllMocks();
  vi.mocked(getMeshCoreRegions).mockResolvedValue([]);
});

afterEach(() => vi.unstubAllGlobals());

describe('MapSettingsPanel', () => {
  it('starts collapsed even with a legacy open preference and indicates active filters', () => {
    renderPanel(<MapSettingsPanel {...baseProps} typeFilter="repeater" meshcoreRegion="se" />);
    const trigger = screen.getByRole('button', { name: 'Map settings' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('2');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('switch', { name: 'IATA borders' })).toBeChecked();
  });

  it('shows clustering as paused during Live and restores the saved preference afterward', () => {
    const { rerender } = renderPanel(<MapSettingsPanel {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Map settings' }));
    expect(screen.getByRole('switch', { name: 'Group nodes' })).toBeChecked();

    rerender(
      <QueryClientProvider client={client}>
        <MapSettingsPanel {...baseProps} liveMode />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Paused during live traffic.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Group nodes' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Group nodes' })).toBeDisabled();
    expect(baseProps.onClusteredChange).not.toHaveBeenCalled();

    rerender(
      <QueryClientProvider client={client}>
        <MapSettingsPanel {...baseProps} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('switch', { name: 'Group nodes' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Group nodes' })).toBeEnabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Group nodes' }));
    expect(baseProps.onClusteredChange).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('switch', { name: 'IATA borders' }));
    expect(baseProps.onBordersChange).toHaveBeenCalledWith(false);
  });
  it('explains that Live suppresses only the ambient neighbor mesh', () => {
    const { rerender } = renderPanel(
      <MapSettingsPanel {...baseProps} liveMode neighborLines="on" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Map settings' }));
    expect(screen.getByText(/Live traffic shows only the selected node/i)).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={client}>
        <MapSettingsPanel {...baseProps} liveMode neighborLines="off" />
      </QueryClientProvider>,
    );
    expect(
      screen.queryByText(/Live traffic shows only the selected node/i),
    ).not.toBeInTheDocument();
  });
});
