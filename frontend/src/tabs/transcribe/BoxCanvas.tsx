/* ──────────────────────────────────────────────────────────────────
   BoxCanvas — draw rectangles over a still frame to mark text to erase.

   Given a frame image (object URL) + its natural width/height, render it
   to fit the column and let the user DRAG to draw one or more boxes. Each
   box is emitted as a NORMALIZED { x, y, w, h } (0..1, relative to the
   displayed frame), so the backend can scale it to the real frame size.

   • Drag on empty space → draw a new box.
   • Click a box → select it (gold-bright outline). Delete/Backspace removes it.
   • The small × handle on a box removes it directly.

   On-brand: gold outlines, hairline frame, "ink on dark stock".
   ────────────────────────────────────────────────────────────────── */

import { useCallback, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { InpaintRegion } from '../../api/inpaint';
import { useT } from '../../i18n';

export interface BoxCanvasProps {
  /** Object URL (or data URL) of the still frame to box. */
  imageUrl: string;
  /** Natural frame size — used only for the intrinsic aspect ratio. */
  width: number;
  height: number;
  /** Current boxes, normalized 0..1. */
  regions: InpaintRegion[];
  /** Emit the next set of boxes (normalized 0..1). */
  onChange: (regions: InpaintRegion[]) => void;
}

/** A drag in normalized-from/to coords, while the mouse is down. */
interface Drag {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MIN_SIZE = 0.012; // ignore stray click-drags smaller than ~1.2% of a side

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Turn a raw drag (any direction) into a normalized, clamped rect. */
function dragToRegion(d: Drag): InpaintRegion {
  const x = clamp01(Math.min(d.x0, d.x1));
  const y = clamp01(Math.min(d.y0, d.y1));
  const x2 = clamp01(Math.max(d.x0, d.x1));
  const y2 = clamp01(Math.max(d.y0, d.y1));
  return { x, y, w: x2 - x, h: y2 - y };
}

export function BoxCanvas({ imageUrl, width, height, regions, onChange }: BoxCanvasProps) {
  const t = useT();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const aspect = width > 0 && height > 0 ? `${width} / ${height}` : '16 / 9';

  /** Mouse position → normalized 0..1 within the surface. */
  const toNorm = useCallback((e: { clientX: number; clientY: number }) => {
    const el = surfaceRef.current;
    if (!el) return { nx: 0, ny: 0 };
    const r = el.getBoundingClientRect();
    return {
      nx: clamp01((e.clientX - r.left) / Math.max(1, r.width)),
      ny: clamp01((e.clientY - r.top) / Math.max(1, r.height)),
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    // Only start a draw on a left-click directly on the surface (not on a box
    // or its remove handle — those have their own handlers + stopPropagation).
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const { nx, ny } = toNorm(e);
    setSelected(null);
    setDrag({ x0: nx, y0: ny, x1: nx, y1: ny });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const { nx, ny } = toNorm(e);
    setDrag((d) => (d ? { ...d, x1: nx, y1: ny } : d));
  };

  const onPointerUp = () => {
    if (!drag) return;
    const region = dragToRegion(drag);
    setDrag(null);
    if (region.w >= MIN_SIZE && region.h >= MIN_SIZE) {
      onChange([...regions, region]);
      setSelected(regions.length); // select the newly added box
    }
  };

  const removeAt = (i: number) => {
    onChange(regions.filter((_, idx) => idx !== i));
    setSelected(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null) {
      e.preventDefault();
      removeAt(selected);
    }
  };

  // Live preview rect while dragging.
  const previewRect = drag ? dragToRegion(drag) : null;
  const showPreview = previewRect && previewRect.w >= 0 && previewRect.h >= 0;

  return (
    <div
      ref={surfaceRef}
      className="al-boxcanvas"
      style={{ aspectRatio: aspect }}
      role="application"
      aria-label={t('clean.box.ariaLabel')}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <img className="al-boxcanvas__img" src={imageUrl} alt="" draggable={false} />

      {regions.map((rgn, i) => (
        <div
          key={i}
          className={`al-boxcanvas__box${selected === i ? ' al-boxcanvas__box--sel' : ''}`}
          style={{
            left: `${rgn.x * 100}%`,
            top: `${rgn.y * 100}%`,
            width: `${rgn.w * 100}%`,
            height: `${rgn.h * 100}%`,
          }}
          onPointerDown={(e) => {
            // Select (don't start a new draw) when pressing on an existing box.
            e.stopPropagation();
            setSelected(i);
          }}
        >
          <button
            type="button"
            className="al-boxcanvas__rm"
            aria-label={t('clean.box.remove')}
            title={t('clean.box.remove')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              removeAt(i);
            }}
          >
            <X size={12} strokeWidth={2.4} />
          </button>
        </div>
      ))}

      {showPreview && (
        <div
          className="al-boxcanvas__box al-boxcanvas__box--draft"
          style={{
            left: `${previewRect!.x * 100}%`,
            top: `${previewRect!.y * 100}%`,
            width: `${previewRect!.w * 100}%`,
            height: `${previewRect!.h * 100}%`,
          }}
        />
      )}

      {regions.length === 0 && !drag && (
        <div className="al-boxcanvas__hint" role="note">
          {t('clean.box.hint')}
        </div>
      )}
    </div>
  );
}
