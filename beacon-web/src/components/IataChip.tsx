import type { ReactNode } from 'react';

// Small primary chip marking an IATA, shared across detail panels, observation cards, and the packet
// structure view so the location marker reads identically everywhere.
export function IataChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`font-mono text-primary font-semibold text-size-11 bg-primary/6 px-1.5 py-px rounded-sm${className ? ` ${className}` : ''}`}
    >
      {children}
    </span>
  );
}
