// Shared desktop packet grid. Keep fixed/font-independent tracks because the sticky header and the
// virtualized rows are separate grids. Compared with the old layout, observer+area gets one compact
// identity cell, hops+hash-size share one diagnostic cell, and the freed width becomes the inline
// path column rather than making the table wider.
export const GRID_TEMPLATE =
  '1.25rem 4.75rem 5.25rem 5.75rem minmax(5.75rem, 0.8fr) minmax(7.75rem, 1.2fr) 2.75rem 4.25rem 4rem';

// Desktop table content gutter. Matches the filter toolbar's px-4 so header, rows and expansion
// share one horizontal rhythm. The padding lives INSIDE the header/row elements: their backgrounds
// and separators still run full-bleed to the scroll-surface edge (the #76 containment model), so
// the first chevron cell and the final right-aligned ÅLDER cell get the same deliberate breathing
// room without recreating a dead gutter on the scroll container.
export const PACKET_TABLE_X_PADDING = 'px-4';

// The narrowest container the grid can honor without clipping a column: the fixed tracks plus the
// two minmax minimums sum to 41.5rem, plus 8 gaps of 0.5rem and the rows' 2rem shared horizontal
// padding. Anything narrower must scroll inside the table region instead of leaking past its
// container.
export const GRID_MIN_WIDTH = '47.5rem';
