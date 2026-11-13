/**
 * @module procedural3DGenerator
 * @description
 * Fase 6 y Fase 7 — Motor 1 de Generación Procedural Parametrizada con Semillas Reproducibles (`seed`).
 *
 * Soporta las 8 categorías oficiales de NIGHTMARE FORGE / Forge AI Studio:
 * 1. Props (Objetos y props)
 * 2. Trees & Vegetation (Árboles y vegetación — incluye el Generador Parametrizado de Árboles 3D de Fase 7)
 * 3. Rocks & Nature (Rocas y elementos naturales)
 * 4. Buildings & Structures (Edificios y estructuras)
 * 5. Furniture & Interior (Mobiliario e interiores)
 * 6. Scene Elements (Elementos de escenario)
 * 7. Stylized Assets (Modelos estilizados)
 * 8. Ambient & Decoration (Elementos ambientales y decorativos)
 *
 * Garantías geométricas:
 * - Determinismo estricto por semilla (`seed`): la misma semilla y parámetros producen exactamente
 *   los mismos buffers de vértices, normales, UVs, caras y hashes SHA-256.
 * - Pivote inferior centrado en `Y = 0` (ninguna pieza flota ni atraviesa el suelo).
 * - Triángulos no degenerados, normales unitarias y coordenadas UV dentro de `[0, 1]`.
 * - Funciona 100% en modo local/offline sin requerir `GEMINI_API_KEY` ni servicios de pago.
 */

import {
  buildStrictLuauFromEditedParts,
  computeFnv1a32Hex,
  normalizePartsWithSyncMetadata,
} from './worldAndModelEditorEngine.ts';

export const FORGE_ASSET_CATEGORIES = [
  'Props',
  'Trees & Vegetation',
  'Rocks & Nature',
  'Buildings & Structures',
  'Furniture & Interior',
  'Scene Elements',
  'Stylized Assets',
  'Ambient & Decoration',
] as const;

export type ForgeAssetCategory = (typeof FORGE_ASSET_CATEGORIES)[number];

export type CanopyShapeType = 'spherical' | 'conical' | 'layered' | 'weeping';
export type LeafDistributionType = 'dense' | 'balanced' | 'sparse' | 'clustered';

export interface TreeProceduralParams {
  seed?: string | number;
  height?: number;
  trunkThickness?: number;
  branchCount?: number;
  leafDistribution?: LeafDistributionType;
  canopyShape?: CanopyShapeType;
  trunkMaterial?: string;
  leafMaterial?: string;
  trunkColor?: string;
  leafColor?: string;
  variation?: number;
}

export interface Procedural3DGenerationRequest {
  prompt?: string;
  name?: string;
  category?: string;
  asset_type?: 'Model3D' | 'Scene3D';
  collision_fidelity?: 'Hull' | 'Box' | 'PreciseConvexDecomposition' | 'Default';
  target_poly_budget?: number;
  seed?: string | number;
  tree_params?: TreeProceduralParams;
}

/**
 * Convierte cualquier semilla (string o número) en un entero de 32 bits sin signo determinista.
 */
export function hashSeedToUint32(seed: string | number | undefined): number {
  const raw = String(seed ?? 'forge-default-seed-2026').trim() || 'forge-default-seed-2026';
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0 || 0x12345678;
}

/**
 * Generador pseudoaleatorio determinista Mulberry32.
 * La misma semilla produce exactamente la misma secuencia en cualquier plataforma (Windows/Linux/macOS).
 */
export function createSeededRng(seed: string | number | undefined): () => number {
  let state = hashSeedToUint32(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function hexToRgbNormalized(hex: string): [number, number, number] {
  const clean = String(hex || '#888888').replace('#', '').trim();
  const num = parseInt(clean.length === 6 ? clean : '888888', 16);
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  return [round4(r), round4(g), round4(b)];
}

/**
 * Construye una malla troncocónica/cilíndrica cerrada con perturbación orgánica determinista.
 * Útil para troncos de árboles, ramas, columnas, barriles y postes.
 */
export function buildTaperedCylinderMesh(params: {
  modelName: string;
  partName: string;
  size: [number, number, number];
  bottomScaleRatio: number;
  topScaleRatio: number;
  radialSegments: number;
  heightSegments: number;
  jitterAmount: number;
  colorHex: string;
  rng: () => number;
}) {
  const [sx, sy, sz] = params.size;
  const rxBase = Math.max(0.15, sx * 0.5);
  const rzBase = Math.max(0.15, sz * 0.5);
  const halfY = Math.max(0.15, sy * 0.5);
  const radial = clamp(Math.round(params.radialSegments), 5, 16);
  const rings = clamp(Math.round(params.heightSegments), 2, 8);

  const vertices: [number, number, number][] = [];
  const normals: [number, number, number][] = [];
  const uvs: [number, number][] = [];
  const faces: [number, number, number][] = [];

  // Anillos laterales desde abajo (-halfY) hasta arriba (+halfY)
  for (let r = 0; r <= rings; r++) {
    const vRatio = r / rings;
    const y = round4(-halfY + vRatio * sy);
    const radiusScale =
      params.bottomScaleRatio + (params.topScaleRatio - params.bottomScaleRatio) * vRatio;

    for (let s = 0; s < radial; s++) {
      const uRatio = s / radial;
      const angle = uRatio * Math.PI * 2;
      const jitter =
        r > 0 && r < rings
          ? 1 + (params.rng() - 0.5) * 2 * clamp(params.jitterAmount, 0, 0.35)
          : 1;
      const vx = round4(Math.cos(angle) * rxBase * radiusScale * jitter);
      const vz = round4(Math.sin(angle) * rzBase * radiusScale * jitter);
      vertices.push([vx, y, vz]);

      const nx = Math.cos(angle);
      const nz = Math.sin(angle);
      const nLen = Math.hypot(nx, 0.15, nz) || 1;
      normals.push([round4(nx / nLen), round4(0.15 / nLen), round4(nz / nLen)]);
      uvs.push([round4(uRatio), round4(vRatio)]);
    }
  }

  // Caras laterales
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < radial; s++) {
      const nextS = (s + 1) % radial;
      const a = r * radial + s;
      const b = r * radial + nextS;
      const c = (r + 1) * radial + nextS;
      const d = (r + 1) * radial + s;
      faces.push([a, b, c]);
      faces.push([a, c, d]);
    }
  }

  // Centro inferior y superior para cerrar la malla (manifold)
  const bottomCenterIdx = vertices.length;
  vertices.push([0, round4(-halfY), 0]);
  normals.push([0, -1, 0]);
  uvs.push([0.5, 0]);

  const topCenterIdx = vertices.length;
  vertices.push([0, round4(halfY), 0]);
  normals.push([0, 1, 0]);
  uvs.push([0.5, 1]);

  const topRingOffset = rings * radial;
  for (let s = 0; s < radial; s++) {
    const nextS = (s + 1) % radial;
    faces.push([bottomCenterIdx, nextS, s]);
    faces.push([topCenterIdx, topRingOffset + s, topRingOffset + nextS]);
  }

  return finalizeProceduralMeshData(
    params.modelName,
    params.partName,
    vertices,
    normals,
    uvs,
    faces,
    params.colorHex
  );
}

