/**
 * Canonical Forge AI Studio RGB Color Conversion Utility (`forge-color-v1`).
 *
 * Shared unambiguous convention across TypeScript, Python (`_normalize_color_rgb_255`),
 * and Roblox Studio Luau (`resolveRgbTupleLuau`):
 *
 * 1. Hex strings (`"#RRGGBB"`, `"RRGGBB"`, `"#RGB"`, `"RGB"`):
 *    Parsed directly to exact 8-bit RGB `[0..255]`.
 *
 * 2. Explicit color-space hints (`colorSpace` / `colorFormat` / `normalized`):
 *    - `'rgb8'` / `'srgb8'` / `'rgb255'` / `'0-255'` / `'uint8'` / `'byte'` / `'fromrgb'` / `normalized: false`:
 *      Always interpreted as 8-bit `[0..255]` (`floor(c + 0.5)` clamped to `0..255`).
 *      Preserves dark 8-bit tuples such as `[1, 1, 1]` or `[1, 0, 0]` without scaling.
 *    - `'rgb01'` / `'normalized'` / `'01'` / `'0-1'` / `'unit'` / `'float'` / `'color3'` / `'linear01'` / `normalized: true`:
 *      Always interpreted as normalized `[0..1]` (`floor(c * 255 + 0.5)` clamped to `0..255`).
 *
 * 3. Untagged bare 3-number tuples `[r, g, b]` (no explicit hint):
 *    - If ALL 3 channels lie within `[0, 1]` (`0 <= r,g,b <= 1`):
 *      Unambiguously treated as normalized `[0..1]` -> scaled by 255 (`floor(c * 255 + 0.5)`).
 *      Examples: `[0, 0, 0] -> [0, 0, 0]`, `[0.5, 0.25, 0.75] -> [128, 64, 191]`,
 *      `[1, 0, 0] -> [255, 0, 0]`, `[1, 1, 1] -> [255, 255, 255]`.
 *    - Otherwise (any channel outside `[0, 1]`):
 *      Treated as 8-bit `[0..255]` -> `floor(c + 0.5)` clamped to `[0, 255]`.
 *
 * 4. Structured objects (`{ r, g, b, colorSpace? }` or `{ color, colorSpace? }`):
 *    Unwraps metadata and delegates to rules 1–3.
 */

export const FORGE_COLOR_CONVENTION_VERSION = 'forge-color-v1';

export type ForgeColorSpace =
  | 'rgb8'
  | 'rgb01'
  | 'normalized'
  | 'srgb8'
  | 'rgb255'
  | 'color3';

const RGB8_HINTS = new Set([
  'rgb8',
  'srgb8',
  'rgb255',
  '255',
  '0-255',
  '0..255',
  'uint8',
  'byte',
  'fromrgb',
]);

const RGB01_HINTS = new Set([
  'rgb01',
  'normalized',
  'norm',
  '01',
  '0-1',
  '0..1',
  'unit',
  'float',
  'color3',
  'linear01',
]);

function clampByte(n: number): number {
  const rounded = Math.floor(n + 0.5);
  if (rounded < 0) return 0;
  if (rounded > 255) return 255;
  return rounded;
}

function sanitizeFallback(
  fallback: readonly [number, number, number]
): [number, number, number] {
  const r = Number.isFinite(fallback[0]) ? clampByte(fallback[0]) : 160;
  const g = Number.isFinite(fallback[1]) ? clampByte(fallback[1]) : 170;
  const b = Number.isFinite(fallback[2]) ? clampByte(fallback[2]) : 185;
  return [r, g, b];
}

function parseFiniteChannel(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseForgeColorSpaceHint(
  hint: unknown
): 'rgb8' | 'rgb01' | null {
  if (hint === true) return 'rgb01';
  if (hint === false) return 'rgb8';
  if (typeof hint === 'string') {
    const clean = hint.trim().toLowerCase();
    if (RGB8_HINTS.has(clean)) return 'rgb8';
    if (RGB01_HINTS.has(clean)) return 'rgb01';
  }
  return null;
}

export function resolveColorRgb255(
  colorRaw: unknown,
  fallback: readonly [number, number, number] = [148, 163, 184],
  explicitColorSpace?: unknown
): [number, number, number] {
  const fb = sanitizeFallback(fallback);

  if (typeof colorRaw === 'string') {
    const clean = colorRaw.replace(/^#/, '').trim();
    if (/^[0-9a-fA-F]{6}$/.test(clean)) {
      return [
        parseInt(clean.slice(0, 2), 16),
        parseInt(clean.slice(2, 4), 16),
        parseInt(clean.slice(4, 6), 16),
      ];
    }
    if (/^[0-9a-fA-F]{3}$/.test(clean)) {
      return [
        parseInt(clean[0], 16) * 17,
        parseInt(clean[1], 16) * 17,
        parseInt(clean[2], 16) * 17,
      ];
    }
    return fb;
  }

  if (
    colorRaw !== null &&
    typeof colorRaw === 'object' &&
    !Array.isArray(colorRaw)
  ) {
    const obj = colorRaw as Record<string, unknown>;
    const nestedHint =
      explicitColorSpace !== undefined && explicitColorSpace !== null
        ? explicitColorSpace
        : obj.colorSpace ?? obj.colorFormat ?? obj.normalized;

    if (obj.color !== undefined) {
      return resolveColorRgb255(obj.color, fb, nestedHint);
    }

    const rVal = obj.r ?? obj.R;
    const gVal = obj.g ?? obj.G;
    const bVal = obj.b ?? obj.B;
    if (rVal !== undefined && gVal !== undefined && bVal !== undefined) {
      return resolveColorRgb255([rVal, gVal, bVal], fb, nestedHint);
    }
    return fb;
  }

  if (Array.isArray(colorRaw) && colorRaw.length >= 3) {
    const r = parseFiniteChannel(colorRaw[0]);
    const g = parseFiniteChannel(colorRaw[1]);
    const b = parseFiniteChannel(colorRaw[2]);
    if (r === null || g === null || b === null) {
      return fb;
    }

    const mode = parseForgeColorSpaceHint(explicitColorSpace);
    if (mode === 'rgb8') {
      return [clampByte(r), clampByte(g), clampByte(b)];
    }
    if (mode === 'rgb01') {
      return [clampByte(r * 255), clampByte(g * 255), clampByte(b * 255)];
    }

    // Untagged bare tuple: [0..1]^3 is unambiguously normalized RGB
    const isNormalizedUnitRange =
      r >= 0 && g >= 0 && b >= 0 && r <= 1 && g <= 1 && b <= 1;
    if (isNormalizedUnitRange) {
      return [clampByte(r * 255), clampByte(g * 255), clampByte(b * 255)];
    }

    return [clampByte(r), clampByte(g), clampByte(b)];
  }

  return fb;
}

export function resolveRgbTuple(
  color: unknown,
  fallback: readonly [number, number, number] = [160, 170, 185],
  explicitColorSpace?: unknown
): [number, number, number] {
  return resolveColorRgb255(color, fallback, explicitColorSpace);
}

export function normalizeColorRgb255(
  colorRaw: unknown,
  fallback: readonly [number, number, number] = [148, 163, 184],
  explicitColorSpace?: unknown
): [number, number, number] {
  return resolveColorRgb255(colorRaw, fallback, explicitColorSpace);
}
