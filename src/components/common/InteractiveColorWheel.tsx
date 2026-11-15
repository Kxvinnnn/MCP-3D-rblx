import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Sun, Sparkles } from 'lucide-react';
import { resolveRgbTuple } from '../../utils/colorUtils.ts';

export interface RgbTuple {
  r: number;
  g: number;
  b: number;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export function hexToRgbTuple(hex: string): [number, number, number] {
  return resolveRgbTuple(hex, [148, 163, 184]);
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1));
  const m = v - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hn < 60) {
    rp = c;
    gp = x;
  } else if (hn < 120) {
    rp = x;
    gp = c;
  } else if (hn < 180) {
    gp = c;
    bp = x;
  } else if (hn < 240) {
    gp = x;
    bp = c;
  } else if (hn < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return [
    Math.round((rp + m) * 255),
    Math.round((gp + m) * 255),
    Math.round((bp + m) * 255),
  ];
}

export interface QuickColorPreset {
  label: string;
  hex: string;
}

export const KID_COLOR_PRESETS: QuickColorPreset[] = [
  { label: 'Rojo', hex: '#EF4444' },
  { label: 'Naranja', hex: '#F97316' },
  { label: 'Amarillo', hex: '#FACC15' },
  { label: 'Verde', hex: '#22C55E' },
  { label: 'Bosque', hex: '#15803D' },
  { label: 'Turquesa', hex: '#06B6D4' },
  { label: 'Azul', hex: '#3B82F6' },
  { label: 'Morado', hex: '#A855F7' },
  { label: 'Rosa', hex: '#EC4899' },
  { label: 'Madera', hex: '#7C4A2D' },
  { label: 'Blanco', hex: '#F8FAFC' },
  { label: 'Carbón', hex: '#1E293B' },
];

export interface InteractiveColorWheelProps {
  /** Current color as hex string (`#RRGGBB`) */
  value: string;
  /** Optional diameter of the circular wheel in CSS pixels */
  size?: number;
  /** Called smoothly at up to 60fps while dragging */
  onChangeLive: (hex: string, rgb: [number, number, number]) => void;
  /** Called once when pointer is released or a preset swatch is clicked */
  onCommit: (hex: string, rgb: [number, number, number]) => void;
  /** Optional label above the wheel */
  title?: string;
  /** Optional compact layout for narrower sidebars */
  compact?: boolean;
}