/**
 * Construye una malla de copa/follaje o roca facetada mediante esfera/domo subdividido con deformación orgánica determinista.
 */
export function buildOrganicCanopyOrRockMesh(params: {
  modelName: string;
  partName: string;
  size: [number, number, number];
  shapeStyle: 'spherical' | 'conical' | 'layered' | 'weeping' | 'faceted_rock';
  radialSegments: number;
  latSegments: number;
  jitterAmount: number;
  colorHex: string;
  rng: () => number;
}) {
  const [sx, sy, sz] = params.size;
  const rx = Math.max(0.25, sx * 0.5);
  const ry = Math.max(0.25, sy * 0.5);
  const rz = Math.max(0.25, sz * 0.5);
  const lonSegs = clamp(Math.round(params.radialSegments), 6, 16);
  const latSegs = clamp(Math.round(params.latSegments), 4, 12);

  const vertices: [number, number, number][] = [];
  const normals: [number, number, number][] = [];
  const uvs: [number, number][] = [];
  const faces: [number, number, number][] = [];

  // Polo inferior (índice 0)
  vertices.push([0, round4(-ry), 0]);
  normals.push([0, -1, 0]);
  uvs.push([0.5, 0]);

  // Anillos intermedios
  for (let lat = 1; lat < latSegs; lat++) {
    const t = lat / latSegs; // 0..1 de abajo a arriba
    const phi = (t - 0.5) * Math.PI; // -pi/2 .. +pi/2
    let ringY = Math.sin(phi) * ry;
    let ringRadiusFactor = Math.cos(phi);

    if (params.shapeStyle === 'conical') {
      ringY = (-0.5 + t) * sy;
      ringRadiusFactor = Math.max(0.12, 1.05 * (1 - t * 0.85));
    } else if (params.shapeStyle === 'layered') {
      const layerWave = 1 + 0.18 * Math.sin(t * Math.PI * 4);
      ringRadiusFactor *= layerWave;
    } else if (params.shapeStyle === 'weeping') {
      ringRadiusFactor *= t < 0.45 ? 1.15 : 0.88;
      ringY -= (1 - t) * ry * 0.12;
    } else if (params.shapeStyle === 'faceted_rock') {
      // Aplanar ligeramente la base de la roca para asentarla mejor
      if (t < 0.25) {
        ringY = Math.max(-ry * 0.92, ringY);
        ringRadiusFactor *= 1.08;
      }
    }

    for (let lon = 0; lon < lonSegs; lon++) {
      const u = lon / lonSegs;
      const theta = u * Math.PI * 2;
      const jitter = 1 + (params.rng() - 0.5) * 2 * clamp(params.jitterAmount, 0, 0.38);
      const vx = round4(Math.cos(theta) * rx * ringRadiusFactor * jitter);
      const vy = round4(clamp(ringY * (1 + (params.rng() - 0.5) * params.jitterAmount * 0.4), -ry, ry));
      const vz = round4(Math.sin(theta) * rz * ringRadiusFactor * jitter);

      vertices.push([vx, vy, vz]);
      const nLen = Math.hypot(vx, vy, vz) || 1;
      normals.push([round4(vx / nLen), round4(vy / nLen), round4(vz / nLen)]);
      uvs.push([round4(u), round4(t)]);
    }
  }

  // Polo superior
  const topPoleIdx = vertices.length;
  vertices.push([0, round4(ry), 0]);
  normals.push([0, 1, 0]);
  uvs.push([0.5, 1]);

  // Conectar polo inferior al primer anillo
  for (let lon = 0; lon < lonSegs; lon++) {
    const nextLon = (lon + 1) % lonSegs;
    faces.push([0, 1 + nextLon, 1 + lon]);
  }

  // Conectar anillos intermedios
  for (let lat = 0; lat < latSegs - 2; lat++) {
    const rowA = 1 + lat * lonSegs;
    const rowB = rowA + lonSegs;
    for (let lon = 0; lon < lonSegs; lon++) {
      const nextLon = (lon + 1) % lonSegs;
      const a = rowA + lon;
      const b = rowA + nextLon;
      const c = rowB + nextLon;
      const d = rowB + lon;
      faces.push([a, b, c]);
      faces.push([a, c, d]);
    }
  }

  // Conectar último anillo al polo superior
  const lastRingStart = 1 + (latSegs - 2) * lonSegs;
  for (let lon = 0; lon < lonSegs; lon++) {
    const nextLon = (lon + 1) % lonSegs;
    faces.push([topPoleIdx, lastRingStart + lon, lastRingStart + nextLon]);
  }

  return finalizeProceduralMeshData(
    params.modelName,
    params.partName,
    vertices,
    normals,
    uvs,
    faces,
    params.colorHex
  );
}

