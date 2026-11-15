/**
 * @module specializedGeometryGenerators
 * @description
 * FASE 3 & FASE 6 — Nueva Arquitectura Geométrica Especializada + Optimización y Presupuesto Poligonal.
 *
 * Implementa motores geométricos especializados por familia de objetos:
 * 1. Árboles y Vegetación:
 *    - Raíces superficiales orgánicas (`SurfaceRoot_1..K`) + `RootFlare`.
 *    - Tronco irregular con variación de sección y curvatura.
 *    - Ramificación jerárquica recursiva (`Primary -> Secondary -> Tertiary/Twigs`).
 *    - Especies diferenciadas: `oak` (roble), `pine` (pino en pisos cónicos),
 *      `willow` (sauce con frondas colgantes), `dead` (árbol seco/muerto sin copa esférica),
 *      `fantasy` (árbol bioluminiscente con cristales y raíces espirales), `bonsai`.
 *    - Clusters de follaje orgánicos y geometría de hojas optimizada.
 * 2. Rocas y Naturaleza:
 *    - Mallas basadas en **icosferas subdivididas y deformadas** (`buildDeformedIcosphereMesh`).
 *    - Cortes planares (facetas y fracturas), estratificación horizontal y erosión basal.
 *    - Formaciones naturales de rocas (peñasco principal + agujas + lajas + cristales/musgo).
 * 3. Edificios y Estructuras:
 *    - Generación arquitectónica modular con cimiento escalonado, muros de fachada,
 *      puerta con marco y dintel/arco, ventanas con marco y cristal, columnas acanaladas,
 *      cornisas/molduras y tejado a cuatro aguas o almenado.
 * 4. Mobiliario, Props y Objetos Mecánicos:
 *    - Motores conscientes de la función del objeto:
 *      * Sillas/Tronos (`chair`): 4 patas torneadas, travesaños, asiento contorneado, respaldo inclinado con barrotes y reposabrazos.
 *      * Mesas (`table`): tablero biselado, faldón estructural, 4 patas y travesaño central.
 *      * Lámparas/Faroles (`lamp`): base torneada escalonada, poste acanalado, jaula/pantalla translúcida y núcleo emisivo Neón.
 *      * Objetos Mecánicos (`mechanical`): chasis pesado, ruedas dentadas reales (`buildToothedGearMesh`), pistones hidráulicos dobles, eje rotor y núcleo energético.
 *      * Cofres/Props (`chest_or_prop`): cofre articulado con tapa abovedada, herrajes de hierro y cerradura.
 * 5. Escenarios y Decoración (`Scene3D`):
 *    - Ensamblaje espacial multi-asset con terreno/plaza en `Y=0`, estructura focal, árboles,
 *      formaciones rocosas, faroles de iluminación y props con jerarquías `Root/Zone_*`.
 * 6. Imagen a 3D (`image_lathe`):
 *    - Reconstrucción volumétrica mediante revolución/lofting del perfil real de 16 cortes extraído de la imagen 2D.
 */

import type { AiDirectorBlueprint, SpecializedObjectFamily, TreeSpeciesArchetype } from './aiGenerationDirector.ts';
import type { ReferenceImageAnalysis } from './imageReferenceProcessor.ts';

export interface LodMeshBuffer {
  vertices: [number, number, number][];
  normals: [number, number, number][];
  uvs: [number, number][];
  faces: [number, number, number][];
  indices: number[];
}

export interface LodLevelDescriptor extends LodMeshBuffer {
  level: 0 | 1 | 2;
  ratio: number;
  vertexCount: number;
  triangleCount: number;
}

export interface SpecializedMeshData extends LodMeshBuffer {
  objFileName: string;
  meshId: string | null;
  assetId: string | null;
  geometrySource: 'EditableMeshBuffers';
  activeLod: 0 | 1 | 2;
  lodLevels: [LodLevelDescriptor, LodLevelDescriptor, LodLevelDescriptor];
}

export interface SpecializedPartSpec {
  partId: string;
  name: string;
  parentId: string;
  parentName: string;
  parentPath: string;
  parentContainerClass: 'Model';
  hierarchyPath: string;
  shape: 'MeshPart';
  size: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  color: string;
  colorRgb255: [number, number, number];
  colorSpace: 'rgb8';
  material: string;
  roughness: number;
  metalness: number;
  reflectance: number;
  transparency: number;
  anchored: boolean;
  canCollide: boolean;
  collisionFidelity: 'Hull' | 'Box' | 'PreciseConvexDecomposition';
  meshId: null;
  assetId: null;
  meshData: SpecializedMeshData;
}

export interface BudgetAllocationProfile {
  targetPolyBudget: number;
  detailLevel: 'low' | 'medium' | 'high' | 'ultra';
  budgetScale: number;
  radialSegmentsPrimary: number;
  heightSegmentsPrimary: number;
  radialSegmentsSecondary: number;
  heightSegmentsSecondary: number;
  icosphereSubdivisionsPrimary: number;
  icosphereSubdivisionsSecondary: number;
  branchRecursionDepth: 1 | 2 | 3;
  gearTeethCount: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function hexToRgb255Tuple(hex: string): [number, number, number] {
  const clean = String(hex || '#808080').replace(/^#/, '').trim();
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)];
    }
  }
  return [128, 128, 128];
}

export function jitterHexColor(baseHex: string, delta: number): string {
  const [r, g, b] = hexToRgb255Tuple(baseHex);
  const shift = Math.round(delta * 255);
  const nr = clamp(r + shift, 12, 245).toString(16).padStart(2, '0');
  const ng = clamp(g + shift, 12, 245).toString(16).padStart(2, '0');
  const nb = clamp(b + shift, 12, 245).toString(16).padStart(2, '0');
  return `#${nr}${ng}${nb}`;
}

export function createDeterministicRng(seedStr: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  if (h === 0) h = 0x9e3779b9;
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic 3D value/harmonic noise in [-1, 1] for organic surface displacement.
 */
function noise3D(x: number, y: number, z: number, seedOffset = 0): number {
  const s1 = Math.sin(x * 2.17 + y * 3.11 + z * 1.73 + seedOffset * 5.13);
  const s2 = Math.cos(x * 4.53 - y * 2.39 + z * 3.87 - seedOffset * 2.91);
  const s3 = Math.sin((x + z) * 6.19 + y * 5.07 + seedOffset * 1.37);
  return clamp(s1 * 0.52 + s2 * 0.31 + s3 * 0.17, -1, 1);
}

/**
 * Computes a real geometric budget allocation profile from `target_poly_budget` and `detailLevel`.
 * Directly addresses Audit Point #4 and #5 (`target_poly_budget` and `detailLevel` must produce
 * measurable, proportional geometric changes without deleting primary silhouette components).
 */
export function computeBudgetAllocationProfile(
  targetPolyBudget?: number,
  detailLevel: 'low' | 'medium' | 'high' | 'ultra' = 'medium'
): BudgetAllocationProfile {
  const defaultByDetail: Record<'low' | 'medium' | 'high' | 'ultra', number> = {
    low: 900,
    medium: 2500,
    high: 6000,
    ultra: 11000,
  };
  const effectiveBudget = clamp(
    Number.isFinite(Number(targetPolyBudget)) && Number(targetPolyBudget) >= 150
      ? Number(targetPolyBudget)
      : defaultByDetail[detailLevel] || 2500,
    180,
    36000
  );

  const detailMultiplier =
    detailLevel === 'low' ? 0.68 : detailLevel === 'high' ? 1.38 : detailLevel === 'ultra' ? 1.85 : 1.0;
  const rawScale = Math.sqrt(effectiveBudget / 2200) * detailMultiplier;
  const budgetScale = clamp(rawScale, 0.45, 2.5);

  const radialSegmentsPrimary = clamp(Math.round(12 * budgetScale), 6, 28);
  const heightSegmentsPrimary = clamp(Math.round(8 * budgetScale), 4, 20);
  const radialSegmentsSecondary = clamp(Math.round(8 * budgetScale), 5, 20);
  const heightSegmentsSecondary = clamp(Math.round(5 * budgetScale), 3, 14);

  const icosphereSubdivisionsPrimary =
    effectiveBudget < 900 || detailLevel === 'low'
      ? 1
      : effectiveBudget < 3500 && detailLevel === 'medium'
        ? 2
        : effectiveBudget < 8500
          ? 3
          : 4;
  const icosphereSubdivisionsSecondary = Math.max(1, icosphereSubdivisionsPrimary - 1);

  const branchRecursionDepth: 1 | 2 | 3 =
    effectiveBudget < 850 || detailLevel === 'low'
      ? 1
      : effectiveBudget >= 4800 || detailLevel === 'high' || detailLevel === 'ultra'
        ? 3
        : 2;

  const gearTeethCount = clamp(Math.round(12 * clamp(budgetScale, 0.7, 1.8)), 8, 22);

  return {
    targetPolyBudget: effectiveBudget,
    detailLevel,
    budgetScale: Number(budgetScale.toFixed(3)),
    radialSegmentsPrimary,
    heightSegmentsPrimary,
    radialSegmentsSecondary,
    heightSegmentsSecondary,
    icosphereSubdivisionsPrimary,
    icosphereSubdivisionsSecondary,
    branchRecursionDepth,
    gearTeethCount,
  };
}

/**
 * Recomputes smooth vertex normals and sanitizes faces to guarantee zero degenerate triangles
 * and outward-pointing normals.
 */
function finalizeLodMeshBuffer(
  vertices: [number, number, number][],
  uvs: [number, number][],
  rawFaces: [number, number, number][],
  targetSize: [number, number, number]
): LodMeshBuffer {
  const [sx, sy, sz] = targetSize;
  // Normalize vertices to fit within [-sx/2..sx/2, -sy/2..sy/2, -sz/2..sz/2]
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const [vx, vy, vz] of vertices) {
    if (vx < minX) minX = vx;
    if (vx > maxX) maxX = vx;
    if (vy < minY) minY = vy;
    if (vy > maxY) maxY = vy;
    if (vz < minZ) minZ = vz;
    if (vz > maxZ) maxZ = vz;
  }
  const spanX = Math.max(1e-4, maxX - minX);
  const spanY = Math.max(1e-4, maxY - minY);
  const spanZ = Math.max(1e-4, maxZ - minZ);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;

  const scaledVerts: [number, number, number][] = vertices.map(([vx, vy, vz]) => [
    round4(((vx - cx) / spanX) * sx),
    round4(((vy - cy) / spanY) * sy),
    round4(((vz - cz) / spanZ) * sz),
  ]);

  const vCount = scaledVerts.length;
  const accumNormals: [number, number, number][] = Array.from({ length: vCount }, () => [0, 0, 0]);
  const validFaces: [number, number, number][] = [];

  for (const [i0, i1, i2] of rawFaces) {
    if (
      i0 === i1 ||
      i1 === i2 ||
      i0 === i2 ||
      i0 < 0 ||
      i1 < 0 ||
      i2 < 0 ||
      i0 >= vCount ||
      i1 >= vCount ||
      i2 >= vCount
    ) {
      continue;
    }
    const v0 = scaledVerts[i0];
    const v1 = scaledVerts[i1];
    const v2 = scaledVerts[i2];
    const ax = v1[0] - v0[0];
    const ay = v1[1] - v0[1];
    const az = v1[2] - v0[2];
    const bx = v2[0] - v0[0];
    const by = v2[1] - v0[1];
    const bz = v2[2] - v0[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const area2 = Math.hypot(nx, ny, nz);
    if (area2 < 1e-7) continue;

    validFaces.push([i0, i1, i2]);
    accumNormals[i0][0] += nx;
    accumNormals[i0][1] += ny;
    accumNormals[i0][2] += nz;
    accumNormals[i1][0] += nx;
    accumNormals[i1][1] += ny;
    accumNormals[i1][2] += nz;
    accumNormals[i2][0] += nx;
    accumNormals[i2][1] += ny;
    accumNormals[i2][2] += nz;
  }

  const normals: [number, number, number][] = accumNormals.map(([nx, ny, nz], idx) => {
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-6) {
      return [round4(nx / len), round4(ny / len), round4(nz / len)];
    }
    const [vx, vy, vz] = scaledVerts[idx];
    const vLen = Math.hypot(vx, vy, vz) || 1;
    return [round4(vx / vLen), round4(vy / vLen), round4(vz / vLen)];
  });

  const safeUvs: [number, number][] = scaledVerts.map(([vx, vy, vz], idx) => {
    if (uvs[idx]) {
      return [round4(clamp(uvs[idx][0], 0, 1)), round4(clamp(uvs[idx][1], 0, 1))];
    }
    const u = (Math.atan2(vz, vx) / (Math.PI * 2)) + 0.5;
    const v = clamp((vy / Math.max(0.1, sy)) + 0.5, 0, 1);
    return [round4(u), round4(v)];
  });

  const indices: number[] = [];
  for (const [f0, f1, f2] of validFaces) {
    indices.push(f0, f1, f2);
  }

  return {
    vertices: scaledVerts,
    normals,
    uvs: safeUvs,
    faces: validFaces,
    indices,
  };
}

/**
 * Wraps a generator callback that accepts a segment multiplier so every part automatically
 * receives true, silhouette-preserving `LOD0` (100%), `LOD1` (~55%), and `LOD2` (~30%) meshes.
 */
function buildMultiLodSpecializedMesh(
  modelName: string,
  lodBuilder: (lodFactor: number) => LodMeshBuffer,
  activeLod: 0 | 1 | 2 = 0
): SpecializedMeshData {
  const lod0 = lodBuilder(1.0);
  const lod1 = lodBuilder(0.62);
  const lod2 = lodBuilder(0.38);
  const baseTris = Math.max(1, lod0.faces.length);
  const lodLevels: [LodLevelDescriptor, LodLevelDescriptor, LodLevelDescriptor] = [
    {
      level: 0,
      ratio: 1.0,
      vertexCount: lod0.vertices.length,
      triangleCount: lod0.faces.length,
      ...lod0,
    },
    {
      level: 1,
      ratio: round4(lod1.faces.length / baseTris),
      vertexCount: lod1.vertices.length,
      triangleCount: lod1.faces.length,
      ...lod1,
    },
    {
      level: 2,
      ratio: round4(lod2.faces.length / baseTris),
      vertexCount: lod2.vertices.length,
      triangleCount: lod2.faces.length,
      ...lod2,
    },
  ];
  const chosen = lodLevels[activeLod] || lodLevels[0];
  return {
    vertices: chosen.vertices,
    normals: chosen.normals,
    uvs: chosen.uvs,
    faces: chosen.faces,
    indices: chosen.indices,
    objFileName: `${modelName}.obj`,
    meshId: null,
    assetId: null,
    geometrySource: 'EditableMeshBuffers',
    activeLod,
    lodLevels,
  };
}

/**
 * 1. Specialized Curved & Tapered Organic Tube Mesh
 * Used for curved tree trunks, primary/secondary/tertiary branches, surface roots,
 * chair legs, curved armrests, and fluted lamp columns.
 */
