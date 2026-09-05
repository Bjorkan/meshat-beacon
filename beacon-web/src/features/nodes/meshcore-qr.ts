// QR rendering for MeshCore contact URIs, drawn locally in the browser (no third-party
// service ever sees the node identity). Encoding is delegated to the well-tested
// qrcode-generator library (Kazuhiko Arase's QR implementation); this module only owns
// canvas rendering.
import qrcode from 'qrcode-generator';

export const QR_ERROR_CORRECTION: 'L' | 'M' | 'Q' | 'H' = 'M';

export function qrModuleCount(text: string): number {
  const qr = qrcode(0, QR_ERROR_CORRECTION);
  qr.addData(text);
  qr.make();
  return qr.getModuleCount();
}

export function qrIsDark(text: string, row: number, col: number): boolean {
  const qr = qrcode(0, QR_ERROR_CORRECTION);
  qr.addData(text);
  qr.make();
  return qr.isDark(row, col);
}

export function drawQr(canvas: HTMLCanvasElement, text: string, scale = 4): void {
  const qr = qrcode(0, QR_ERROR_CORRECTION);
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const quiet = 2;
  canvas.width = (size + quiet * 2) * scale;
  canvas.height = (size + quiet * 2) * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
  }
}
