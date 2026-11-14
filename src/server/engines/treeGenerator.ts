import { SubMeshGeometryInput, resolveRgbTupleLuau } from './generation3DEngine.ts';

export type TreePreset = 'simple' | 'leafy' | 'fantasy' | 'weeping' | 'low' | 'high';
export type TreeLodLevel = 0 | 1 | 2;

export interface TreeGenerationOptions {
  preset?: TreePreset;
  seed?: number;
  lod?: TreeLodLevel;
  scale?: number;
  trunkColor?: [number, number, number] | string;
  foliageColor?: [number, number, number] | string;
}

export interface GeneratedTreePart {
  name: string;
  shape: 'MeshPart' | 'Cylinder' | 'Ball';
  size: [number, number, number];
  position: [number, number, number];
  rotation: [number, number, number];
  color: [number, number, number];
  material: string;
  roughness: number;
  metalness: number;
  transparency: number;
  canCollide: boolean;
  anchored: boolean;
  collisionFidelity: 'Hull' | 'Box';
  meshData: SubMeshGeometryInput;
}

export interface GeneratedTreeModel {
  name: string;
  seed: number;
  preset: TreePreset;
  lod: TreeLodLevel;
  parts: GeneratedTreePart[];
  stats: {
    partCount: number;
    totalVertices: number;
    totalTriangles: number;
    minY: number;
    maxY: number;
  };
}

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTaperedCylinderMesh(
  bottomRadius: number,
  topRadius: number,
  height: number,
  radialSegments: number,
  heightSegments: number
): SubMeshGeometryInput {
  const segR = Math.max(5, Math.min(32, Math.floor(radialSegments)));
  const segH = Math.max(1, Math.min(12, Math.floor(heightSegments)));
  const halfH = height * 0.5;

  const vertices: Array<[number, number, number]> = [];
  const normals: Array<[number, number, number]> = [];
  const uvs: Array<[number, number]> = [];
  const faces: Array<[number, number, number]> = [];

  for (let yIdx = 0; yIdx <= segH; yIdx++) {
    const v = yIdx / segH;
    const y = -halfH + v * height;
    const radius = bottomRadius + (topRadius - bottomRadius) * v;
    for (let rIdx = 0; rIdx <= segR; rIdx++) {
      const u = rIdx / segR;
      const theta = u * Math.PI * 2;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      vertices.push([radius * ct, y, radius * st]);
      const slope = (bottomRadius - topRadius) / Math.max(height, 1e-4);
      const len = Math.hypot(ct, slope, st) || 1;
      normals.push([ct / len, slope / len, st / len]);
      uvs.push([u, v]);
    }
  }

  const stride = segR + 1;
  for (let yIdx = 0; yIdx < segH; yIdx++) {
    for (let rIdx = 0; rIdx < segR; rIdx++) {
      const a = yIdx * stride + rIdx;
      const b = a + 1;
      const c = (yIdx + 1) * stride + rIdx;
      const d = c + 1;
      // Outward CCW winding in right-handed coordinates (+X right, +Y up, +Z front)
      faces.push([a, d, b]);
      faces.push([a, c, d]);
    }
  }

  // Bottom cap
  const bottomCenterIdx = vertices.length;
  vertices.push([0, -halfH, 0]);
  normals.push([0, -1, 0]);
  uvs.push([0.5, 0.5]);
  const bottomRingStart = vertices.length;
  for (let rIdx = 0; rIdx < segR; rIdx++) {
    const theta = (rIdx / segR) * Math.PI * 2;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    vertices.push([bottomRadius * ct, -halfH, bottomRadius * st]);
    normals.push([0, -1, 0]);
    uvs.push([0.5 + 0.5 * ct, 0.5 + 0.5 * st]);
  }
  for (let rIdx = 0; rIdx < segR; rIdx++) {
    const nxt = (rIdx + 1) % segR;
    faces.push([bottomCenterIdx, bottomRingStart + rIdx, bottomRingStart + nxt]);
  }

  // Top cap
  const topCenterIdx = vertices.length;
  vertices.push([0, halfH, 0]);
  normals.push([0, 1, 0]);
  uvs.push([0.5, 0.5]);
  const topRingStart = vertices.length;
  for (let rIdx = 0; rIdx < segR; rIdx++) {
    const theta = (rIdx / segR) * Math.PI * 2;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    vertices.push([topRadius * ct, halfH, topRadius * st]);
    normals.push([0, 1, 0]);
    uvs.push([0.5 + 0.5 * ct, 0.5 + 0.5 * st]);
  }
  for (let rIdx = 0; rIdx < segR; rIdx++) {
    const nxt = (rIdx + 1) % segR;
    faces.push([topCenterIdx, topRingStart + nxt, topRingStart + rIdx]);
  }

  return { vertices, normals, uvs, faces, indices: faces.flat() };
}