/**
 * Construye una caja biselada (chamfered box) cerrada para estructuras, mobiliario y props.
 */
export function buildBeveledBoxMesh(params: {
  modelName: string;
  partName: string;
  size: [number, number, number];
  bevelRatio: number;
  colorHex: string;
}) {
  const [sx, sy, sz] = params.size;
  const hx = Math.max(0.1, sx * 0.5);
  const hy = Math.max(0.1, sy * 0.5);
  const hz = Math.max(0.1, sz * 0.5);
  const b = clamp(params.bevelRatio, 0.02, 0.25);

  const vertices: [number, number, number][] = [
    // Anillo inferior biselado (0..3)
    [round4(-hx * (1 - b)), round4(-hy), round4(-hz * (1 - b))],
    [round4(hx * (1 - b)), round4(-hy), round4(-hz * (1 - b))],
    [round4(hx * (1 - b)), round4(-hy), round4(hz * (1 - b))],
    [round4(-hx * (1 - b)), round4(-hy), round4(hz * (1 - b))],
    // Cuerpo medio inferior (4..7)
    [round4(-hx), round4(-hy * (1 - b)), round4(-hz)],
    [round4(hx), round4(-hy * (1 - b)), round4(-hz)],
    [round4(hx), round4(-hy * (1 - b)), round4(hz)],
    [round4(-hx), round4(-hy * (1 - b)), round4(hz)],
    // Cuerpo medio superior (8..11)
    [round4(-hx), round4(hy * (1 - b)), round4(-hz)],
    [round4(hx), round4(hy * (1 - b)), round4(-hz)],
    [round4(hx), round4(hy * (1 - b)), round4(hz)],
    [round4(-hx), round4(hy * (1 - b)), round4(hz)],
    // Anillo superior biselado (12..15)
    [round4(-hx * (1 - b)), round4(hy), round4(-hz * (1 - b))],
    [round4(hx * (1 - b)), round4(hy), round4(-hz * (1 - b))],
    [round4(hx * (1 - b)), round4(hy), round4(hz * (1 - b))],
    [round4(-hx * (1 - b)), round4(hy), round4(hz * (1 - b))],
  ];

  const normals: [number, number, number][] = vertices.map(([vx, vy, vz]) => {
    const len = Math.hypot(vx, vy, vz) || 1;
    return [round4(vx / len), round4(vy / len), round4(vz / len)];
  });

  const uvs: [number, number][] = vertices.map(([_vx, vy], i) => [
    round4((i % 4) / 3),
    round4((vy + hy) / Math.max(0.2, sy)),
  ]);

  const faces: [number, number, number][] = [
    // Base inferior
    [0, 2, 1],
    [0, 3, 2],
    // Tapa superior
    [12, 13, 14],
    [12, 14, 15],
  ];

  const rings = [0, 4, 8, 12];
  for (let r = 0; r < rings.length - 1; r++) {
    const rA = rings[r];
    const rB = rings[r + 1];
    for (let s = 0; s < 4; s++) {
      const nextS = (s + 1) % 4;
      faces.push([rA + s, rA + nextS, rB + nextS]);
      faces.push([rA + s, rB + nextS, rB + s]);
    }
  }

  return finalizeProceduralMeshData(
    params.modelName,
    params.partName,
    vertices,
    normals,
    uvs,
    faces,
    params.colorHex
  );
}

function finalizeProceduralMeshData(
  modelName: string,
  partName: string,
  vertices: [number, number, number][],
  normals: [number, number, number][],
  uvs: [number, number][],
  faces: [number, number, number][],
  colorHex: string
) {
  const rgb = hexToRgbNormalized(colorHex);
  const vertexColors: [number, number, number][] = vertices.map((_, idx) => {
    const shade = 0.94 + (idx % 5) * 0.015;
    return [
      round4(clamp(rgb[0] * shade, 0, 1)),
      round4(clamp(rgb[1] * shade, 0, 1)),
      round4(clamp(rgb[2] * shade, 0, 1)),
    ];
  });

  const sig = `${modelName}:${partName}:v${vertices.length}:f${faces.length}`;
  const hashDec = parseInt(computeFnv1a32Hex(sig), 16) || 9100000000;
  const validNumericId = 9000000000 + (hashDec % 899999999);
  const assetUri = `rbxassetid://${validNumericId}`;

  const lod1Faces = faces.filter((_, idx) => idx % 2 === 0);
  const lod2Faces = faces.filter((_, idx) => idx % 3 === 0);

  return {
    meshId: assetUri,
    assetId: assetUri,
    sourceFormat: 'PROC',
    vertices,
    normals,
    uvs,
    vertexColors,
    faces,
    lodLevels: [
      { level: 0, ratio: 1.0, triangleCount: faces.length, faces },
      {
        level: 1,
        ratio: 0.5,
        triangleCount: Math.max(4, lod1Faces.length),
        faces: lod1Faces.length >= 4 ? lod1Faces : faces,
      },
      {
        level: 2,
        ratio: 0.25,
        triangleCount: Math.max(4, lod2Faces.length),
        faces: lod2Faces.length >= 4 ? lod2Faces : faces,
      },
    ],
  };
}

/**
 * Normaliza categoría de entrada hacia una de las 8 categorías oficiales.
 */
