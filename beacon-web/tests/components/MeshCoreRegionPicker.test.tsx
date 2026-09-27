import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MeshCoreRegionPicker } from '../../src/components/MeshCoreRegionPicker';
import { meshcoreRegionQueries } from '../../src/api/queries';

const regions = [
  { token: 'se', displayName: 'Sverige', nodeCount: 0 },
  { token: 'se06', displayName: 'Jönköpings län', parentToken: 'se', nodeCount: 0 },
  { token: 'se0680', displayName: 'Jönköpings kommun', parentToken: 'se06', nodeCount: 0 },
  { token: 'se0682', displayName: 'Nässjö kommun', parentToken: 'se06', nodeCount: 0 },
  { token: 'offgrid', displayName: 'Offgrid', nodeCount: 0 },
];

function setup({ selected = [] as string[], multiple = false } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(meshcoreRegionQueries.all(), regions);
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MeshCoreRegionPicker
        label="MeshCore region"
        options={regions.map((r) => ({
          value: r.token,
          label: r.token,
        }))}
        selected={selected}
        onChange={onChange}
        multiple={multiple}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'MeshCore region' }));
  return onChange;
}

describe('MeshCoreRegionPicker', () => {
  it('browses country, county and municipality without changing the filter on expansion', () => {
    const change = setup();
    expect(screen.queryByRole('radio', { name: /Jönköpings län/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'se · Sverige' }));
    expect(screen.getByRole('radio', { name: /Jönköpings län/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Jönköpings kommun/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'se06 · Jönköpings län' }));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: /Jönköpings kommun/ }));
    expect(change).toHaveBeenCalledWith(['se0680']);
  });

  it('selects an exact parent transport scope and preserves other selections', () => {
    const change = setup({ multiple: true, selected: ['offgrid'] });
    fireEvent.click(screen.getByRole('checkbox', { name: 'se · Sverige' }));
    expect(change).toHaveBeenCalledWith(['offgrid', 'se']);
  });

  it('keeps navigation separate from selection and returns to the root through breadcrumbs', () => {
    const change = setup();
    fireEvent.click(screen.getByRole('button', { name: 'se · Sverige' }));
    fireEvent.click(screen.getByRole('button', { name: 'se06 · Jönköpings län' }));
    expect(screen.getByRole('navigation', { name: 'Region levels' })).toHaveTextContent('Sverige');
    fireEvent.click(screen.getByRole('button', { name: 'All regions' }));
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(change).not.toHaveBeenCalled();
  });

  it('opens ancestors of a persisted municipality and clears the filter', () => {
    const change = setup({ selected: ['se0680'] });
    expect(screen.getByRole('radio', { name: /Jönköpings kommun/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(change).toHaveBeenCalledWith([]);
  });

  it('finds a municipality by friendly name or token without expanding the tree', () => {
    setup({});
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Nässjö' } });
    expect(screen.getByRole('radio', { name: 'se0682 · Nässjö kommun' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'se0680' } });
    expect(screen.getByRole('radio', { name: 'se0680 · Jönköpings kommun' })).toBeInTheDocument();
  });

  it('keeps unknown saved regions selectable', () => {
    setup({ selected: ['custom'] });
    expect(screen.getByRole('radio', { name: 'custom' })).toBeChecked();
  });
});