export function buildTaperedCurvedTubeMesh(options: {
  modelName: string;
  size: [number, number, number];
  radialSegments: number;
  heightSegments: number;
  bottomRadiusRatio?: number;
  topRadiusRatio?: number;
  curveX?: number;
  curveZ?: number;
  flutingCount?: number;
  flutingDepth?: number;
  barkRoughness?: number;
  seedOffset?: number;
}): SpecializedMeshData {
  const {
    modelName,
    size,
    radialSegments,
    heightSegments,
    bottomRadiusRatio = 1.0,
    topRadiusRatio = 0.62,
    curveX = 0.0,
    curveZ = 0.0,
    flutingCount = 5,
    flutingDepth = 0.08,
    barkRoughness = 0.06,
    seedOffset = 1.0,
  } = options;

  return buildMultiLodSpecializedMesh(modelName, (lodFactor) => {
    const rSegs = Math.max(5, Math.round(radialSegments * lodFactor));
    const hSegs = Math.max(2, Math.round(heightSegments * lodFactor));
    const vertices: [number, number, number][] = [];
    const uvs: [number, number][] = [];
    const faces: [number, number, number][] = [];

    for (let h = 0; h <= hSegs; h++) {
      const v = h / hSegs; // 0 = bottom, 1 = top
      const y = (v - 0.5) * size[1];
      // Root flare near bottom + smooth taper toward top
      const flareBoost = v < 0.2 ? Math.pow(1 - v / 0.2, 2) * 0.22 : 0;
      const baseRadius = bottomRadiusRatio * (1 - v) + topRadiusRatio * v + flareBoost;
      // Smooth S-curve / arch bend along height
      const bendOffsetX = Math.sin(v * Math.PI) * curveX * size[0] * 0.45;
      const bendOffsetZ = Math.sin(v * Math.PI * 0.85) * curveZ * size[2] * 0.45;

      for (let r = 0; r < rSegs; r++) {
        const u = r / rSegs;
        const theta = u * Math.PI * 2;
        const flute = 1 + Math.sin(theta * flutingCount + v * 3.2 + seedOffset) * flutingDepth * (1 - v * 0.5);
        const bark = 1 + noise3D(Math.cos(theta), v * 3, Math.sin(theta), seedOffset) * barkRoughness;
        const radX = size[0] * 0.5 * baseRadius * flute * bark;
        const radZ = size[2] * 0.5 * baseRadius * flute * bark;
        const vx = Math.cos(theta) * radX + bendOffsetX;
        const vz = Math.sin(theta) * radZ + bendOffsetZ;
        vertices.push([vx, y, vz]);
        uvs.push([u, v]);
      }
    }

    // Side quads -> triangles
    for (let h = 0; h < hSegs; h++) {
      const rowA = h * rSegs;
      const rowB = (h + 1) * rSegs;
      for (let r = 0; r < rSegs; r++) {
        const nextR = (r + 1) % rSegs;
        faces.push([rowA + r, rowB + r, rowB + nextR]);
        faces.push([rowA + r, rowB + nextR, rowA + nextR]);
      }
    }

    // Bottom cap center + Top cap center for watertight manifold
    const botCenterIdx = vertices.length;
    vertices.push([0, -size[1] * 0.5, 0]);
    uvs.push([0.5, 0]);
    const topCenterIdx = vertices.length;
    vertices.push([0, size[1] * 0.5, 0]);
    uvs.push([0.5, 1]);

    const topRow = hSegs * rSegs;
    for (let r = 0; r < rSegs; r++) {
      const nextR = (r + 1) % rSegs;
      faces.push([botCenterIdx, nextR, r]);
      faces.push([topCenterIdx, topRow + r, topRow + nextR]);
    }

    return finalizeLodMeshBuffer(vertices, uvs, faces, size);
  });
}

/**
 * 2. True Subdivided & Deformed Geodesic Icosphere Mesh
 * Used for Rocks (with planar fracture cuts, stratification & erosion) and Organic Foliage Clusters.
 */
