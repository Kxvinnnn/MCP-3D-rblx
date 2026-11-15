import { deflateSync } from 'node:zlib';

export type TextureResolution = 256 | 512 | 1024;

export type PbrSurfacePattern =
  | 'organic_fur_coat'
  | 'organic_bark'
  | 'organic_foliage'
  | 'weathered_stone'
  | 'carved_wood'
  | 'brushed_metal'
  | 'carbon_fiber'
  | 'ceramic_hoof_horn'
  | 'glass_visor'
  | 'fabric_cloth'
  | 'fantasy_crystal'
  | 'automotive_clearcoat';

export type VisualStyleId =
  | 'realistic'
  | 'semi_realistic'
  | 'stylized'
  | 'cartoon'
  | 'low_poly'
  | 'anime'
  | 'fantasy'
  | 'sci_fi'
  | 'medieval'
  | 'custom';

export interface PbrMaterialSpec {
  id: string;
  pattern: PbrSurfacePattern;
  baseColorHex: string;
  secondaryColorHex?: string;
  accentColorHex?: string;
  roughnessBase: number;
  metallicBase: number;
  emissiveColorHex?: string;
  emissiveStrength?: number;
  style?: VisualStyleId;
  seed?: string;
}

export interface PbrTextureSet {
  materialId: string;
  pattern: PbrSurfacePattern;
  resolution: TextureResolution;
  albedoDataUri: string;
  normalDataUri: string;
  roughnessDataUri: string;
  metallicDataUri: string;
  aoDataUri: string;
  emissiveDataUri?: string;
  surfaceAppearance: {
    ColorMap: string;
    NormalMap: string;
    RoughnessMap: string;
    MetalnessMap: string;
    AlphaMode: 'Opaque' | 'Transparency';
    RoughnessMultiplier: number;
    MetalnessMultiplier: number;
  };
  textureSource: 'procedural_server_rgba_png';
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, crcInput, crcBuf]);
}

/**
 * Encodes an RGBA8 pixel buffer (width * height * 4) into a valid lossless PNG data URI.
 */
