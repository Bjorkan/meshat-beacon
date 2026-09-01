import { useState, type ReactNode } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as Popover from '@radix-ui/react-popover';
import { useHasHover } from '../hooks/useMediaQuery';

const contentClass =
  'z-50 whitespace-nowrap rounded border border-border bg-bg-raised px-2 py-1 font-mono text-[11px] text-text-normal shadow-lg';

export function Tooltip({
  label,
  children,
  className = '',
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const hasHover = useHasHover();
  const [touchOpen, setTouchOpen] = useState(false);
  const trigger = <span className={`inline-flex ${className}`}>{children}</span>;

  // Touch has no hover state, so a Radix Popover preserves Beacon's tap-to-inspect behavior.
  if (!hasHover) {
    return (
      <Popover.Root open={touchOpen} onOpenChange={setTouchOpen}>
        <Popover.Trigger asChild onClick={(event) => event.stopPropagation()}>
          {trigger}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            role="tooltip"
            side="top"
            sideOffset={6}
            collisionPadding={6}
            onPointerDownOutside={() => setTouchOpen(false)}
            className={contentClass}
          >
            {label}
            <Popover.Arrow className="fill-bg-raised" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  return (
    <TooltipPrimitive.Provider delayDuration={0} skipDelayDuration={0}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{trigger}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="top"
            sideOffset={6}
            collisionPadding={6}
            className={contentClass}
          >
            {label}
            <TooltipPrimitive.Arrow className="fill-bg-raised" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