export function buildDeformedIcosphereMesh(options: {
  modelName: string;
  size: [number, number, number];
  subdivisions: number;
  noiseAmplitude?: number;
  facetPlanesCount?: number;
  stratificationStrength?: number;
  basalFlatten?: number;
  canopyLobes?: number;
  seedOffset?: number;
}): SpecializedMeshData {
  const {
    modelName,
    size,
    subdivisions,
    noiseAmplitude = 0.22,
    facetPlanesCount = 6,
    stratificationStrength = 0.14,
    basalFlatten = 0.35,
    canopyLobes = 0,
    seedOffset = 1.0,
  } = options;

  return buildMultiLodSpecializedMesh(modelName, (lodFactor) => {
    const targetSubdiv =
      lodFactor >= 0.9 ? subdivisions : lodFactor >= 0.55 ? Math.max(1, subdivisions - 1) : 1;

    const t = (1 + Math.sqrt(5)) / 2;
    const initVerts: [number, number, number][] = [
      [-1, t, 0],
      [1, t, 0],
      [-1, -t, 0],
      [1, -t, 0],
      [0, -1, t],
      [0, 1, t],
      [0, -1, -t],
      [0, 1, -t],
      [t, 0, -1],
      [t, 0, 1],
      [-t, 0, -1],
      [-t, 0, 1],
    ].map(([vx, vy, vz]) => {
      const len = Math.hypot(vx, vy, vz);
      return [vx / len, vy / len, vz / len];
    });

    let tris: [number, number, number][] = [
      [0, 11, 5],
      [0, 5, 1],
      [0, 1, 7],
      [0, 7, 10],
      [0, 10, 11],
      [1, 5, 9],
      [5, 11, 4],
      [11, 10, 2],
      [10, 7, 6],
      [7, 1, 8],
      [3, 9, 4],
      [3, 4, 2],
      [3, 2, 6],
      [3, 6, 8],
      [3, 8, 9],
      [4, 9, 5],
      [2, 4, 11],
      [6, 2, 10],
      [8, 6, 7],
      [9, 8, 1],
    ];

    const verts = [...initVerts];

    for (let s = 0; s < targetSubdiv; s++) {
      const midpointCache = new Map<string, number>();
      const getMidpoint = (i1: number, i2: number): number => {
        const key = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
        const existing = midpointCache.get(key);
        if (existing !== undefined) return existing;
        const v1 = verts[i1];
        const v2 = verts[i2];
        const mx = (v1[0] + v2[0]) * 0.5;
        const my = (v1[1] + v2[1]) * 0.5;
        const mz = (v1[2] + v2[2]) * 0.5;
        const len = Math.hypot(mx, my, mz) || 1;
        const newIdx = verts.length;
        verts.push([mx / len, my / len, mz / len]);
        midpointCache.set(key, newIdx);
        return newIdx;
      };

      const nextTris: [number, number, number][] = [];
      for (const [a, b, c] of tris) {
        const ab = getMidpoint(a, b);
        const bc = getMidpoint(b, c);
        const ca = getMidpoint(c, a);
        nextTris.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      tris = nextTris;
    }

    // Generate deterministic fracture planes for rock faceting
    const rng = createDeterministicRng(`icosphere-${seedOffset}-${facetPlanesCount}`);
    const fracturePlanes: Array<{ nx: number; ny: number; nz: number; dist: number }> = [];
    for (let p = 0; p < facetPlanesCount; p++) {
      const theta = rng() * Math.PI * 2;
      const phi = (rng() - 0.35) * Math.PI * 0.85;
      const nx = Math.cos(phi) * Math.cos(theta);
      const ny = Math.sin(phi);
      const nz = Math.cos(phi) * Math.sin(theta);
      fracturePlanes.push({
        nx,
        ny,
        nz,
        dist: 0.68 + rng() * 0.24,
      });
    }

    const deformedVerts: [number, number, number][] = [];
    const uvs: [number, number][] = [];

    for (const [ux, uy, uz] of verts) {
      let radius = 1.0;

      // 1. Fractal 3D geometric noise
      const n1 = noise3D(ux * 1.8, uy * 1.8, uz * 1.8, seedOffset);
      const n2 = noise3D(ux * 3.7, uy * 3.7, uz * 3.7, seedOffset + 7.1) * 0.45;
      radius += (n1 + n2) * noiseAmplitude;

      // 2. Planar fracture cuts (rock facets & sharp ridges)
      for (const pl of fracturePlanes) {
        const dot = ux * pl.nx + uy * pl.ny + uz * pl.nz;
        if (dot > pl.dist) {
          radius -= (dot - pl.dist) * 0.58;
        }
      }

      // 3. Sedimentary horizontal stratification layers
      if (stratificationStrength > 0) {
        const strata = Math.sin((uy + 1) * Math.PI * 5.5 + seedOffset) * stratificationStrength;
        radius += strata * 0.35;
      }

      // 4. Multi-lobed billowing for organic tree canopies
      if (canopyLobes > 0) {
        const angle = Math.atan2(uz, ux);
        const lobeWave = Math.cos(angle * canopyLobes + seedOffset) * 0.16 * (1 - Math.abs(uy) * 0.5);
        const tierWave = Math.sin((uy + 0.6) * Math.PI * 3) * 0.11;
        radius += lobeWave + tierWave;
      }

      radius = clamp(radius, 0.38, 1.45);
      const vx = ux * radius * size[0] * 0.5;
      let vy = uy * radius * size[1] * 0.5;
      const vz = uz * radius * size[2] * 0.5;

      // 5. Basal erosion / grounding flattening near bottom
      if (basalFlatten > 0 && vy < -size[1] * 0.28) {
        vy = -size[1] * 0.28 + (vy + size[1] * 0.28) * (1 - basalFlatten);
      }

      deformedVerts.push([vx, vy, vz]);
      const u = Math.atan2(uz, ux) / (Math.PI * 2) + 0.5;
      const v = clamp(uy * 0.5 + 0.5, 0, 1);
      uvs.push([u, v]);
    }

    return finalizeLodMeshBuffer(deformedVerts, uvs, tris, size);
  });
}

/**
 * 3. True Toothed Involute Gear Wheel Mesh (`buildToothedGearMesh`)
 * Used for mechanical objects, gearboxes, turbines, and clockwork mechanisms.
 */
export function buildToothedGearMesh(options: {
  modelName: string;
  size: [number, number, number];
  teethCount: number;
  toothDepthRatio?: number;
  hubRadiusRatio?: number;
}): SpecializedMeshData {
  const {
    modelName,
    size,
    teethCount,
    toothDepthRatio = 0.22,
    hubRadiusRatio = 0.35,
  } = options;

  return buildMultiLodSpecializedMesh(modelName, (lodFactor) => {
    const nTeeth = Math.max(6, Math.round(teethCount * clamp(lodFactor, 0.5, 1.0)));
    const segsPerTooth = 4; // root -> flank up -> tip -> flank down
    const totalRingSegs = nTeeth * segsPerTooth;

    const vertices: [number, number, number][] = [];
    const uvs: [number, number][] = [];
    const faces: [number, number, number][] = [];

    const outerRx = size[0] * 0.5;
    const outerRz = size[2] * 0.5;
    const innerRx = outerRx * (1 - toothDepthRatio);
    const innerRz = outerRz * (1 - toothDepthRatio);
    const halfY = size[1] * 0.5;

    // Ring 0: bottom outer toothed profile, Ring 1: top outer toothed profile
    for (let ring = 0; ring < 2; ring++) {
      const y = ring === 0 ? -halfY : halfY;
      for (let s = 0; s < totalRingSegs; s++) {
        const phase = s % segsPerTooth;
        const isTip = phase === 1 || phase === 2;
        const rx = isTip ? outerRx : innerRx;
        const rz = isTip ? outerRz : innerRz;
        const theta = (s / totalRingSegs) * Math.PI * 2;
        vertices.push([Math.cos(theta) * rx, y, Math.sin(theta) * rz]);
        uvs.push([s / totalRingSegs, ring]);
      }
    }

    // Ring 2: bottom inner hub ring, Ring 3: top inner hub ring
    for (let ring = 0; ring < 2; ring++) {
      const y = ring === 0 ? -halfY * 1.15 : halfY * 1.15;
      for (let s = 0; s < totalRingSegs; s++) {
        const theta = (s / totalRingSegs) * Math.PI * 2;
        vertices.push([
          Math.cos(theta) * outerRx * hubRadiusRatio,
          y,
          Math.sin(theta) * outerRz * hubRadiusRatio,
        ]);
        uvs.push([s / totalRingSegs, ring === 0 ? 0.25 : 0.75]);
      }
    }

    const r0 = 0;
    const r1 = totalRingSegs;
    const r2 = totalRingSegs * 2;
    const r3 = totalRingSegs * 3;

    const botCenterIdx = vertices.length;
    vertices.push([0, -halfY, 0]);
    uvs.push([0.5, 0.5]);
    const topCenterIdx = vertices.length;
    vertices.push([0, halfY, 0]);
    uvs.push([0.5, 0.5]);

    for (let s = 0; s < totalRingSegs; s++) {
      const next = (s + 1) % totalRingSegs;
      // Outer gear teeth rim
      faces.push([r0 + s, r1 + s, r1 + next]);
      faces.push([r0 + s, r1 + next, r0 + next]);
      // Top annulus from outer rim to hub
      faces.push([r1 + s, r3 + s, r3 + next]);
      faces.push([r1 + s, r3 + next, r1 + next]);
      // Bottom annulus from outer rim to hub
      faces.push([r0 + s, r0 + next, r2 + next]);
      faces.push([r0 + s, r2 + next, r2 + s]);
      // Hub caps
      faces.push([topCenterIdx, r3 + s, r3 + next]);
      faces.push([botCenterIdx, r2 + next, r2 + s]);
    }

    return finalizeLodMeshBuffer(vertices, uvs, faces, size);
  });
}

/**
 * 4. Architectural Pitched / Gable / Pyramid / Pagoda Roof & Molding Mesh
 */
export function buildArchitecturalRoofMesh(options: {
  modelName: string;
  size: [number, number, number];
  roofStyle: 'pitched_hip' | 'gable' | 'pagoda_curved' | 'crenellated';
  segments: number;
}): SpecializedMeshData {
  const { modelName, size, roofStyle, segments } = options;

  return buildMultiLodSpecializedMesh(modelName, (lodFactor) => {
    const hSegs = Math.max(3, Math.round(segments * lodFactor));
    const rSegs = roofStyle === 'gable' ? 4 : Math.max(4, Math.round(8 * lodFactor));
    const vertices: [number, number, number][] = [];
    const uvs: [number, number][] = [];
    const faces: [number, number, number][] = [];

    for (let h = 0; h <= hSegs; h++) {
      const v = h / hSegs; // 0 = eaves bottom, 1 = ridge/peak
      const y = (v - 0.5) * size[1];
      let scaleXZ = 1 - v * 0.88;
      if (roofStyle === 'pagoda_curved') {
        scaleXZ = Math.pow(1 - v, 1.45) * 1.08 + 0.06;
      } else if (roofStyle === 'crenellated') {
        scaleXZ = v > 0.75 ? 1.04 : 0.96;
      }

      for (let r = 0; r < rSegs; r++) {
        const u = r / rSegs;
        const angle = (u + 0.125) * Math.PI * 2;
        const rx = Math.cos(angle) * size[0] * 0.5 * scaleXZ;
        const rz = Math.sin(angle) * size[2] * 0.5 * scaleXZ;
        vertices.push([rx, y, rz]);
        uvs.push([u, v]);
      }
    }

    for (let h = 0; h < hSegs; h++) {
      const rowA = h * rSegs;
      const rowB = (h + 1) * rSegs;
      for (let r = 0; r < rSegs; r++) {
        const next = (r + 1) % rSegs;
        faces.push([rowA + r, rowB + r, rowB + next]);
        faces.push([rowA + r, rowB + next, rowA + next]);
      }
    }

    const botCenter = vertices.length;
    vertices.push([0, -size[1] * 0.5, 0]);
    uvs.push([0.5, 0]);
    const topCenter = vertices.length;
    vertices.push([0, size[1] * 0.5, 0]);
    uvs.push([0.5, 1]);
    const topRow = hSegs * rSegs;

    for (let r = 0; r < rSegs; r++) {
      const next = (r + 1) % rSegs;
      faces.push([botCenter, next, r]);
      faces.push([topCenter, topRow + r, topRow + next]);
    }

    return finalizeLodMeshBuffer(vertices, uvs, faces, size);
  });
}

/**
 * 5. Beveled Structural Panel / Box with Chamfered Edges & Subdivided Grid
 * Used for architectural walls, door frames, tabletops, chair seats, and mechanical housings.
 */
export function buildBeveledStructuralMesh(options: {
  modelName: string;
  size: [number, number, number];
  bevelRatio?: number;
  topTaperX?: number;
  topTaperZ?: number;
  archTop?: boolean;
  radialSegments?: number;
  heightSegments?: number;
}): SpecializedMeshData {
  const {
    modelName,
    size,
    bevelRatio = 0.08,
    topTaperX = 1.0,
    topTaperZ = 1.0,
    archTop = false,
    radialSegments = 8,
    heightSegments = 4,
  } = options;

  return buildMultiLodSpecializedMesh(modelName, (lodFactor) => {
    const rSegs = Math.max(4, Math.round(radialSegments * lodFactor));
    const hSegs = Math.max(2, Math.round(heightSegments * lodFactor));
    const vertices: [number, number, number][] = [];
    const uvs: [number, number][] = [];
    const faces: [number, number, number][] = [];

    for (let h = 0; h <= hSegs; h++) {
      const v = h / hSegs;
      let y = (v - 0.5) * size[1];
      const edgeBevel =
        h === 0 || h === hSegs ? 1 - bevelRatio : 1.0;
      const tx = (1 - v + v * topTaperX) * edgeBevel;
      const tz = (1 - v + v * topTaperZ) * edgeBevel;

      for (let r = 0; r < rSegs; r++) {
        const u = r / rSegs;
        const theta = (u + 0.125) * Math.PI * 2;
        // Superellipse exponent for crisp beveled rectangular profile
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        const sx = Math.sign(cosT) * Math.pow(Math.abs(cosT), 0.55) * size[0] * 0.5 * tx;
        const sz = Math.sign(sinT) * Math.pow(Math.abs(sinT), 0.55) * size[2] * 0.5 * tz;
        if (archTop && v > 0.75) {
          y += Math.cos((sx / Math.max(0.1, size[0] * 0.5)) * (Math.PI * 0.5)) * size[1] * 0.12 * ((v - 0.75) / 0.25);
        }
        vertices.push([sx, y, sz]);
        uvs.push([u, v]);
      }
    }

    for (let h = 0; h < hSegs; h++) {
      const rowA = h * rSegs;
      const rowB = (h + 1) * rSegs;
      for (let r = 0; r < rSegs; r++) {
        const next = (r + 1) % rSegs;
        faces.push([rowA + r, rowB + r, rowB + next]);
        faces.push([rowA + r, rowB + next, rowA + next]);
      }
    }

    const botCenter = vertices.length;
    vertices.push([0, -size[1] * 0.5, 0]);
    uvs.push([0.5, 0]);
    const topCenter = vertices.length;
    vertices.push([0, size[1] * 0.5, 0]);
    uvs.push([0.5, 1]);
    const topRow = hSegs * rSegs;

    for (let r = 0; r < rSegs; r++) {
      const next = (r + 1) % rSegs;
      faces.push([botCenter, next, r]);
      faces.push([topCenter, topRow + r, topRow + next]);
    }

    return finalizeLodMeshBuffer(vertices, uvs, faces, size);
  });
}

/**
 * 6. Revolved / Lofted Silhouette Lathe Mesh (`buildLatheSilhouetteMesh`)
 * Used for Image-to-3D reconstruction (FASE 5) and turned lampshades/columns.
 */
export function buildLatheSilhouetteMesh(options: {
  modelName: string;
  size: [number, number, number];
  widthProfile: number[];
  centerOffsetProfile?: number[];
  radialSegments: number;
}): SpecializedMeshData {
  const { modelName, size, widthProfile, centerOffsetProfile, radialSegments } = options;

  return buildMultiLodSpecializedMesh(modelName, (lodFactor) => {
    const rSegs = Math.max(6, Math.round(radialSegments * lodFactor));
    const profileLen = Math.max(4, widthProfile.length);
    const vertices: [number, number, number][] = [];
    const uvs: [number, number][] = [];
    const faces: [number, number, number][] = [];

    for (let h = 0; h < profileLen; h++) {
      const v = h / (profileLen - 1);
      const y = (v - 0.5) * size[1];
      const wNorm = clamp(widthProfile[h] ?? 0.5, 0.08, 1.0);
      const xShift = (centerOffsetProfile?.[h] ?? 0) * size[0] * 0.4;

      for (let r = 0; r < rSegs; r++) {
        const u = r / rSegs;
        const theta = u * Math.PI * 2;
        const vx = Math.cos(theta) * size[0] * 0.5 * wNorm + xShift;
        const vz = Math.sin(theta) * size[2] * 0.5 * wNorm;
        vertices.push([vx, y, vz]);
        uvs.push([u, v]);
      }
    }

    for (let h = 0; h < profileLen - 1; h++) {
      const rowA = h * rSegs;
      const rowB = (h + 1) * rSegs;
      for (let r = 0; r < rSegs; r++) {
        const next = (r + 1) % rSegs;
        faces.push([rowA + r, rowB + r, rowB + next]);
        faces.push([rowA + r, rowB + next, rowA + next]);
      }
    }

    const botCenter = vertices.length;
    vertices.push([0, -size[1] * 0.5, 0]);
    uvs.push([0.5, 0]);
    const topCenter = vertices.length;
    vertices.push([0, size[1] * 0.5, 0]);
    uvs.push([0.5, 1]);
    const topRow = (profileLen - 1) * rSegs;

    for (let r = 0; r < rSegs; r++) {
      const next = (r + 1) % rSegs;
      faces.push([botCenter, next, r]);
      faces.push([topCenter, topRow + r, topRow + next]);
    }

    return finalizeLodMeshBuffer(vertices, uvs, faces, size);
  });
}

function makePartSpec(params: {
  idx: number;
  name: string;
  parentPath: string;
  size: [number, number, number];
  position: [number, number, number];
  rotation?: [number, number, number];
  colorHex: string;
  material: string;
  roughness?: number;
  metalness?: number;
  reflectance?: number;
  transparency?: number;
  collisionFidelity: 'Hull' | 'Box' | 'PreciseConvexDecomposition';
  meshData: SpecializedMeshData;
}): SpecializedPartSpec {
  const cleanName = params.name.replace(/[^a-zA-Z0-9_]/g, '_');
  const parentPath = params.parentPath || 'Root';
  const segs = parentPath.split('/').filter(Boolean);
  const parentName = segs[segs.length - 1] || 'Root';
  const hex = params.colorHex.startsWith('#') ? params.colorHex.toLowerCase() : `#${params.colorHex.toLowerCase()}`;

  return {
    partId: `fpart_${params.idx}_${cleanName.toLowerCase()}`,
    name: cleanName,
    parentId: `fnode_${parentPath.replace(/[^a-zA-Z0-9_]/g, '_')}`,
    parentName,
    parentPath,
    parentContainerClass: 'Model',
    hierarchyPath: `${parentPath}/${cleanName}`,
    shape: 'MeshPart',
    size: [round4(params.size[0]), round4(params.size[1]), round4(params.size[2])],
    position: [round4(params.position[0]), round4(params.position[1]), round4(params.position[2])],
    rotation: [
      round4(params.rotation?.[0] ?? 0),
      round4(params.rotation?.[1] ?? 0),
      round4(params.rotation?.[2] ?? 0),
    ],
    color: hex,
    colorRgb255: hexToRgb255Tuple(hex),
    colorSpace: 'rgb8',
    material: params.material,
    roughness: clamp(params.roughness ?? 0.7, 0.04, 1),
    metalness: clamp(params.metalness ?? 0.08, 0, 1),
    reflectance: clamp(params.reflectance ?? 0.02, 0, 1),
    transparency: clamp(params.transparency ?? 0, 0, 0.95),
    anchored: true,
    canCollide: true,
    collisionFidelity: params.collisionFidelity,
    meshId: null,
    assetId: null,
    meshData: params.meshData,
  };
}

/**
 * Grounds an entire part assembly so its lowest bounding-box point rests exactly at Y = 0.000.
 */
export function groundPartsAtYZero<T extends { size: [number, number, number]; position: [number, number, number] }>(
  parts: T[]
): T[] {
  if (parts.length === 0) return parts;
  let minY = Infinity;
  for (const p of parts) {
    const bot = p.position[1] - p.size[1] * 0.5;
    if (bot < minY) minY = bot;
  }
  if (!Number.isFinite(minY)) return parts;
  const shiftY = -minY;
  for (const p of parts) {
    p.position = [
      round4(p.position[0]),
      round4(Math.max(p.size[1] * 0.5, p.position[1] + shiftY)),
      round4(p.position[2]),
    ];
  }
  return parts;
}

// ============================================================================
// CATEGORY 1: TREES & VEGETATION (Recursive Branching, Surface Roots, Species)
// ============================================================================
export function generateSpecializedTreeAssetParts(params: {
  modelName: string;
  species: TreeSpeciesArchetype;
  blueprint: AiDirectorBlueprint;
  budget: BudgetAllocationProfile;
  treeParams?: Record<string, any>;
  seed: string;
}): SpecializedPartSpec[] {
  const { modelName, species, blueprint, budget, treeParams = {}, seed } = params;
  const rng = createDeterministicRng(`tree-${seed}-${species}`);
  const parts: SpecializedPartSpec[] = [];
  let idx = 1;

  const totalHeight = clamp(Number(treeParams.height ?? blueprint.proportions_studs.height ?? 16), 5, 44);
  const totalWidth = clamp(Number(treeParams.width ?? blueprint.proportions_studs.width ?? totalHeight * 0.78), 4, 34);
  const trunkThick = clamp(Number(treeParams.trunkThickness ?? totalHeight * 0.11), 0.6, 5.5);
  const trunkCurvature = clamp(Number(treeParams.trunkCurvature ?? (species === 'willow' || species === 'bonsai' ? 0.38 : 0.2)), 0, 1);
  const trunkLean = clamp(Number(treeParams.trunkLean ?? (species === 'willow' ? 7 : 2)), -25, 25);
  const rootFlareScale = clamp(Number(treeParams.rootFlareScale ?? 1.4), 0.8, 2.4);
  const primaryBranchCount = clamp(
    Math.round(Number(treeParams.branchCount ?? (species === 'pine' ? 6 : 5))),
    2,
    10
  );
  const isDeadTree =
    species === 'dead' || Number(treeParams.foliageCount) === 0 || treeParams.leafDistribution === 'none';

  const trunkMat = blueprint.materials_and_textures.primary_material || 'Wood';
  const leafMat =
    species === 'fantasy'
      ? 'Neon'
      : blueprint.materials_and_textures.secondary_material || 'Grass';
  const trunkHex = blueprint.materials_and_textures.primary_hex;
  const leafHex = blueprint.materials_and_textures.secondary_hex;
  const accentHex = blueprint.materials_and_textures.accent_hex;
  const cf = blueprint.roblox_constraints.collision_fidelity;

  // 1. RootFlare at Y=0
  const flareH = round4(clamp(totalHeight * 0.11, 0.9, 3.6));
  const flareW = round4(trunkThick * 1.45 * rootFlareScale);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'RootFlare',
      parentPath: 'Root/Roots',
      size: [flareW, flareH, flareW],
      position: [0, flareH * 0.5, 0],
      rotation: [0, round4(rng() * 360), 0],
      colorHex: jitterHexColor(trunkHex, -0.03),
      material: trunkMat,
      roughness: 0.88,
      metalness: 0.04,
      collisionFidelity: cf,
      meshData: buildTaperedCurvedTubeMesh({
        modelName,
        size: [flareW, flareH, flareW],
        radialSegments: budget.radialSegmentsPrimary,
        heightSegments: Math.max(4, Math.round(budget.heightSegmentsPrimary * 0.7)),
        bottomRadiusRatio: 1.0,
        topRadiusRatio: 0.66,
        flutingCount: 6,
        flutingDepth: 0.16,
        barkRoughness: 0.08,
        seedOffset: rng() * 10,
      }),
    })
  );

  // 2. Organic Exposed Surface Roots (`SurfaceRoot_1..K`) radiating along Y=0
  const rootCount = clamp(Math.round(3 + budget.budgetScale * 2), 3, 6);
  for (let r = 0; r < rootCount; r++) {
    const angle = (r / rootCount) * Math.PI * 2 + (rng() - 0.5) * 0.35;
    const rootLen = round4(flareW * (0.55 + rng() * 0.28));
    const rootH = round4(Math.max(0.45, flareH * 0.42));
    const rootThk = round4(Math.max(0.35, trunkThick * 0.36));
    const rx = Math.cos(angle) * (flareW * 0.38);
    const rz = Math.sin(angle) * (flareW * 0.38);
    parts.push(
      makePartSpec({
        idx: idx++,
        name: `SurfaceRoot_${r + 1}`,
        parentPath: 'Root/Roots',
        size: [rootThk, rootH, rootLen],
        position: [rx, rootH * 0.5, rz],
        rotation: [-12, round4((angle * 180) / Math.PI + 90), 0],
        colorHex: jitterHexColor(trunkHex, -0.05),
        material: trunkMat,
        roughness: 0.9,
        metalness: 0.03,
        collisionFidelity: cf,
        meshData: buildTaperedCurvedTubeMesh({
          modelName,
          size: [rootThk, rootH, rootLen],
          radialSegments: budget.radialSegmentsSecondary,
          heightSegments: budget.heightSegmentsSecondary,
          bottomRadiusRatio: 0.95,
          topRadiusRatio: 0.42,
          curveX: 0.25,
          flutingCount: 4,
          flutingDepth: 0.1,
          seedOffset: r + 2.5,
        }),
      })
    );
  }

  // 3. Multi-section Irregular MainTrunk (`MainTrunk` + `UpperTrunkSpire`)
  const trunkH = round4(totalHeight * (species === 'pine' ? 0.68 : 0.54));
  const trunkY = round4(flareH * 0.78 + trunkH * 0.5);
  const trunkOffsetX = round4(Math.sin((trunkLean * Math.PI) / 180) * trunkH * 0.16);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'MainTrunk',
      parentPath: 'Root/Trunk',
      size: [trunkThick, trunkH, trunkThick],
      position: [trunkOffsetX, trunkY, 0],
      rotation: [round4(trunkLean * 0.45), round4(rng() * 180), round4(trunkLean)],
      colorHex: trunkHex,
      material: trunkMat,
      roughness: 0.85,
      metalness: 0.04,
      collisionFidelity: cf,
      meshData: buildTaperedCurvedTubeMesh({
        modelName,
        size: [trunkThick, trunkH, trunkThick],
        radialSegments: budget.radialSegmentsPrimary,
        heightSegments: budget.heightSegmentsPrimary,
        bottomRadiusRatio: 1.0,
        topRadiusRatio: 0.64,
        curveX: trunkCurvature * 0.55,
        curveZ: trunkCurvature * 0.35,
        flutingCount: 6,
        flutingDepth: 0.09,
        barkRoughness: 0.07,
        seedOffset: rng() * 20,
      }),
    })
  );

  // 4. Recursive Hierarchical Branching: Primary (`Branch_1..N`) -> Secondary (`SubBranch_1..M`) -> Tertiary (`TwigBranch_1..T`)
  const trunkTopY = flareH * 0.78 + trunkH;
  const branchTips: Array<{ x: number; y: number; z: number; angle: number; scale: number }> = [];

  for (let b = 0; b < primaryBranchCount; b++) {
    const tNorm = b / Math.max(1, primaryBranchCount - 1);
    const goldenAngle = b * 2.39996 + (rng() - 0.5) * 0.35;
    const bLen = round4(
      clamp(totalWidth * (species === 'pine' ? 0.32 * (1 - tNorm * 0.5) : 0.34), 1.6, totalHeight * 0.46)
    );
    const bThk = round4(Math.max(0.32, trunkThick * (0.46 - tNorm * 0.14)));
    const attachY = flareH + trunkH * (0.45 + tNorm * 0.48);
    const pitchDeg = species === 'willow' ? 58 : species === 'pine' ? 68 : 44 + (rng() - 0.5) * 14;
    const pitchRad = (pitchDeg * Math.PI) / 180;
    const reach = trunkThick * 0.32 + Math.sin(pitchRad) * bLen * 0.45;
    const bx = round4(trunkOffsetX + Math.cos(goldenAngle) * reach);
    const by = round4(attachY + Math.cos(pitchRad) * bLen * 0.38);
    const bz = round4(Math.sin(goldenAngle) * reach);

    parts.push(
      makePartSpec({
        idx: idx++,
        name: `Branch_${b + 1}`,
        parentPath: 'Root/Branches/Primary',
        size: [bThk, bLen, bThk],
        position: [bx, by, bz],
        rotation: [
          round4(Math.sin(goldenAngle) * pitchDeg),
          round4((goldenAngle * 180) / Math.PI),
          round4(-Math.cos(goldenAngle) * pitchDeg),
        ],
        colorHex: jitterHexColor(trunkHex, 0.02),
        material: trunkMat,
        roughness: 0.82,
        metalness: 0.04,
        collisionFidelity: cf,
        meshData: buildTaperedCurvedTubeMesh({
          modelName,
          size: [bThk, bLen, bThk],
          radialSegments: budget.radialSegmentsSecondary,
          heightSegments: budget.heightSegmentsSecondary,
          bottomRadiusRatio: 0.95,
          topRadiusRatio: 0.48,
          curveX: 0.22 + trunkCurvature * 0.3,
          flutingCount: 4,
          flutingDepth: 0.06,
          seedOffset: b * 3.1,
        }),
      })
    );

    const tipX = trunkOffsetX + Math.cos(goldenAngle) * (reach + bLen * 0.42);
    const tipY = attachY + Math.cos(pitchRad) * bLen * 0.72;
    const tipZ = Math.sin(goldenAngle) * (reach + bLen * 0.42);
    branchTips.push({ x: tipX, y: tipY, z: tipZ, angle: goldenAngle, scale: 1 - tNorm * 0.25 });

    // Recursive Level 2: Secondary Forked Sub-Branches (`SubBranch_*`)
    if (budget.branchRecursionDepth >= 2 || isDeadTree) {
      const subCount = isDeadTree ? 2 : b % 2 === 0 ? 2 : 1;
      for (let sb = 0; sb < subCount; sb++) {
        const subAngle = goldenAngle + (sb === 0 ? 0.52 : -0.52) + (rng() - 0.5) * 0.2;
        const subLen = round4(Math.max(1.1, bLen * 0.62));
        const subThk = round4(Math.max(0.22, bThk * 0.62));
        const sbx = round4(bx + Math.cos(subAngle) * (subLen * 0.48));
        const sby = round4(by + subLen * (species === 'willow' ? -0.15 : 0.32));
        const sbz = round4(bz + Math.sin(subAngle) * (subLen * 0.48));

        parts.push(
          makePartSpec({
            idx: idx++,
            name: `SubBranch_${b + 1}_${sb + 1}`,
            parentPath: 'Root/Branches/Secondary',
            size: [subThk, subLen, subThk],
            position: [sbx, sby, sbz],
            rotation: [
              round4(Math.sin(subAngle) * 52),
              round4((subAngle * 180) / Math.PI),
              round4(-Math.cos(subAngle) * 52),
            ],
            colorHex: jitterHexColor(trunkHex, 0.04),
            material: trunkMat,
            roughness: 0.8,
            metalness: 0.03,
            collisionFidelity: cf,
            meshData: buildTaperedCurvedTubeMesh({
              modelName,
              size: [subThk, subLen, subThk],
              radialSegments: Math.max(5, budget.radialSegmentsSecondary - 2),
              heightSegments: Math.max(3, budget.heightSegmentsSecondary - 1),
              bottomRadiusRatio: 0.9,
              topRadiusRatio: 0.38,
              curveX: 0.28,
              seedOffset: b * 7 + sb,
            }),
          })
        );

        // Recursive Level 3: Tertiary Twigs (`TwigBranch_*`) for high/ultra budgets or Dead trees
        if ((budget.branchRecursionDepth >= 3 || isDeadTree) && sb === 0 && b < 4) {
          const twigAngle = subAngle + 0.4;
          const twigLen = round4(Math.max(0.8, subLen * 0.58));
          const twigThk = round4(Math.max(0.16, subThk * 0.58));
          parts.push(
            makePartSpec({
              idx: idx++,
              name: `TwigBranch_${b + 1}`,
              parentPath: 'Root/Branches/Tertiary',
              size: [twigThk, twigLen, twigThk],
              position: [
                round4(sbx + Math.cos(twigAngle) * twigLen * 0.4),
                round4(sby + twigLen * 0.3),
                round4(sbz + Math.sin(twigAngle) * twigLen * 0.4),
              ],
              rotation: [35, round4((twigAngle * 180) / Math.PI), -35],
              colorHex: jitterHexColor(trunkHex, 0.06),
              material: trunkMat,
              roughness: 0.82,
              metalness: 0.02,
              collisionFidelity: cf,
              meshData: buildTaperedCurvedTubeMesh({
                modelName,
                size: [twigThk, twigLen, twigThk],
                radialSegments: 5,
                heightSegments: 3,
                bottomRadiusRatio: 0.85,
                topRadiusRatio: 0.28,
                curveX: 0.32,
                seedOffset: b * 11,
              }),
            })
          );
        }
      }
    }
  }

  // 5. Fantasy Bioluminescent Root Crystals (if species === 'fantasy')
  if (species === 'fantasy') {
    const crystalCount = 4;
    for (let c = 0; c < crystalCount; c++) {
      const cAngle = (c / crystalCount) * Math.PI * 2 + 0.4;
      const cH = round4(clamp(totalHeight * 0.16 * (0.85 + rng() * 0.3), 1.2, 4.2));
      const cW = round4(Math.max(0.45, cH * 0.34));
      const cx = Math.cos(cAngle) * (flareW * 0.52);
      const cz = Math.sin(cAngle) * (flareW * 0.52);
      parts.push(
        makePartSpec({
          idx: idx++,
          name: `BioCrystal_${c + 1}`,
          parentPath: 'Root/FantasyCrystals',
          size: [cW, cH, cW],
          position: [cx, cH * 0.48, cz],
          rotation: [round4(Math.sin(cAngle) * 18), round4(c * 72), round4(-Math.cos(cAngle) * 18)],
          colorHex: c % 2 === 0 ? accentHex : leafHex,
          material: 'Neon',
          roughness: 0.15,
          metalness: 0.1,
          reflectance: 0.35,
          collisionFidelity: cf,
          meshData: buildDeformedIcosphereMesh({
            modelName,
            size: [cW, cH, cW],
            subdivisions: budget.icosphereSubdivisionsSecondary,
            noiseAmplitude: 0.12,
            facetPlanesCount: 8,
            stratificationStrength: 0,
            basalFlatten: 0.1,
            seedOffset: 50 + c,
          }),
        })
      );
    }
  }

  // 6. Species-Specific Canopy & Foliage Clusters
  if (!isDeadTree) {
    if (species === 'pine') {
      // Conical tiered pine whorls
      const tierCount = clamp(Math.round(3 + budget.budgetScale), 3, 6);
      for (let t = 0; t < tierCount; t++) {
        const tierNorm = t / (tierCount - 1);
        const tierW = round4(totalWidth * (0.95 - tierNorm * 0.62));
        const tierH = round4((totalHeight * 0.62) / tierCount * 1.35);
        const tierY = round4(flareH + trunkH * 0.38 + tierNorm * (totalHeight * 0.52));
        parts.push(
          makePartSpec({
            idx: idx++,
            name: t === 0 ? 'CanopyCrown_Main' : `PineCanopyTier_${t + 1}`,
            parentPath: 'Root/Canopy',
            size: [tierW, tierH, tierW],
            position: [trunkOffsetX, tierY, 0],
            rotation: [0, round4(t * 37), 0],
            colorHex: jitterHexColor(leafHex, (tierNorm - 0.5) * 0.08),
            material: leafMat,
            roughness: 0.76,
            metalness: 0.03,
            collisionFidelity: cf,
            meshData: buildArchitecturalRoofMesh({
              modelName,
              size: [tierW, tierH, tierW],
              roofStyle: 'pagoda_curved',
              segments: budget.heightSegmentsPrimary,
            }),
          })
        );
      }
    } else {
      // Multi-lobed Organic Crown (`CanopyCrown_Main`) + Satellite `FoliageCluster_1..C`
      const crownW = round4(totalWidth * 0.76);
      const crownH = round4(totalHeight * (species === 'bonsai' ? 0.28 : 0.42));
      const crownY = round4(trunkTopY + crownH * 0.18);
      parts.push(
        makePartSpec({
          idx: idx++,
          name: 'CanopyCrown_Main',
          parentPath: 'Root/Canopy',
          size: [crownW, crownH, crownW],
          position: [trunkOffsetX, crownY, 0],
          rotation: [0, round4(rng() * 360), 0],
          colorHex: leafHex,
          material: leafMat,
          roughness: species === 'fantasy' ? 0.25 : 0.74,
          metalness: 0.04,
          collisionFidelity: cf,
          meshData: buildDeformedIcosphereMesh({
            modelName,
            size: [crownW, crownH, crownW],
            subdivisions: budget.icosphereSubdivisionsPrimary,
            noiseAmplitude: 0.18,
            facetPlanesCount: 4,
            stratificationStrength: species === 'bonsai' ? 0.25 : 0.06,
            basalFlatten: 0.28,
            canopyLobes: 6,
            seedOffset: 101,
          }),
        })
      );

      const clusterCount = clamp(
        Number(treeParams.foliageCount ?? Math.max(4, branchTips.length)),
        3,
        10
      );
      for (let c = 0; c < clusterCount; c++) {
        const tip = branchTips[c % branchTips.length];
        const cAngle = tip ? tip.angle : (c / clusterCount) * Math.PI * 2;
        const cW = round4(crownW * (0.42 + (rng() * 0.22)));
        const cH = round4(crownH * (0.46 + (rng() * 0.2)));
        const cx = tip ? round4(tip.x) : round4(Math.cos(cAngle) * crownW * 0.42);
        const cy = tip ? round4(tip.y + cH * 0.18) : round4(crownY + (rng() - 0.4) * crownH * 0.4);
        const cz = tip ? round4(tip.z) : round4(Math.sin(cAngle) * crownW * 0.42);

        parts.push(
          makePartSpec({
            idx: idx++,
            name: `FoliageCluster_${c + 1}`,
            parentPath: 'Root/Canopy',
            size: [cW, cH, cW],
            position: [cx, cy, cz],
            rotation: [round4((rng() - 0.5) * 18), round4(rng() * 360), round4((rng() - 0.5) * 18)],
            colorHex: jitterHexColor(leafHex, (rng() - 0.5) * 0.12),
            material: leafMat,
            roughness: species === 'fantasy' ? 0.25 : 0.75,
            metalness: 0.03,
            collisionFidelity: cf,
            meshData: buildDeformedIcosphereMesh({
              modelName,
              size: [cW, cH, cW],
              subdivisions: budget.icosphereSubdivisionsSecondary,
              noiseAmplitude: 0.2,
              facetPlanesCount: 4,
              stratificationStrength: 0.08,
              basalFlatten: 0.22,
              canopyLobes: 5,
              seedOffset: 200 + c * 9,
            }),
          })
        );
      }

      // Weeping willow hanging fronds (`WeepingFrond_1..K`)
      if (species === 'willow') {
        const frondCount = Math.min(6, branchTips.length);
        for (let f = 0; f < frondCount; f++) {
          const tip = branchTips[f];
          const frondH = round4(totalHeight * 0.36);
          const frondW = round4(Math.max(0.55, trunkThick * 0.45));
          parts.push(
            makePartSpec({
              idx: idx++,
              name: `WeepingFrond_${f + 1}`,
              parentPath: 'Root/Canopy/WeepingFronds',
              size: [frondW, frondH, frondW],
              position: [round4(tip.x), round4(Math.max(frondH * 0.55, tip.y - frondH * 0.38)), round4(tip.z)],
              rotation: [0, round4(f * 60), 0],
              colorHex: jitterHexColor(leafHex, 0.05),
              material: leafMat,
              roughness: 0.78,
              metalness: 0.02,
              collisionFidelity: cf,
              meshData: buildTaperedCurvedTubeMesh({
                modelName,
                size: [frondW, frondH, frondW],
                radialSegments: 6,
                heightSegments: 5,
                bottomRadiusRatio: 0.35,
                topRadiusRatio: 0.95,
                curveX: 0.18,
                seedOffset: 300 + f,
              }),
            })
          );
        }
      }
    }
  }

  return groundPartsAtYZero(parts);
}

