import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** Modules of white around the code; the QR spec asks for 4. */
const QUIET = 4;

/** One SVG path of the dark modules, one subpath per horizontal run. */
function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let row = 0; row < n; row++) {
    let col = 0;
    while (col < n) {
      if (!qr.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < n && qr.isDark(row, col)) col++;
      const len = col - start;
      d += `M${start + QUIET} ${row + QUIET}h${len}v1h-${len}z`;
    }
  }
  return { size: n + 2 * QUIET, d };
}

/**
 * The QR as inline SVG. The colors are fixed, never theme tokens: a light-on-dark QR does not scan,
 * so it is black on white in both themes (and on paper). The only importer of qrcode-generator, so the
 * library ships in the lazily loaded owner chunk only.
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, d } = useMemo(() => qrPath(text), [text]);
  return (
    <svg className="qr" role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
