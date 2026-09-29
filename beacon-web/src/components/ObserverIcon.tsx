// Observer "eye" glyph; the platform emoji renders natively on every device.
export function ObserverIcon({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex size-3 items-center justify-center text-size-10 leading-none ${className}`}
    >
      👁️
    </span>
  );
}