// ============================================================================
// CATEGORY 2: ROCKS & NATURE (Deformed Icospheres, Facets, Stratification, Erosion)
// ============================================================================
export function generateSpecializedRockAssetParts(params: {
  modelName: string;
  blueprint: AiDirectorBlueprint;
  budget: BudgetAllocationProfile;
  prompt?: string;
  seed: string;
}): SpecializedPartSpec[] {
  const { modelName, blueprint, budget, prompt = '', seed } = params;
  const rng = createDeterministicRng(`rock-${seed}`);
  const parts: SpecializedPartSpec[] = [];
  let idx = 1;

  const baseW = blueprint.proportions_studs.width || 9.5;
  const baseH = blueprint.proportions_studs.height || 7.5;
  const baseD = blueprint.proportions_studs.depth || 8.5;
  const primaryMat = blueprint.materials_and_textures.primary_material || 'Slate';
  const secondaryMat = blueprint.materials_and_textures.secondary_material || 'Basalt';
  const primaryHex = blueprint.materials_and_textures.primary_hex;
  const secondaryHex = blueprint.materials_and_textures.secondary_hex;
  const accentHex = blueprint.materials_and_textures.accent_hex;
  const cf = blueprint.roblox_constraints.collision_fidelity;

  // 1. Primary Eroded & Stratified Outcrop Mass (`PrimaryRockOutcrop`)
  const mainSize: [number, number, number] = [
    round4(baseW * 0.68),
    round4(baseH * 0.92),
    round4(baseD * 0.68),
  ];
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'PrimaryRockOutcrop',
      parentPath: 'Root/PrimaryMass',
      size: mainSize,
      position: [0, mainSize[1] * 0.5, 0],
      rotation: [round4((rng() - 0.5) * 10), round4(rng() * 360), round4((rng() - 0.5) * 10)],
      colorHex: primaryHex,
      material: primaryMat,
      roughness: 0.88,
      metalness: 0.06,
      collisionFidelity: cf,
      meshData: buildDeformedIcosphereMesh({
        modelName,
        size: mainSize,
        subdivisions: budget.icosphereSubdivisionsPrimary,
        noiseAmplitude: 0.25,
        facetPlanesCount: 9,
        stratificationStrength: 0.22,
        basalFlatten: 0.45,
        seedOffset: 11.3,
      }),
    })
  );

  // 2. Stratified Terrace Slabs & Fractured Crags (`StratifiedSlab_1..K`)
  const slabCount = clamp(Math.round(3 + budget.budgetScale * 1.5), 3, 6);
  for (let s = 0; s < slabCount; s++) {
    const angle = (s / slabCount) * Math.PI * 2 + (rng() - 0.5) * 0.4;
    const dist = baseW * (0.28 + rng() * 0.16);
    const sw = round4(baseW * (0.36 + rng() * 0.18));
    const sh = round4(baseH * (0.34 + (1 - s / slabCount) * 0.42));
    const sd = round4(baseD * (0.34 + rng() * 0.18));

    parts.push(
      makePartSpec({
        idx: idx++,
        name: `StratifiedRockSlab_${s + 1}`,
        parentPath: 'Root/StratifiedSlabs',
        size: [sw, sh, sd],
        position: [round4(Math.cos(angle) * dist), round4(sh * 0.48), round4(Math.sin(angle) * dist)],
        rotation: [
          round4((rng() - 0.5) * 16),
          round4((angle * 180) / Math.PI + rng() * 45),
          round4((rng() - 0.5) * 16),
        ],
        colorHex: jitterHexColor(s % 2 === 0 ? primaryHex : secondaryHex, (rng() - 0.5) * 0.08),
        material: s % 2 === 0 ? primaryMat : secondaryMat,
        roughness: 0.9,
        metalness: 0.05,
        collisionFidelity: cf,
        meshData: buildDeformedIcosphereMesh({
          modelName,
          size: [sw, sh, sd],
          subdivisions: budget.icosphereSubdivisionsSecondary,
          noiseAmplitude: 0.24,
          facetPlanesCount: 8,
          stratificationStrength: 0.26,
          basalFlatten: 0.48,
          seedOffset: 30 + s * 7.7,
        }),
      })
    );
  }

  // 3. Peripheral Talus Boulders / Crystal Spires (`FractureBoulder_1..M`)
  const hasCrystals = /\b(cristal|crystal|m[aá]gico|ne[oó]n|mineral|cuarzo|gem)\b/i.test(prompt);
  const accentCount = 3;
  for (let a = 0; a < accentCount; a++) {
    const angle = (a / accentCount) * Math.PI * 2 + 0.9;
    const dist = baseW * 0.42;
    const aw = round4(baseW * (hasCrystals ? 0.16 : 0.24));
    const ah = round4(baseH * (hasCrystals ? 0.48 : 0.22));
    const ad = round4(baseD * (hasCrystals ? 0.16 : 0.24));

    parts.push(
      makePartSpec({
        idx: idx++,
        name: hasCrystals ? `CrystalVeinSpire_${a + 1}` : `ErodedTalusBoulder_${a + 1}`,
        parentPath: 'Root/FractureClusters',
        size: [aw, ah, ad],
        position: [round4(Math.cos(angle) * dist), round4(ah * 0.48), round4(Math.sin(angle) * dist)],
        rotation: [round4(Math.sin(angle) * 22), round4(a * 110), round4(-Math.cos(angle) * 22)],
        colorHex: hasCrystals ? accentHex : jitterHexColor(secondaryHex, -0.04),
        material: hasCrystals ? 'Neon' : 'Rock',
        roughness: hasCrystals ? 0.18 : 0.92,
        metalness: hasCrystals ? 0.2 : 0.04,
        collisionFidelity: cf,
        meshData: buildDeformedIcosphereMesh({
          modelName,
          size: [aw, ah, ad],
          subdivisions: budget.icosphereSubdivisionsSecondary,
          noiseAmplitude: 0.18,
          facetPlanesCount: 10,
          stratificationStrength: hasCrystals ? 0 : 0.15,
          basalFlatten: 0.35,
          seedOffset: 80 + a * 5,
        }),
      })
    );
  }

  return groundPartsAtYZero(parts);
}

