// Shared desktop packet grid. Keep fixed/font-independent tracks because the sticky header and the
// virtualized rows are separate grids. Compared with the old layout, observer+area gets one compact
// identity cell, hops+hash-size share one diagnostic cell, and the freed width becomes the inline
// path column rather than making the table wider.
export const GRID_TEMPLATE =
  "1.25rem 4.75rem 5.25rem 5.75rem minmax(5.75rem, 0.8fr) minmax(7.75rem, 1.2fr) 2.75rem 4.25rem 4rem";