export function encodeRgbaToPngDataUri(width: number, height: number, rgba: Uint8Array): string {
  const stride = width * 4;
  const raw = Buffer.allocUnsafe((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type 0 (None)
    const srcOffset = y * stride;
    raw.set(rgba.subarray(srcOffset, srcOffset + stride), rowStart + 1);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = deflateSync(raw, { level: 3 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const png = Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash2D(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise2D(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);
  const v00 = hash2D(ix, iy, seed);
  const v10 = hash2D(ix + 1, iy, seed);
  const v01 = hash2D(ix, iy + 1, seed);
  const v11 = hash2D(ix + 1, iy + 1, seed);
  const a = v00 + (v10 - v00) * fx;
  const b = v01 + (v11 - v01) * fx;
  return a + (b - a) * fy;
}

function fbm2D(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2D(x * freq, y * freq, seed + o * 97) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.02;
  }
  return norm > 0 ? sum / norm : 0.5;
}

function parseHexRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.padEnd(6, '8').slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  const k = clamp01(t);
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
}

function styleContrastFactor(style?: VisualStyleId): number {
  if (style === 'cartoon' || style === 'anime') return 0.72;
  if (style === 'stylized' || style === 'fantasy') return 1.15;
  if (style === 'low_poly') return 0.55;
  return 1.0;
}

interface PixelSample {
  r: number;
  g: number;
  b: number;
  height: number;
  roughness: number;
  metallic: number;
  ao: number;
  emissive: number;
}

function samplePatternPixel(
  u: number,
  v: number,
  spec: PbrMaterialSpec,
  seedNum: number
): PixelSample {
  const baseRgb = parseHexRgb(spec.baseColorHex);
  const secRgb = spec.secondaryColorHex
    ? parseHexRgb(spec.secondaryColorHex)
    : [baseRgb[0] * 0.68, baseRgb[1] * 0.68, baseRgb[2] * 0.68] as [number, number, number];
  const accRgb = spec.accentColorHex
    ? parseHexRgb(spec.accentColorHex)
    : [
        Math.min(255, baseRgb[0] * 1.18 + 14),
        Math.min(255, baseRgb[1] * 1.16 + 12),
        Math.min(255, baseRgb[2] * 1.14 + 10),
      ] as [number, number, number];

  const contrast = styleContrastFactor(spec.style);
  const rough0 = clamp01(spec.roughnessBase);
  const metal0 = clamp01(spec.metallicBase);

  switch (spec.pattern) {
    case 'organic_fur_coat': {
      // Directional hair strands + subtle dappling + undercoat AO
      const strand = fbm2D(u * 48, v * 10, seedNum, 3);
      const fineHair = valueNoise2D(u * 96, v * 18, seedNum + 31);
      const dapple = fbm2D(u * 6.5, v * 6.5, seedNum + 73, 3);
      const hairVal = clamp01((strand * 0.65 + fineHair * 0.35 - 0.5) * contrast + 0.5);
      const patchMix = clamp01((dapple - 0.42) * 1.9);
      let col = mixRgb(secRgb, baseRgb, 0.38 + hairVal * 0.62);
      col = mixRgb(col, accRgb, patchMix * 0.35);
      const height = hairVal * 0.72 + dapple * 0.28;
      const ao = clamp01(0.66 + hairVal * 0.34);
      const roughness = clamp01(rough0 + (1 - hairVal) * 0.14 - 0.05);
      return { r: col[0], g: col[1], b: col[2], height, roughness, metallic: metal0, ao, emissive: 0 };
    }

    case 'organic_bark': {
      // Deep vertical fissures + fibrous bark plates + moss/lichen flecks
      const warp = fbm2D(u * 5, v * 5, seedNum + 11, 2) * 0.35;
      const ridge = Math.abs(Math.sin((u + warp * 0.12) * Math.PI * 12));
      const grain = fbm2D(u * 26, v * 6, seedNum + 41, 4);
      const fissure = clamp01(Math.pow(ridge, 1.55) * 0.68 + grain * 0.32);
      const col = mixRgb(secRgb, baseRgb, fissure);
      const ao = clamp01(0.45 + fissure * 0.55);
      const roughness = clamp01(rough0 + (1 - fissure) * 0.12);
      return { r: col[0], g: col[1], b: col[2], height: fissure, roughness, metallic: 0, ao, emissive: 0 };
    }

    case 'organic_foliage': {
      // Overlapping leaf cluster pattern with sunlit tips and shadowed recesses
      const cluster = fbm2D(u * 12, v * 12, seedNum + 19, 4);
      const vein = valueNoise2D(u * 36, v * 36, seedNum + 53);
      const leafMask = clamp01((cluster * 0.75 + vein * 0.25 - 0.25) * 1.45);
      let col = mixRgb(secRgb, baseRgb, leafMask);
      if (leafMask > 0.68) col = mixRgb(col, accRgb, (leafMask - 0.68) * 1.8);
      const ao = clamp01(0.5 + leafMask * 0.5);
      const roughness = clamp01(rough0 + (1 - leafMask) * 0.15);
      return { r: col[0], g: col[1], b: col[2], height: leafMask, roughness, metallic: 0, ao, emissive: 0 };
    }

    case 'weathered_stone': {
      // Masonry/mineral grain + cracks + subtle mineral speckles
      const rock = fbm2D(u * 10, v * 10, seedNum + 7, 4);
      const crackNoise = Math.abs(fbm2D(u * 16, v * 16, seedNum + 89, 3) - 0.5) * 2;
      const crack = crackNoise < 0.09 ? crackNoise / 0.09 : 1.0;
      const blockX = Math.abs(((u * 4 + (Math.floor(v * 4) % 2) * 0.5) % 1) - 0.5) * 2;
      const blockY = Math.abs(((v * 4) % 1) - 0.5) * 2;
      const mortar = blockX > 0.92 || blockY > 0.9 ? 0.55 : 1.0;
      const h = clamp01(rock * 0.65 + crack * 0.2 + mortar * 0.15);
      const col = mixRgb(secRgb, baseRgb, h);
      const ao = clamp01(0.45 + crack * 0.25 + mortar * 0.3);
      const roughness = clamp01(rough0 + (1 - h) * 0.14);
      return { r: col[0], g: col[1], b: col[2], height: h, roughness, metallic: metal0, ao, emissive: 0 };
    }

    case 'carved_wood': {
      const rings = Math.sin((u * 18 + fbm2D(u * 4, v * 14, seedNum + 23, 3) * 1.6) * Math.PI);
      const plankSeam = ((v * 5) % 1) < 0.04 ? 0.35 : 1.0;
      const grain = clamp01((rings * 0.5 + 0.5) * 0.72 * plankSeam + 0.28);
      const col = mixRgb(secRgb, baseRgb, grain);
      const roughness = clamp01(rough0 + (1 - grain) * 0.16);
      return { r: col[0], g: col[1], b: col[2], height: grain, roughness, metallic: 0, ao: plankSeam, emissive: 0 };
    }

    case 'brushed_metal': {
      const streak = fbm2D(u * 4, v * 72, seedNum + 5, 3);
      const micro = valueNoise2D(u * 30, v * 110, seedNum + 61);
      const val = clamp01(streak * 0.7 + micro * 0.3);
      const col = mixRgb(secRgb, baseRgb, 0.55 + val * 0.45);
      const roughness = clamp01(rough0 + (0.5 - val) * 0.18);
      const metallic = clamp01(Math.max(0.7, metal0));
      return { r: col[0], g: col[1], b: col[2], height: val, roughness, metallic, ao: 0.92, emissive: 0 };
    }

    case 'carbon_fiber': {
      const cellU = Math.floor(u * 24);
      const cellV = Math.floor(v * 24);
      const weave = ((cellU + cellV) % 2) === 0 ? 0.75 : 0.38;
      const fine = Math.sin((u * 24 - cellU) * Math.PI) * Math.sin((v * 24 - cellV) * Math.PI);
      const h = clamp01(weave * 0.65 + fine * 0.35);
      const col = mixRgb(secRgb, baseRgb, h);
      const roughness = clamp01(rough0 + (1 - h) * 0.15);
      return { r: col[0], g: col[1], b: col[2], height: h, roughness, metallic: clamp01(Math.max(0.2, metal0)), ao: 0.78 + h * 0.22, emissive: 0 };
    }

    case 'ceramic_hoof_horn': {
      // Subtle keratin/horn rings + glossy tip gradient
      const band = Math.sin(v * Math.PI * 10 + fbm2D(u * 8, v * 8, seedNum, 2) * 1.4) * 0.5 + 0.5;
      const h = clamp01(band * 0.45 + 0.45);
      const col = mixRgb(secRgb, baseRgb, h);
      return { r: col[0], g: col[1], b: col[2], height: h, roughness: clamp01(rough0), metallic: 0.02, ao: 0.85, emissive: 0 };
    }

    case 'glass_visor': {
      const sheen = Math.pow(clamp01(1 - Math.abs(u - v) * 1.3), 2) * 0.35;
      const col = mixRgb(baseRgb, accRgb, sheen);
      return { r: col[0], g: col[1], b: col[2], height: 0.5 + sheen * 0.3, roughness: clamp01(Math.min(0.12, rough0)), metallic: 0.15, ao: 0.95, emissive: spec.emissiveStrength ? 0.25 : 0 };
    }

    case 'fabric_cloth': {
      const warp = Math.sin(u * Math.PI * 64) * 0.5 + 0.5;
      const weft = Math.sin(v * Math.PI * 64) * 0.5 + 0.5;
      const weave = clamp01((warp + weft) * 0.5 * 0.55 + fbm2D(u * 10, v * 10, seedNum, 2) * 0.45);
      const col = mixRgb(secRgb, baseRgb, 0.5 + weave * 0.5);
      return { r: col[0], g: col[1], b: col[2], height: weave, roughness: clamp01(Math.max(0.68, rough0)), metallic: 0, ao: 0.75 + weave * 0.25, emissive: 0 };
    }

    case 'fantasy_crystal': {
      const facet = fbm2D(u * 9, v * 9, seedNum + 37, 2);
      const quant = Math.floor(facet * 5) / 4;
      const col = mixRgb(baseRgb, accRgb, quant);
      const glow = clamp01((quant - 0.5) * 1.4) * (spec.emissiveStrength ?? 0.55);
      return { r: col[0], g: col[1], b: col[2], height: quant, roughness: clamp01(Math.min(0.2, rough0)), metallic: 0.18, ao: 0.88, emissive: glow };
    }

    case 'automotive_clearcoat': {
      // Metallic flake clearcoat paint with subtle panel seam lines
      const flake = valueNoise2D(u * 80, v * 80, seedNum + 13) * 0.18;
      const panelHighlight = clamp01(1 - Math.abs(v - 0.5) * 0.65 + flake);
      const col = mixRgb(baseRgb, accRgb, clamp01(flake * 1.5 + (panelHighlight - 0.6) * 0.25));
      return {
        r: col[0],
        g: col[1],
        b: col[2],
        height: 0.5 + flake * 0.2,
        roughness: clamp01(Math.min(0.18, rough0)),
        metallic: clamp01(Math.max(0.45, metal0)),
        ao: 0.96,
        emissive: 0,
      };
    }
  }
}

/**
 * Generates deterministic multi-channel RGBA PNG PBR maps (Albedo, Normal, Roughness, Metallic, AO, Emissive).
 */
export function generateServerPbrTextureSet(
  spec: PbrMaterialSpec,
  resolution: TextureResolution = 256
): PbrTextureSet {
  const size = resolution;
  const totalPixels = size * size;
  const albedoBuf = new Uint8Array(totalPixels * 4);
  const normalBuf = new Uint8Array(totalPixels * 4);
  const roughnessBuf = new Uint8Array(totalPixels * 4);
  const metallicBuf = new Uint8Array(totalPixels * 4);
  const aoBuf = new Uint8Array(totalPixels * 4);
  const emissiveBuf = spec.emissiveColorHex ? new Uint8Array(totalPixels * 4) : null;
  const emissiveRgb = spec.emissiveColorHex ? parseHexRgb(spec.emissiveColorHex) : [0, 0, 0];

  const heights = new Float32Array(totalPixels);
  const seedNum = hashSeed(`${spec.seed || spec.id}:${spec.pattern}`);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = y * size + x;
      const px = idx * 4;
      const sample = samplePatternPixel(u, v, spec, seedNum);

      heights[idx] = sample.height;

      albedoBuf[px] = clampByte(sample.r);
      albedoBuf[px + 1] = clampByte(sample.g);
      albedoBuf[px + 2] = clampByte(sample.b);
      albedoBuf[px + 3] = 255;

      const rByte = clampByte(sample.roughness * 255);
      roughnessBuf[px] = rByte;
      roughnessBuf[px + 1] = rByte;
      roughnessBuf[px + 2] = rByte;
      roughnessBuf[px + 3] = 255;

      const mByte = clampByte(sample.metallic * 255);
      metallicBuf[px] = mByte;
      metallicBuf[px + 1] = mByte;
      metallicBuf[px + 2] = mByte;
      metallicBuf[px + 3] = 255;

      const aoByte = clampByte(sample.ao * 255);
      aoBuf[px] = aoByte;
      aoBuf[px + 1] = aoByte;
      aoBuf[px + 2] = aoByte;
      aoBuf[px + 3] = 255;

      if (emissiveBuf) {
        emissiveBuf[px] = clampByte(emissiveRgb[0] * sample.emissive);
        emissiveBuf[px + 1] = clampByte(emissiveRgb[1] * sample.emissive);
        emissiveBuf[px + 2] = clampByte(emissiveRgb[2] * sample.emissive);
        emissiveBuf[px + 3] = 255;
      }
    }
  }

  // Sobel-like height-to-tangent-space normal conversion
  const normalStrength = spec.pattern === 'automotive_clearcoat' || spec.pattern === 'glass_visor' ? 0.8 : 2.6;
  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const hL = heights[y * size + xm];
      const hR = heights[y * size + xp];
      const hU = heights[ym * size + x];
      const hD = heights[yp * size + x];
      const nx = (hL - hR) * normalStrength;
      const ny = (hU - hD) * normalStrength;
      const nz = 1.0;
      const invLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const px = (y * size + x) * 4;
      normalBuf[px] = clampByte((nx * invLen * 0.5 + 0.5) * 255);
      normalBuf[px + 1] = clampByte((ny * invLen * 0.5 + 0.5) * 255);
      normalBuf[px + 2] = clampByte((nz * invLen * 0.5 + 0.5) * 255);
      normalBuf[px + 3] = 255;
    }
  }

  const albedoDataUri = encodeRgbaToPngDataUri(size, size, albedoBuf);
  const normalDataUri = encodeRgbaToPngDataUri(size, size, normalBuf);
  const roughnessDataUri = encodeRgbaToPngDataUri(size, size, roughnessBuf);
  const metallicDataUri = encodeRgbaToPngDataUri(size, size, metallicBuf);
  const aoDataUri = encodeRgbaToPngDataUri(size, size, aoBuf);
  const emissiveDataUri = emissiveBuf ? encodeRgbaToPngDataUri(size, size, emissiveBuf) : undefined;

  return {
    materialId: spec.id,
    pattern: spec.pattern,
    resolution: size,
    albedoDataUri,
    normalDataUri,
    roughnessDataUri,
    metallicDataUri,
    aoDataUri,
    ...(emissiveDataUri ? { emissiveDataUri } : {}),
    surfaceAppearance: {
      ColorMap: albedoDataUri,
      NormalMap: normalDataUri,
      RoughnessMap: roughnessDataUri,
      MetalnessMap: metallicDataUri,
      AlphaMode: spec.pattern === 'glass_visor' ? 'Transparency' : 'Opaque',
      RoughnessMultiplier: Number(spec.roughnessBase.toFixed(2)),
      MetalnessMultiplier: Number(spec.metallicBase.toFixed(2)),
    },
    textureSource: 'procedural_server_rgba_png',
  };
}

