import { useCallback, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useHasHover } from '../hooks/useMediaQuery';

export function Dropdown({
  renderTrigger,
  align = 'right',
  width = 'w-48',
  fullWidth = false,
  className = '',
  mobileViewport = false,
  children,
}: {
  renderTrigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  align?: 'left' | 'right';
  width?: string;
  fullWidth?: boolean;
  className?: string;
  mobileViewport?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasHover = useHasHover();
  const close = useCallback(() => setOpen(false), []);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className={`relative ${fullWidth ? 'w-full' : ''} ${className}`}>
        <Popover.Trigger asChild>
          {renderTrigger({
            open,
            // Radix composes its own trigger event onto the returned button. Keeping the legacy
            // callback as a no-op preserves call sites without toggling the controlled state twice.
            toggle: () => undefined,
          })}
        </Popover.Trigger>
      </div>
      <Popover.Portal>
        <Popover.Content
          align={align === 'left' ? 'start' : 'end'}
          sideOffset={4}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            if (!hasHover) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            const target = event.target;
            if (target instanceof HTMLInputElement && target.value) event.preventDefault();
          }}
          className={`${width} max-w-[calc(100vw-1.5rem)] ${
            fullWidth ? 'w-[var(--radix-popover-trigger-width)]' : ''
          } ${
            mobileViewport ? 'max-sm:w-[calc(100vw-1.5rem)] max-sm:max-h-[calc(100dvh-4rem)]' : ''
          } bg-bg-raised border border-border rounded-md shadow-lg z-50 py-1 max-h-80 overflow-y-auto focus:outline-none`}
        >
          {children(close)}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
