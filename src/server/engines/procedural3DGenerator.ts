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

import crypto from 'crypto';
import {
  buildStrictLuauFromEditedParts,
  canonicalEulerToMatrix9,
  computeFnv1a32Hex,
  normalizePartsWithSyncMetadata,
} from './worldAndModelEditorEngine.ts';

import { parseNaturalLanguageToTreeParams } from '../../utils/treePromptParser.ts';
import { resolveColorRgb255 } from '../../utils/colorUtils.ts';
import {
  type AiDirectorBlueprint,
  type EngineExecutionReport,
  type GenerationExecutionMode,
  validateAndSanitizeDirectorBlueprint,
} from './aiGenerationDirector.ts';
import {
  analyzeReferenceImageBase64,
  evaluateReferenceVsModelMetrics,
  type ReferenceImageAnalysis,
  type ReferenceImageComparisonMetrics,
} from './imageReferenceProcessor.ts';
import {
  buildPartsFromSpecializedEngine,
  computeBudgetAllocationProfile,
} from './specializedGeometryGenerators.ts';
import {
  evaluateSemanticVisualIdentity,
  interpretPromptSemantics,
  renderMultiAngleSvgSnapshots,
} from './universalFreeform3DEngine.ts';

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
export type BranchDistributionType = 'tiered' | 'whorled' | 'alternating' | 'canopy_top';
export type TreeDetailLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface TreeProceduralParams {
  seed?: string | number;
  height?: number;
  width?: number;
  trunkThickness?: number;
  trunkLean?: number;
  trunkCurvature?: number;
  rootFlareScale?: number;
  branchCount?: number;
  branchLength?: number;
  branchDistribution?: BranchDistributionType;
  leafDistribution?: LeafDistributionType;
  canopyShape?: CanopyShapeType;
  canopySize?: number;
  foliageCount?: number;
  foliageDensity?: number;
  trunkMaterial?: string;
  leafMaterial?: string;
  trunkColor?: string;
  leafColor?: string;
  variation?: number;
  leafVariation?: number;
  colorVariation?: number;
  detailLevel?: TreeDetailLevel;
  lodLevel?: 0 | 1 | 2;
  targetPolyBudget?: number;
  species?: 'oak' | 'pine' | 'willow' | 'dead' | 'fantasy' | 'bonsai';
}

export type Procedural3DPart = Record<string, any>;
export type Procedural3DSynthesisResult = Record<string, any>;