/**
 * Infers the best PBR pattern for a part based on its material, name, and category.
 */
export function inferPbrSurfacePatternForPart(part: {
  name?: string;
  material?: string;
  pbrPattern?: string;
}): PbrSurfacePattern {
  const n = (part.name || '').toLowerCase();
  const m = (part.material || '').toLowerCase();
  const p = (part.pbrPattern || '').toLowerCase();

  if (p.includes('carbon')) return 'carbon_fiber';
  if (p.includes('titanium') || p.includes('brushed') || m === 'metal') return 'brushed_metal';
  if (p.includes('stone') || m === 'cobblestone' || m === 'granite' || m === 'slate') return 'weathered_stone';
  if (n.includes('hoof') || n.includes('horn') || n.includes('beak') || n.includes('claw')) return 'ceramic_hoof_horn';
  if (n.includes('mane') || n.includes('tail') || n.includes('coat') || n.includes('torso') || n.includes('neck') || n.includes('head') || n.includes('snout') || n.includes('ear') || n.includes('leg') || n.includes('haunch') || n.includes('shoulder') || n.includes('muzzle')) {
    return 'organic_fur_coat';
  }
  if (n.includes('trunk') || n.includes('bark') || n.includes('branch') || n.includes('root')) return 'organic_bark';
  if (n.includes('foliage') || n.includes('canopy') || n.includes('leaf') || n.includes('crown')) return 'organic_foliage';
  if (n.includes('glass') || n.includes('windshield') || n.includes('visor') || n.includes('eye') || m === 'glass') return 'glass_visor';
  if (n.includes('chassis') || n.includes('hood') || n.includes('fender') || n.includes('body') || n.includes('spoiler')) return 'automotive_clearcoat';
  if (n.includes('crystal') || n.includes('gem') || m === 'neon') return 'fantasy_crystal';
  if (m === 'wood' || m === 'woodplanks' || n.includes('timber') || n.includes('beam') || n.includes('door')) return 'carved_wood';
  if (m === 'fabric') return 'fabric_cloth';
  return 'weathered_stone';
}