export function resolveCanonicalAssetCategory(
  rawCategory?: string,
  prompt?: string
): ForgeAssetCategory {
  const combined = `${rawCategory || ''} ${prompt || ''}`.toLowerCase();
  if (
    /tree|árbol|arbol|pine|oak|willow|forest|vegeta|bush|plant|canopy|bonsai|palm|flora/.test(
      combined
    )
  ) {
    return 'Trees & Vegetation';
  }
  if (/rock|roca|stone|piedra|cliff|boulder|mountain|terrain|crystal_rock|nature/.test(combined)) {
    return 'Rocks & Nature';
  }
  if (/building|edificio|tower|torre|house|casa|castle|wall|structure|estructura|arch|pillar/.test(combined)) {
    return 'Buildings & Structures';
  }
  if (/furniture|mobiliario|chair|silla|table|mesa|desk|bed|shelf|interior|cabinet/.test(combined)) {
    return 'Furniture & Interior';
  }
  if (/scene|escenario|portal|bridge|puente|platform|arena|altar|shrine_stage/.test(combined)) {
    return 'Scene Elements';
  }
  if (/stylized|estilizado|totem|lowpoly|cartoon|anime|fantasy_spire/.test(combined)) {
    return 'Stylized Assets';
  }
  if (/ambient|decor|lamp|farol|lantern|brazier|statue|fountain|banner/.test(combined)) {
    return 'Ambient & Decoration';
  }
  return 'Props';
}

/**
 * Fase 7 — Generador Procedural Parametrizado de Árboles 3D para Roblox.
 *
 * Soporta:
 * - Altura (`height`)
 * - Grosor de tronco (`trunkThickness`)
 * - Ramas (`branchCount`)
 * - Distribución de hojas (`leafDistribution`: `'dense' | 'balanced' | 'sparse' | 'clustered'`)
 * - Forma de copa (`canopyShape`: `'spherical' | 'conical' | 'layered' | 'weeping'`)
 * - Materiales (`trunkMaterial`, `leafMaterial`)
 * - Variación aleatoria controlada por semilla (`seed`, `variation`)
 */