function buildCanopyBlobMesh(
  rx: number,
  ry: number,
  rz: number,
  latBands: number,
  lonBands: number,
  jitterAmp: number,
  rand: () => number
): SubMeshGeometryInput {
  const latCount = Math.max(4, Math.min(18, Math.floor(latBands)));
  const lonCount = Math.max(6, Math.min(24, Math.floor(lonBands)));

  const vertices: Array<[number, number, number]> = [];
  const normals: Array<[number, number, number]> = [];
  const uvs: Array<[number, number]> = [];
  const faces: Array<[number, number, number]> = [];

  for (let lat = 0; lat <= latCount; lat++) {
    const v = lat / latCount;
    const theta = v * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    for (let lon = 0; lon <= lonCount; lon++) {
      const u = lon / lonCount;
      const phi = u * Math.PI * 2;
      const nx = Math.cos(phi) * sinT;
      const ny = cosT;
      const nz = Math.sin(phi) * sinT;
      // Keep poles and seam closed cleanly
      const seamNoise =
        lat === 0 || lat === latCount || lon === 0 || lon === lonCount
          ? 1.0
          : 1.0 + (rand() - 0.5) * 2 * jitterAmp;
      vertices.push([rx * nx * seamNoise, ry * ny * seamNoise, rz * nz * seamNoise]);
      const nLen = Math.hypot(nx / rx, ny / ry, nz / rz) || 1;
      normals.push([(nx / rx) / nLen, (ny / ry) / nLen, (nz / rz) / nLen]);
      uvs.push([u, v]);
    }
  }

  const stride = lonCount + 1;
  for (let lat = 0; lat < latCount; lat++) {
    for (let lon = 0; lon < lonCount; lon++) {
      const first = lat * stride + lon;
      const second = first + stride;
      if (lat > 0) {
        faces.push([first, first + 1, second]);
      }
      if (lat < latCount - 1) {
        faces.push([second, first + 1, second + 1]);
      }
    }
  }

  return { vertices, normals, uvs, faces, indices: faces.flat() };
}