export interface Procedural3DGenerationRequest {
  prompt?: string;
  name?: string;
  category?: string;
  sub_category?: string;
  style?: string;
  asset_type?: 'Model3D' | 'Scene3D';
  generation_mode?: GenerationExecutionMode;
  collision_fidelity?: 'Hull' | 'Box' | 'PreciseConvexDecomposition' | 'Default';
  target_poly_budget?: number;
  detail_level?: TreeDetailLevel;
  seed?: string | number;
  tree_params?: TreeProceduralParams & Record<string, any>;
  manually_edited_fields?: string[];
  reference_image_base64?: string;
  ai_director_blueprint?: Partial<AiDirectorBlueprint>;
  director_blueprint?: Partial<AiDirectorBlueprint>;
  execution_report?: Partial<EngineExecutionReport>;
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

function hexToRgbNormalized(colorInput: unknown): [number, number, number] {
  const [rByte, gByte, bByte] = resolveColorRgb255(colorInput, [136, 136, 136]);
  return [round4(rByte / 255), round4(gByte / 255), round4(bByte / 255)];
}

interface RawProceduralGeometry {
  vertices: [number, number, number][];
  normals: [number, number, number][];
  uvs: [number, number][];
  faces: [number, number, number][];
}

function modulateHexColor(colorInput: unknown, factor: number): string {
  const [rBase, gBase, bBase] = resolveColorRgb255(colorInput, [45, 106, 79]);
  const r = Math.round(clamp(rBase * factor, 0, 255));
  const g = Math.round(clamp(gBase * factor, 0, 255));
  const b = Math.round(clamp(bBase * factor, 0, 255));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Recalcula normales suaves ponderadas por área de cada triángulo válido y garantiza vector unitario finito.
 */
function recomputeSmoothNormals(
  vertices: [number, number, number][],
  faces: [number, number, number][],
  fallbackNormals: [number, number, number][]
): [number, number, number][] {
  const accum: [number, number, number][] = vertices.map(() => [0, 0, 0]);
  for (const [i0, i1, i2] of faces) {
    const a = vertices[i0];
    const b = vertices[i1];
    const c = vertices[i2];
    if (!a || !b || !c) continue;
    const e1x = b[0] - a[0];
    const e1y = b[1] - a[1];
    const e1z = b[2] - a[2];
    const e2x = c[0] - a[0];
    const e2y = c[1] - a[1];
    const e2z = c[2] - a[2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nz)) continue;
    accum[i0][0] += nx;
    accum[i0][1] += ny;
    accum[i0][2] += nz;
    accum[i1][0] += nx;
    accum[i1][1] += ny;
    accum[i1][2] += nz;
    accum[i2][0] += nx;
    accum[i2][1] += ny;
    accum[i2][2] += nz;
  }

  return accum.map((acc, idx) => {
    const len = Math.hypot(acc[0], acc[1], acc[2]);
    if (len > 1e-8 && Number.isFinite(len)) {
      return [round4(acc[0] / len), round4(acc[1] / len), round4(acc[2] / len)];
    }
    const fb = fallbackNormals[idx] || [0, 1, 0];
    const fbLen = Math.hypot(fb[0], fb[1], fb[2]) || 1;
    return [round4(fb[0] / fbLen), round4(fb[1] / fbLen), round4(fb[2] / fbLen)];
  });
}

function buildCylinderBuffers(params: {
  size: [number, number, number];
  bottomScaleRatio: number;
  topScaleRatio: number;
  radialSegments: number;
  heightSegments: number;
  jitterAmount: number;
  bendOffsetX?: number;
  bendOffsetZ?: number;
  curvatureAmount?: number;
  radialLobeAmplitude?: number;
  radialLobeCount?: number;
  rng: () => number;
}): RawProceduralGeometry {
  const [sx, sy, sz] = params.size;
  const rxBase = Math.max(0.15, sx * 0.5);
  const rzBase = Math.max(0.15, sz * 0.5);
  const halfY = Math.max(0.15, sy * 0.5);
  const radial = clamp(Math.round(params.radialSegments), 4, 16);
  const rings = clamp(Math.round(params.heightSegments), 1, 10);
  const bendX = Number(params.bendOffsetX || 0);
  const bendZ = Number(params.bendOffsetZ || 0);
  const curv = clamp(Number(params.curvatureAmount || 0), 0, 1);
  const lobeAmp = clamp(Number(params.radialLobeAmplitude || 0), 0, 0.35);
  const lobeCount = clamp(Math.round(Number(params.radialLobeCount || 5)), 3, 8);

  const vertices: [number, number, number][] = [];
  const normals: [number, number, number][] = [];
  const uvs: [number, number][] = [];
  const faces: [number, number, number][] = [];

  for (let r = 0; r <= rings; r++) {
    const vRatio = r / rings;
    const y = round4(-halfY + vRatio * sy);
    const radiusScale =
      params.bottomScaleRatio + (params.topScaleRatio - params.bottomScaleRatio) * vRatio;
    const spineShiftX =
      bendX * (vRatio * vRatio) + Math.sin(vRatio * Math.PI) * curv * Math.max(sx * 0.75, sy * 0.12);
    const spineShiftZ =
      bendZ * (vRatio * vRatio) + Math.sin(vRatio * Math.PI * 1.5) * curv * Math.max(sz * 0.35, sy * 0.05);

    for (let s = 0; s < radial; s++) {
      const uRatio = s / radial;
      const angle = uRatio * Math.PI * 2;
      const jitter =
        r > 0 && r < rings
          ? 1 + (params.rng() - 0.5) * 2 * clamp(params.jitterAmount, 0, 0.35)
          : 1;
      const lobeFactor =
        lobeAmp > 0 && r < rings
          ? Math.max(0.55, 1 + lobeAmp * (1 - vRatio * 0.85) * Math.sin(angle * lobeCount))
          : 1;
      const vx = round4(spineShiftX + Math.cos(angle) * rxBase * radiusScale * jitter * lobeFactor);
      const vz = round4(spineShiftZ + Math.sin(angle) * rzBase * radiusScale * jitter * lobeFactor);
      vertices.push([vx, y, vz]);

      const nx = Math.cos(angle);
      const nz = Math.sin(angle);
      const nLen = Math.hypot(nx, 0.15, nz) || 1;
      normals.push([round4(nx / nLen), round4(0.15 / nLen), round4(nz / nLen)]);
      uvs.push([round4(clamp(uRatio, 0, 1)), round4(clamp(vRatio, 0, 1))]);
    }
  }

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

  const bottomCenterIdx = vertices.length;
  vertices.push([0, round4(-halfY), 0]);
  normals.push([0, -1, 0]);
  uvs.push([0.5, 0]);

  const topCenterIdx = vertices.length;
  const topSpineX = round4(bendX);
  const topSpineZ = round4(bendZ + Math.sin(Math.PI * 1.5) * curv * sz * 0.25);
  vertices.push([topSpineX, round4(halfY), topSpineZ]);
  normals.push([0, 1, 0]);
  uvs.push([0.5, 1]);

  const topRingOffset = rings * radial;
  for (let s = 0; s < radial; s++) {
    const nextS = (s + 1) % radial;
    faces.push([bottomCenterIdx, nextS, s]);
    faces.push([topCenterIdx, topRingOffset + s, topRingOffset + nextS]);
  }

  return {
    vertices,
    normals: recomputeSmoothNormals(vertices, faces, normals),
    uvs,
    faces,
  };
}

/**
 * Construye una malla troncocónica/cilíndrica cerrada con perturbación orgánica determinista
 * y niveles LOD 1 y LOD 2 igualmente cerrados (watertight, cero caras rotas).
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
  bendOffsetX?: number;
  bendOffsetZ?: number;
  curvatureAmount?: number;
  radialLobeAmplitude?: number;
  radialLobeCount?: number;
  activeLod?: 0 | 1 | 2;
  rng: () => number;
}) {
  const lod0 = buildCylinderBuffers(params);
  const lod1Rng = createSeededRng(`${params.modelName}:${params.partName}:cyl-lod1`);
  const lod2Rng = createSeededRng(`${params.modelName}:${params.partName}:cyl-lod2`);

  const lod1 = buildCylinderBuffers({
    ...params,
    radialSegments: Math.max(5, Math.ceil(params.radialSegments * 0.65)),
    heightSegments: Math.max(1, Math.ceil(params.heightSegments * 0.5)),
    rng: lod1Rng,
  });
  const lod2 = buildCylinderBuffers({
    ...params,
    radialSegments: Math.max(4, Math.floor(params.radialSegments * 0.5)),
    heightSegments: 1,
    jitterAmount: params.jitterAmount * 0.5,
    rng: lod2Rng,
  });

  return finalizeProceduralMeshData(
    params.modelName,
    params.partName,
    lod0.vertices,
    lod0.normals,
    lod0.uvs,
    lod0.faces,
    params.colorHex,
    lod1,
    lod2,
    params.activeLod
  );
}

function buildOrganicCanopyOrRockBuffers(params: {
  size: [number, number, number];
  shapeStyle: 'spherical' | 'conical' | 'layered' | 'weeping' | 'faceted_rock';
  radialSegments: number;
  latSegments: number;
  jitterAmount: number;
  rng: () => number;
}): RawProceduralGeometry {
  const [sx, sy, sz] = params.size;
  const rx = Math.max(0.25, sx * 0.5);
  const ry = Math.max(0.25, sy * 0.5);
  const rz = Math.max(0.25, sz * 0.5);
  const lonSegs = clamp(Math.round(params.radialSegments), 4, 16);
  const latSegs = clamp(Math.round(params.latSegments), 2, 12);

  const vertices: [number, number, number][] = [];
  const normals: [number, number, number][] = [];
  const uvs: [number, number][] = [];
  const faces: [number, number, number][] = [];

  vertices.push([0, round4(-ry), 0]);
  normals.push([0, -1, 0]);
  uvs.push([0.5, 0]);

  for (let lat = 1; lat < latSegs; lat++) {
    const t = lat / latSegs;
    const phi = (t - 0.5) * Math.PI;
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
      const vy = round4(
        clamp(ringY * (1 + (params.rng() - 0.5) * params.jitterAmount * 0.4), -ry, ry)
      );
      const vz = round4(Math.sin(theta) * rz * ringRadiusFactor * jitter);

      vertices.push([vx, vy, vz]);
      const nLen = Math.hypot(vx, vy, vz) || 1;
      normals.push([round4(vx / nLen), round4(vy / nLen), round4(vz / nLen)]);
      uvs.push([round4(u), round4(t)]);
    }
  }

  const topPoleIdx = vertices.length;
  vertices.push([0, round4(ry), 0]);
  normals.push([0, 1, 0]);
  uvs.push([0.5, 1]);

  for (let lon = 0; lon < lonSegs; lon++) {
    const nextLon = (lon + 1) % lonSegs;
    faces.push([0, 1 + nextLon, 1 + lon]);
  }

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

  const lastRingStart = 1 + (latSegs - 2) * lonSegs;
  for (let lon = 0; lon < lonSegs; lon++) {
    const nextLon = (lon + 1) % lonSegs;
    faces.push([topPoleIdx, lastRingStart + lon, lastRingStart + nextLon]);
  }

  return {
    vertices,
    normals: recomputeSmoothNormals(vertices, faces, normals),
    uvs,
    faces,
  };
}

/**
 * Construye una malla de copa/follaje o roca facetada mediante esfera/domo subdividido con deformación orgánica determinista
 * y variantes cerradas reales para LOD 1 y LOD 2.
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
  activeLod?: 0 | 1 | 2;
  rng: () => number;
}) {
  const lod0 = buildOrganicCanopyOrRockBuffers(params);
  const lod1Rng = createSeededRng(`${params.modelName}:${params.partName}:canopy-lod1`);
  const lod2Rng = createSeededRng(`${params.modelName}:${params.partName}:canopy-lod2`);

  const lod1 = buildOrganicCanopyOrRockBuffers({
    ...params,
    radialSegments: Math.max(5, Math.ceil(params.radialSegments * 0.65)),
    latSegments: Math.max(3, Math.ceil(params.latSegments * 0.65)),
    rng: lod1Rng,
  });
  const lod2 = buildOrganicCanopyOrRockBuffers({
    ...params,
    radialSegments: Math.max(4, Math.floor(params.radialSegments * 0.5)),
    latSegments: Math.max(2, Math.floor(params.latSegments * 0.5)),
    jitterAmount: params.jitterAmount * 0.5,
    rng: lod2Rng,
  });

  return finalizeProceduralMeshData(
    params.modelName,
    params.partName,
    lod0.vertices,
    lod0.normals,
    lod0.uvs,
    lod0.faces,
    params.colorHex,
    lod1,
    lod2,
    params.activeLod
  );
}

function buildSimpleBoxBuffers(size: [number, number, number]): RawProceduralGeometry {
  const [sx, sy, sz] = size;
  const hx = Math.max(0.1, sx * 0.5);
  const hy = Math.max(0.1, sy * 0.5);
  const hz = Math.max(0.1, sz * 0.5);
  const vertices: [number, number, number][] = [
    [round4(-hx), round4(-hy), round4(-hz)],
    [round4(hx), round4(-hy), round4(-hz)],
    [round4(hx), round4(-hy), round4(hz)],
    [round4(-hx), round4(-hy), round4(hz)],
    [round4(-hx), round4(hy), round4(-hz)],
    [round4(hx), round4(hy), round4(-hz)],
    [round4(hx), round4(hy), round4(hz)],
    [round4(-hx), round4(hy), round4(hz)],
  ];
  const normals: [number, number, number][] = vertices.map(([vx, vy, vz]) => {
    const len = Math.hypot(vx, vy, vz) || 1;
    return [round4(vx / len), round4(vy / len), round4(vz / len)];
  });
  const uvs: [number, number][] = vertices.map(([_vx, vy], i) => [
    round4((i % 4) / 3),
    vy < 0 ? 0 : 1,
  ]);
  const faces: [number, number, number][] = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  return { vertices, normals, uvs, faces };
}

/**
 * Construye una caja biselada (chamfered box) cerrada para estructuras, mobiliario y props,
 * con variantes LOD 1 y LOD 2 cerradas y válidas.
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
    [round4(-hx * (1 - b)), round4(-hy), round4(-hz * (1 - b))],
    [round4(hx * (1 - b)), round4(-hy), round4(-hz * (1 - b))],
    [round4(hx * (1 - b)), round4(-hy), round4(hz * (1 - b))],
    [round4(-hx * (1 - b)), round4(-hy), round4(hz * (1 - b))],
    [round4(-hx), round4(-hy * (1 - b)), round4(-hz)],
    [round4(hx), round4(-hy * (1 - b)), round4(-hz)],
    [round4(hx), round4(-hy * (1 - b)), round4(hz)],
    [round4(-hx), round4(-hy * (1 - b)), round4(hz)],
    [round4(-hx), round4(hy * (1 - b)), round4(-hz)],
    [round4(hx), round4(hy * (1 - b)), round4(-hz)],
    [round4(hx), round4(hy * (1 - b)), round4(hz)],
    [round4(-hx), round4(hy * (1 - b)), round4(hz)],
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
    [0, 2, 1],
    [0, 3, 2],
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

  // LOD 1: prisma de 12 vértices con tapa superior biselada (20 triángulos cerrados)
  const lod1Verts: [number, number, number][] = [
    ...vertices.slice(4, 8),
    ...vertices.slice(8, 12),
    ...vertices.slice(12, 16),
  ];
  const lod1Norms: [number, number, number][] = lod1Verts.map(([vx, vy, vz]) => {
    const len = Math.hypot(vx, vy, vz) || 1;
    return [round4(vx / len), round4(vy / len), round4(vz / len)];
  });
  const lod1Uvs: [number, number][] = lod1Verts.map(([_vx, vy], i) => [
    round4((i % 4) / 3),
    round4((vy + hy) / Math.max(0.2, sy)),
  ]);
  const lod1Faces: [number, number, number][] = [
    [0, 2, 1],
    [0, 3, 2],
    [8, 9, 10],
    [8, 10, 11],
  ];
  for (let r = 0; r < 2; r++) {
    const rA = r * 4;
    const rB = (r + 1) * 4;
    for (let s = 0; s < 4; s++) {
      const nextS = (s + 1) % 4;
      lod1Faces.push([rA + s, rA + nextS, rB + nextS]);
      lod1Faces.push([rA + s, rB + nextS, rB + s]);
    }
  }
  const lod1: RawProceduralGeometry = {
    vertices: lod1Verts,
    normals: lod1Norms,
    uvs: lod1Uvs,
    faces: lod1Faces,
  };
  const lod2 = buildSimpleBoxBuffers(params.size);

  return finalizeProceduralMeshData(
    params.modelName,
    params.partName,
    vertices,
    normals,
    uvs,
    faces,
    params.colorHex,
    lod1,
    lod2
  );
}

function finalizeProceduralMeshData(
  modelName: string,
  partName: string,
  vertices: [number, number, number][],
  normals: [number, number, number][],
  uvs: [number, number][],
  faces: [number, number, number][],
  colorHex: string,
  lod1Geom?: RawProceduralGeometry,
  lod2Geom?: RawProceduralGeometry,
  activeLod: 0 | 1 | 2 = 0
) {
  const safeLod0: RawProceduralGeometry = { vertices, normals, uvs, faces };
  const safeLod1 = lod1Geom || safeLod0;
  const safeLod2 = lod2Geom || safeLod1;

  const chosenGeom =
    activeLod === 2 ? safeLod2 : activeLod === 1 ? safeLod1 : safeLod0;

  const rgb = hexToRgbNormalized(colorHex);
  const vertexColors: [number, number, number][] = chosenGeom.vertices.map((_, idx) => {
    const shade = 0.94 + (idx % 5) * 0.015;
    return [
      round4(clamp(rgb[0] * shade, 0, 1)),
      round4(clamp(rgb[1] * shade, 0, 1)),
      round4(clamp(rgb[2] * shade, 0, 1)),
    ];
  });

  const geometrySignature = JSON.stringify({
    modelName,
    partName,
    activeLod,
    vertices: chosenGeom.vertices,
    normals: chosenGeom.normals,
    uvs: chosenGeom.uvs,
    faces: chosenGeom.faces,
  });
  const partGeometryHash = crypto
    .createHash('sha256')
    .update(geometrySignature, 'utf-8')
    .digest('hex');

  const baseCount = Math.max(1, faces.length);

  return {
    meshId: '',
    assetId: '',
    robloxAssetId: null,
    assetUri: null,
    geometrySource: 'EditableMeshBuffers' as const,
    geometryHash: partGeometryHash,
    sourceFormat: 'PROC',
    activeLod,
    vertices: chosenGeom.vertices,
    normals: chosenGeom.normals,
    uvs: chosenGeom.uvs,
    vertexColors,
    faces: chosenGeom.faces,
    lodLevels: [
      {
        level: 0,
        ratio: 1.0,
        vertexCount: vertices.length,
        triangleCount: faces.length,
        vertices,
        normals,
        uvs,
        faces,
      },
      {
        level: 1,
        ratio: round4(safeLod1.faces.length / baseCount),
        vertexCount: safeLod1.vertices.length,
        triangleCount: safeLod1.faces.length,
        vertices: safeLod1.vertices,
        normals: safeLod1.normals,
        uvs: safeLod1.uvs,
        faces: safeLod1.faces,
      },
      {
        level: 2,
        ratio: round4(safeLod2.faces.length / baseCount),
        vertexCount: safeLod2.vertices.length,
        triangleCount: safeLod2.faces.length,
        vertices: safeLod2.vertices,
        normals: safeLod2.normals,
        uvs: safeLod2.uvs,
        faces: safeLod2.faces,
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
 * Fase 3 & Fase 7 — Generador Procedural Parametrizado de Árboles 3D para Roblox.
 *
 * Soporta 14+ parámetros configurables y reproducibles por semilla (`seed`):
 * altura, ancho/expansión horizontal, grosor, inclinación, curvatura del tronco,
 * cantidad/longitud/distribución de ramas, forma/tamaño de copa, cantidad/densidad de follaje,
 * materiales, colores, variación tonal/orgánica, nivel de detalle y nivel LOD activo (0/1/2).
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
  const trunkLeanDeg = clamp(Number(params.trunkLean ?? 0), -28, 28);
  const trunkCurvature = clamp(Number(params.trunkCurvature ?? 0), 0, 1);
  const branchCount = clamp(Math.round(Number(params.branchCount ?? 4)), 1, 12);
  const explicitBranchLength =
    params.branchLength !== undefined && Number.isFinite(Number(params.branchLength)) && Number(params.branchLength) > 0
      ? clamp(Number(params.branchLength), 1.0, Math.max(12, height * 0.75))
      : null;
  const branchDistribution: BranchDistributionType =
    params.branchDistribution === 'whorled' ||
    params.branchDistribution === 'alternating' ||
    params.branchDistribution === 'canopy_top' ||
    params.branchDistribution === 'tiered'
      ? params.branchDistribution
      : 'tiered';
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
  const canopySize = clamp(Number(params.canopySize ?? 1.0), 0.35, 2.4);
  const foliageDensity = clamp(Number(params.foliageDensity ?? 1.0), 0.25, 2.2);

  const detailLevel: TreeDetailLevel =
    params.detailLevel === 'low' ||
    params.detailLevel === 'high' ||
    params.detailLevel === 'ultra' ||
    params.detailLevel === 'medium'
      ? params.detailLevel
      : 'medium';

  const activeLod: 0 | 1 | 2 =
    params.lodLevel === 2 ? 2 : params.lodLevel === 1 ? 1 : 0;

  const detailSegMap: Record<TreeDetailLevel, { trunkRad: number; trunkRings: number; branchRad: number; canopyRad: number; canopyLat: number }> = {
    low: { trunkRad: 5, trunkRings: 2, branchRad: 4, canopyRad: 6, canopyLat: 3 },
    medium: { trunkRad: 8, trunkRings: 4, branchRad: 6, canopyRad: 10, canopyLat: 6 },
    high: { trunkRad: 11, trunkRings: 6, branchRad: 8, canopyRad: 12, canopyLat: 8 },
    ultra: { trunkRad: 14, trunkRings: 8, branchRad: 10, canopyRad: 15, canopyLat: 10 },
  };
  const baseSegSpec = detailSegMap[detailLevel];
  const polyBudgetVal = Number(params.targetPolyBudget ?? 0);
  const budgetFactor =
    Number.isFinite(polyBudgetVal) && polyBudgetVal >= 200
      ? clamp(Math.sqrt(polyBudgetVal / 2400), 0.65, 1.95)
      : 1.0;
  const segSpec = {
    trunkRad: clamp(Math.round(baseSegSpec.trunkRad * budgetFactor), 4, 22),
    trunkRings: clamp(Math.round(baseSegSpec.trunkRings * budgetFactor), 2, 14),
    branchRad: clamp(Math.round(baseSegSpec.branchRad * budgetFactor), 4, 16),
    canopyRad: clamp(Math.round(baseSegSpec.canopyRad * budgetFactor), 5, 22),
    canopyLat: clamp(Math.round(baseSegSpec.canopyLat * budgetFactor), 3, 14),
  };

  const trunkMaterial = String(params.trunkMaterial || 'Wood');
  const leafMaterial = String(params.leafMaterial || 'Grass');
  const baseTrunkColor = String(params.trunkColor || '#5c4033');
  const baseLeafColor = String(params.leafColor || '#2d6a4f');
  const variation = clamp(Number(params.variation ?? 0.22), 0, 1);
  const leafVariation = clamp(
    Number(params.leafVariation !== undefined ? params.leafVariation : variation),
    0,
    1
  );
  const colorVariation = clamp(
    Number(params.colorVariation !== undefined ? params.colorVariation : leafVariation),
    0,
    1
  );

  const trunkColor =
    colorVariation > 0.05
      ? modulateHexColor(baseTrunkColor, 1 + (rng() - 0.5) * 0.22 * colorVariation)
      : baseTrunkColor;

  const parts: any[] = [];

  // 1. Base radicular asentada exactamente en Y = 0
  const rootFlareScale = clamp(Number(params.rootFlareScale ?? 1.0), 0.75, 2.2);
  const rootFlareHeight = round4(Math.max(0.6, height * 0.08 * (rootFlareScale > 1.1 ? 1.15 : 1.0)));
  const rootFlareWidth = round4(trunkThickness * 1.45 * rootFlareScale);
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
      bottomScaleRatio: rootFlareScale > 1.1 ? 1.38 : 1.25,
      topScaleRatio: 0.78,
      radialSegments: rootFlareScale > 1.1 ? Math.max(8, segSpec.trunkRad) : segSpec.trunkRad,
      heightSegments: 2,
      jitterAmount: variation * 0.18,
      radialLobeAmplitude: rootFlareScale > 1.1 ? 0.24 : 0.1,
      radialLobeCount: 5,
      colorHex: trunkColor,
      activeLod,
      rng,
    }),
  });

  // 1B. Raíces superficiales orgánicas expuestas (`SurfaceRoot_1..K` en `Root/Roots`)
  const enableRecursiveHierarchy = Boolean(
    (params as any).includeRecursiveHierarchy ||
      params.targetPolyBudget !== undefined ||
      (params as any).species !== undefined
  );
  if (enableRecursiveHierarchy) {
    const surfaceRootCount = rootFlareScale >= 1.2 ? 4 : 3;
    for (let sr = 0; sr < surfaceRootCount; sr++) {
      const rAngle = (sr / surfaceRootCount) * Math.PI * 2 + 0.35;
      const rLen = round4(Math.max(0.9, rootFlareWidth * 0.48));
      const rThk = round4(Math.max(0.28, trunkThickness * 0.32));
      const rH = round4(Math.max(0.35, rootFlareHeight * 0.45));
      const rx = round4(Math.cos(rAngle) * (rootFlareWidth * 0.34));
      const rz = round4(Math.sin(rAngle) * (rootFlareWidth * 0.34));
      const rootSize: [number, number, number] = [rThk, rH, rLen];
      const rootName = `SurfaceRoot_${sr + 1}`;
      parts.push({
        partId: `part_root_${sr + 1}`,
        name: rootName,
        parentPath: 'Root/Roots',
        shape: 'MeshPart',
        size: rootSize,
        position: [rx, round4(rH * 0.65), rz],
        rotation: [0, round4((rAngle * 180) / Math.PI), 0],
        color: modulateHexColor(trunkColor, 0.94),
        material: trunkMaterial,
        transparency: 0,
        reflectance: 0.01,
        roughness: 0.88,
        metalness: 0.03,
        canCollide: true,
        anchored: true,
        collisionFidelity,
        meshData: buildTaperedCylinderMesh({
          modelName,
          partName: rootName,
          size: rootSize,
          bottomScaleRatio: 0.95,
          topScaleRatio: 0.38,
          radialSegments: Math.max(4, segSpec.branchRad),
          heightSegments: 2,
          jitterAmount: variation * 0.14,
          curvatureAmount: 0.18,
          colorHex: trunkColor,
          activeLod,
          rng,
        }),
      });
    }
  }

  // 2. Tronco principal articulado (con soporte de inclinación y curvatura orgánica)
  const trunkHeight = round4(height * 0.56);
  const trunkSize: [number, number, number] = [
    round4(trunkThickness),
    trunkHeight,
    round4(trunkThickness),
  ];
  const trunkCenterY = round4(rootFlareHeight * 0.85 + trunkHeight * 0.5);
  const leanAzimuth = rng() * Math.PI * 2;
  const leanRad = (trunkLeanDeg * Math.PI) / 180;
  const leanShiftMag = Math.tan(leanRad) * trunkHeight * 0.45;
  const trunkBendX = round4(Math.cos(leanAzimuth) * leanShiftMag);
  const trunkBendZ = round4(Math.sin(leanAzimuth) * leanShiftMag);
  const trunkTopOffsetX = trunkBendX;
  const trunkTopOffsetZ = round4(trunkBendZ + Math.sin(Math.PI * 1.5) * trunkCurvature * trunkThickness * 0.25);
  const trunkRings = trunkCurvature > 0.08 ? Math.max(4, segSpec.trunkRings) : segSpec.trunkRings;

  parts.push({
    partId: 'part_2_trunk',
    name: 'MainTrunk',
    parentPath: 'Root',
    shape: 'MeshPart',
    size: trunkSize,
    position: [0, trunkCenterY, 0],
    rotation: [
      round4((rng() - 0.5) * 4 * variation + trunkLeanDeg * 0.15),
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
      radialSegments: segSpec.trunkRad,
      heightSegments: trunkRings,
      jitterAmount: variation * 0.22,
      colorHex: trunkColor,
      bendOffsetX: trunkBendX,
      bendOffsetZ: trunkBendZ,
      curvatureAmount: trunkCurvature,
      activeLod,
      rng,
    }),
  });

  // Factor de escala horizontal del parámetro width respecto a la proporción natural de altura
  const widthScaleFactor =
    params.width !== undefined && Number.isFinite(Number(params.width)) && Number(params.width) > 0
      ? clamp(Number(params.width) / Math.max(2.0, height * 0.56), 0.4, 2.5)
      : 1.0;

  // 3. Ramas primarias y ramificación recursiva secundaria (`Branch_1..N` -> `SubBranch_1..M`)
  const branchStartHeight =
    branchDistribution === 'canopy_top'
      ? rootFlareHeight + trunkHeight * 0.78
      : rootFlareHeight + trunkHeight * 0.58;
  const branchSpreadRadius = Math.max(1.2, height * 0.18 * widthScaleFactor);
  const branchEndpoints: [number, number, number][] = [];

  for (let i = 0; i < branchCount; i++) {
    const baseAngle =
      branchDistribution === 'alternating'
        ? i * Math.PI + (i * Math.PI) / Math.max(2, branchCount)
        : branchDistribution === 'whorled'
        ? (i / branchCount) * Math.PI * 2
        : (i / branchCount) * Math.PI * 2;
    const angle = baseAngle + (rng() - 0.5) * 0.45 * variation;
    const tierFactor =
      branchDistribution === 'whorled' || branchDistribution === 'canopy_top'
        ? 0.5
        : i / Math.max(1, branchCount - 1);
    const heightSpan =
      branchDistribution === 'whorled'
        ? trunkHeight * 0.08 * ((i % 2) * 0.5)
        : branchDistribution === 'canopy_top'
        ? trunkHeight * 0.14
        : tierFactor * (trunkHeight * 0.32);

    const computedBranchLen =
      explicitBranchLength !== null
        ? explicitBranchLength * widthScaleFactor * (1 - tierFactor * 0.12) * (0.94 + rng() * 0.16 * variation)
        : height * (0.24 - tierFactor * 0.06) * widthScaleFactor * (0.9 + rng() * 0.25 * variation);
    const branchLength = round4(Math.max(1.2, computedBranchLen));
    const branchThick = round4(Math.max(0.28, trunkThickness * (0.48 - tierFactor * 0.12)));
    const pitchDeg = canopyShape === 'weeping' ? 58 : canopyShape === 'conical' ? 32 : 42;
    const tiltRad = (pitchDeg * Math.PI) / 180;

    const radialOffset = Math.sin(tiltRad) * branchLength * 0.5;
    const verticalOffset = Math.cos(tiltRad) * branchLength * 0.5;
    const attachFactor = clamp(0.6 + tierFactor * 0.4, 0, 1);
    const anchorShiftX = trunkTopOffsetX * attachFactor;
    const anchorShiftZ = trunkTopOffsetZ * attachFactor;

    const bx = round4(anchorShiftX + Math.cos(angle) * (trunkThickness * 0.25 + radialOffset));
    const by = round4(branchStartHeight + heightSpan + verticalOffset);
    const bz = round4(anchorShiftZ + Math.sin(angle) * (trunkThickness * 0.25 + radialOffset));

    const tipX = round4(anchorShiftX + Math.cos(angle) * (trunkThickness * 0.3 + radialOffset * 1.85));
    const tipY = round4(
      branchStartHeight +
        heightSpan +
        verticalOffset * (canopyShape === 'weeping' ? 1.2 : 1.75)
    );
    const tipZ = round4(anchorShiftZ + Math.sin(angle) * (trunkThickness * 0.3 + radialOffset * 1.85));
    branchEndpoints.push([tipX, tipY, tipZ]);

    const branchName = `Branch_${i + 1}`;
    const branchSize: [number, number, number] = [branchThick, branchLength, branchThick];
    const branchColor =
      colorVariation > 0.08
        ? modulateHexColor(trunkColor, 1 + (rng() - 0.5) * 0.16 * colorVariation)
        : trunkColor;
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
      color: branchColor,
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
        radialSegments: segSpec.branchRad,
        heightSegments: Math.max(2, Math.floor(segSpec.trunkRings * 0.75)),
        jitterAmount: variation * 0.2,
        curvatureAmount: trunkCurvature * 0.35,
        colorHex: branchColor,
        activeLod,
        rng,
      }),
    });

    // Ramificación jerárquica recursiva nivel 2 (`SubBranch_*`)
    if (enableRecursiveHierarchy && i < Math.min(branchCount, 5)) {
      const subAngle = angle + (i % 2 === 0 ? 0.55 : -0.55);
      const subLen = round4(Math.max(0.85, branchLength * 0.56));
      const subThk = round4(Math.max(0.2, branchThick * 0.58));
      const subSize: [number, number, number] = [subThk, subLen, subThk];
      const subName = `SubBranch_${i + 1}`;
      const subX = round4((bx + tipX) * 0.5 + Math.cos(subAngle) * subLen * 0.28);
      const subY = round4((by + tipY) * 0.5 + subLen * 0.22);
      const subZ = round4((bz + tipZ) * 0.5 + Math.sin(subAngle) * subLen * 0.28);
      parts.push({
        partId: `part_subbranch_${i + 1}`,
        name: subName,
        parentPath: 'Root/Branches/Secondary',
        shape: 'MeshPart',
        size: subSize,
        position: [subX, subY, subZ],
        rotation: [
          round4(Math.sin(subAngle) * (pitchDeg + 10)),
          round4((subAngle * 180) / Math.PI),
          round4(-Math.cos(subAngle) * (pitchDeg + 10)),
        ],
        color: branchColor,
        material: trunkMaterial,
        transparency: 0,
        reflectance: 0.02,
        roughness: 0.82,
        metalness: 0.03,
        canCollide: false,
        anchored: true,
        collisionFidelity,
        meshData: buildTaperedCylinderMesh({
          modelName,
          partName: subName,
          size: subSize,
          bottomScaleRatio: 0.9,
          topScaleRatio: 0.38,
          radialSegments: Math.max(4, segSpec.branchRad - 1),
          heightSegments: 2,
          jitterAmount: variation * 0.16,
          curvatureAmount: 0.2,
          colorHex: branchColor,
          activeLod,
          rng,
        }),
      });
    }
  }

  // 4. Copa principal (`CanopyCrown_Main`) según `canopyShape`, `canopySize`, `width`, `leafDistribution` y `foliageDensity`
  const densityMultiplier =
    (leafDistribution === 'dense'
      ? 1.25
      : leafDistribution === 'sparse'
      ? 0.75
      : leafDistribution === 'clustered'
      ? 1.05
      : 1.0) * (0.7 + foliageDensity * 0.3);

  const computedDefaultCrownW =
    height * (canopyShape === 'conical' ? 0.46 : 0.56) * densityMultiplier * canopySize;
  const crownWidth = round4(
    Math.max(
      2.0,
      params.width !== undefined && Number.isFinite(Number(params.width)) && Number(params.width) > 0
        ? Number(params.width) * densityMultiplier * canopySize
        : computedDefaultCrownW
    )
  );
  const crownHeight = round4(
    Math.max(
      1.8,
      height *
        (canopyShape === 'conical'
          ? 0.55
          : canopyShape === 'layered'
          ? 0.34
          : canopyShape === 'weeping'
          ? 0.48
          : 0.44) *
        densityMultiplier *
        canopySize
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
    position: [round4(trunkTopOffsetX), crownCenterY, round4(trunkTopOffsetZ)],
    rotation: [0, round4(rng() * 360), 0],
    color: baseLeafColor,
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
      radialSegments: segSpec.canopyRad,
      latSegments: segSpec.canopyLat,
      jitterAmount: Math.max(variation, leafVariation) * 0.28,
      colorHex: baseLeafColor,
      activeLod,
      rng,
    }),
  });

  // 5. Racimos de follaje secundarios (`FoliageCluster_1..N`) controlados por `foliageCount`, `foliageDensity`, `leafDistribution` y `colorVariation`
  const defaultClusterCount =
    leafDistribution === 'dense'
      ? Math.max(4, Math.round(branchCount * foliageDensity))
      : leafDistribution === 'sparse'
      ? Math.max(1, Math.floor(branchCount * 0.5 * foliageDensity))
      : Math.max(2, Math.min(8, Math.round(Math.min(6, branchCount) * foliageDensity)));
  const clusterCount =
    params.foliageCount !== undefined && Number.isFinite(Number(params.foliageCount))
      ? clamp(Math.round(Number(params.foliageCount)), 0, 16)
      : clamp(defaultClusterCount, 0, 16);

  for (let c = 0; c < clusterCount; c++) {
    const anchor = branchEndpoints[c % branchEndpoints.length] || [
      round4(trunkTopOffsetX + Math.cos(c) * branchSpreadRadius),
      crownCenterY,
      round4(trunkTopOffsetZ + Math.sin(c) * branchSpreadRadius),
    ];
    const alternatingScaleBias = 1 + (c % 2 === 0 ? -0.22 : 0.24) * leafVariation;
    const clusterScale = round4(
      clamp(
        (0.46 + (rng() - 0.3) * 0.36 * leafVariation) *
          alternatingScaleBias *
          (leafDistribution === 'clustered' ? 1.12 : 1.0) *
          (0.85 + foliageDensity * 0.15),
        0.26,
        0.95
      )
    );
    const clusterSize: [number, number, number] = [
      round4(Math.max(1.1, crownWidth * clusterScale)),
      round4(Math.max(0.95, crownHeight * clusterScale * (canopyShape === 'layered' ? 0.65 : 0.85))),
      round4(Math.max(1.1, crownWidth * clusterScale)),
    ];
    const clusterName = `FoliageCluster_${c + 1}`;
    const clusterY = Math.max(
      round4(clusterSize[1] * 0.5 + 0.5),
      round4(anchor[1] + (canopyShape === 'weeping' ? -0.35 : 0.45))
    );
    const leafTintFactor = 1 + (rng() - 0.5) * 0.34 * colorVariation;
    const clusterColor = modulateHexColor(baseLeafColor, leafTintFactor);

    parts.push({
      partId: `part_foliage_${c + 1}`,
      name: clusterName,
      parentPath: 'Root/Canopy',
      shape: 'MeshPart',
      size: clusterSize,
      position: [anchor[0], clusterY, anchor[2]],
      rotation: [
        round4((rng() - 0.5) * 14 * leafVariation),
        round4(rng() * 360),
        round4((rng() - 0.5) * 14 * leafVariation),
      ],
      color: clusterColor,
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
        radialSegments: Math.max(5, Math.round(segSpec.canopyRad * 0.8)),
        latSegments: Math.max(3, Math.round(segSpec.canopyLat * 0.85)),
        jitterAmount: leafVariation * 0.32,
        colorHex: clusterColor,
        activeLod,
        rng,
      }),
    });
  }

  return groundAndNormalizeParts(parts.map((p) => centerProceduralPartGeometry(modelName, p)));
}

/**
 * Centra el bounding box local de `meshData` en `(0, 0, 0)`, actualiza `part.size` al tamaño
 * exacto `[spanX, spanY, spanZ]` y traslada `part.position` en coordenadas del modelo para
 * garantizar paridad geométrica exacta 1:1 entre Three.js y Roblox Studio `CreateMeshPartAsync`.
 */
export function centerProceduralPartGeometry(modelName: string, part: any): any {
  const verts: [number, number, number][] | undefined = part?.meshData?.vertices;
  if (!Array.isArray(verts) || verts.length === 0) {
    return part;
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of verts) {
    const x = Number(v[0] ?? 0);
    const y = Number(v[1] ?? 0);
    const z = Number(v[2] ?? 0);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return part;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const spanX = round4(Math.max(0.2, maxX - minX));
  const spanY = round4(Math.max(0.2, maxY - minY));
  const spanZ = round4(Math.max(0.2, maxZ - minZ));

  const shiftVerts = (list: any[] | undefined): [number, number, number][] =>
    Array.isArray(list)
      ? list.map((v) => [
          round4(Number(v[0] ?? 0) - cx),
          round4(Number(v[1] ?? 0) - cy),
          round4(Number(v[2] ?? 0) - cz),
        ])
      : [];

  const centeredVertices = shiftVerts(verts);
  const centeredLodLevels = Array.isArray(part.meshData.lodLevels)
    ? part.meshData.lodLevels.map((lod: any) => ({
        ...lod,
        vertices: shiftVerts(lod.vertices),
      }))
    : part.meshData.lodLevels;

  const rot = Array.isArray(part.rotation) ? part.rotation : [0, 0, 0];
  const m = canonicalEulerToMatrix9(Number(rot[0] ?? 0), Number(rot[1] ?? 0), Number(rot[2] ?? 0));
  const worldShiftX = m[0] * cx + m[1] * cy + m[2] * cz;
  const worldShiftY = m[3] * cx + m[4] * cy + m[5] * cz;
  const worldShiftZ = m[6] * cx + m[7] * cy + m[8] * cz;

  const px = Number(part.position?.[0] ?? 0);
  const py = Number(part.position?.[1] ?? 0);
  const pz = Number(part.position?.[2] ?? 0);

  const geometrySignature = JSON.stringify({
    modelName,
    partName: part.name || 'Part',
    activeLod: part.meshData.activeLod ?? 0,
    vertices: centeredVertices,
    normals: part.meshData.normals || [],
    uvs: part.meshData.uvs || [],
    faces: part.meshData.faces || [],
  });
  const updatedGeometryHash = crypto
    .createHash('sha256')
    .update(geometrySignature, 'utf-8')
    .digest('hex');

  return {
    ...part,
    size: [spanX, spanY, spanZ],
    position: [
      round4(px + worldShiftX),
      round4(py + worldShiftY),
      round4(pz + worldShiftZ),
    ],
    meshData: {
      ...part.meshData,
      geometryHash: updatedGeometryHash,
      vertices: centeredVertices,
      lodLevels: centeredLodLevels,
    },
  };
}

/**
 * Ajusta todas las piezas para que el punto más bajo del modelo descanse exactamente en `Y = 0`.
 */
export function groundAndNormalizeParts(parts: any[]): any[] {
  let minY = Infinity;
  for (const p of parts) {
    const py = Number(p.position?.[1] ?? 0);
    const verts: [number, number, number][] | undefined = p?.meshData?.vertices;
    if (Array.isArray(verts) && verts.length > 0) {
      for (const v of verts) {
        const wy = py + Number(v[1] ?? 0);
        if (wy < minY) minY = wy;
      }
    } else {
      const sy = Number(p.size?.[1] ?? 1);
      const bottom = py - sy * 0.5;
      if (bottom < minY) minY = bottom;
    }
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
 * Sintetiza las piezas para cualquiera de las 8 categorías oficiales usando motores geométricos
 * especializados por familia (Árboles recursivos, Rocas de icosferas deformadas/estratificadas,
 * Edificios modulares con puertas/ventanas/columnas, Sillas/Mesas/Lámparas/Mecanismos dentados,
 * Escenarios multi-asset `Scene3D`, y reconstrucción `Image-to-3D` por silueta).
 */
export function generateSeededCategoryParts(
  modelName: string,
  category: ForgeAssetCategory,
  seed: string | number = 'forge-seed-2026',
  collisionFidelity: string = 'Hull',
  treeParams?: TreeProceduralParams,
  options?: {
    prompt?: string;
    assetType?: 'Model3D' | 'Scene3D';
    targetPolyBudget?: number;
    detailLevel?: TreeDetailLevel;
    referenceAnalysis?: ReferenceImageAnalysis | null;
    directorBlueprint?: Partial<AiDirectorBlueprint>;
  }
): {
  parts: any[];
  pbrProfile: Record<string, any>;
  description: string;
  blueprint: AiDirectorBlueprint;
  budgetProfile: ReturnType<typeof computeBudgetAllocationProfile>;
} {
  const effectiveDetail: TreeDetailLevel =
    options?.detailLevel || treeParams?.detailLevel || 'medium';
  const effectiveBudget = options?.targetPolyBudget ?? treeParams?.targetPolyBudget;
  const budgetProfile = computeBudgetAllocationProfile(effectiveBudget, effectiveDetail);

  const validated = validateAndSanitizeDirectorBlueprint(options?.directorBlueprint, {
    prompt: options?.prompt || category,
    name: modelName,
    category,
    asset_type: options?.assetType || 'Model3D',
    detail_level: effectiveDetail,
    target_poly_budget: budgetProfile.targetPolyBudget,
    collision_fidelity:
      collisionFidelity === 'Box' || collisionFidelity === 'PreciseConvexDecomposition'
        ? collisionFidelity
        : 'Hull',
    tree_params: treeParams,
    referenceAnalysis: options?.referenceAnalysis,
  });
  const blueprint = validated.blueprint;

  // Si hay una imagen de referencia real (Image-to-3D) y no es árbol explícito, reconstruir silueta 3D
  if (options?.referenceAnalysis && blueprint.identity.object_family === 'image_lathe') {
    const rawParts = buildPartsFromSpecializedEngine({
      modelName,
      blueprint,
      budget: budgetProfile,
      prompt: options?.prompt,
      seed: String(seed),
      treeParams,
      referenceAnalysis: options.referenceAnalysis,
    });
    const parts = groundAndNormalizeParts(
      rawParts.map((p) => centerProceduralPartGeometry(modelName, p))
    );
    return {
      parts,
      pbrProfile: {
        albedo_hex: blueprint.materials_and_textures.primary_hex,
        roughness: blueprint.materials_and_textures.roughness,
        metalness: blueprint.materials_and_textures.metalness,
        emissive_hex: blueprint.materials_and_textures.accent_hex,
        roblox_material: blueprint.materials_and_textures.primary_material,
        pattern: blueprint.materials_and_textures.pbr_pattern,
      },
      description: `Reconstrucción volumétrica Image-to-3D guiada por silueta 2D (seed=${String(
        seed
      )}, ratio=${options.referenceAnalysis.aspectRatioWidthToHeight}, ${parts.length} sub-mallas).`,
      blueprint,
      budgetProfile,
    };
  }

  // Árboles y vegetación (cuando no es un Scene3D multi-asset)
  if (category === 'Trees & Vegetation' && options?.assetType !== 'Scene3D' && blueprint.identity.object_family === 'tree') {
    const effectiveTreeParams: TreeProceduralParams = {
      seed,
      detailLevel: effectiveDetail,
      ...(effectiveBudget !== undefined ? { targetPolyBudget: budgetProfile.targetPolyBudget } : {}),
      ...(options?.referenceAnalysis
        ? {
            trunkColor: options.referenceAnalysis.dominantPaletteHex.bottomHex,
            leafColor: options.referenceAnalysis.dominantPaletteHex.topHex,
          }
        : {}),
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
      description: `Árbol 3D procedural con raíces superficiales y ramificación recursiva (seed=${String(
        seed
      )}, altura=${effectiveTreeParams.height ?? 14} studs, ramas=${
        effectiveTreeParams.branchCount ?? 4
      }, copa=${effectiveTreeParams.canopyShape ?? 'spherical'}, follaje=${
        effectiveTreeParams.leafDistribution ?? 'balanced'
      }).`,
      blueprint,
      budgetProfile,
    };
  }

  // Resto de familias especializadas: Rocas (Icosferas), Edificios, Sillas, Lámparas, Mecanismos, Mesas, Cofres y Escenarios (Scene3D)
  const specializedParts = buildPartsFromSpecializedEngine({
    modelName,
    blueprint,
    budget: budgetProfile,
    prompt: options?.prompt || category,
    seed: String(seed),
    treeParams,
    referenceAnalysis: options?.referenceAnalysis,
  });

  const normalizedCentered = groundAndNormalizeParts(
    specializedParts.map((p) => centerProceduralPartGeometry(modelName, p))
  );

  return {
    parts: normalizedCentered,
    pbrProfile: {
      albedo_hex: blueprint.materials_and_textures.primary_hex,
      roughness: blueprint.materials_and_textures.roughness,
      metalness: blueprint.materials_and_textures.metalness,
      emissive_hex: blueprint.materials_and_textures.accent_hex,
      roblox_material: blueprint.materials_and_textures.primary_material,
      pattern: blueprint.materials_and_textures.pbr_pattern,
    },
    description: `Asset 3D especializado familia '${blueprint.identity.object_family}' (${category}, seed=${String(
      seed
    )}, budget=${budgetProfile.targetPolyBudget} tris, ${normalizedCentered.length} sub-mallas).`,
    blueprint,
    budgetProfile,
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
  const rawSeed = req.seed ?? req.tree_params?.seed;
  const isDefaultSeed = !rawSeed || rawSeed === 'forge-tree-2026' || rawSeed === 'forge-seed-2026';
  const seed = isDefaultSeed
    ? `forge-${safeModelName.toLowerCase()}-${Date.now().toString(36).slice(-6)}`
    : rawSeed;
  const collisionFidelity = req.collision_fidelity || 'Hull';
  const assetType = req.asset_type || 'Model3D';

  const referenceAnalysis: ReferenceImageAnalysis | null =
    typeof req.reference_image_base64 === 'string' && req.reference_image_base64.trim().length > 16
      ? analyzeReferenceImageBase64(req.reference_image_base64)
      : null;

  const promptTreeParsed =
    canonicalCategory === 'Trees & Vegetation' && req.prompt
      ? parseNaturalLanguageToTreeParams(req.prompt).params
      : undefined;

  const manFields = Array.isArray(req.manually_edited_fields) ? req.manually_edited_fields : [];
  const mergedTreeParams: Record<string, any> = {
    seed,
    ...(req.tree_params || {}),
  };

  if (promptTreeParsed) {
    for (const [key, val] of Object.entries(promptTreeParsed)) {
      if (val !== undefined) {
        const isDefaultUiValue =
          (key === 'leafColor' && mergedTreeParams.leafColor === '#34843d') ||
          (key === 'trunkColor' && mergedTreeParams.trunkColor === '#6e482b') ||
          (key === 'height' && mergedTreeParams.height === 14) ||
          (key === 'width' && mergedTreeParams.width === 10) ||
          (key === 'trunkThickness' && mergedTreeParams.trunkThickness === 1.6) ||
          (key === 'branchCount' && mergedTreeParams.branchCount === 4);

        if (!manFields.includes(key) && (isDefaultUiValue || mergedTreeParams[key] === undefined)) {
          mergedTreeParams[key] = val;
        }
      }
    }
  }

  const effectiveDetailLevel: TreeDetailLevel =
    req.detail_level ||
    mergedTreeParams.detailLevel ||
    'medium';

  const effectiveTreeParams: TreeProceduralParams | undefined =
    canonicalCategory === 'Trees & Vegetation'
      ? {
          seed,
          ...mergedTreeParams,
          detailLevel: effectiveDetailLevel,
          ...(req.target_poly_budget !== undefined || mergedTreeParams.targetPolyBudget !== undefined
            ? { targetPolyBudget: req.target_poly_budget ?? mergedTreeParams.targetPolyBudget }
            : {}),
        }
      : req.tree_params
        ? {
            ...req.tree_params,
            detailLevel: effectiveDetailLevel,
            ...(req.target_poly_budget !== undefined || req.tree_params?.targetPolyBudget !== undefined
              ? { targetPolyBudget: req.target_poly_budget ?? req.tree_params?.targetPolyBudget }
              : {}),
          }
        : {
            seed,
            detailLevel: effectiveDetailLevel,
            ...(req.target_poly_budget !== undefined ? { targetPolyBudget: req.target_poly_budget } : {}),
          };

  const isSceneRequest =
    req.category === 'Scene3D' ||
    req.asset_type === 'Scene3D' ||
    canonicalCategory === 'Scene Elements';
  const effectiveAssetType: 'Model3D' | 'Scene3D' = isSceneRequest ? 'Scene3D' : assetType;

  const generated = generateSeededCategoryParts(
    safeModelName,
    canonicalCategory,
    seed,
    collisionFidelity,
    effectiveTreeParams,
    {
      prompt: `${req.prompt || ''} ${req.sub_category || ''} ${req.style || ''}`.trim(),
      assetType: effectiveAssetType,
      targetPolyBudget: req.target_poly_budget,
      detailLevel: effectiveDetailLevel,
      referenceAnalysis,
      directorBlueprint: req.director_blueprint || req.ai_director_blueprint,
    }
  );

  const normalizedParts = normalizePartsWithSyncMetadata(generated.parts, safeModelName).map(
    (p: any) => ({
      ...p,
      parent: p.parent || p.parentName || p.hierarchyPath || 'Root',
      meshId: '',
      assetId: '',
      robloxAssetId: null,
      assetUri: null,
      geometrySource: 'EditableMeshBuffers',
      meshData: p.meshData
        ? {
            ...p.meshData,
            meshId: '',
            assetId: '',
            robloxAssetId: null,
            assetUri: null,
            geometrySource: 'EditableMeshBuffers',
          }
        : p.meshData,
    })
  );
  const totalTris = normalizedParts.reduce(
    (sum: number, p: any) => sum + (Array.isArray(p.meshData?.faces) ? p.meshData.faces.length : 12),
    0
  );

  const referenceComparisonMetrics: ReferenceImageComparisonMetrics | null = referenceAnalysis
    ? evaluateReferenceVsModelMetrics(
        referenceAnalysis,
        normalizedParts.map((p: any) => ({
          size: p.size,
          position: p.position,
          color: Array.isArray(p.color) ? undefined : p.color,
        }))
      )
    : null;

  const luauCode = buildStrictLuauFromEditedParts(
    safeModelName,
    normalizedParts,
    collisionFidelity
  );
  const fileName = `${safeModelName}.luau`;
  const deterministicId = `asset-proc-${computeFnv1a32Hex(`${safeModelName}:${String(seed)}:${totalTris}`)}`;
  const assetGeometryHash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        normalizedParts.map((p: any) => ({
          partId: p.partId,
          geometryHash: p.geometryHash,
          vertices: p.meshData?.vertices || [],
          faces: p.meshData?.faces || [],
        }))
      ),
      'utf-8'
    )
    .digest('hex');

  const resolvedMode: GenerationExecutionMode =
    req.generation_mode || (referenceAnalysis ? 'image_to_3d' : 'procedural');

  const executionReport: EngineExecutionReport = {
    requested_mode: req.execution_report?.requested_mode || resolvedMode,
    executed_mode: req.execution_report?.executed_mode || resolvedMode,
    ai_provider_available: req.execution_report?.ai_provider_available ?? false,
    ai_provider_used: req.execution_report?.ai_provider_used ?? false,
    image_reference_processed: Boolean(referenceAnalysis),
    reference_image_analyzed: Boolean(referenceAnalysis),
    fallback_triggered: req.execution_report?.fallback_triggered ?? false,
    fallback_reason: req.execution_report?.fallback_reason ?? null,
    seed_used: String(seed),
    seed: req.execution_report?.seed ?? seed,
    seed_preserved: req.execution_report?.seed_preserved ?? true,
    poly_budget_requested: generated.budgetProfile.targetPolyBudget,
    poly_budget_achieved: totalTris,
    detail_level: effectiveDetailLevel,
  };

  const semanticInterpretation = interpretPromptSemantics({
    prompt: `${req.prompt || ''} ${req.sub_category || ''}`.trim() || safeModelName,
    category: canonicalCategory,
    name: safeModelName,
    blueprint: generated.blueprint,
  });
  const visualIdentityEvaluation = evaluateSemanticVisualIdentity({
    prompt: `${req.prompt || ''} ${req.sub_category || ''}`.trim() || safeModelName,
    parts: normalizedParts,
    interpretation: semanticInterpretation,
  });
  const multiAngleSnapshots = renderMultiAngleSvgSnapshots({
    modelName: safeModelName,
    subjectLabel: semanticInterpretation.subjectLabel,
    parts: normalizedParts,
  });

  const objFam = generated.blueprint.identity.object_family;
  const engineUsed =
    objFam === 'quadruped_animal' ||
    objFam === 'winged_creature' ||
    objFam === 'biped_humanoid_or_statue' ||
    objFam === 'wheeled_vehicle' ||
    objFam === 'freeform_composite'
      ? `universal_freeform_3d_engine:${semanticInterpretation.archetype}`
      : `specialized_geometry_engine:${objFam}`;

  const baseAsset: Record<string, any> = {
    id: deterministicId,
    forgeAssetId: deterministicId,
    sourceAssetId: deterministicId,
    robloxAssetId: null,
    assetUri: null,
    geometrySource: 'EditableMeshBuffers',
    geometryHash: assetGeometryHash,
    name: safeModelName,
    model_name: safeModelName,
    category: canonicalCategory,
    asset_type: isSceneRequest ? 'Scene3D' : generated.blueprint.identity.asset_type || effectiveAssetType,
    generation_mode: resolvedMode,
    engine_used: engineUsed,
    seed: String(seed),
    ...(canonicalCategory === 'Trees & Vegetation'
      ? { tree_params: { seed, ...req.tree_params } }
      : {}),
    poly_count: totalTris,
    poly_budget_requested: generated.budgetProfile.targetPolyBudget,
    target_poly_budget: generated.budgetProfile.targetPolyBudget,
    detail_level: effectiveDetailLevel,
    collision_fidelity: collisionFidelity,
    rojo_target_folder: 'src/shared/Assets3D',
    file_name: fileName,
    description: generated.description,
    pbr_profile: generated.pbrProfile,
    ai_director_blueprint: generated.blueprint,
    director_blueprint: generated.blueprint,
    execution_report: executionReport,
    semantic_interpretation: semanticInterpretation,
    visual_identity_evaluation: visualIdentityEvaluation,
    multi_angle_snapshots: multiAngleSnapshots,
    ...(referenceAnalysis
      ? {
          reference_image_analysis: referenceAnalysis,
          reference_comparison_metrics: referenceComparisonMetrics,
        }
      : {}),
    parts: normalizedParts,
    luau_code: luauCode,
  };

  const contentHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(baseAsset), 'utf-8')
    .digest('hex');

  return {
    ...baseAsset,
    contentHash,
  };
}

/**
 * Valida la integridad geométrica de un arreglo de partes 3D generadas (FASE 6 & 7).
 */
export function validateProcedural3DGeometry(parts: any[]): {
  valid: boolean;
  totalParts: number;
  totalVertices: number;
  totalTriangles: number;
  degenerateTriangles: number;
  editableMeshCompliant: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  let totalVertices = 0;
  let totalTriangles = 0;
  let degenerateTriangles = 0;
  let editableMeshCompliant = true;

  if (!Array.isArray(parts) || parts.length === 0) {
    return {
      valid: false,
      totalParts: 0,
      totalVertices: 0,
      totalTriangles: 0,
      degenerateTriangles: 0,
      editableMeshCompliant: false,
      errors: ['El modelo no contiene partes 3D.'],
    };
  }

  for (const part of parts) {
    const md = part?.meshData;
    if (!md || !Array.isArray(md.vertices) || !Array.isArray(md.faces)) {
      errors.push(`Parte '${part?.name || 'unknown'}' carece de buffers meshData.`);
      continue;
    }
    const vCount = md.vertices.length;
    const fCount = md.faces.length;
    totalVertices += vCount;
    totalTriangles += fCount;

    if (vCount > 9000 || fCount > 9500) {
      editableMeshCompliant = false;
      errors.push(
        `Parte '${part.name}' excede límites seguros EditableMesh (${vCount} verts, ${fCount} tris).`
      );
    }

    for (const face of md.faces) {
      if (!Array.isArray(face) || face.length < 3) {
        degenerateTriangles++;
        continue;
      }
      const [i0, i1, i2] = face;
      if (i0 === i1 || i1 === i2 || i0 === i2) {
        degenerateTriangles++;
        continue;
      }
      const v0 = md.vertices[i0];
      const v1 = md.vertices[i1];
      const v2 = md.vertices[i2];
      if (!v0 || !v1 || !v2) {
        degenerateTriangles++;
        continue;
      }
      const ux = v1[0] - v0[0];
      const uy = v1[1] - v0[1];
      const uz = v1[2] - v0[2];
      const vx = v2[0] - v0[0];
      const vy = v2[1] - v0[1];
      const vz = v2[2] - v0[2];
      const cx = uy * vz - uz * vy;
      const cy = uz * vx - ux * vz;
      const cz = ux * vy - uy * vx;
      const area2 = Math.hypot(cx, cy, cz);
      if (!Number.isFinite(area2) || area2 < 1e-8) {
        degenerateTriangles++;
      }
    }
  }

  if (degenerateTriangles > 0) {
    errors.push(`Se detectaron ${degenerateTriangles} triángulos degenerados.`);
  }

  return {
    valid: errors.length === 0 && totalVertices > 0 && totalTriangles > 0,
    totalParts: parts.length,
    totalVertices,
    totalTriangles,
    degenerateTriangles,
    editableMeshCompliant,
    errors,
  };
}