// ============================================================================
// CATEGORY 3: BUILDINGS & STRUCTURES (Modular Facades, Doors, Windows, Columns, Roof)
// ============================================================================
export function generateSpecializedBuildingAssetParts(params: {
  modelName: string;
  blueprint: AiDirectorBlueprint;
  budget: BudgetAllocationProfile;
  seed: string;
}): SpecializedPartSpec[] {
  const { modelName, blueprint, budget, seed } = params;
  const rng = createDeterministicRng(`bldg-${seed}`);
  const parts: SpecializedPartSpec[] = [];
  let idx = 1;

  const totalW = blueprint.proportions_studs.width || 11;
  const totalH = blueprint.proportions_studs.height || 16;
  const totalD = blueprint.proportions_studs.depth || 11;
  const wallMat = blueprint.materials_and_textures.secondary_material || 'Brick';
  const stoneMat = blueprint.materials_and_textures.primary_material || 'Cobblestone';
  const roofMat = blueprint.materials_and_textures.accent_material || 'Slate';
  const stoneHex = blueprint.materials_and_textures.primary_hex;
  const wallHex = blueprint.materials_and_textures.secondary_hex;
  const accentHex = blueprint.materials_and_textures.accent_hex;
  const cf = blueprint.roblox_constraints.collision_fidelity;

  // 1. Stepped Plinth Foundation + Entry Steps (`SteppedFoundation`, `EntrySteps`)
  const plinthH = round4(totalH * 0.1);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'SteppedStoneFoundation',
      parentPath: 'Root/Foundation',
      size: [totalW, plinthH, totalD],
      position: [0, plinthH * 0.5, 0],
      colorHex: stoneHex,
      material: stoneMat,
      roughness: 0.86,
      metalness: 0.05,
      collisionFidelity: cf,
      meshData: buildBeveledStructuralMesh({
        modelName,
        size: [totalW, plinthH, totalD],
        bevelRatio: 0.06,
        topTaperX: 0.95,
        topTaperZ: 0.95,
        radialSegments: budget.radialSegmentsPrimary,
        heightSegments: 3,
      }),
    })
  );

  const stepW = round4(totalW * 0.36);
  const stepH = round4(plinthH * 0.65);
  const stepD = round4(1.4);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'EntryThresholdSteps',
      parentPath: 'Root/Foundation',
      size: [stepW, stepH, stepD],
      position: [0, stepH * 0.5, round4(totalD * 0.5 + stepD * 0.35)],
      colorHex: jitterHexColor(stoneHex, -0.04),
      material: stoneMat,
      roughness: 0.88,
      metalness: 0.04,
      collisionFidelity: cf,
      meshData: buildBeveledStructuralMesh({
        modelName,
        size: [stepW, stepH, stepD],
        bevelRatio: 0.08,
        radialSegments: 8,
        heightSegments: 2,
      }),
    })
  );

  // 2. Modular Facade Core Body (`MainFacadeStructure`)
  const bodyW = round4(totalW * 0.82);
  const bodyH = round4(totalH * 0.62);
  const bodyD = round4(totalD * 0.82);
  const bodyY = round4(plinthH + bodyH * 0.5);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'MainFacadeStructure',
      parentPath: 'Root/Facades',
      size: [bodyW, bodyH, bodyD],
      position: [0, bodyY, 0],
      colorHex: wallHex,
      material: wallMat,
      roughness: 0.8,
      metalness: 0.06,
      collisionFidelity: cf,
      meshData: buildBeveledStructuralMesh({
        modelName,
        size: [bodyW, bodyH, bodyD],
        bevelRatio: 0.04,
        topTaperX: 0.96,
        topTaperZ: 0.96,
        radialSegments: budget.radialSegmentsPrimary,
        heightSegments: budget.heightSegmentsPrimary,
      }),
    })
  );

  // 3. Four Corner Fluted Columns / Buttresses (`CornerColumn_1..4`)
  const colRadius = round4(totalW * 0.11);
  const colH = round4(bodyH * 1.02);
  const colOffsets: [number, number][] = [
    [-bodyW * 0.48, -bodyD * 0.48],
    [bodyW * 0.48, -bodyD * 0.48],
    [-bodyW * 0.48, bodyD * 0.48],
    [bodyW * 0.48, bodyD * 0.48],
  ];
  colOffsets.forEach(([ox, oz], cIdx) => {
    parts.push(
      makePartSpec({
        idx: idx++,
        name: `CornerColumn_${cIdx + 1}`,
        parentPath: 'Root/Columns',
        size: [colRadius, colH, colRadius],
        position: [round4(ox), bodyY, round4(oz)],
        colorHex: stoneHex,
        material: stoneMat,
        roughness: 0.82,
        metalness: 0.08,
        collisionFidelity: cf,
        meshData: buildTaperedCurvedTubeMesh({
          modelName,
          size: [colRadius, colH, colRadius],
          radialSegments: budget.radialSegmentsSecondary,
          heightSegments: budget.heightSegmentsSecondary,
          bottomRadiusRatio: 1.0,
          topRadiusRatio: 0.88,
          flutingCount: 8,
          flutingDepth: 0.07,
          seedOffset: cIdx + 1,
        }),
      })
    );
  });

  // 4. Recessed Arched Doorway (`DoorFrameArch` + `HeavyTimberDoor`)
  const doorW = round4(bodyW * 0.28);
  const doorH = round4(bodyH * 0.42);
  const doorD = 0.65;
  const doorY = round4(plinthH + doorH * 0.5);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'ArchedDoorFrame',
      parentPath: 'Root/Openings',
      size: [round4(doorW * 1.22), round4(doorH * 1.1), doorD],
      position: [0, doorY, round4(bodyD * 0.5 + 0.12)],
      colorHex: stoneHex,
      material: stoneMat,
      roughness: 0.84,
      metalness: 0.06,
      collisionFidelity: cf,
      meshData: buildBeveledStructuralMesh({
        modelName,
        size: [round4(doorW * 1.22), round4(doorH * 1.1), doorD],
        archTop: true,
        radialSegments: 8,
        heightSegments: 4,
      }),
    })
  );

  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'TimberDoorLeaf',
      parentPath: 'Root/Openings',
      size: [doorW, doorH, 0.42],
      position: [0, doorY, round4(bodyD * 0.5 + 0.22)],
      colorHex: '#5c3a21',
      material: 'Wood',
      roughness: 0.78,
      metalness: 0.1,
      collisionFidelity: cf,
      meshData: buildBeveledStructuralMesh({
        modelName,
        size: [doorW, doorH, 0.42],
        archTop: true,
        radialSegments: 8,
        heightSegments: 3,
      }),
    })
  );

  // 5. Framed Windows on Front, Left, and Right Facades (`FramedWindow_1..3`)
  const winW = round4(bodyW * 0.2);
  const winH = round4(bodyH * 0.22);
  const winY = round4(plinthH + bodyH * 0.68);
  const windowSpecs: Array<{ name: string; pos: [number, number, number]; rot: [number, number, number] }> = [
    { name: 'FramedWindow_Front', pos: [0, winY, round4(bodyD * 0.5 + 0.16)], rot: [0, 0, 0] },
    { name: 'FramedWindow_West', pos: [round4(-bodyW * 0.5 - 0.16), winY, 0], rot: [0, 90, 0] },
    { name: 'FramedWindow_East', pos: [round4(bodyW * 0.5 + 0.16), winY, 0], rot: [0, 90, 0] },
  ];
  for (const wSpec of windowSpecs) {
    parts.push(
      makePartSpec({
        idx: idx++,
        name: wSpec.name,
        parentPath: 'Root/Openings',
        size: [winW, winH, 0.36],
        position: wSpec.pos,
        rotation: wSpec.rot,
        colorHex: '#38bdf8',
        material: 'Glass',
        roughness: 0.15,
        metalness: 0.2,
        reflectance: 0.35,
        transparency: 0.25,
        collisionFidelity: cf,
        meshData: buildBeveledStructuralMesh({
          modelName,
          size: [winW, winH, 0.36],
          archTop: true,
          radialSegments: 8,
          heightSegments: 3,
        }),
      })
    );
  }

  // 6. Upper Cornice Molding + Pitched Architectural Roof (`UpperCorniceMolding`, `PitchedRoofCrown`)
  const corniceH = round4(totalH * 0.05);
  const corniceY = round4(plinthH + bodyH + corniceH * 0.5);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'UpperCorniceMolding',
      parentPath: 'Root/RoofAssembly',
      size: [round4(totalW * 0.96), corniceH, round4(totalD * 0.96)],
      position: [0, corniceY, 0],
      colorHex: stoneHex,
      material: stoneMat,
      roughness: 0.8,
      metalness: 0.08,
      collisionFidelity: cf,
      meshData: buildBeveledStructuralMesh({
        modelName,
        size: [round4(totalW * 0.96), corniceH, round4(totalD * 0.96)],
        topTaperX: 1.06,
        topTaperZ: 1.06,
        radialSegments: 8,
        heightSegments: 2,
      }),
    })
  );

  const roofH = round4(totalH * 0.25);
  const roofW = round4(totalW * 1.04);
  const roofD = round4(totalD * 1.04);
  const roofY = round4(plinthH + bodyH + corniceH + roofH * 0.48);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'PitchedRoofCrown',
      parentPath: 'Root/RoofAssembly',
      size: [roofW, roofH, roofD],
      position: [0, roofY, 0],
      rotation: [0, round4(rng() > 0.5 ? 0 : 45), 0],
      colorHex: accentHex,
      material: roofMat,
      roughness: 0.72,
      metalness: 0.12,
      collisionFidelity: cf,
      meshData: buildArchitecturalRoofMesh({
        modelName,
        size: [roofW, roofH, roofD],
        roofStyle: 'pagoda_curved',
        segments: budget.heightSegmentsPrimary,
      }),
    })
  );

  return groundPartsAtYZero(parts);
}

