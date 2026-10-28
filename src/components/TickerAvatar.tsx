import { useState } from 'react';
import { cn } from '@/lib/utils';
import { getTickerName } from '@/data/ticker-names';

type LogoLook =
  | { kind: 'filled'; src: string }
  | { kind: 'mark'; src: string; light: boolean };

const LOGO_PX = 96;

/**
 * Logos come as full-bleed squares (own background), or as a mark on transparency
 * with uneven margins. Filled ones fill the tile; marks are cropped to their
 * content and re-centred, so every avatar has the same visual edge. A mark that is
 * near-white is flagged so it can sit on a dark tile.
 */
function analyzeLogo(img: HTMLImageElement): LogoLook | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = LOGO_PX;
    canvas.height = LOGO_PX;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, LOGO_PX, LOGO_PX);
    const { data } = ctx.getImageData(0, 0, LOGO_PX, LOGO_PX);
    const alphaAt = (x: number, y: number) => data[(y * LOGO_PX + x) * 4 + 3];

    let edgeOpaque = 0;
    for (let k = 0; k < LOGO_PX; k++) {
      for (const [x, y] of [[k, 0], [k, LOGO_PX - 1], [0, k], [LOGO_PX - 1, k]]) {
        if (alphaAt(x, y) > 200) edgeOpaque += 1;
      }
    }
    if (edgeOpaque / (LOGO_PX * 4) > 0.9) return { kind: 'filled', src: img.src };

    let minX = LOGO_PX, minY = LOGO_PX, maxX = -1, maxY = -1;
    let sum = 0, count = 0;
    for (let y = 0; y < LOGO_PX; y++) {
      for (let x = 0; x < LOGO_PX; x++) {
        const o = (y * LOGO_PX + x) * 4;
        if (data[o + 3] < 32) continue;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        if (data[o + 3] >= 128) {
          sum += (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255;
          count += 1;
        }
      }
    }
    if (maxX < 0) return null;

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const inner = LOGO_PX * 0.72;
    const scale = inner / Math.max(w, h);
    const out = document.createElement('canvas');
    out.width = LOGO_PX;
    out.height = LOGO_PX;
    const octx = out.getContext('2d');
    if (!octx) return null;
    // Re-draw from the full-size source for sharpness, not the downsampled copy.
    const srcScale = img.naturalWidth / LOGO_PX;
    octx.drawImage(
      img,
      minX * srcScale, minY * srcScale, w * srcScale, h * srcScale,
      (LOGO_PX - w * scale) / 2, (LOGO_PX - h * scale) / 2, w * scale, h * scale,
    );
    return { kind: 'mark', src: out.toDataURL('image/png'), light: count > 0 && sum / count > 0.85 };
  } catch {
    return null;
  }
}

/** Reference row identity: the ticker's logo, or a text mark when none loads. */
export function TickerAvatar({ ticker, className }: { ticker: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [look, setLook] = useState<LogoLook | null>(null);
  const symbol = ticker.trim().toUpperCase();
  // Logos are bundled under public/ticker-logos for catalogued tickers only: no third-party
  // request is ever made, so no page (the public share included) discloses a ticker to anyone.
  const showLogo = !failed && getTickerName(symbol) !== undefined;
  const remote = `/ticker-logos/${symbol}.png`;
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md font-num text-[10px] font-semibold',
        className,
        // A shared soft tile with a hairline ring, dimmed in dark mode to avoid glare.
        !showLogo && 'bg-surface-elevated text-muted-foreground',
        showLogo && 'ring-1 ring-inset ring-black/[0.07] dark:ring-white/10',
        showLogo && look?.kind !== 'filled' && (look?.kind === 'mark' && look.light
          ? 'bg-[#2a2926]'
          : 'bg-[#fdfcf9] dark:bg-[#dcdad2]'),
      )}
    >
      {showLogo ? (
        <img
          src={look?.src ?? remote}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className={cn('h-full w-full', look?.kind === 'filled' ? 'object-cover dark:brightness-90' : 'object-contain')}
          onLoad={(e) => {
            if (!look) setLook(analyzeLogo(e.currentTarget) ?? { kind: 'mark', src: remote, light: false });
          }}
          onError={() => setFailed(true)}
        />
      ) : (
        ticker.slice(0, 4)
      )}
    </span>
  );
}