function resolvePartColorHex(part: { color?: unknown; colorHex?: unknown }): string {
  if (typeof part.colorHex === 'string' && part.colorHex.trim().startsWith('#')) {
    return part.colorHex.trim().toLowerCase();
  }
  if (typeof part.color === 'string' && part.color.trim().startsWith('#')) {
    return part.color.trim().toLowerCase();
  }
  if (Array.isArray(part.color) && part.color.length >= 3) {
    const [r0, g0, b0] = part.color.map(Number);
    const scale = r0 <= 1 && g0 <= 1 && b0 <= 1 ? 255 : 1;
    const toHex = (n: number) => clampByte(n * scale).toString(16).padStart(2, '0');
    return `#${toHex(r0)}${toHex(g0)}${toHex(b0)}`;
  }
  return '#8c8c8c';
}

/**
 * Generates deduplicated PBR texture sets for all parts in an asset without exceeding 6 unique maps.
 */
export function buildAssetPbrTextureCatalog(
  parts: Array<{
    name?: string;
    color?: unknown;
    colorHex?: unknown;
    material?: string;
    roughness?: number;
    metalness?: number;
    pbrPattern?: string;
  }>,
  options: {
    resolution?: TextureResolution;
    style?: VisualStyleId;
    seed?: string;
  } = {}
): {
  catalog: Record<string, PbrTextureSet>;
  partMaterialMap: Record<string, string>;
  resolution: TextureResolution;
  textureSource: 'procedural_server_rgba_png';
} {
  const resolution = options.resolution ?? 256;
  const catalog: Record<string, PbrTextureSet> = {};
  const partMaterialMap: Record<string, string> = {};

  for (const part of parts) {
    const pattern = inferPbrSurfacePatternForPart(part);
    const baseColor = resolvePartColorHex(part);
    const matKey = `${pattern}_${baseColor.replace('#', '')}`;
    if (!catalog[matKey] && Object.keys(catalog).length < 6) {
      catalog[matKey] = generateServerPbrTextureSet(
        {
          id: matKey,
          pattern,
          baseColorHex: baseColor,
          roughnessBase: typeof part.roughness === 'number' ? part.roughness : pattern === 'organic_fur_coat' ? 0.78 : 0.48,
          metallicBase: typeof part.metalness === 'number' ? part.metalness : pattern === 'brushed_metal' ? 0.85 : 0.04,
          style: options.style,
          seed: options.seed,
        },
        resolution
      );
    }
    const assignedKey = catalog[matKey] ? matKey : Object.keys(catalog)[0];
    if (part.name && assignedKey) {
      partMaterialMap[part.name] = assignedKey;
    }
  }

  return {
    catalog,
    partMaterialMap,
    resolution,
    textureSource: 'procedural_server_rgba_png',
  };
}
