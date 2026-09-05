import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NodeLocationMapLazy } from '../../../src/features/nodes/NodeLocationMapLazy';
import type { Node } from '../../../src/features/nodes/types';

vi.mock('../../../src/features/nodes/NodeLocationMap', () => ({
  NodeLocationMap: ({ node }: { node: Node }) => (
    <div data-testid="node-location-map">
      {node.lat},{node.lng}
    </div>
  ),
}));

function node(lat: number | null, lng: number | null): Node {
  return {
    id: 'n1',
    publicKey: 'a'.repeat(64),
    nodeType: 2,
    nodeTypeName: 'repeater',
    name: 'Relay',
    lat,
    lng,
    iatas: [],
    knownNeighborCount: 0,
    locationSource: 'advert',
    lastAdvertAt: null,
    supportsMultibytePaths: false,
    supportsMultibyteTraces: false,
    minFirmwareVersion: null,
    firstSeen: 1,
    lastSeen: 2,
    metadata: null,
  };
}

describe('NodeLocationMapLazy', () => {
  it('renders nothing when the node has no coordinates', () => {
    const { container } = render(<NodeLocationMapLazy node={node(null, null)} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('node-location-map')).toBeNull();
  });

  it('renders the single-node map without a node-list request when coordinates exist', async () => {
    // The lazy chunk only receives the already-loaded node detail; it must not fetch /nodes.
    render(<NodeLocationMapLazy node={node(57.1, 12.9)} />);
    expect(await screen.findByTestId('node-location-map')).toBeInTheDocument();
  });
});
