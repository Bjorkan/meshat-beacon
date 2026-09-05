import { useEffect, useRef } from 'react';
import { drawQr } from './meshcore-qr';

// Local QR canvas for a MeshCore contact URI. No network, no third-party service: the payload is
// encoded and drawn entirely in the browser.
export function MeshcoreContactQr({ uri, label }: { uri: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (canvasRef.current) drawQr(canvasRef.current, uri, 4);
  }, [uri]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      className="h-24 w-24 shrink-0 rounded-sm border border-border bg-white p-1"
    />
  );
}
