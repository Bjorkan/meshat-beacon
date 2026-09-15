import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
  vi.mocked(getMeshCoreRegions).mockResolvedValue([]);
});

afterEach(() => vi.unstubAllGlobals());

describe('MapSettingsPanel Live presentation', () => {
  it('explains that Live temporarily overrides visual clustering without changing the saved preference', () => {
    const { rerender } = renderPanel(<MapSettingsPanel {...baseProps} />);
    expect(screen.queryByText(/Live shows every node/i)).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={client}>
        <MapSettingsPanel {...baseProps} liveMode />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/Live shows every node as an individual dot/i)).toBeInTheDocument();

    const clustering = screen.getByRole('group', { name: 'Clustering' });
    expect(within(clustering).getByRole('button', { name: 'On' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('explains that Live suppresses only the ambient neighbor mesh', () => {
    const { rerender } = renderPanel(
      <MapSettingsPanel {...baseProps} liveMode neighborLines="on" />,
    );
    expect(screen.getByText(/Live hides the ambient neighbor mesh/i)).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={client}>
        <MapSettingsPanel {...baseProps} liveMode neighborLines="off" />
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/Live hides the ambient neighbor mesh/i)).not.toBeInTheDocument();
  });
});