export function generateParameterizedTree3DParts(
  modelName: string,
  params: TreeProceduralParams = {},
  collisionFidelity: string = 'Hull'
): any[] {
  const seed = params.seed ?? 'forge-tree-seed-2026';
  const rng = createSeededRng(seed);

  const height = clamp(Number(params.height ?? 14), 4, 45);
  const trunkThickness = clamp(Number(params.trunkThickness ?? 1.6), 0.4, 6.0);
  const branchCount = clamp(Math.round(Number(params.branchCount ?? 4)), 1, 12);
  const leafDistribution: LeafDistributionType =
    params.leafDistribution === 'dense' ||
    params.leafDistribution === 'balanced' ||
    params.leafDistribution === 'sparse' ||
    params.leafDistribution === 'clustered'
      ? params.leafDistribution
      : 'balanced';
  const canopyShape: CanopyShapeType =
    params.canopyShape === 'spherical' ||
    params.canopyShape === 'conical' ||
    params.canopyShape === 'layered' ||
    params.canopyShape === 'weeping'
      ? params.canopyShape
      : 'spherical';

  const trunkMaterial = String(params.trunkMaterial || 'Wood');
  const leafMaterial = String(params.leafMaterial || 'Grass');
  const trunkColor = String(params.trunkColor || '#5c4033');
  const leafColor = String(params.leafColor || '#2d6a4f');
  const variation = clamp(Number(params.variation ?? 0.22), 0, 1);

  const parts: any[] = [];

  // 1. Base radicular asentada exactamente en Y = 0
  const rootFlareHeight = round4(Math.max(0.6, height * 0.08));
  const rootFlareWidth = round4(trunkThickness * 1.45);
  const rootFlareSize: [number, number, number] = [
    rootFlareWidth,
    rootFlareHeight,
    rootFlareWidth,
  ];
  parts.push({
    partId: 'part_1_rootflare',
    name: 'RootFlare',
    parentPath: 'Root',
    shape: 'MeshPart',
    size: rootFlareSize,
    position: [0, round4(rootFlareHeight * 0.5), 0],
    rotation: [0, 0, 0],
    color: trunkColor,
    material: trunkMaterial,
    transparency: 0,
    reflectance: 0.02,
    roughness: 0.85,
    metalness: 0.05,
    canCollide: true,
    anchored: true,
    collisionFidelity,
    meshData: buildTaperedCylinderMesh({
      modelName,
      partName: 'RootFlare',
      size: rootFlareSize,
      bottomScaleRatio: 1.25,
      topScaleRatio: 0.82,
      radialSegments: 8,
      heightSegments: 2,
      jitterAmount: variation * 0.18,
      colorHex: trunkColor,
      rng,
    }),
  });

  // 2. Tronco principal articulado
  const trunkHeight = round4(height * 0.56);
  const trunkSize: [number, number, number] = [
    round4(trunkThickness),
    trunkHeight,
    round4(trunkThickness),
  ];
  const trunkCenterY = round4(rootFlareHeight * 0.85 + trunkHeight * 0.5);
  parts.push({
    partId: 'part_2_trunk',
    name: 'MainTrunk',
    parentPath: 'Root',
    shape: 'MeshPart',
    size: trunkSize,
    position: [0, trunkCenterY, 0],
    rotation: [
      round4((rng() - 0.5) * 4 * variation),
      round4(rng() * 360),
      round4((rng() - 0.5) * 4 * variation),
    ],
    color: trunkColor,
    material: trunkMaterial,
    transparency: 0,
    reflectance: 0.02,
    roughness: 0.82,
    metalness: 0.04,
    canCollide: true,
    anchored: true,
    collisionFidelity,
    meshData: buildTaperedCylinderMesh({
      modelName,
      partName: 'MainTrunk',
      size: trunkSize,
      bottomScaleRatio: 1.0,
      topScaleRatio: 0.62,
      radialSegments: 8,
      heightSegments: 4,
      jitterAmount: variation * 0.22,
      colorHex: trunkColor,
      rng,
    }),
  });

  // 3. Ramas secundarias parametrizadas (`branchCount`)
  const branchStartHeight = rootFlareHeight + trunkHeight * 0.58;
  const branchSpreadRadius = Math.max(1.2, height * 0.18);
  const branchEndpoints: [number, number, number][] = [];

  for (let i = 0; i < branchCount; i++) {
    const angle = (i / branchCount) * Math.PI * 2 + (rng() - 0.5) * 0.45 * variation;
    const tierFactor = i / Math.max(1, branchCount - 1);
    const branchLength = round4(
      Math.max(1.4, height * (0.24 - tierFactor * 0.06) * (0.9 + rng() * 0.25 * variation))
    );
    const branchThick = round4(Math.max(0.28, trunkThickness * (0.48 - tierFactor * 0.12)));
    const pitchDeg = canopyShape === 'weeping' ? 58 : canopyShape === 'conical' ? 32 : 42;
    const tiltRad = (pitchDeg * Math.PI) / 180;

    const radialOffset = Math.sin(tiltRad) * branchLength * 0.5;
    const verticalOffset = Math.cos(tiltRad) * branchLength * 0.5;

    const bx = round4(Math.cos(angle) * (trunkThickness * 0.25 + radialOffset));
    const by = round4(branchStartHeight + tierFactor * (trunkHeight * 0.32) + verticalOffset);
    const bz = round4(Math.sin(angle) * (trunkThickness * 0.25 + radialOffset));

    const tipX = round4(Math.cos(angle) * (trunkThickness * 0.3 + radialOffset * 1.85));
    const tipY = round4(
      branchStartHeight +
        tierFactor * (trunkHeight * 0.32) +
        verticalOffset * (canopyShape === 'weeping' ? 1.2 : 1.75)
    );
    const tipZ = round4(Math.sin(angle) * (trunkThickness * 0.3 + radialOffset * 1.85));
    branchEndpoints.push([tipX, tipY, tipZ]);

    const branchName = `Branch_${i + 1}`;
    const branchSize: [number, number, number] = [branchThick, branchLength, branchThick];
    parts.push({
      partId: `part_branch_${i + 1}`,
      name: branchName,
      parentPath: 'Root/Branches',
      shape: 'MeshPart',
      size: branchSize,
      position: [bx, by, bz],
      rotation: [
        round4(Math.sin(angle) * pitchDeg),
        round4((angle * 180) / Math.PI),
        round4(-Math.cos(angle) * pitchDeg),
      ],
      color: trunkColor,
      material: trunkMaterial,
      transparency: 0,
      reflectance: 0.02,
      roughness: 0.8,
      metalness: 0.04,
      canCollide: true,
      anchored: true,
      collisionFidelity,
      meshData: buildTaperedCylinderMesh({
        modelName,
        partName: branchName,
        size: branchSize,
        bottomScaleRatio: 1.0,
        topScaleRatio: 0.45,
        radialSegments: 6,
        heightSegments: 3,
        jitterAmount: variation * 0.2,
        colorHex: trunkColor,
        rng,
      }),
    });
  }

  // 4. Copa principal (`CanopyCrown_Main`) según `canopyShape` y `leafDistribution`
  const densityMultiplier =
    leafDistribution === 'dense'
      ? 1.25
      : leafDistribution === 'sparse'
      ? 0.75
      : leafDistribution === 'clustered'
      ? 1.05
      : 1.0;

  const crownWidth = round4(
    Math.max(2.6, height * (canopyShape === 'conical' ? 0.46 : 0.56) * densityMultiplier)
  );
  const crownHeight = round4(
    Math.max(
      2.2,
      height *
        (canopyShape === 'conical'
          ? 0.55
          : canopyShape === 'layered'
          ? 0.34
          : canopyShape === 'weeping'
          ? 0.48
          : 0.44) *
        densityMultiplier
    )
  );
  const crownCenterY = round4(rootFlareHeight + trunkHeight * 0.88 + crownHeight * 0.26);
  const crownSize: [number, number, number] = [crownWidth, crownHeight, crownWidth];

  parts.push({
    partId: 'part_canopy_main',
    name: 'CanopyCrown_Main',
    parentPath: 'Root/Canopy',
    shape: 'MeshPart',
    size: crownSize,
    position: [0, crownCenterY, 0],
    rotation: [0, round4(rng() * 360), 0],
    color: leafColor,
    material: leafMaterial,
    transparency: 0,
    reflectance: 0.04,
    roughness: 0.72,
    metalness: 0.02,
    canCollide: true,
    anchored: true,
    collisionFidelity,
    meshData: buildOrganicCanopyOrRockMesh({
      modelName,
      partName: 'CanopyCrown_Main',
      size: crownSize,
      shapeStyle: canopyShape,
      radialSegments: 10,
      latSegments: 6,
      jitterAmount: variation * 0.28,
      colorHex: leafColor,
      rng,
    }),
  });

  // 5. Racimos de follaje secundarios (`FoliageCluster_1..N`) controlados por `leafDistribution`
  const clusterCount =
    leafDistribution === 'dense'
      ? Math.max(4, branchCount)
      : leafDistribution === 'sparse'
      ? Math.max(1, Math.floor(branchCount * 0.5))
      : Math.max(2, Math.min(6, branchCount));

  for (let c = 0; c < clusterCount; c++) {
    const anchor = branchEndpoints[c % branchEndpoints.length] || [
      round4(Math.cos(c) * branchSpreadRadius),
      crownCenterY,
      round4(Math.sin(c) * branchSpreadRadius),
    ];
    const clusterScale = round4(
      (0.45 + (rng() * 0.22 * variation)) * (leafDistribution === 'clustered' ? 1.15 : 1.0)
    );
    const clusterSize: [number, number, number] = [
      round4(Math.max(1.5, crownWidth * clusterScale)),
      round4(Math.max(1.2, crownHeight * clusterScale * (canopyShape === 'layered' ? 0.65 : 0.85))),
      round4(Math.max(1.5, crownWidth * clusterScale)),
    ];
    const clusterName = `FoliageCluster_${c + 1}`;
    const clusterY = Math.max(
      round4(clusterSize[1] * 0.5 + 0.5),
      round4(anchor[1] + (canopyShape === 'weeping' ? -0.35 : 0.45))
    );

    parts.push({
      partId: `part_foliage_${c + 1}`,
      name: clusterName,
      parentPath: 'Root/Canopy',
      shape: 'MeshPart',
      size: clusterSize,
      position: [anchor[0], clusterY, anchor[2]],
      rotation: [
        round4((rng() - 0.5) * 12 * variation),
        round4(rng() * 360),
        round4((rng() - 0.5) * 12 * variation),
      ],
      color: leafColor,
      material: leafMaterial,
      transparency: 0,
      reflectance: 0.04,
      roughness: 0.74,
      metalness: 0.02,
      canCollide: false,
      anchored: true,
      collisionFidelity,
      meshData: buildOrganicCanopyOrRockMesh({
        modelName,
        partName: clusterName,
        size: clusterSize,
        shapeStyle: canopyShape,
        radialSegments: 8,
        latSegments: 5,
        jitterAmount: variation * 0.3,
        colorHex: leafColor,
        rng,
      }),
    });
  }

  return groundAndNormalizeParts(parts);
}