// ============================================================================
// CATEGORY 4: FURNITURE, PROPS & MECHANICAL OBJECTS (Function-Aware Families)
// ============================================================================

/**
 * 4A. Specialized Chair / Throne Generator (`chair`)
 */
export function generateSpecializedChairAssetParts(params: {
  modelName: string;
  blueprint: AiDirectorBlueprint;
  budget: BudgetAllocationProfile;
}): SpecializedPartSpec[] {
  const { modelName, blueprint, budget } = params;
  const parts: SpecializedPartSpec[] = [];
  let idx = 1;

  const w = blueprint.proportions_studs.width || 3.2;
  const h = blueprint.proportions_studs.height || 5.4;
  const d = blueprint.proportions_studs.depth || 3.2;
  const frameMat = blueprint.materials_and_textures.primary_material || 'Wood';
  const cushionMat = blueprint.materials_and_textures.secondary_material || 'Fabric';
  const frameHex = blueprint.materials_and_textures.primary_hex;
  const cushionHex = blueprint.materials_and_textures.secondary_hex;
  const accentHex = blueprint.materials_and_textures.accent_hex;
  const cf = blueprint.roblox_constraints.collision_fidelity;

  const seatY = round4(h * 0.44);
  const legH = seatY;
  const legThick = round4(Math.max(0.28, w * 0.1));
  const legSpreadX = round4(w * 0.4);
  const legSpreadZ = round4(d * 0.4);

  // 1. 4 Turned & Tapered Legs (`ChairLeg_FL`, `ChairLeg_FR`, `ChairLeg_BL`, `ChairLeg_BR`)
  const legDefs: Array<{ name: string; x: number; z: number; tiltX: number }> = [
    { name: 'ChairLeg_FrontLeft', x: -legSpreadX, z: legSpreadZ, tiltX: 3 },
    { name: 'ChairLeg_FrontRight', x: legSpreadX, z: legSpreadZ, tiltX: 3 },
    { name: 'ChairLeg_BackLeft', x: -legSpreadX, z: -legSpreadZ, tiltX: -4 },
    { name: 'ChairLeg_BackRight', x: legSpreadX, z: -legSpreadZ, tiltX: -4 },
  ];
  for (const leg of legDefs) {
    parts.push(
      makePartSpec({
        idx: idx++,
        name: leg.name,
        parentPath: 'Root/LegsAndStretchers',
        size: [legThick, legH, legThick],
        position: [leg.x, round4(legH * 0.5), leg.z],
        rotation: [leg.tiltX, 0, 0],
        colorHex: frameHex,
        material: frameMat,
        roughness: 0.72,
        metalness: 0.08,
        collisionFidelity: cf,
        meshData: buildTaperedCurvedTubeMesh({
          modelName,
          size: [legThick, legH, legThick],
          radialSegments: budget.radialSegmentsSecondary,
          heightSegments: budget.heightSegmentsSecondary,
          bottomRadiusRatio: 0.72,
          topRadiusRatio: 1.0,
          flutingCount: 6,
          flutingDepth: 0.05,
        }),
      })
    );
  }

  // 2. Side Stretchers (`StretcherRail_Left`, `StretcherRail_Right`)
  for (const side of [-1, 1]) {
    parts.push(
      makePartSpec({
        idx: idx++,
        name: side < 0 ? 'StretcherRail_Left' : 'StretcherRail_Right',
        parentPath: 'Root/LegsAndStretchers',
        size: [round4(legThick * 0.7), round4(legThick * 0.7), round4(legSpreadZ * 1.95)],
        position: [round4(side * legSpreadX), round4(legH * 0.32), 0],
        colorHex: jitterHexColor(frameHex, -0.04),
        material: frameMat,
        roughness: 0.76,
        metalness: 0.06,
        collisionFidelity: cf,
        meshData: buildBeveledStructuralMesh({
          modelName,
          size: [round4(legThick * 0.7), round4(legThick * 0.7), round4(legSpreadZ * 1.95)],
          bevelRatio: 0.15,
          radialSegments: 6,
          heightSegments: 2,
        }),
      })
    );
  }

  // 3. Contoured Seat Frame + Upholstered Cushion (`SeatFrame`, `UpholsteredCushion`)
  const seatFrameH = round4(h * 0.06);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'ContouredSeatFrame',
      parentPath: 'Root/SeatAssembly',
      size: [w, seatFrameH, d],
      position: [0, seatY, 0],
      colorHex: frameHex,
      material: frameMat,
      roughness: 0.7,
      metalness: 0.1,
      collisionFidelity: cf,
      meshData: buildBeveledStructuralMesh({
        modelName,
        size: [w, seatFrameH, d],
        bevelRatio: 0.12,
        radialSegments: budget.radialSegmentsPrimary,
        heightSegments: 3,
      }),
    })
  );

  const cushionH = round4(h * 0.055);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'UpholsteredSeatCushion',
      parentPath: 'Root/SeatAssembly',
      size: [round4(w * 0.88), cushionH, round4(d * 0.88)],
      position: [0, round4(seatY + (seatFrameH + cushionH) * 0.48), 0.05],
      colorHex: cushionHex,
      material: cushionMat,
      roughness: 0.85,
      metalness: 0.02,
      collisionFidelity: cf,
      meshData: buildBeformedCushionMesh(modelName, [round4(w * 0.88), cushionH, round4(d * 0.88)], budget),
    })
  );

  // 4. Angled Backrest Uprights + Carved Crest + Backrest Panel (`BackrestPanel`, `BackrestCrest`)
  const backH = round4(h * 0.52);
  const backY = round4(seatY + backH * 0.5);
  const backZ = round4(-legSpreadZ - 0.08);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'ErgonomicBackrestPanel',
      parentPath: 'Root/Backrest',
      size: [round4(w * 0.86), round4(backH * 0.78), round4(legThick * 0.9)],
      position: [0, backY, backZ],
      rotation: [-7, 0, 0],
      colorHex: cushionHex,
      material: cushionMat,
      roughness: 0.8,
      metalness: 0.05,
      collisionFidelity: cf,
      meshData: buildBeveledStructuralMesh({
        modelName,
        size: [round4(w * 0.86), round4(backH * 0.78), round4(legThick * 0.9)],
        archTop: true,
        radialSegments: budget.radialSegmentsPrimary,
        heightSegments: budget.heightSegmentsSecondary,
      }),
    })
  );

  const crestH = round4(h * 0.11);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'CarvedBackrestCrest',
      parentPath: 'Root/Backrest',
      size: [round4(w * 0.96), crestH, round4(legThick * 1.15)],
      position: [0, round4(seatY + backH * 0.92), round4(backZ - 0.12)],
      rotation: [-7, 0, 0],
      colorHex: accentHex,
      material: frameMat,
      roughness: 0.55,
      metalness: 0.25,
      collisionFidelity: cf,
      meshData: buildBeveledStructuralMesh({
        modelName,
        size: [round4(w * 0.96), crestH, round4(legThick * 1.15)],
        archTop: true,
        radialSegments: 8,
        heightSegments: 3,
      }),
    })
  );

  // 5. Curved Armrests (`Armrest_Left`, `Armrest_Right`)
  const armY = round4(seatY + h * 0.17);
  for (const side of [-1, 1]) {
    parts.push(
      makePartSpec({
        idx: idx++,
        name: side < 0 ? 'CurvedArmrest_Left' : 'CurvedArmrest_Right',
        parentPath: 'Root/Armrests',
        size: [round4(legThick * 1.05), round4(legThick * 0.75), round4(d * 0.82)],
        position: [round4(side * legSpreadX), armY, 0],
        colorHex: frameHex,
        material: frameMat,
        roughness: 0.68,
        metalness: 0.1,
        collisionFidelity: cf,
        meshData: buildBeveledStructuralMesh({
          modelName,
          size: [round4(legThick * 1.05), round4(legThick * 0.75), round4(d * 0.82)],
          bevelRatio: 0.18,
          radialSegments: 8,
          heightSegments: 3,
        }),
      })
    );
  }

  return groundPartsAtYZero(parts);
}

function buildBeformedCushionMesh(
  modelName: string,
  size: [number, number, number],
  budget: BudgetAllocationProfile
): SpecializedMeshData {
  return buildDeformedIcosphereMesh({
    modelName,
    size,
    subdivisions: budget.icosphereSubdivisionsSecondary,
    noiseAmplitude: 0.04,
    facetPlanesCount: 2,
    stratificationStrength: 0,
    basalFlatten: 0.4,
    seedOffset: 7.7,
  });
}

/**
 * 4B. Specialized Street Lamp / Lantern Generator (`lamp`)
 */
export function generateSpecializedLampAssetParts(params: {
  modelName: string;
  blueprint: AiDirectorBlueprint;
  budget: BudgetAllocationProfile;
}): SpecializedPartSpec[] {
  const { modelName, blueprint, budget } = params;
  const parts: SpecializedPartSpec[] = [];
  let idx = 1;

  const w = blueprint.proportions_studs.width || 3.2;
  const h = blueprint.proportions_studs.height || 8.5;
  const metalMat = blueprint.materials_and_textures.primary_material || 'Metal';
  const metalHex = blueprint.materials_and_textures.primary_hex;
  const glowHex = blueprint.materials_and_textures.accent_hex || '#f59e0b';
  const cf = blueprint.roblox_constraints.collision_fidelity;

  // 1. Stepped Lathe Base (`LampPedestalBase`)
  const baseH = round4(h * 0.16);
  const baseW = round4(w * 0.85);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'LampPedestalBase',
      parentPath: 'Root/PedestalBase',
      size: [baseW, baseH, baseW],
      position: [0, baseH * 0.5, 0],
      colorHex: metalHex,
      material: metalMat,
      roughness: 0.4,
      metalness: 0.78,
      collisionFidelity: cf,
      meshData: buildLatheSilhouetteMesh({
        modelName,
        size: [baseW, baseH, baseW],
        widthProfile: [1.0, 0.96, 0.82, 0.78, 0.62, 0.48, 0.42],
        radialSegments: budget.radialSegmentsPrimary,
      }),
    })
  );

  // 2. Fluted Vertical Post (`FlutedLampPost`)
  const postH = round4(h * 0.56);
  const postW = round4(Math.max(0.45, w * 0.22));
  const postY = round4(baseH + postH * 0.5);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'FlutedLampPost',
      parentPath: 'Root/FlutedPost',
      size: [postW, postH, postW],
      position: [0, postY, 0],
      colorHex: metalHex,
      material: metalMat,
      roughness: 0.38,
      metalness: 0.8,
      collisionFidelity: cf,
      meshData: buildTaperedCurvedTubeMesh({
        modelName,
        size: [postW, postH, postW],
        radialSegments: budget.radialSegmentsPrimary,
        heightSegments: budget.heightSegmentsPrimary,
        bottomRadiusRatio: 1.0,
        topRadiusRatio: 0.74,
        flutingCount: 8,
        flutingDepth: 0.08,
      }),
    })
  );

  // 3. Support Collar / Neck (`LanternSupportCollar`)
  const collarH = round4(h * 0.05);
  const collarW = round4(w * 0.52);
  const collarY = round4(baseH + postH + collarH * 0.5);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'LanternSupportCollar',
      parentPath: 'Root/LanternCage',
      size: [collarW, collarH, collarW],
      position: [0, collarY, 0],
      colorHex: jitterHexColor(metalHex, 0.05),
      material: metalMat,
      roughness: 0.35,
      metalness: 0.82,
      collisionFidelity: cf,
      meshData: buildLatheSilhouetteMesh({
        modelName,
        size: [collarW, collarH, collarW],
        widthProfile: [0.55, 0.75, 0.95, 1.0],
        radialSegments: budget.radialSegmentsSecondary,
      }),
    })
  );

  // 4. Translucent Glass Shade (`LanternGlassShade`)
  const shadeH = round4(h * 0.16);
  const shadeW = round4(w * 0.78);
  const shadeY = round4(collarY + collarH * 0.5 + shadeH * 0.5);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'LanternGlassShade',
      parentPath: 'Root/LanternCage',
      size: [shadeW, shadeH, shadeW],
      position: [0, shadeY, 0],
      colorHex: '#fef9c3',
      material: 'Glass',
      roughness: 0.12,
      metalness: 0.1,
      reflectance: 0.3,
      transparency: 0.35,
      collisionFidelity: cf,
      meshData: buildLatheSilhouetteMesh({
        modelName,
        size: [shadeW, shadeH, shadeW],
        widthProfile: [0.68, 0.85, 1.0, 0.96, 0.82],
        radialSegments: budget.radialSegmentsPrimary,
      }),
    })
  );

  // 5. Glowing Neon Bulb Core (`LuminaireBulbCore`)
  const bulbSize = round4(shadeW * 0.45);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'LuminaireBulbCore',
      parentPath: 'Root/LuminaireCore',
      size: [bulbSize, bulbSize, bulbSize],
      position: [0, shadeY, 0],
      colorHex: glowHex,
      material: 'Neon',
      roughness: 0.1,
      metalness: 0.05,
      reflectance: 0.2,
      collisionFidelity: cf,
      meshData: buildDeformedIcosphereMesh({
        modelName,
        size: [bulbSize, bulbSize, bulbSize],
        subdivisions: budget.icosphereSubdivisionsSecondary,
        noiseAmplitude: 0.02,
        facetPlanesCount: 0,
        stratificationStrength: 0,
        basalFlatten: 0,
      }),
    })
  );

  // 6. Top Canopy Hood & Finial Spire (`LanternTopHood`)
  const hoodH = round4(h * 0.09);
  const hoodW = round4(w * 0.92);
  const hoodY = round4(shadeY + shadeH * 0.5 + hoodH * 0.48);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'LanternTopHood',
      parentPath: 'Root/LanternCage',
      size: [hoodW, hoodH, hoodW],
      position: [0, hoodY, 0],
      colorHex: metalHex,
      material: metalMat,
      roughness: 0.38,
      metalness: 0.8,
      collisionFidelity: cf,
      meshData: buildArchitecturalRoofMesh({
        modelName,
        size: [hoodW, hoodH, hoodW],
        roofStyle: 'pagoda_curved',
        segments: budget.heightSegmentsSecondary,
      }),
    })
  );

  return groundPartsAtYZero(parts);
}