export const InteractiveColorWheel: React.FC<InteractiveColorWheelProps> = ({
  value,
  size = 196,
  onChangeLive,
  onCommit,
  title,
  compact = false,
}) => {
  const wheelCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wheelDraggingRef = useRef<boolean>(false);
  const rafPendingRef = useRef<number | null>(null);
  const pendingEmitRef = useRef<{ hex: string; rgb: [number, number, number] } | null>(null);

  const initialRgb = hexToRgbTuple(value);
  const initialHsv = rgbToHsv(initialRgb[0], initialRgb[1], initialRgb[2]);

  const [hsv, setHsv] = useState<{ h: number; s: number; v: number }>(() => initialHsv);

  // Sync external value changes when NOT actively dragging
  useEffect(() => {
    if (wheelDraggingRef.current) return;
    const [r, g, b] = hexToRgbTuple(value);
    const nextHsv = rgbToHsv(r, g, b);
    setHsv((prev) => ({
      // Preserve hue when color is pure black/white so the wheel dot doesn't jump to 0 deg
      h: nextHsv.s < 0.02 || nextHsv.v < 0.02 ? prev.h : nextHsv.h,
      s: nextHsv.s,
      v: nextHsv.v,
    }));
  }, [value]);

  // Draw crisp HSV color wheel canvas scaled by current brightness `hsv.v`
  useEffect(() => {
    const canvas = wheelCanvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const pxSize = Math.round(size * dpr);
    if (canvas.width !== pxSize || canvas.height !== pxSize) {
      canvas.width = pxSize;
      canvas.height = pxSize;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const radius = pxSize / 2;
    const imgData = ctx.createImageData(pxSize, pxSize);
    const data = imgData.data;
    const brightness = Math.max(0.12, hsv.v);

    for (let y = 0; y < pxSize; y++) {
      const dy = y - radius;
      for (let x = 0; x < pxSize; x++) {
        const dx = x - radius;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (y * pxSize + x) * 4;

        if (dist > radius) {
          data[idx + 3] = 0;
          continue;
        }

        // Smooth 1.5px anti-aliased edge
        const alpha = dist > radius - 1.5 ? Math.max(0, Math.min(1, (radius - dist) / 1.5)) : 1;
        let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (angleDeg < 0) angleDeg += 360;
        const sat = Math.min(1, dist / (radius - 1));

        const [r, g, b] = hsvToRgb(angleDeg, sat, brightness);
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = Math.round(alpha * 255);
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }, [size, hsv.v]);

  useEffect(() => {
    return () => {
      if (rafPendingRef.current !== null) {
        cancelAnimationFrame(rafPendingRef.current);
      }
    };
  }, []);

  const scheduleLiveEmit = useCallback(
    (hex: string, rgb: [number, number, number]) => {
      pendingEmitRef.current = { hex, rgb };
      if (rafPendingRef.current === null) {
        rafPendingRef.current = requestAnimationFrame(() => {
          rafPendingRef.current = null;
          const payload = pendingEmitRef.current;
          if (payload) {
            onChangeLive(payload.hex, payload.rgb);
          }
        });
      }
    },
    [onChangeLive]
  );

  const pickColorAtClientPos = useCallback(
    (clientX: number, clientY: number, isCommit: boolean) => {
      const canvas = wheelCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const radius = rect.width / 2;
      const dx = clientX - (rect.left + radius);
      const dy = clientY - (rect.top + radius);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const sat = Math.max(0, Math.min(1, dist / radius));
      let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angleDeg < 0) angleDeg += 360;

      const v = hsv.v < 0.08 ? 0.95 : hsv.v;
      const nextHsv = { h: angleDeg, s: sat, v };
      setHsv(nextHsv);

      const rgb = hsvToRgb(nextHsv.h, nextHsv.s, nextHsv.v);
      const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);

      if (isCommit) {
        if (rafPendingRef.current !== null) {
          cancelAnimationFrame(rafPendingRef.current);
          rafPendingRef.current = null;
        }
        onChangeLive(hex, rgb);
        onCommit(hex, rgb);
      } else {
        scheduleLiveEmit(hex, rgb);
      }
    },
    [hsv.v, onChangeLive, onCommit, scheduleLiveEmit]
  );

  const handleWheelPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    wheelDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    pickColorAtClientPos(e.clientX, e.clientY, false);
  };

  const handleWheelPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!wheelDraggingRef.current) return;
    e.preventDefault();
    pickColorAtClientPos(e.clientX, e.clientY, false);
  };

  const handleWheelPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!wheelDraggingRef.current) return;
    wheelDraggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if capture was already released
    }
    pickColorAtClientPos(e.clientX, e.clientY, true);
  };

  const currentRgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const currentHex = rgbToHex(currentRgb[0], currentRgb[1], currentRgb[2]);
  const fullBrightRgb = hsvToRgb(hsv.h, hsv.s, 1);
  const fullBrightHex = rgbToHex(fullBrightRgb[0], fullBrightRgb[1], fullBrightRgb[2]);

  // Indicator marker position on the wheel
  const angleRad = (hsv.h * Math.PI) / 180;
  const markerRadiusPx = (size / 2 - 4) * hsv.s;
  const markerX = size / 2 + Math.cos(angleRad) * markerRadiusPx;
  const markerY = size / 2 + Math.sin(angleRad) * markerRadiusPx;

  const handleBrightnessChange = (newV: number, commit: boolean) => {
    const nextHsv = { ...hsv, v: newV };
    setHsv(nextHsv);
    const rgb = hsvToRgb(nextHsv.h, nextHsv.s, nextHsv.v);
    const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
    if (commit) {
      onChangeLive(hex, rgb);
      onCommit(hex, rgb);
    } else {
      scheduleLiveEmit(hex, rgb);
    }
  };

  const handlePresetClick = (presetHex: string) => {
    const rgb = hexToRgbTuple(presetHex);
    const nextHsv = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    setHsv((prev) => ({
      h: nextHsv.s < 0.02 ? prev.h : nextHsv.h,
      s: nextHsv.s,
      v: nextHsv.v,
    }));
    onChangeLive(presetHex, rgb);
    onCommit(presetHex, rgb);
  };

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {title && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>{title}</span>
          </span>
          <div className="flex items-center gap-1.5">
            <span
              className="w-5 h-5 rounded-full border-2 border-white/80 shadow-sm shrink-0"
              style={{ backgroundColor: currentHex }}
            />
            <span className="text-[11px] font-mono tabular-nums text-slate-300 font-bold">
              {currentHex}
            </span>
          </div>
        </div>
      )}

      {/* Interactive Rainbow Color Wheel */}
      <div className="flex flex-col items-center">
        <div
          className="relative select-none touch-none rounded-full shadow-[0_0_28px_rgba(6,182,212,0.18)] ring-4 ring-slate-800/90"
          style={{ width: size, height: size }}
        >
          <canvas
            ref={wheelCanvasRef}
            onPointerDown={handleWheelPointerDown}
            onPointerMove={handleWheelPointerMove}
            onPointerUp={handleWheelPointerUp}
            onPointerCancel={handleWheelPointerUp}
            aria-label="Círculo interactivo de colores"
            className="w-full h-full rounded-full cursor-crosshair block touch-none"
          />

          {/* Tactile Selector Handle */}
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full border-[3px] border-white shadow-[0_2px_8px_rgba(0,0,0,0.75)] ring-1 ring-black/60 transition-transform duration-75"
            style={{
              left: markerX,
              top: markerY,
              backgroundColor: currentHex,
            }}
          />
        </div>
      </div>

      {/* Smooth Brightness / Clarity Slider */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-300">
          <span className="flex items-center gap-1">
            <Sun className="w-3.5 h-3.5 text-amber-400" />
            <span>Brillo (Oscuro ↔ Claro)</span>
          </span>
          <span className="font-mono tabular-nums text-cyan-300">
            {Math.round(hsv.v * 100)}%
          </span>
        </div>

        <div className="relative h-7 rounded-full p-1 bg-slate-950 border border-slate-800 flex items-center">
          <div
            className="w-full h-3.5 rounded-full pointer-events-none"
            style={{
              background: `linear-gradient(to right, #05070B, ${fullBrightHex})`,
            }}
          />
          <input
            type="range"
            aria-label="Brillo del color"
            min={0.08}
            max={1}
            step={0.01}
            value={Math.max(0.08, hsv.v)}
            onChange={(e) => handleBrightnessChange(parseFloat(e.target.value), false)}
            onPointerUp={(e) =>
              handleBrightnessChange(parseFloat((e.target as HTMLInputElement).value), true)
            }
            onKeyUp={(e) =>
              handleBrightnessChange(parseFloat((e.target as HTMLInputElement).value), true)
            }
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <div
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full border-2 border-white shadow-md"
            style={{
              left: `calc(${((Math.max(0.08, hsv.v) - 0.08) / 0.92) * 88 + 6}%)`,
              backgroundColor: currentHex,
            }}
          />
        </div>
      </div>

      {/* Quick 1-Tap Color Buttons for Kids */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-bold text-slate-300 block">
          Colores Rápidos (1 toque):
        </span>
        <div className="grid grid-cols-6 gap-2">
          {KID_COLOR_PRESETS.map((preset) => {
            const isActive = preset.hex.toUpperCase() === currentHex.toUpperCase();
            return (
              <button
                key={preset.hex}
                type="button"
                title={preset.label}
                aria-label={`Color ${preset.label}`}
                onClick={() => handlePresetClick(preset.hex)}
                className={`h-8 w-full rounded-xl border-2 cursor-pointer transition-transform duration-150 hover:scale-105 active:scale-95 ${
                  isActive
                    ? 'border-white ring-2 ring-cyan-400 scale-105 shadow-md'
                    : 'border-white/25 hover:border-white/70'
                }`}
                style={{ backgroundColor: preset.hex }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