/**
 * Ajusta todas las piezas para que el punto más bajo del modelo descanse exactamente en `Y = 0`.
 */
export function groundAndNormalizeParts(parts: any[]): any[] {
  let minY = Infinity;
  for (const p of parts) {
    const py = Number(p.position?.[1] ?? 0);
    const sy = Number(p.size?.[1] ?? 1);
    const bottom = py - sy * 0.5;
    if (bottom < minY) minY = bottom;
  }
  if (!Number.isFinite(minY)) minY = 0;
  const shiftY = -minY;

  return parts.map((p) => ({
    ...p,
    position: [
      round4(Number(p.position?.[0] ?? 0)),
      round4(Number(p.position?.[1] ?? 0) + shiftY),
      round4(Number(p.position?.[2] ?? 0)),
    ],
  }));
}

/**
 * Sintetiza las piezas para cualquiera de las 8 categorías oficiales usando semilla reproducible.
 */
export function generateSeededCategoryParts(
  modelName: string,
  category: ForgeAssetCategory,
  seed: string | number = 'forge-seed-2026',
  collisionFidelity: string = 'Hull',
  treeParams?: TreeProceduralParams
): { parts: any[]; pbrProfile: Record<string, any>; description: string } {
  if (category === 'Trees & Vegetation') {
    const effectiveTreeParams: TreeProceduralParams = {
      seed,
      ...treeParams,
    };
    const parts = generateParameterizedTree3DParts(modelName, effectiveTreeParams, collisionFidelity);
    return {
      parts,
      pbrProfile: {
        albedo_hex: effectiveTreeParams.leafColor || '#2d6a4f',
        roughness: 0.76,
        metalness: 0.04,
        emissive_hex: '#000000',
        roblox_material: effectiveTreeParams.leafMaterial || 'Grass',
        pattern: 'OrganicFoliageBark',
      },
      description: `Árbol 3D procedural parametrizado (seed=${String(seed)}, altura=${
        effectiveTreeParams.height ?? 14
      } studs, ramas=${effectiveTreeParams.branchCount ?? 4}, copa=${
        effectiveTreeParams.canopyShape ?? 'spherical'
      }, follaje=${effectiveTreeParams.leafDistribution ?? 'balanced'}).`,
    };
  }

  const rng = createSeededRng(seed);

  if (category === 'Rocks & Nature') {
    const rockCount = 5;
    const parts: any[] = [];
    const rockColors = ['#64748b', '#475569', '#334155', '#52525b', '#71717a'];
    for (let i = 0; i < rockCount; i++) {
      const isMain = i === 0;
      const sx = round4(isMain ? 5.2 + rng() * 1.6 : 2.0 + rng() * 2.2);
      const sy = round4(isMain ? 3.8 + rng() * 1.8 : 1.4 + rng() * 1.8);
      const sz = round4(isMain ? 4.8 + rng() * 1.5 : 2.0 + rng() * 2.2);
      const angle = (i / rockCount) * Math.PI * 2 + rng() * 0.5;
      const dist = isMain ? 0 : 2.2 + rng() * 1.4;
      const color = rockColors[i % rockColors.length];
      const partName = isMain ? 'PrimaryBoulder' : `RockCluster_${i}`;
      parts.push({
        partId: `part_rock_${i + 1}`,
        name: partName,
        parentPath: isMain ? 'Root' : 'Root/RockFormation',
        shape: 'MeshPart',
        size: [sx, sy, sz],
        position: [round4(Math.cos(angle) * dist), round4(sy * 0.5), round4(Math.sin(angle) * dist)],
        rotation: [round4((rng() - 0.5) * 15), round4(rng() * 360), round4((rng() - 0.5) * 15)],
        color,
        material: 'Slate',
        transparency: 0,
        reflectance: 0.05,
        roughness: 0.88,
        metalness: 0.08,
        canCollide: true,
        anchored: true,
        collisionFidelity,
        meshData: buildOrganicCanopyOrRockMesh({
          modelName,
          partName,
          size: [sx, sy, sz],
          shapeStyle: 'faceted_rock',
          radialSegments: 8,
          latSegments: 5,
          jitterAmount: 0.26,
          colorHex: color,
          rng,
        }),
      });
    }
    return {
      parts: groundAndNormalizeParts(parts),
      pbrProfile: {
        albedo_hex: '#64748b',
        roughness: 0.88,
        metalness: 0.08,
        emissive_hex: '#000000',
        roblox_material: 'Slate',
        pattern: 'NaturalStratifiedStone',
      },
      description: `Formación rocosa natural procedural (seed=${String(seed)}, ${parts.length} sub-mallas facetadas).`,
    };
  }

  if (category === 'Buildings & Structures') {
    const baseW = round4(8 + rng() * 2);
    const wallH = round4(7 + rng() * 2);
    const parts: any[] = [
      {
        partId: 'part_struct_foundation',
        name: 'StoneFoundation',
        parentPath: 'Root',
        shape: 'MeshPart',
        size: [baseW, 1.2, baseW],
        position: [0, 0.6, 0],
        rotation: [0, 0, 0],
        color: '#475569',
        material: 'Concrete',
        transparency: 0,
        reflectance: 0.04,
        roughness: 0.85,
        metalness: 0.08,
        canCollide: true,
        anchored: true,
        collisionFidelity,
        meshData: buildBeveledBoxMesh({
          modelName,
          partName: 'StoneFoundation',
          size: [baseW, 1.2, baseW],
          bevelRatio: 0.08,
          colorHex: '#475569',
        }),
      },
    ];
    const cornerOffsets: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    cornerOffsets.forEach(([ox, oz], idx) => {
      const colName = `SupportPillar_${idx + 1}`;
      const colSize: [number, number, number] = [1.2, wallH, 1.2];
      parts.push({
        partId: `part_struct_pillar_${idx + 1}`,
        name: colName,
        parentPath: 'Root/Columns',
        shape: 'MeshPart',
        size: colSize,
        position: [round4(ox * (baseW * 0.38)), round4(1.2 + wallH * 0.5), round4(oz * (baseW * 0.38))],
        rotation: [0, 0, 0],
        color: '#94a3b8',
        material: 'Concrete',
        transparency: 0,
        reflectance: 0.05,
        roughness: 0.78,
        metalness: 0.1,
        canCollide: true,
        anchored: true,
        collisionFidelity,
        meshData: buildTaperedCylinderMesh({
          modelName,
          partName: colName,
          size: colSize,
          bottomScaleRatio: 1.05,
          topScaleRatio: 0.92,
          radialSegments: 8,
          heightSegments: 3,
          jitterAmount: 0.02,
          colorHex: '#94a3b8',
          rng,
        }),
      });
    });
    const roofH = round4(3.2 + rng() * 1.2);
    const roofSize: [number, number, number] = [round4(baseW * 1.08), roofH, round4(baseW * 1.08)];
    parts.push({
      partId: 'part_struct_roof',
      name: 'PitchedRoofCrown',
      parentPath: 'Root/Roof',
      shape: 'MeshPart',
      size: roofSize,
      position: [0, round4(1.2 + wallH + roofH * 0.5), 0],
      rotation: [0, 45, 0],
      color: '#7c2d12',
      material: 'Slate',
      transparency: 0,
      reflectance: 0.06,
      roughness: 0.74,
      metalness: 0.12,
      canCollide: true,
      anchored: true,
      collisionFidelity,
      meshData: buildTaperedCylinderMesh({
        modelName,
        partName: 'PitchedRoofCrown',
        size: roofSize,
        bottomScaleRatio: 1.1,
        topScaleRatio: 0.08,
        radialSegments: 4,
        heightSegments: 2,
        jitterAmount: 0,
        colorHex: '#7c2d12',
        rng,
      }),
    });

    return {
      parts: groundAndNormalizeParts(parts),
      pbrProfile: {
        albedo_hex: '#94a3b8',
        roughness: 0.78,
        metalness: 0.1,
        emissive_hex: '#000000',
        roblox_material: 'Concrete',
        pattern: 'ModularArchitecturalStone',
      },
      description: `Estructura modular arquitectónica (seed=${String(seed)}, ${parts.length} piezas articuladas).`,
    };
  }

  // Categorías restantes: Furniture & Interior, Scene Elements, Stylized Assets, Ambient & Decoration, Props
  const paletteByCategory: Record<
    string,
    { primary: string; secondary: string; accent: string; matPrimary: string; matAccent: string }
  > = {
    'Furniture & Interior': {
      primary: '#78350f',
      secondary: '#92400e',
      accent: '#d97706',
      matPrimary: 'WoodPlanks',
      matAccent: 'Metal',
    },
    'Scene Elements': {
      primary: '#334155',
      secondary: '#475569',
      accent: '#38bdf8',
      matPrimary: 'Slate',
      matAccent: 'Neon',
    },
    'Stylized Assets': {
      primary: '#4f46e5',
      secondary: '#7c3aed',
      accent: '#22d3ee',
      matPrimary: 'SmoothPlastic',
      matAccent: 'Neon',
    },
    'Ambient & Decoration': {
      primary: '#1e293b',
      secondary: '#334155',
      accent: '#f59e0b',
      matPrimary: 'Metal',
      matAccent: 'Neon',
    },
    Props: {
      primary: '#475569',
      secondary: '#64748b',
      accent: '#0ea5e9',
      matPrimary: 'Metal',
      matAccent: 'Neon',
    },
  };

  const pal = paletteByCategory[category] || paletteByCategory.Props;
  const baseWidth = round4(3.2 + rng() * 1.4);
  const bodyHeight = round4(3.4 + rng() * 1.8);

  const parts: any[] = [
    {
      partId: 'part_1_pedestal_base',
      name: 'BaseFoundation',
      parentPath: 'Root',
      shape: 'MeshPart',
      size: [baseWidth, 0.8, baseWidth],
      position: [0, 0.4, 0],
      rotation: [0, 0, 0],
      color: pal.primary,
      material: pal.matPrimary,
      transparency: 0,
      reflectance: 0.08,
      roughness: 0.55,
      metalness: 0.45,
      canCollide: true,
      anchored: true,
      collisionFidelity,
      meshData: buildBeveledBoxMesh({
        modelName,
        partName: 'BaseFoundation',
        size: [baseWidth, 0.8, baseWidth],
        bevelRatio: 0.12,
        colorHex: pal.primary,
      }),
    },
    {
      partId: 'part_2_core_body',
      name: 'PrimaryCoreBody',
      parentPath: 'Root',
      shape: 'MeshPart',
      size: [round4(baseWidth * 0.72), bodyHeight, round4(baseWidth * 0.72)],
      position: [0, round4(0.8 + bodyHeight * 0.5), 0],
      rotation: [0, round4(rng() * 90), 0],
      color: pal.secondary,
      material: pal.matPrimary,
      transparency: 0,
      reflectance: 0.1,
      roughness: 0.48,
      metalness: 0.52,
      canCollide: true,
      anchored: true,
      collisionFidelity,
      meshData: buildTaperedCylinderMesh({
        modelName,
        partName: 'PrimaryCoreBody',
        size: [round4(baseWidth * 0.72), bodyHeight, round4(baseWidth * 0.72)],
        bottomScaleRatio: 1.0,
        topScaleRatio: 0.84,
        radialSegments: 8,
        heightSegments: 3,
        jitterAmount: 0.06,
        colorHex: pal.secondary,
        rng,
      }),
    },
    {
      partId: 'part_3_top_crown',
      name: 'UpperCrownAssembly',
      parentPath: 'Root/Upper',
      shape: 'MeshPart',
      size: [round4(baseWidth * 0.85), 0.9, round4(baseWidth * 0.85)],
      position: [0, round4(0.8 + bodyHeight + 0.45), 0],
      rotation: [0, 0, 0],
      color: pal.primary,
      material: pal.matPrimary,
      transparency: 0,
      reflectance: 0.12,
      roughness: 0.42,
      metalness: 0.6,
      canCollide: true,
      anchored: true,
      collisionFidelity,
      meshData: buildBeveledBoxMesh({
        modelName,
        partName: 'UpperCrownAssembly',
        size: [round4(baseWidth * 0.85), 0.9, round4(baseWidth * 0.85)],
        bevelRatio: 0.15,
        colorHex: pal.primary,
      }),
    },
    {
      partId: 'part_4_accent_emitter',
      name: 'AccentCrestEmitter',
      parentPath: 'Root/Accents',
      shape: 'MeshPart',
      size: [round4(baseWidth * 0.42), 1.2, round4(baseWidth * 0.42)],
      position: [0, round4(0.8 + bodyHeight + 1.4), 0],
      rotation: [0, round4(rng() * 180), 0],
      color: pal.accent,
      material: pal.matAccent,
      transparency: 0,
      reflectance: 0.2,
      roughness: 0.2,
      metalness: 0.8,
      canCollide: false,
      anchored: true,
      collisionFidelity,
      meshData: buildOrganicCanopyOrRockMesh({
        modelName,
        partName: 'AccentCrestEmitter',
        size: [round4(baseWidth * 0.42), 1.2, round4(baseWidth * 0.42)],
        shapeStyle: 'conical',
        radialSegments: 8,
        latSegments: 4,
        jitterAmount: 0.05,
        colorHex: pal.accent,
        rng,
      }),
    },
  ];

  return {
    parts: groundAndNormalizeParts(parts),
    pbrProfile: {
      albedo_hex: pal.primary,
      roughness: 0.48,
      metalness: 0.52,
      emissive_hex: pal.accent,
      roblox_material: pal.matPrimary,
      pattern: 'PrecisionCompositeTrim',
    },
    description: `Asset 3D procedural categoría '${category}' (seed=${String(seed)}, ${
      parts.length
    } sub-mallas EditableMesh).`,
  };
}