/**
 * 4C. Specialized Mechanical Object / Gearbox / Turbine Generator (`mechanical`)
 */
export function generateSpecializedMechanicalAssetParts(params: {
  modelName: string;
  blueprint: AiDirectorBlueprint;
  budget: BudgetAllocationProfile;
}): SpecializedPartSpec[] {
  const { modelName, blueprint, budget } = params;
  const parts: SpecializedPartSpec[] = [];
  let idx = 1;

  const w = blueprint.proportions_studs.width || 7.4;
  const h = blueprint.proportions_studs.height || 6.8;
  const d = blueprint.proportions_studs.depth || 5.6;
  const chassisHex = blueprint.materials_and_textures.primary_hex;
  const gearHex = blueprint.materials_and_textures.secondary_hex || '#d97706';
  const coreHex = blueprint.materials_and_textures.accent_hex || '#06b6d4';
  const cf = blueprint.roblox_constraints.collision_fidelity;

  // 1. Heavy Bolted Chassis Plinth (`HeavyBoltedChassis`)
  const baseH = round4(h * 0.2);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'HeavyBoltedChassis',
      parentPath: 'Root/Chassis',
      size: [w, baseH, d],
      position: [0, baseH * 0.5, 0],
      colorHex: chassisHex,
      material: 'DiamondPlate',
      roughness: 0.42,
      metalness: 0.78,
      collisionFidelity: cf,
      meshData: buildBeveledStructuralMesh({
        modelName,
        size: [w, baseH, d],
        bevelRatio: 0.08,
        topTaperX: 0.94,
        topTaperZ: 0.94,
        radialSegments: budget.radialSegmentsPrimary,
        heightSegments: 3,
      }),
    })
  );

  // 2. Main Drive Housing Block (`MainDriveHousing`)
  const houseW = round4(w * 0.58);
  const houseH = round4(h * 0.52);
  const houseD = round4(d * 0.62);
  const houseY = round4(baseH + houseH * 0.5);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'MainDriveHousing',
      parentPath: 'Root/Chassis',
      size: [houseW, houseH, houseD],
      position: [0, houseY, 0],
      colorHex: jitterHexColor(chassisHex, 0.06),
      material: 'Metal',
      roughness: 0.35,
      metalness: 0.82,
      collisionFidelity: cf,
      meshData: buildBeveledStructuralMesh({
        modelName,
        size: [houseW, houseH, houseD],
        bevelRatio: 0.12,
        radialSegments: budget.radialSegmentsPrimary,
        heightSegments: budget.heightSegmentsSecondary,
      }),
    })
  );

  // 3. Primary Toothed Involute Drive Gear (`PrimaryDriveGear`)
  const mainGearD = round4(h * 0.52);
  const gearThick = round4(0.75);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'PrimaryDriveGear',
      parentPath: 'Root/GearTrain',
      size: [mainGearD, gearThick, mainGearD],
      position: [round4(-houseW * 0.18), round4(houseY + 0.2), round4(houseD * 0.5 + gearThick * 0.45)],
      rotation: [90, 0, 0],
      colorHex: gearHex,
      material: 'Metal',
      roughness: 0.28,
      metalness: 0.88,
      reflectance: 0.2,
      collisionFidelity: cf,
      meshData: buildToothedGearMesh({
        modelName,
        size: [mainGearD, gearThick, mainGearD],
        teethCount: budget.gearTeethCount,
        toothDepthRatio: 0.22,
      }),
    })
  );

  // 4. Meshed Secondary Pinion Gear (`SecondaryPinionGear`)
  const pinionD = round4(mainGearD * 0.62);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'SecondaryPinionGear',
      parentPath: 'Root/GearTrain',
      size: [pinionD, gearThick, pinionD],
      position: [round4(houseW * 0.32), round4(houseY + mainGearD * 0.26), round4(houseD * 0.5 + gearThick * 0.45)],
      rotation: [90, 15, 0],
      colorHex: jitterHexColor(gearHex, 0.08),
      material: 'Metal',
      roughness: 0.26,
      metalness: 0.9,
      collisionFidelity: cf,
      meshData: buildToothedGearMesh({
        modelName,
        size: [pinionD, gearThick, pinionD],
        teethCount: Math.max(8, Math.round(budget.gearTeethCount * 0.65)),
        toothDepthRatio: 0.24,
      }),
    })
  );

  // 5. Dual Hydraulic Pistons (`HydraulicPiston_Left`, `HydraulicPiston_Right`)
  const pistonH = round4(h * 0.58);
  const pistonW = round4(w * 0.14);
  for (const side of [-1, 1]) {
    parts.push(
      makePartSpec({
        idx: idx++,
        name: side < 0 ? 'HydraulicPiston_Left' : 'HydraulicPiston_Right',
        parentPath: 'Root/Hydraulics',
        size: [pistonW, pistonH, pistonW],
        position: [round4(side * (houseW * 0.58)), round4(baseH + pistonH * 0.48), 0],
        rotation: [0, 0, round4(-side * 12)],
        colorHex: '#94a3b8',
        material: 'Metal',
        roughness: 0.22,
        metalness: 0.92,
        collisionFidelity: cf,
        meshData: buildTaperedCurvedTubeMesh({
          modelName,
          size: [pistonW, pistonH, pistonW],
          radialSegments: budget.radialSegmentsSecondary,
          heightSegments: budget.heightSegmentsSecondary,
          bottomRadiusRatio: 1.0,
          topRadiusRatio: 0.72,
          flutingCount: 6,
          flutingDepth: 0.04,
        }),
      })
    );
  }

  // 6. Central Rotor Axle + Glowing Energy Reactor Core (`ReactorEnergyCore`)
  const coreSize = round4(houseW * 0.36);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'ReactorEnergyCore',
      parentPath: 'Root/EnergyCore',
      size: [coreSize, round4(h * 0.24), coreSize],
      position: [0, round4(baseH + houseH + h * 0.1), 0],
      colorHex: coreHex,
      material: 'Neon',
      roughness: 0.12,
      metalness: 0.2,
      reflectance: 0.35,
      collisionFidelity: cf,
      meshData: buildLatheSilhouetteMesh({
        modelName,
        size: [coreSize, round4(h * 0.24), coreSize],
        widthProfile: [0.85, 1.0, 0.78, 1.0, 0.65],
        radialSegments: budget.radialSegmentsPrimary,
      }),
    })
  );

  return groundPartsAtYZero(parts);
}

/**
 * 4D. Specialized Table (`table`) & Treasure Chest (`chest_or_prop`) Generators
 */
export function generateSpecializedTableOrPropParts(params: {
  modelName: string;
  family: 'table' | 'chest_or_prop';
  blueprint: AiDirectorBlueprint;
  budget: BudgetAllocationProfile;
}): SpecializedPartSpec[] {
  const { modelName, family, blueprint, budget } = params;
  const parts: SpecializedPartSpec[] = [];
  let idx = 1;
  const cf = blueprint.roblox_constraints.collision_fidelity;
  const pHex = blueprint.materials_and_textures.primary_hex;
  const sHex = blueprint.materials_and_textures.secondary_hex;
  const aHex = blueprint.materials_and_textures.accent_hex;

  if (family === 'table') {
    const w = 7.2;
    const h = 4.2;
    const d = 4.6;
    const legH = round4(h * 0.88);
    const legW = 0.48;
    const positions: [string, number, number][] = [
      ['TableLeg_FL', -w * 0.42, d * 0.38],
      ['TableLeg_FR', w * 0.42, d * 0.38],
      ['TableLeg_BL', -w * 0.42, -d * 0.38],
      ['TableLeg_BR', w * 0.42, -d * 0.38],
    ];
    for (const [lname, lx, lz] of positions) {
      parts.push(
        makePartSpec({
          idx: idx++,
          name: lname,
          parentPath: 'Root/TableLegs',
          size: [legW, legH, legW],
          position: [round4(lx), round4(legH * 0.5), round4(lz)],
          colorHex: pHex,
          material: 'Wood',
          roughness: 0.74,
          metalness: 0.06,
          collisionFidelity: cf,
          meshData: buildTaperedCurvedTubeMesh({
            modelName,
            size: [legW, legH, legW],
            radialSegments: budget.radialSegmentsSecondary,
            heightSegments: budget.heightSegmentsSecondary,
            bottomRadiusRatio: 0.75,
            topRadiusRatio: 1.0,
          }),
        })
      );
    }
    parts.push(
      makePartSpec({
        idx: idx++,
        name: 'BeveledTableTop',
        parentPath: 'Root/TableTop',
        size: [w, round4(h * 0.12), d],
        position: [0, round4(legH + h * 0.06), 0],
        colorHex: pHex,
        material: 'WoodPlanks',
        roughness: 0.68,
        metalness: 0.08,
        collisionFidelity: cf,
        meshData: buildBeveledStructuralMesh({
          modelName,
          size: [w, round4(h * 0.12), d],
          bevelRatio: 0.1,
          radialSegments: budget.radialSegmentsPrimary,
          heightSegments: 3,
        }),
      })
    );
    parts.push(
      makePartSpec({
        idx: idx++,
        name: 'CentralCrossbeamStretcher',
        parentPath: 'Root/TableLegs',
        size: [round4(w * 0.84), 0.36, 0.42],
        position: [0, round4(legH * 0.28), 0],
        colorHex: sHex,
        material: 'Metal',
        roughness: 0.45,
        metalness: 0.7,
        collisionFidelity: cf,
        meshData: buildBeveledStructuralMesh({
          modelName,
          size: [round4(w * 0.84), 0.36, 0.42],
          radialSegments: 6,
          heightSegments: 2,
        }),
      })
    );
    return groundPartsAtYZero(parts);
  }

  // Articulated Treasure Chest / Prop (`chest_or_prop`)
  const w = blueprint.proportions_studs.width || 5.8;
  const h = blueprint.proportions_studs.height || 4.4;
  const d = blueprint.proportions_studs.depth || 4.0;
  const baseH = round4(h * 0.58);
  const lidH = round4(h * 0.42);

  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'ChestTimberHull',
      parentPath: 'Root/BaseChest',
      size: [w, baseH, d],
      position: [0, baseH * 0.5, 0],
      colorHex: pHex,
      material: 'WoodPlanks',
      roughness: 0.78,
      metalness: 0.08,
      collisionFidelity: cf,
      meshData: buildBeveledStructuralMesh({
        modelName,
        size: [w, baseH, d],
        topTaperX: 1.04,
        topTaperZ: 1.04,
        radialSegments: budget.radialSegmentsPrimary,
        heightSegments: budget.heightSegmentsSecondary,
      }),
    })
  );

  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'VaultedChestLid',
      parentPath: 'Root/ArchedLid',
      size: [round4(w * 1.02), lidH, round4(d * 1.02)],
      position: [0, round4(baseH + lidH * 0.46), 0],
      colorHex: jitterHexColor(pHex, 0.04),
      material: 'Wood',
      roughness: 0.74,
      metalness: 0.1,
      collisionFidelity: cf,
      meshData: buildBeveledStructuralMesh({
        modelName,
        size: [round4(w * 1.02), lidH, round4(d * 1.02)],
        archTop: true,
        radialSegments: budget.radialSegmentsPrimary,
        heightSegments: budget.heightSegmentsSecondary,
      }),
    })
  );

  for (const side of [-1, 1]) {
    parts.push(
      makePartSpec({
        idx: idx++,
        name: side < 0 ? 'IronReinforcementBand_Left' : 'IronReinforcementBand_Right',
        parentPath: 'Root/IronBands',
        size: [0.46, round4(h * 0.98), round4(d * 1.06)],
        position: [round4(side * w * 0.36), round4(h * 0.49), 0],
        colorHex: sHex,
        material: 'Metal',
        roughness: 0.38,
        metalness: 0.85,
        collisionFidelity: cf,
        meshData: buildBeveledStructuralMesh({
          modelName,
          size: [0.46, round4(h * 0.98), round4(d * 1.06)],
          archTop: true,
          radialSegments: 8,
          heightSegments: 3,
        }),
      })
    );
  }

  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'ArcaneLockEscutcheon',
      parentPath: 'Root/LockCore',
      size: [0.95, 1.25, 0.45],
      position: [0, round4(baseH * 0.95), round4(d * 0.52)],
      colorHex: aHex,
      material: 'Neon',
      roughness: 0.2,
      metalness: 0.6,
      collisionFidelity: cf,
      meshData: buildDeformedIcosphereMesh({
        modelName,
        size: [0.95, 1.25, 0.45],
        subdivisions: budget.icosphereSubdivisionsSecondary,
        noiseAmplitude: 0.08,
        facetPlanesCount: 6,
      }),
    })
  );

  return groundPartsAtYZero(parts);
}

