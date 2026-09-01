import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

// Right-anchored modal. Radix owns focus entry/trapping/restoration, Escape and outside dismissal.
// `inactive` keeps a lower stacked overlay mounted but removes it from the active modal/a11y path.
export function ModalOverlay({
  label,
  onClose,
  inactive = false,
  children,
}: {
  label: string;
  onClose: () => void;
  inactive?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open
      modal={!inactive}
      onOpenChange={(open) => {
        if (!open && !inactive) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-40 bg-black/50 fade-in"
          aria-hidden={inactive || undefined}
          onPointerDown={() => {
            if (!inactive) onClose();
          }}
        />
        <Dialog.Content
          aria-label={label}
          aria-hidden={inactive || undefined}
          onEscapeKeyDown={(event) => {
            if (inactive) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (inactive) event.preventDefault();
          }}
          className="fixed inset-y-0 right-0 z-40 flex max-w-full shadow-2xl focus:outline-none"
        >
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
