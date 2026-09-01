import type { ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

// Radix supplies the accessible trigger/content relationship, keyboard dismissal and collision-aware
// positioning that the old hand-rolled portal could not provide consistently.
export function Tooltip({
  label,
  children,
  className = '',
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={0}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <span className={'inline-flex ' + className}>{children}</span>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="top"
            sideOffset={6}
            collisionPadding={6}
            className="z-50 whitespace-nowrap rounded border border-border bg-bg-raised px-2 py-1 font-mono text-[11px] text-text-normal shadow-lg"
          >
            {label}
            <TooltipPrimitive.Arrow className="fill-bg-raised" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
