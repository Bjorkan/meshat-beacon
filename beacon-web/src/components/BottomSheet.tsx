import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

// Mobile-only slide-up dialog. Radix supplies modal focus, Escape/outside dismissal and restoration;
// Beacon retains the dynamic-viewport, safe-area and overscroll geometry.
export function BottomSheet({
  onClose,
  label,
  role,
  children,
}: {
  onClose: () => void;
  label: string;
  role?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-x-0 top-0 h-dvh z-50 lg:hidden bg-black/50 fade-in"
          onPointerDown={onClose}
        />
        <Dialog.Content
          aria-label={label}
          aria-modal="true"
          className="fixed inset-x-0 bottom-0 z-50 lg:hidden bg-bg-surface border-t border-border rounded-t-xl pb-[env(safe-area-inset-bottom)] shadow-2xl max-h-[85dvh] overflow-y-auto overscroll-contain flex flex-col focus:outline-none"
        >
          <div className="flex justify-center pt-2 pb-1 shrink-0">
            <span className="w-9 h-1 rounded-full bg-border" aria-hidden />
          </div>
          <div role={role} aria-label={role ? label : undefined}>
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