export function generateProceduralTree(
  name: string = 'ProceduralTree',
  options: TreeGenerationOptions = {}
): GeneratedTreeModel {
  const preset: TreePreset = options.preset || 'simple';
  const seed = Number.isFinite(options.seed) ? Math.floor(Number(options.seed)) : 2026;
  const lod: TreeLodLevel = options.lod ?? (preset === 'low' ? 2 : preset === 'high' ? 0 : 1);
  const scale = Math.max(0.25, Math.min(4.0, Number(options.scale ?? 1.0)));
  const rand = createMulberry32(seed);

  const safeName = name.replace(/[^a-zA-Z0-9_]/g, '') || 'ProceduralTree';
  const defaultTrunk: [number, number, number] =
    preset === 'fantasy' ? [88, 56, 112] : [101, 67, 33];
  const defaultFoliage: [number, number, number] =
    preset === 'fantasy'
      ? [168, 85, 247]
      : preset === 'weeping'
      ? [74, 148, 86]
      : [46, 139, 87];

  const trunkRgb = resolveRgbTupleLuau(options.trunkColor ?? defaultTrunk);
  const foliageRgb = resolveRgbTupleLuau(options.foliageColor ?? defaultFoliage);

  const lodSegMap: Record<TreeLodLevel, { radial: number; heightSeg: number; lat: number; lon: number }> = {
    0: { radial: 16, heightSeg: 4, lat: 10, lon: 14 },
    1: { radial: 10, heightSeg: 2, lat: 7, lon: 10 },
    2: { radial: 6, heightSeg: 1, lat: 4, lon: 6 },
  };
  const seg = lodSegMap[lod];

  const trunkHeight =
    (preset === 'fantasy' ? 12.0 : preset === 'weeping' ? 11.0 : 9.0) * scale;
  const trunkBottomR = (preset === 'leafy' || preset === 'high' ? 1.45 : 1.15) * scale;
  const trunkTopR = trunkBottomR * 0.52;

  const parts: GeneratedTreePart[] = [];

  // 1. Trunk (pivot Y = 0 at base)
  const trunkMesh = buildTaperedCylinderMesh(
    trunkBottomR,
    trunkTopR,
    trunkHeight,
    seg.radial,
    seg.heightSeg
  );
  parts.push({
    name: `${safeName}_Trunk`,
    shape: 'MeshPart',
    size: [trunkBottomR * 2, trunkHeight, trunkBottomR * 2],
    position: [0, trunkHeight * 0.5, 0],
    rotation: [0, 0, 0],
    color: trunkRgb,
    material: 'Wood',
    roughness: 0.85,
    metalness: 0.05,
    transparency: 0,
    canCollide: true,
    anchored: true,
    collisionFidelity: 'Hull',
    meshData: trunkMesh,
  });

  // 2. Branches
  const branchCount =
    preset === 'low'
      ? 2
      : preset === 'simple'
      ? 3
      : preset === 'leafy'
      ? 5
      : preset === 'weeping'
      ? 6
      : preset === 'fantasy'
      ? 5
      : 6;

  const branchTips: Array<[number, number, number]> = [];
  for (let i = 0; i < branchCount; i++) {
    const yawDeg = (360 / branchCount) * i + (rand() - 0.5) * 24;
    const yawRad = (yawDeg * Math.PI) / 180;
    const tiltDeg = preset === 'weeping' ? 52 : 36 + rand() * 14;
    const branchLen = (3.4 + rand() * 1.8) * scale;
    const brBottom = trunkTopR * 0.72;
    const brTop = brBottom * 0.42;
    const startY = trunkHeight * (0.68 + rand() * 0.22);

    const tiltRad = (tiltDeg * Math.PI) / 180;
    const dirX = Math.cos(yawRad) * Math.sin(tiltRad);
    const dirY = Math.cos(tiltRad);
    const dirZ = Math.sin(yawRad) * Math.sin(tiltRad);

    const midX = dirX * (branchLen * 0.5);
    const midY = startY + dirY * (branchLen * 0.5);
    const midZ = dirZ * (branchLen * 0.5);

    const tipX = dirX * branchLen;
    const tipY = startY + dirY * branchLen;
    const tipZ = dirZ * branchLen;
    branchTips.push([tipX, tipY, tipZ]);

    parts.push({
      name: `${safeName}_Branch_${i + 1}`,
      shape: 'MeshPart',
      size: [brBottom * 2, branchLen, brBottom * 2],
      position: [midX, midY, midZ],
      rotation: [tiltDeg * Math.sin(yawRad), yawDeg, -tiltDeg * Math.cos(yawRad)],
      color: trunkRgb,
      material: 'Wood',
      roughness: 0.85,
      metalness: 0.05,
      transparency: 0,
      canCollide: true,
      anchored: true,
      collisionFidelity: 'Hull',
      meshData: buildTaperedCylinderMesh(
        brBottom,
        brTop,
        branchLen,
        Math.max(5, Math.floor(seg.radial * 0.75)),
        1
      ),
    });

    if (preset === 'weeping') {
      const drapeLen = (3.8 + rand() * 1.4) * scale;
      const drapeY = Math.max(drapeLen * 0.5 + 0.5, tipY - drapeLen * 0.5);
      parts.push({
        name: `${safeName}_WeepingVine_${i + 1}`,
        shape: 'MeshPart',
        size: [1.1 * scale, drapeLen, 1.1 * scale],
        position: [tipX * 1.05, drapeY, tipZ * 1.05],
        rotation: [0, yawDeg, 0],
        color: foliageRgb,
        material: 'Grass',
        roughness: 0.75,
        metalness: 0.0,
        transparency: 0,
        canCollide: false,
        anchored: true,
        collisionFidelity: 'Box',
        meshData: buildCanopyBlobMesh(0.55 * scale, drapeLen * 0.5, 0.55 * scale, seg.lat, seg.lon, 0.08, rand),
      });
    }
  }

  // 3. Canopy clusters (crown + branch tips)
  const crownRx = (preset === 'leafy' || preset === 'high' ? 4.4 : 3.4) * scale;
  const crownRy = (preset === 'fantasy' ? 3.8 : 2.9) * scale;
  parts.push({
    name: `${safeName}_CrownMain`,
    shape: 'MeshPart',
    size: [crownRx * 2, crownRy * 2, crownRx * 2],
    position: [0, trunkHeight + crownRy * 0.45, 0],
    rotation: [0, 0, 0],
    color: foliageRgb,
    material: preset === 'fantasy' ? 'Neon' : 'Grass',
    roughness: preset === 'fantasy' ? 0.25 : 0.78,
    metalness: 0.02,
    transparency: 0,
    canCollide: true,
    anchored: true,
    collisionFidelity: 'Hull',
    meshData: buildCanopyBlobMesh(crownRx, crownRy, crownRx, seg.lat, seg.lon, 0.1, rand),
  });

  const subCanopyCount = preset === 'low' ? 1 : branchTips.length;
  for (let i = 0; i < subCanopyCount; i++) {
    const [tx, ty, tz] = branchTips[i];
    const subR = (2.1 + rand() * 0.9) * scale;
    const subRy = subR * 0.75;
    parts.push({
      name: `${safeName}_CanopyCluster_${i + 1}`,
      shape: 'MeshPart',
      size: [subR * 2, subRy * 2, subR * 2],
      position: [tx, Math.max(subRy + 0.5, ty + subRy * 0.3), tz],
      rotation: [0, rand() * 360, 0],
      color: foliageRgb,
      material: preset === 'fantasy' ? 'ForceField' : 'Grass',
      roughness: 0.75,
      metalness: 0.02,
      transparency: preset === 'fantasy' ? 0.15 : 0,
      canCollide: false,
      anchored: true,
      collisionFidelity: 'Box',
      meshData: buildCanopyBlobMesh(subR, subRy, subR, seg.lat, seg.lon, 0.12, rand),
    });
  }

  let totalVertices = 0;
  let totalTriangles = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const part of parts) {
    totalVertices += part.meshData.vertices.length;
    totalTriangles += part.meshData.faces.length;
    for (const v of part.meshData.vertices) {
      const worldY = part.position[1] + v[1];
      if (worldY < minY) minY = worldY;
      if (worldY > maxY) maxY = worldY;
    }
  }

  return {
    name: safeName,
    seed,
    preset,
    lod,
    parts,
    stats: {
      partCount: parts.length,
      totalVertices,
      totalTriangles,
      minY: Number.isFinite(minY) ? Number(minY.toFixed(4)) : 0,
      maxY: Number.isFinite(maxY) ? Number(maxY.toFixed(4)) : 0,
    },
  };
}