/**
 * Construye el paquete completo de Asset 3D listo para:
 * - Visualizador 3D interactivo
 * - Validación geométrica EditableMesh
 * - Exportación (.luau, .rbxmx, .gltf, .obj)
 * - Sincronización Rojo y Roblox Studio Plugin via Forge Local Bridge
 * - Persistencia en Biblioteca de Assets
 */
export function synthesizeSeededProcedural3DAsset(req: Procedural3DGenerationRequest): Record<string, any> {
  const canonicalCategory = resolveCanonicalAssetCategory(req.category, req.prompt);
  const rawName =
    req.name ||
    (canonicalCategory === 'Trees & Vegetation'
      ? 'ProceduralRobloxTree'
      : String(req.prompt || canonicalCategory)
          .replace(/[^a-zA-Z0-9 ]/g, ' ')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join('')) ||
    'ProceduralAsset3D';

  const safeModelName = rawName.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32) || 'ProceduralAsset3D';
  const seed = req.seed ?? req.tree_params?.seed ?? `${safeModelName}-seed-2026`;
  const collisionFidelity = req.collision_fidelity || 'Hull';
  const assetType = req.asset_type || 'Model3D';

  const generated = generateSeededCategoryParts(
    safeModelName,
    canonicalCategory,
    seed,
    collisionFidelity,
    req.tree_params
  );

  const normalizedParts = normalizePartsWithSyncMetadata(generated.parts, safeModelName);
  const totalTris = normalizedParts.reduce(
    (sum: number, p: any) => sum + (Array.isArray(p.meshData?.faces) ? p.meshData.faces.length : 12),
    0
  );

  const luauCode = buildStrictLuauFromEditedParts(
    safeModelName,
    normalizedParts,
    collisionFidelity
  );
  const fileName = `${safeModelName}.luau`;
  const deterministicId = `asset-proc-${computeFnv1a32Hex(`${safeModelName}:${String(seed)}:${totalTris}`)}`;

  return {
    id: deterministicId,
    name: safeModelName,
    category: canonicalCategory,
    asset_type: assetType,
    generation_mode: 'procedural',
    seed: String(seed),
    tree_params: canonicalCategory === 'Trees & Vegetation' ? { seed, ...req.tree_params } : undefined,
    poly_count: totalTris,
    collision_fidelity: collisionFidelity,
    rojo_target_folder: 'src/shared/Assets3D',
    file_name: fileName,
    description: generated.description,
    pbr_profile: generated.pbrProfile,
    parts: normalizedParts,
    luau_code: luauCode,
  };
}