// ============================================================================
// CATEGORY 5: COHERENT MULTI-ASSET SCENE (`Scene3D`)
// ============================================================================
export function generateSpecializedSceneAssetParts(params: {
  modelName: string;
  blueprint: AiDirectorBlueprint;
  budget: BudgetAllocationProfile;
  seed: string;
}): SpecializedPartSpec[] {
  const { modelName, blueprint, budget, seed } = params;
  const parts: SpecializedPartSpec[] = [];
  let idx = 1;
  const cf = blueprint.roblox_constraints.collision_fidelity;

  const sceneW = blueprint.proportions_studs.width || 24;
  const sceneD = blueprint.proportions_studs.depth || 24;
  const terrainH = 1.4;

  // 1. Zone_Terrain: Stepped Stone & Grass Sanctuary Plaza Base at Y=0
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'SanctuaryTerrainBase',
      parentPath: 'Root/Zone_Terrain',
      size: [sceneW, terrainH, sceneD],
      position: [0, terrainH * 0.5, 0],
      colorHex: '#334155',
      material: 'Slate',
      roughness: 0.88,
      metalness: 0.05,
      collisionFidelity: cf,
      meshData: buildBeveledStructuralMesh({
        modelName,
        size: [sceneW, terrainH, sceneD],
        bevelRatio: 0.06,
        topTaperX: 0.96,
        topTaperZ: 0.96,
        radialSegments: budget.radialSegmentsPrimary,
        heightSegments: 3,
      }),
    })
  );

  // 2. Zone_FocalStructure: Central Sanctuary Watchtower / Shrine at (0, terrainH, -3)
  const shrineW = 6.2;
  const shrineH = 9.5;
  const shrineD = 6.2;
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'FocalSanctuaryKeep',
      parentPath: 'Root/Zone_FocalStructure',
      size: [shrineW, shrineH, shrineD],
      position: [0, round4(terrainH + shrineH * 0.5), -3.2],
      colorHex: '#64748b',
      material: 'Cobblestone',
      roughness: 0.82,
      metalness: 0.06,
      collisionFidelity: cf,
      meshData: buildBeveledStructuralMesh({
        modelName,
        size: [shrineW, shrineH, shrineD],
        topTaperX: 0.9,
        topTaperZ: 0.9,
        radialSegments: budget.radialSegmentsPrimary,
        heightSegments: budget.heightSegmentsSecondary,
      }),
    })
  );

  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'FocalSanctuaryRoof',
      parentPath: 'Root/Zone_FocalStructure',
      size: [7.2, 3.6, 7.2],
      position: [0, round4(terrainH + shrineH + 1.7), -3.2],
      colorHex: '#b45309',
      material: 'Slate',
      roughness: 0.72,
      metalness: 0.1,
      collisionFidelity: cf,
      meshData: buildArchitecturalRoofMesh({
        modelName,
        size: [7.2, 3.6, 7.2],
        roofStyle: 'pagoda_curved',
        segments: budget.heightSegmentsSecondary,
      }),
    })
  );

  // 3. Zone_Vegetation: Guardian Stylized Tree at (-6.5, terrainH, 2.5)
  const treeX = -6.5;
  const treeZ = 2.5;
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'GuardianTreeTrunk',
      parentPath: 'Root/Zone_Vegetation',
      size: [1.6, 6.8, 1.6],
      position: [treeX, round4(terrainH + 3.4), treeZ],
      colorHex: '#5c3d28',
      material: 'Wood',
      roughness: 0.85,
      metalness: 0.04,
      collisionFidelity: cf,
      meshData: buildTaperedCurvedTubeMesh({
        modelName,
        size: [1.6, 6.8, 1.6],
        radialSegments: budget.radialSegmentsSecondary,
        heightSegments: budget.heightSegmentsSecondary,
        bottomRadiusRatio: 1.0,
        topRadiusRatio: 0.58,
        curveX: 0.25,
      }),
    })
  );

  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'GuardianTreeCanopy',
      parentPath: 'Root/Zone_Vegetation',
      size: [6.4, 4.8, 6.4],
      position: [treeX, round4(terrainH + 7.8), treeZ],
      colorHex: '#2d7a46',
      material: 'Grass',
      roughness: 0.75,
      metalness: 0.03,
      collisionFidelity: cf,
      meshData: buildDeformedIcosphereMesh({
        modelName,
        size: [6.4, 4.8, 6.4],
        subdivisions: budget.icosphereSubdivisionsSecondary,
        noiseAmplitude: 0.18,
        facetPlanesCount: 4,
        canopyLobes: 5,
      }),
    })
  );

  // 4. Zone_Rocks: Stratified Boulder Formation at (6.5, terrainH, 1.8)
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'EasternCliffOutcrop',
      parentPath: 'Root/Zone_Rocks',
      size: [4.8, 4.2, 4.4],
      position: [6.5, round4(terrainH + 2.0), 1.8],
      rotation: [0, 35, 0],
      colorHex: '#475569',
      material: 'Basalt',
      roughness: 0.9,
      metalness: 0.05,
      collisionFidelity: cf,
      meshData: buildDeformedIcosphereMesh({
        modelName,
        size: [4.8, 4.2, 4.4],
        subdivisions: budget.icosphereSubdivisionsSecondary,
        noiseAmplitude: 0.24,
        facetPlanesCount: 8,
        stratificationStrength: 0.22,
        basalFlatten: 0.45,
        seedOffset: seed.length + 9,
      }),
    })
  );

  // 5. Zone_Lighting: Twin Street Lantern Beacons flanking the front plaza path
  for (const side of [-1, 1]) {
    const lx = side * 4.2;
    const lz = 6.2;
    parts.push(
      makePartSpec({
        idx: idx++,
        name: side < 0 ? 'PlazaLanternPost_West' : 'PlazaLanternPost_East',
        parentPath: 'Root/Zone_Lighting',
        size: [0.85, 4.4, 0.85],
        position: [lx, round4(terrainH + 2.2), lz],
        colorHex: '#1e293b',
        material: 'Metal',
        roughness: 0.38,
        metalness: 0.8,
        collisionFidelity: cf,
        meshData: buildTaperedCurvedTubeMesh({
          modelName,
          size: [0.85, 4.4, 0.85],
          radialSegments: 8,
          heightSegments: 4,
          bottomRadiusRatio: 1.0,
          topRadiusRatio: 0.65,
        }),
      })
    );
    parts.push(
      makePartSpec({
        idx: idx++,
        name: side < 0 ? 'PlazaLanternBeacon_West' : 'PlazaLanternBeacon_East',
        parentPath: 'Root/Zone_Lighting',
        size: [1.2, 1.2, 1.2],
        position: [lx, round4(terrainH + 4.8), lz],
        colorHex: '#f59e0b',
        material: 'Neon',
        roughness: 0.12,
        metalness: 0.1,
        collisionFidelity: cf,
        meshData: buildDeformedIcosphereMesh({
          modelName,
          size: [1.2, 1.2, 1.2],
          subdivisions: 1,
          noiseAmplitude: 0.04,
          facetPlanesCount: 4,
        }),
      })
    );
  }

  return groundPartsAtYZero(parts);
}

// ============================================================================
// CATEGORY 6: IMAGE-TO-3D SILHOUETTE RECONSTRUCTION (`image_lathe`)
// ============================================================================
export function generateReferenceImage3DAssetParts(params: {
  modelName: string;
  blueprint: AiDirectorBlueprint;
  budget: BudgetAllocationProfile;
  referenceAnalysis: ReferenceImageAnalysis;
}): SpecializedPartSpec[] {
  const { modelName, blueprint, budget, referenceAnalysis } = params;
  const parts: SpecializedPartSpec[] = [];
  let idx = 1;
  const cf = blueprint.roblox_constraints.collision_fidelity;

  const totalH = clamp(blueprint.proportions_studs.height || 12, 6, 28);
  const totalW = clamp(Number((totalH * referenceAnalysis.aspectRatioWidthToHeight).toFixed(2)), 2.5, 28);
  const profile16 = referenceAnalysis.widthProfile16;
  const offsets16 = referenceAnalysis.silhouetteProfile16.map((s) => s.centerOffsetNorm);
  const pal = referenceAnalysis.dominantPaletteHex;

  // 1. Base Zone (slices 0..5)
  const baseH = round4(totalH * 0.28);
  const baseMaxW = Math.max(...profile16.slice(0, 6), 0.25);
  const baseW = round4(totalW * baseMaxW);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'ReferenceSilhouetteBase',
      parentPath: 'Root/LatheBase',
      size: [baseW, baseH, baseW],
      position: [0, baseH * 0.5, 0],
      colorHex: pal.bottomHex,
      material: blueprint.materials_and_textures.primary_material || 'SmoothPlastic',
      roughness: 0.65,
      metalness: 0.15,
      collisionFidelity: cf,
      meshData: buildLatheSilhouetteMesh({
        modelName,
        size: [baseW, baseH, baseW],
        widthProfile: profile16.slice(0, 6).map((w) => w / baseMaxW),
        centerOffsetProfile: offsets16.slice(0, 6),
        radialSegments: budget.radialSegmentsPrimary,
      }),
    })
  );

  // 2. Mid Structural Body (slices 5..11)
  const bodyH = round4(totalH * 0.42);
  const bodyMaxW = Math.max(...profile16.slice(5, 12), 0.25);
  const bodyW = round4(totalW * bodyMaxW);
  const bodyY = round4(baseH + bodyH * 0.48);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'ReferenceSilhouetteBody',
      parentPath: 'Root/LatheBody',
      size: [bodyW, bodyH, bodyW],
      position: [0, bodyY, 0],
      colorHex: pal.midHex,
      material: blueprint.materials_and_textures.secondary_material || 'SmoothPlastic',
      roughness: 0.58,
      metalness: 0.18,
      collisionFidelity: cf,
      meshData: buildLatheSilhouetteMesh({
        modelName,
        size: [bodyW, bodyH, bodyW],
        widthProfile: profile16.slice(5, 12).map((w) => w / bodyMaxW),
        centerOffsetProfile: offsets16.slice(5, 12),
        radialSegments: budget.radialSegmentsPrimary,
      }),
    })
  );

  // 3. Upper Crown / Dome Zone (slices 11..15)
  const crownH = round4(totalH * 0.34);
  const crownMaxW = Math.max(...profile16.slice(10, 16), 0.25);
  const crownW = round4(totalW * crownMaxW);
  const crownY = round4(baseH + bodyH * 0.92 + crownH * 0.46);
  parts.push(
    makePartSpec({
      idx: idx++,
      name: 'ReferenceSilhouetteCrown',
      parentPath: 'Root/LatheCrown',
      size: [crownW, crownH, crownW],
      position: [0, crownY, 0],
      colorHex: pal.topHex,
      material: blueprint.materials_and_textures.accent_material || 'SmoothPlastic',
      roughness: 0.5,
      metalness: 0.12,
      collisionFidelity: cf,
      meshData: buildLatheSilhouetteMesh({
        modelName,
        size: [crownW, crownH, crownW],
        widthProfile: profile16.slice(10, 16).map((w) => w / crownMaxW),
        centerOffsetProfile: offsets16.slice(10, 16),
        radialSegments: budget.radialSegmentsPrimary,
      }),
    })
  );

  // 4. Lateral Structural Appendages at Peak Silhouette Width
  let peakSliceIdx = 8;
  let peakW = 0;
  for (let i = 3; i < 14; i++) {
    if (profile16[i] > peakW) {
      peakW = profile16[i];
      peakSliceIdx = i;
    }
  }
  const peakY = round4((peakSliceIdx / 15) * totalH);
  const appSpan = round4(totalW * peakW * 0.42);
  const appSize = round4(Math.max(0.8, totalW * 0.22));
  for (const side of [-1, 1]) {
    parts.push(
      makePartSpec({
        idx: idx++,
        name: side < 0 ? 'SilhouetteLateralWing_Left' : 'SilhouetteLateralWing_Right',
        parentPath: 'Root/LatheAccents',
        size: [appSize, round4(totalH * 0.18), appSize],
        position: [round4(side * appSpan), peakY, 0],
        colorHex: pal.topHex,
        material: blueprint.materials_and_textures.secondary_material || 'SmoothPlastic',
        roughness: 0.55,
        metalness: 0.15,
        collisionFidelity: cf,
        meshData: buildDeformedIcosphereMesh({
          modelName,
          size: [appSize, round4(totalH * 0.18), appSize],
          subdivisions: budget.icosphereSubdivisionsSecondary,
          noiseAmplitude: 0.1,
          facetPlanesCount: 4,
        }),
      })
    );
  }

  return groundPartsAtYZero(parts);
}

/**
 * Master dispatcher that builds specialized 3D parts from a validated `AiDirectorBlueprint`,
 * `BudgetAllocationProfile`, and optional `ReferenceImageAnalysis`.
 */
function applyActiveLodSelection(parts: SpecializedPartSpec[], activeLod: 0 | 1 | 2): SpecializedPartSpec[] {
  if (activeLod === 0) return parts;
  return parts.map((p) => {
    const chosen = p.meshData.lodLevels[activeLod] || p.meshData.lodLevels[0];
    return {
      ...p,
      meshData: {
        ...p.meshData,
        activeLod,
        vertices: chosen.vertices,
        normals: chosen.normals,
        uvs: chosen.uvs,
        faces: chosen.faces,
        indices: chosen.indices,
      },
    };
  });
}

export function buildPartsFromSpecializedEngine(params: {
  modelName: string;
  blueprint: AiDirectorBlueprint;
  budget: BudgetAllocationProfile;
  prompt?: string;
  seed: string;
  treeParams?: Record<string, any>;
  referenceAnalysis?: ReferenceImageAnalysis | null;
}): SpecializedPartSpec[] {
  const { modelName, blueprint, budget, prompt, seed, treeParams, referenceAnalysis } = params;
  const family: SpecializedObjectFamily = blueprint.identity.object_family;
  const rawLod = Number(treeParams?.lodLevel ?? 0);
  const activeLod: 0 | 1 | 2 = rawLod === 2 ? 2 : rawLod === 1 ? 1 : 0;

  let rawParts: SpecializedPartSpec[];

  if (referenceAnalysis && family === 'image_lathe') {
    rawParts = generateReferenceImage3DAssetParts({
      modelName,
      blueprint,
      budget,
      referenceAnalysis,
    });
    return applyActiveLodSelection(rawParts, activeLod);
  }

  switch (family) {
    case 'tree': {
      const rawSpecies = String(blueprint.identity.species_or_subtype || 'oak').toLowerCase();
      const species: TreeSpeciesArchetype =
        rawSpecies === 'pine' ||
        rawSpecies === 'willow' ||
        rawSpecies === 'dead' ||
        rawSpecies === 'fantasy' ||
        rawSpecies === 'bonsai'
          ? rawSpecies
          : 'oak';
      rawParts = generateSpecializedTreeAssetParts({
        modelName,
        species,
        blueprint,
        budget,
        treeParams,
        seed,
      });
      break;
    }
    case 'rock':
      rawParts = generateSpecializedRockAssetParts({
        modelName,
        blueprint,
        budget,
        prompt,
        seed,
      });
      break;
    case 'building':
      rawParts = generateSpecializedBuildingAssetParts({
        modelName,
        blueprint,
        budget,
        seed,
      });
      break;
    case 'chair':
      rawParts = generateSpecializedChairAssetParts({
        modelName,
        blueprint,
        budget,
      });
      break;
    case 'lamp':
      rawParts = generateSpecializedLampAssetParts({
        modelName,
        blueprint,
        budget,
      });
      break;
    case 'mechanical':
      rawParts = generateSpecializedMechanicalAssetParts({
        modelName,
        blueprint,
        budget,
      });
      break;
    case 'table':
      rawParts = generateSpecializedTableOrPropParts({
        modelName,
        family: 'table',
        blueprint,
        budget,
      });
      break;
    case 'scene':
      rawParts = generateSpecializedSceneAssetParts({
        modelName,
        blueprint,
        budget,
        seed,
      });
      break;
    default:
      rawParts = generateSpecializedTableOrPropParts({
        modelName,
        family: 'chest_or_prop',
        blueprint,
        budget,
      });
      break;
  }

  return applyActiveLodSelection(rawParts, activeLod);
}
