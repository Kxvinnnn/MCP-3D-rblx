/**
 * @module assetEngine
 * @description
 * Engine 2/7 — Asset, Multi-Format 3D Serializer & 4-Channel PBR Engine (TypeScript Server Module).
 *
 * RESPONSIBILITIES:
 * 1. Build & Parse Roblox `.RBXMX` XML models (`buildRbxmxFromPartsServer`, `parseRbxmxFromPartsServer`)
 *    preserving full 3×3 CFrame rotation matrices, Roblox Material tokens, 4-channel `SurfaceAppearance`
 *    (`ColorMap`, `NormalMap`, `RoughnessMap`, `MetalnessMap`), and `ForgeMeshGeometryJSON` buffers.
 * 2. Build Wavefront `.OBJ` + `.MTL` material pairs (`buildObjAndMtlFromPartsServer`).
 * 3. Build glTF 2.0 JSON with embedded binary `ARRAY_BUFFER` / `ELEMENT_ARRAY_BUFFER` and PBR textures
 *    (`buildGltfFromPartsServer`).
 * 4. Generate `--!strict` Luau PBR `SurfaceAppearance` + `EditableImage` binder modules
 *    (`generatePBRSurfaceAppearanceLuau`).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import {
  buildStrictLuauFromEditedParts,
  extractGeometryFromProcessedMesh,
  MeshPartInput,
  splitOversizedMeshPartInput,
  SubMeshGeometryInput,
  synthesizeProceduralMeshData,
  validatePublishedRobloxMeshId,
} from './generation3DEngine.ts';

export interface DecodedPngValidationResult {
  valid: boolean;
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlaceMethod?: number;
  hasPalette?: boolean;
  byteLength: number;
  sha256: string;
  rgbaPreviewB64: string;
  previewSize: number;
  meanRgba?: [number, number, number, number];
  error?: string;
}

export const FORGE_SYNC_HASH_SCHEMA_V1 = 'forge-sync-v1';

/**
 * Canonical text normalization shared across Python, TypeScript, and Luau:
 * converts CRLF and CR to LF and trims outer whitespace.
 */
export function normalizeLuauAndSyncText(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

/**
 * Computes a deterministic 32-bit FNV-1a hex hash over normalized LF string content.
 * Matches `compute_fnv1a_32_hex` in Python and `computeLuauContentHash` in `ForgeAIStudioPlugin.server.luau`
 * byte-for-byte.
 */
export function computeFnv1a32Hex(text: string): string {
  const normalized = normalizeLuauAndSyncText(text);
  const bytes = Buffer.from(normalized, 'utf-8');
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Formats a floating-point number with deterministic half-away-from-zero rounding
 * and `-0.0` normalization so Python, TypeScript, and Luau produce identical decimal strings.
 */
export function fmtCanonicalFixed(val: any, decimals: number = 4): string {
  let f = Number(val ?? 0);
  if (!Number.isFinite(f)) f = 0;
  const scale = Math.pow(10, decimals);
  const sign = f < -1e-9 ? -1 : 1;
  const scaled = Math.floor(Math.abs(f) * scale + 0.5000001);
  if (scaled === 0) {
    return decimals > 0 ? `0.${'0'.repeat(decimals)}` : '0';
  }
  const s = String(scaled).padStart(decimals + 1, '0');
  const prefix = sign < 0 ? '-' : '';
  if (decimals === 0) return `${prefix}${s}`;
  return `${prefix}${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals)}`;
}

export function canonicalEulerToMatrix9(rxDeg: number, ryDeg: number, rzDeg: number): number[] {
  const rx = (rxDeg * Math.PI) / 180;
  const ry = (ryDeg * Math.PI) / 180;
  const rz = (rzDeg * Math.PI) / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cy * cz,
    -cy * sz,
    sy,
    sx * sy * cz + cx * sz,
    -sx * sy * sz + cx * cz,
    -sx * cy,
    -cx * sy * cz + sx * sz,
    cx * sy * sz + sx * cz,
    cx * cy,
  ];
}

export function canonicalMatrix9ToEulerDeg(m: number[]): [number, number, number] {
  if (!Array.isArray(m) || m.length < 9) return [0, 0, 0];
  const [r00 = 1, r01 = 0, r02 = 0, , r11 = 1, r12 = 0, , r21 = 0, r22 = 1] = m.map((v) =>
    Number(v ?? 0)
  );
  const clampedR02 = Math.max(-1, Math.min(1, r02));
  const ry = Math.asin(clampedR02);
  let rx = 0;
  let rz = 0;
  if (Math.abs(clampedR02) < 0.999999) {
    rx = Math.atan2(-r12, r22);
    rz = Math.atan2(-r01, r00);
  } else {
    rx = Math.atan2(r21, r11);
    rz = 0;
  }
  const toDeg = (rad: number) => Number(fmtCanonicalFixed((rad * 180) / Math.PI, 2));
  return [toDeg(rx), toDeg(ry), toDeg(rz)];
}

export function generatePersistentPartGuid(seedPrefix: string = 'fpart'): string {
  return `${seedPrefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function extractCanonicalRotationMatrix9(part: any): number[] {
  const rot = Array.isArray(part?.rotation) ? part.rotation : null;
  let rx = 0, ry = 0, rz = 0;
  let hasExplicitEuler = false;
  if (rot && rot.length >= 3) {
    rx = Number(rot[0] ?? 0);
    ry = Number(rot[1] ?? 0);
    rz = Number(rot[2] ?? 0);
    if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz)) {
      hasExplicitEuler = true;
    } else {
      rx = 0; ry = 0; rz = 0;
    }
  }
  const rawMat = part?.rotationMatrix || part?.rotation_matrix || part?.cframeMatrix;
  if (Array.isArray(rawMat) && rawMat.length >= 9) {
    const out = rawMat.slice(0, 9).map((v: any) => Number(v));
    if (out.every((v: number) => Number.isFinite(v))) {
      if (hasExplicitEuler) {
        const derivedDeg = canonicalMatrix9ToEulerDeg(out);
        if (
          Math.abs(derivedDeg[0] - rx) > 0.05 ||
          Math.abs(derivedDeg[1] - ry) > 0.05 ||
          Math.abs(derivedDeg[2] - rz) > 0.05
        ) {
          return canonicalEulerToMatrix9(rx, ry, rz);
        }
      }
      return out;
    }
  }
  return canonicalEulerToMatrix9(rx, ry, rz);
}

export function normalizeColorRgb255(colorRaw: any): [number, number, number] {
  if (!Array.isArray(colorRaw) || colorRaw.length < 3) {
    return [148, 163, 184];
  }
  let v0 = Number(colorRaw[0] ?? 148);
  let v1 = Number(colorRaw[1] ?? 163);
  let v2 = Number(colorRaw[2] ?? 184);
  if (!Number.isFinite(v0)) v0 = 148;
  if (!Number.isFinite(v1)) v1 = 163;
  if (!Number.isFinite(v2)) v2 = 184;
  const isFloat01 =
    [v0, v1, v2].every((x) => x >= 0 && x <= 1) &&
    ([colorRaw[0], colorRaw[1], colorRaw[2]].some((x) => typeof x === 'number' && !Number.isInteger(x)) ||
      Math.max(v0, v1, v2) <= 1.0);
  if (isFloat01 && Math.max(v0, v1, v2) <= 1.0 && (v0 < 1.0 || v1 < 1.0 || v2 < 1.0)) {
    return [
      Math.max(0, Math.min(255, Math.floor(v0 * 255 + 0.5))),
      Math.max(0, Math.min(255, Math.floor(v1 * 255 + 0.5))),
      Math.max(0, Math.min(255, Math.floor(v2 * 255 + 0.5))),
    ];
  }
  return [
    Math.max(0, Math.min(255, Math.floor(v0 + 0.5))),
    Math.max(0, Math.min(255, Math.floor(v1 + 0.5))),
    Math.max(0, Math.min(255, Math.floor(v2 + 0.5))),
  ];
}

export function normalizeHierarchyMetadata(
  part: any,
  indexFallback: number = 0,
  modelName: string = ''
): {
  name: string;
  partName: string;
  partId: string;
  parentId: string;
  parentName: string;
  parentContainerClass: 'Folder' | 'Model';
  hierarchyPath: string;
  hierarchySegments: string[];
} {
  const rawName = String(part?.name || `MeshPart_${indexFallback + 1}`).trim();
  const safeName = rawName || `MeshPart_${indexFallback + 1}`;
  const cleanAlnum =
    Array.from(safeName)
      .map((c) => (/[a-zA-Z0-9_]/.test(c) ? c : '_'))
      .join('') || `MeshPart_${indexFallback + 1}`;
  const rawPartId = String(part?.partId || part?.part_id || part?.id || '').trim();
  const partId = rawPartId || `fpart_${cleanAlnum}`;
  if (part && typeof part === 'object' && !rawPartId) {
    part.partId = partId;
  }

  const rawParent = String(part?.parentName || part?.parent_name || '').trim();
  const rawPath = String(part?.hierarchyPath || part?.hierarchy_path || '').trim();
  const cleanModel = String(modelName || '').trim().toLowerCase();

  let intermediateFolders: string[] = [];
  if (rawPath) {
    let pathSegs = rawPath
      .replace(/\\/g, '/')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    if (pathSegs.length > 0) {
      const firstLow = pathSegs[0].toLowerCase();
      if (
        firstLow === 'root' ||
        firstLow === 'modelroot' ||
        firstLow === 'workspace' ||
        (cleanModel && firstLow === cleanModel)
      ) {
        pathSegs = pathSegs.slice(1);
      }
    }
    if (pathSegs.length > 0 && pathSegs[pathSegs.length - 1] === safeName) {
      pathSegs = pathSegs.slice(0, -1);
    }
    intermediateFolders = pathSegs.filter((s) => {
      const low = s.toLowerCase();
      return (
        low !== 'root' &&
        low !== 'modelroot' &&
        low !== 'workspace' &&
        (!cleanModel || low !== cleanModel)
      );
    });
  }

  if (intermediateFolders.length === 0 && rawParent) {
    let parentSegs = rawParent
      .replace(/\\/g, '/')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parentSegs.length > 0) {
      const firstLow = parentSegs[0].toLowerCase();
      if (
        firstLow === 'root' ||
        firstLow === 'modelroot' ||
        firstLow === 'workspace' ||
        (cleanModel && firstLow === cleanModel)
      ) {
        parentSegs = parentSegs.slice(1);
      }
    }
    if (parentSegs.length > 1 && parentSegs[parentSegs.length - 1] === safeName) {
      parentSegs = parentSegs.slice(0, -1);
    }
    intermediateFolders = parentSegs.filter((s) => {
      const low = s.toLowerCase();
      return (
        low !== 'root' &&
        low !== 'modelroot' &&
        low !== 'workspace' &&
        (!cleanModel || low !== cleanModel)
      );
    });
  }

  const hierarchySegments = ['Root', ...intermediateFolders, safeName];
  const hierarchyPath = hierarchySegments.join('/');
  const parentName =
    intermediateFolders.length > 0
      ? intermediateFolders[intermediateFolders.length - 1]
      : 'Root';
  const parentClean = intermediateFolders
    .map((s) =>
      Array.from(s)
        .map((c) => (/[a-zA-Z0-9_]/.test(c) ? c : '_'))
        .join('')
    )
    .join('_');
  const expectedParentId = intermediateFolders.length > 0 ? `fnode_${parentClean}` : 'fnode_Root';
  const rawParentId = String(part?.parentId || part?.parent_id || '').trim();
  let parentId: string;
  if (intermediateFolders.length === 0) {
    parentId = 'fnode_Root';
  } else if (
    rawParentId &&
    rawParentId !== 'root' &&
    rawParentId !== 'fnode_Root' &&
    rawParentId !== 'fnode_ModelRoot'
  ) {
    parentId = rawParentId.startsWith('fnode_') ? expectedParentId : rawParentId;
  } else {
    parentId = expectedParentId;
  }

  const rawContainerClass = String(
    part?.parentContainerClass || part?.parent_container_class || ''
  ).trim();
  const parentContainerClass: 'Folder' | 'Model' =
    rawContainerClass === 'Folder' || rawContainerClass === 'Model'
      ? rawContainerClass
      : 'Model';

  return {
    name: safeName,
    partName: safeName,
    partId,
    parentId,
    parentName,
    parentContainerClass,
    hierarchyPath,
    hierarchySegments,
  };
}

export function validateHierarchyDag(
  parts: any[],
  modelName: string = ''
): {
  valid: boolean;
  hasCycles: boolean;
  cycles: string[][];
  duplicatePartIds: string[];
  errors: string[];
} {
  const parentMap = new Map<string, string>();
  const partCounts = new Map<string, number>();
  const errors: string[] = [];
  const cycles: string[][] = [];

  (parts || []).forEach((p, idx) => {
    const rawPid = String(p?.partId || p?.part_id || '').trim();
    const rawParentId = String(p?.parentId || p?.parent_id || '').trim();
    const hier = normalizeHierarchyMetadata(p, idx, modelName);
    const pid = rawPid || hier.partId;
    const parentId =
      rawParentId && rawParentId !== 'root' && rawParentId !== 'fnode_Root'
        ? rawParentId
        : hier.parentId;
    partCounts.set(pid, (partCounts.get(pid) || 0) + 1);
    parentMap.set(pid, parentId);
    const segs = hier.hierarchySegments.slice(1, -1);
    let prevNode = 'fnode_Root';
    const accum: string[] = [];
    for (const seg of segs) {
      const cleanSeg = Array.from(seg)
        .map((c) => (/[a-zA-Z0-9_]/.test(c) ? c : '_'))
        .join('');
      accum.push(cleanSeg);
      const curNode = `fnode_${accum.join('_')}`;
      if (curNode === prevNode) {
        cycles.push([curNode, prevNode]);
      } else if (!parentMap.has(curNode)) {
        parentMap.set(curNode, prevNode);
      }
      prevNode = curNode;
    }
  });

  const duplicatePartIds = Array.from(partCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([pid]) => pid);
  if (duplicatePartIds.length > 0) {
    errors.push(`IDs de piezas duplicados detectados: ${duplicatePartIds.join(', ')}`);
  }

  for (const startNode of Array.from(parentMap.keys())) {
    const visitedOrder: string[] = [];
    const visitedSet = new Set<string>();
    let curr: string | undefined = startNode;
    while (curr && curr !== 'fnode_Root' && curr !== 'fnode_ModelRoot' && curr !== 'root') {
      if (visitedSet.has(curr)) {
        const cycleIdx = visitedOrder.indexOf(curr);
        const cyclePath = [...visitedOrder.slice(cycleIdx), curr];
        if (!cycles.some((existing) => existing.join('->') === cyclePath.join('->'))) {
          cycles.push(cyclePath);
          errors.push(`Ciclo jerárquico detectado: ${cyclePath.join(' -> ')}`);
        }
        break;
      }
      visitedSet.add(curr);
      visitedOrder.push(curr);
      curr = parentMap.get(curr);
    }
  }

  return {
    valid: cycles.length === 0 && duplicatePartIds.length === 0,
    hasCycles: cycles.length > 0,
    cycles,
    duplicatePartIds,
    errors,
  };
}

/**
 * Computes canonical `FORGE_SYNC_HASH_SCHEMA_V1` FNV-1a 32-bit hashes across:
 * 1. `geometryHash`: FULL geometry buffers (every vertex, normal, UV, and triangle index + meshId + geometrySource)
 * 2. `materialHash`: Material, reflectance, transparency, roughness, metalness & 4-channel PBR asset URIs
 * 3. `transformHash`: Model-relative Transform (size, position, 9-component rotation matrix, physical flags)
 * 4. `hierarchyHash`: Parent container identity and canonical hierarchyPath
 * 5. `combinedHash`: Deterministic combination of partId + all 4 domain hashes (+ 256-bit `integritySha256`)
 * Matches Python `AssetEngine.compute_part_sync_hashes` and Luau plugin byte-for-byte.
 */
export function computePartSyncHashes(
  part: any,
  indexFallback: number = 0,
  modelName: string = ''
): {
  schemaVersion: string;
  hashSchemaVersion: string;
  partId: string;
  parentId: string;
  parentName: string;
  parentContainerClass: 'Folder' | 'Model';
  hierarchyPath: string;
  hierarchySegments: string[];
  geometrySource: string;
  rotationMatrix: number[];
  reflectance: number;
  geometryHash: string;
  materialHash: string;
  transformHash: string;
  hierarchyHash: string;
  combinedHash: string;
  integritySha256: string;
} {
  const hier = normalizeHierarchyMetadata(part, indexFallback, modelName);
  const md = part?.meshData && typeof part.meshData === 'object' ? part.meshData : {};
  const verts: any[] = Array.isArray(md.vertices)
    ? md.vertices
    : Array.isArray(part?.vertices)
    ? part.vertices
    : [];
  const faces: any[] = Array.isArray(md.faces)
    ? md.faces
    : Array.isArray(part?.faces)
    ? part.faces
    : [];
  const norms: any[] = Array.isArray(md.normals)
    ? md.normals
    : Array.isArray(part?.normals)
    ? part.normals
    : [];
  const uvs: any[] = Array.isArray(md.uvs)
    ? md.uvs
    : Array.isArray(part?.uvs)
    ? part.uvs
    : [];

  const meshId = validatePublishedRobloxMeshId(
    part?.meshId || part?.mesh_id || md.meshId || part?.assetId || md.assetId
  );
  const rawGeomSource = String(
    part?.geometrySource || part?.geometry_source || md.geometrySource || ''
  ).trim();
  let geometrySource: string;
  if (verts.length >= 3 && faces.length >= 1) {
    geometrySource = 'EditableMeshBuffers';
  } else if (meshId) {
    geometrySource = 'PublishedCloudMeshId';
  } else if (rawGeomSource) {
    geometrySource = rawGeomSource;
  } else {
    geometrySource = 'StudioExternalUnreadable';
  }

  const geomTokens: string[] = [
    FORGE_SYNC_HASH_SCHEMA_V1,
    'geom',
    meshId,
    geometrySource,
    `vc=${verts.length}`,
    `fc=${faces.length}`,
  ];
  for (const v of verts) {
    if (Array.isArray(v) && v.length >= 3) {
      geomTokens.push(
        `v:${fmtCanonicalFixed(v[0], 4)},${fmtCanonicalFixed(v[1], 4)},${fmtCanonicalFixed(v[2], 4)}`
      );
    }
  }
  for (const n of norms) {
    if (Array.isArray(n) && n.length >= 3) {
      geomTokens.push(
        `n:${fmtCanonicalFixed(n[0], 4)},${fmtCanonicalFixed(n[1], 4)},${fmtCanonicalFixed(n[2], 4)}`
      );
    }
  }
  for (const u of uvs) {
    if (Array.isArray(u) && u.length >= 2) {
      geomTokens.push(`u:${fmtCanonicalFixed(u[0], 4)},${fmtCanonicalFixed(u[1], 4)}`);
    }
  }
  for (const f of faces) {
    if (Array.isArray(f) && f.length >= 3) {
      geomTokens.push(`f:${Math.trunc(Number(f[0] ?? 0))},${Math.trunc(Number(f[1] ?? 0))},${Math.trunc(Number(f[2] ?? 0))}`);
    }
  }
  const geometryHash = computeFnv1a32Hex(geomTokens.join('|'));

  const rgb = normalizeColorRgb255(part?.color);
  const matName = String(part?.material || 'Metal').trim() || 'Metal';
  const pbr = part?.pbrMaterial && typeof part.pbrMaterial === 'object' ? part.pbrMaterial : {};
  const roughVal =
    typeof pbr.roughness === 'number'
      ? pbr.roughness
      : part?.roughness !== undefined && part?.roughness !== null
      ? part.roughness
      : 0.35;
  const metalVal =
    typeof pbr.metalness === 'number'
      ? pbr.metalness
      : part?.metalness !== undefined && part?.metalness !== null
      ? part.metalness
      : 0.6;
  const transVal =
    part?.transparency !== undefined && part?.transparency !== null ? part.transparency : 0;
  const reflVal =
    part?.reflectance !== undefined && part?.reflectance !== null
      ? part.reflectance
      : typeof pbr.reflectance === 'number'
      ? pbr.reflectance
      : 0;
  const roughStr = fmtCanonicalFixed(roughVal, 3);
  const metalStr = fmtCanonicalFixed(metalVal, 3);
  const transpStr = fmtCanonicalFixed(transVal, 3);
  const reflStr = fmtCanonicalFixed(reflVal, 3);
  const cmap = validatePublishedRobloxMeshId(pbr.colorMapAssetId || pbr.color_map_asset_id || pbr.colorMapId);
  const nmap = validatePublishedRobloxMeshId(pbr.normalMapAssetId || pbr.normal_map_asset_id || pbr.normalMapId);
  const rmap = validatePublishedRobloxMeshId(pbr.roughnessMapAssetId || pbr.roughness_map_asset_id || pbr.roughnessMapId);
  const mmap = validatePublishedRobloxMeshId(pbr.metalnessMapAssetId || pbr.metalness_map_asset_id || pbr.metalnessMapId);
  const matTokens = [
    FORGE_SYNC_HASH_SCHEMA_V1,
    'mat',
    `${rgb[0]},${rgb[1]},${rgb[2]}`,
    matName,
    roughStr,
    metalStr,
    transpStr,
    reflStr,
    cmap,
    nmap,
    rmap,
    mmap,
  ];
  const materialHash = computeFnv1a32Hex(matTokens.join('|'));

  const sizeArr = Array.isArray(part?.size) && part.size.length >= 3 ? part.size : [2, 2, 2];
  const posArr = Array.isArray(part?.position) && part.position.length >= 3 ? part.position : [0, 1, 0];
  const rotMat9 = extractCanonicalRotationMatrix9(part);
  const sizeStr = `${fmtCanonicalFixed(sizeArr[0], 3)},${fmtCanonicalFixed(sizeArr[1], 3)},${fmtCanonicalFixed(sizeArr[2], 3)}`;
  const posStr = `${fmtCanonicalFixed(posArr[0], 3)},${fmtCanonicalFixed(posArr[1], 3)},${fmtCanonicalFixed(posArr[2], 3)}`;
  const rotMatStr = rotMat9.map((c) => fmtCanonicalFixed(c, 4)).join(',');
  const anchStr = part?.anchored === false ? '0' : '1';
  const collStr = part?.canCollide === false ? '0' : '1';
  const cfMode = String(part?.collisionFidelity || 'Hull').trim() || 'Hull';
  const transformTokens = [
    FORGE_SYNC_HASH_SCHEMA_V1,
    'xform',
    sizeStr,
    posStr,
    rotMatStr,
    anchStr,
    collStr,
    cfMode,
  ];
  const transformSig = transformTokens.join('|');
  const transformHash = computeFnv1a32Hex(transformSig);

  const hierarchyTokens = [
    FORGE_SYNC_HASH_SCHEMA_V1,
    'hier',
    hier.parentId,
    hier.parentName,
    hier.hierarchyPath,
  ];
  const hierarchySig = hierarchyTokens.join('|');
  const hierarchyHash = computeFnv1a32Hex(hierarchySig);

  const combinedSig = `${FORGE_SYNC_HASH_SCHEMA_V1}|part|${hier.partId}|${geometryHash}|${materialHash}|${transformHash}|${hierarchyHash}`;
  const combinedHash = computeFnv1a32Hex(combinedSig);
  const geomSig = geomTokens.join('|');
  const matSig = matTokens.join('|');
  const integritySha256 = crypto
    .createHash('sha256')
    .update(`${geomSig}\n${matSig}\n${transformSig}\n${hierarchySig}\n${combinedSig}`, 'utf-8')
    .digest('hex')
    .slice(0, 32);

  return {
    schemaVersion: FORGE_SYNC_HASH_SCHEMA_V1,
    hashSchemaVersion: FORGE_SYNC_HASH_SCHEMA_V1,
    partId: hier.partId,
    parentId: hier.parentId,
    parentName: hier.parentName,
    parentContainerClass: hier.parentContainerClass,
    hierarchyPath: hier.hierarchyPath,
    hierarchySegments: hier.hierarchySegments,
    geometrySource,
    rotationMatrix: rotMat9.map((c) => Number(fmtCanonicalFixed(c, 6))),
    reflectance: Number(fmtCanonicalFixed(reflVal, 4)),
    geometryHash,
    materialHash,
    transformHash,
    hierarchyHash,
    combinedHash,
    integritySha256,
  };
}

/**
 * Normalizes a part list so every part carries a stable `partId`, `parentId`, `parentName`,
 * `hierarchyPath`, `rotationMatrix`, `geometrySource`, and canonical `FORGE_SYNC_HASH_SCHEMA_V1` hashes.
 */
export function normalizePartsWithSyncMetadata(parts: any[], modelName: string = ''): any[] {
  if (!Array.isArray(parts)) return [];
  return parts.map((p, idx) => {
    const syncMeta = computePartSyncHashes(p, idx, modelName);
    const derivedRot = canonicalMatrix9ToEulerDeg(syncMeta.rotationMatrix);
    const existingRot =
      Array.isArray(p?.rotation) && p.rotation.length === 3
        ? p.rotation.map((x: any) => Number(fmtCanonicalFixed(x, 2)))
        : derivedRot;
    return {
      ...p,
      name: p?.name || `MeshPart_${idx + 1}`,
      partId: syncMeta.partId,
      parentId: syncMeta.parentId,
      parentName: syncMeta.parentName,
      parentContainerClass: syncMeta.parentContainerClass,
      hierarchyPath: syncMeta.hierarchyPath,
      hierarchySegments: syncMeta.hierarchySegments,
      geometrySource: syncMeta.geometrySource,
      rotationMatrix: syncMeta.rotationMatrix,
      rotation: existingRot,
      reflectance: syncMeta.reflectance,
      color: normalizeColorRgb255(p?.color),
      schemaVersion: syncMeta.schemaVersion,
      hashSchemaVersion: syncMeta.hashSchemaVersion,
      geometryHash: syncMeta.geometryHash,
      materialHash: syncMeta.materialHash,
      transformHash: syncMeta.transformHash,
      hierarchyHash: syncMeta.hierarchyHash,
      combinedHash: syncMeta.combinedHash,
      integritySha256: syncMeta.integritySha256,
    };
  });
}

/**
 * Computes a canonical SHA-256 snapshot digest across an asset's geometry (`parts` + `meshData`),
 * hierarchy (`hierarchyPath`), and PBR state (`pbr_profile` + per-part `pbrMaterial`) so the unified
 * persistence service never creates duplicate versions for identical states.
 */
export function computeAssetSnapshotSha256(asset: any): string {
  const parts = Array.isArray(asset?.parts) ? asset.parts : [];
  const partSummaries = parts.map((p: any, idx: number) => {
    const hashes = computePartSyncHashes(p, idx);
    return {
      partId: hashes.partId,
      name: p?.name || `MeshPart_${idx + 1}`,
      parentName: hashes.parentName,
      hierarchyPath: hashes.hierarchyPath,
      g: hashes.geometryHash,
      m: hashes.materialHash,
      t: hashes.transformHash,
      h: hashes.hierarchyHash,
    };
  });
  const canonical = JSON.stringify({
    parts: partSummaries,
    pbr_profile: asset?.pbr_profile || null,
    collision_fidelity: asset?.collision_fidelity || 'Hull',
  });
  return crypto.createHash('sha256').update(canonical, 'utf-8').digest('hex').slice(0, 16);
}

/**
 * Compares the web editor asset (`forgeAssetOrParts`) against a live Roblox Studio DataModel part list
 * (`studioParts`) using stable `partId` (`ForgePartId`) identifiers, reporting exact differences
 * across geometry, transformations, hierarchies, materials, duplicate IDs, hierarchy cycles,
 * granular incremental operations, and 3-way conflicts.
 */
export function computeDataModelSyncDiffServer(
  forgeAssetOrParts: any,
  studioParts: any[],
  optionsOrSyncScope:
    | string
    | {
        baseParts?: any[];
        syncScope?: 'selection' | 'full_model' | 'explicit_delete' | string;
        modelName?: string;
        explicitDeleteIds?: string[];
        baselineSnapshotSha256?: string | null;
      } = 'full_model',
  baselineSnapshotSha256Arg: string | null = null,
  explicitDeleteIdsArg: string[] = []
): {
  schema_version: string;
  schemaVersion: string;
  hashSchemaVersion: string;
  sync_scope: string;
  syncScope: string;
  in_sync: boolean;
  inSync: boolean;
  has_conflicts: boolean;
  hasConflicts: boolean;
  hasConflict: boolean;
  has_duplicate_ids: boolean;
  hasDuplicateIds: boolean;
  hasDuplicateStudioIds: boolean;
  has_hierarchy_cycles: boolean;
  hasHierarchyCycles: boolean;
  hierarchy_cycles: string[][];
  hierarchyCycles: string[][];
  deleted_parent_ids: string[];
  deletedParentIds: string[];
  duplicate_studio_part_ids: string[];
  duplicateStudioPartIds: string[];
  duplicate_forge_part_ids: string[];
  duplicateForgePartIds: string[];
  baselineSha256: string | null;
  currentForgeSha256: string;
  forgeModifiedSinceBaseline: boolean;
  modelName: string;
  forge_part_count: number;
  studio_part_count: number;
  totalForgeParts: number;
  totalStudioParts: number;
  matchingPartsCount: number;
  unchanged_count: number;
  unchanged_parts: string[];
  added_in_studio: string[];
  addedInStudio: string[];
  removed_in_studio: string[];
  removedInStudio: string[];
  explicitDeletedParts: string[];
  unchangedOmittedInSelection: string[];
  modified_parts: Array<any>;
  modifiedGeometry: string[];
  modifiedTransform: string[];
  modifiedHierarchy: string[];
  modifiedMaterial: string[];
  incremental_operations: Array<any>;
  incrementalOperations: Array<any>;
  conflicts: Array<any>;
  part_diffs: Array<any>;
  partDiffs: Array<any>;
} {
  const isOptionsObj =
    typeof optionsOrSyncScope === 'object' && optionsOrSyncScope !== null;
  const syncScope = isOptionsObj
    ? String(optionsOrSyncScope.syncScope || 'full_model')
    : String(optionsOrSyncScope || 'full_model');
  const modelName = isOptionsObj
    ? String(optionsOrSyncScope.modelName || (forgeAssetOrParts && !Array.isArray(forgeAssetOrParts) ? forgeAssetOrParts.name : '') || 'Model3D')
    : String((forgeAssetOrParts && !Array.isArray(forgeAssetOrParts) ? forgeAssetOrParts.name : '') || 'Model3D');
  const explicitDeleteIds = isOptionsObj
    ? optionsOrSyncScope.explicitDeleteIds || []
    : explicitDeleteIdsArg || [];
  const baselineSha = isOptionsObj
    ? String(optionsOrSyncScope.baselineSnapshotSha256 || '').trim() || null
    : String(baselineSnapshotSha256Arg || '').trim() || null;

  const rawForgeParts = Array.isArray(forgeAssetOrParts)
    ? forgeAssetOrParts
    : Array.isArray(forgeAssetOrParts?.parts)
    ? forgeAssetOrParts.parts
    : [];
  const forgeDag = validateHierarchyDag(rawForgeParts, modelName);
  const studioDag = validateHierarchyDag(studioParts || [], modelName);
  const forgeParts = normalizePartsWithSyncMetadata(rawForgeParts, modelName);
  const normStudio = normalizePartsWithSyncMetadata(studioParts || [], modelName);

  const forgeIdCounts = new Map<string, number>();
  for (const fp of forgeParts) {
    const pid = String(fp?.partId || '');
    if (pid) forgeIdCounts.set(pid, (forgeIdCounts.get(pid) || 0) + 1);
  }
  const duplicateForgePartIds = Array.from(forgeIdCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([pid]) => pid);

  const studioIdCounts = new Map<string, number>();
  for (const sp of normStudio) {
    const pid = String(sp?.partId || '');
    if (pid) {
      studioIdCounts.set(pid, (studioIdCounts.get(pid) || 0) + 1);
    }
  }
  const duplicateStudioPartIds = Array.from(studioIdCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([pid]) => pid);

  const currentForgeSha =
    !Array.isArray(forgeAssetOrParts) && forgeAssetOrParts?.snapshot_sha256
      ? forgeAssetOrParts.snapshot_sha256
      : computeAssetSnapshotSha256({ parts: forgeParts });

  const baselinePartMap = new Map<string, any>();
  const explicitBaseParts = isOptionsObj ? optionsOrSyncScope.baseParts : undefined;
  if (Array.isArray(explicitBaseParts)) {
    for (const bp of normalizePartsWithSyncMetadata(explicitBaseParts, modelName)) {
      baselinePartMap.set(String(bp.partId), bp);
    }
  } else if (baselineSha && !Array.isArray(forgeAssetOrParts) && Array.isArray(forgeAssetOrParts?.version_history)) {
    for (const snap of forgeAssetOrParts.version_history) {
      if (snap && snap.snapshot_sha256 === baselineSha) {
        for (const bp of normalizePartsWithSyncMetadata(snap.parts || [], modelName)) {
          baselinePartMap.set(String(bp.partId), bp);
        }
        break;
      }
    }
  }
  const forgeModifiedSinceBaseline =
    baselinePartMap.size > 0 || Boolean(baselineSha && baselineSha !== currentForgeSha);

  const forgeById = new Map<string, any>();
  const forgeByName = new Map<string, any>();
  for (const fp of forgeParts) {
    forgeById.set(String(fp.partId), fp);
    if (!forgeByName.has(String(fp.name))) {
      forgeByName.set(String(fp.name), fp);
    }
  }

  const explicitDeleteSet = new Set(
    (explicitDeleteIds || []).map((x) => String(x || '').trim()).filter(Boolean)
  );
  const seenForgeIds = new Set<string>();
  const addedInStudio: string[] = [];
  const removedInStudio: string[] = [];
  const explicitDeletedParts: string[] = [];
  const unchangedOmittedInSelection: string[] = [];
  const unchangedParts: string[] = [];
  const modifiedParts: Array<any> = [];
  const modifiedGeometry: string[] = [];
  const modifiedTransform: string[] = [];
  const modifiedHierarchy: string[] = [];
  const modifiedMaterial: string[] = [];
  const incrementalOperations: Array<any> = [];
  const conflicts: Array<any> = [];
  const partDiffs: Array<any> = [];
  let matchingPartsCount = 0;

  const forgeParentIds = new Set<string>(['fnode_Root', 'fnode_ModelRoot', 'root']);
  for (const fp of forgeParts) {
    forgeParentIds.add(String(fp.partId || ''));
    if (fp.parentId) forgeParentIds.add(String(fp.parentId));
  }
  const studioParentIds = new Set<string>(['fnode_Root', 'fnode_ModelRoot', 'root']);
  for (const sp of normStudio) {
    studioParentIds.add(String(sp.partId || ''));
    if (sp.parentId) studioParentIds.add(String(sp.parentId));
  }
  const deletedParentIds = Array.from(forgeParentIds).filter(
    (pid) => pid && !studioParentIds.has(pid) && pid.startsWith('fnode_')
  );

  for (const sp of normStudio) {
    let fp = forgeById.get(String(sp.partId));
    if (!fp && !seenForgeIds.has(String(sp.partId))) {
      const candidateByName = forgeByName.get(String(sp.name));
      if (candidateByName && !seenForgeIds.has(String(candidateByName.partId))) {
        fp = candidateByName;
      }
    }

    if (!fp) {
      addedInStudio.push(sp.name);
      incrementalOperations.push({
        op: 'add',
        partId: sp.partId,
        name: sp.name,
        parentId: sp.parentId,
        hierarchyPath: sp.hierarchyPath,
      });
      partDiffs.push({
        partId: sp.partId,
        name: sp.name,
        status: 'added_in_studio',
        operations: ['add'],
        geometryMatch: false,
        transformMatch: false,
        hierarchyMatch: false,
        materialMatch: false,
        studioHashes: {
          geometryHash: sp.geometryHash,
          transformHash: sp.transformHash,
          materialHash: sp.materialHash,
          hierarchyHash: sp.hierarchyHash,
          parentName: sp.parentName,
          hierarchyPath: sp.hierarchyPath,
        },
      });
      continue;
    }

    seenForgeIds.add(String(fp.partId));
    const spGeomSource = String(sp.geometrySource || 'EditableMeshBuffers');
    const geometryMatch =
      fp.geometryHash === sp.geometryHash || spGeomSource === 'StudioExternalUnreadable';
    const transformMatch = fp.transformHash === sp.transformHash;
    const hierarchyMatch =
      fp.hierarchyHash === sp.hierarchyHash &&
      fp.hierarchyPath === sp.hierarchyPath &&
      fp.parentName === sp.parentName;
    const materialMatch = fp.materialHash === sp.materialHash;

    const changes: string[] = [];
    const partOps: string[] = [];
    if (!geometryMatch) {
      modifiedGeometry.push(fp.name);
      changes.push('geometry');
      partOps.push('update_geometry');
      incrementalOperations.push({
        op: 'update_geometry',
        partId: fp.partId,
        name: fp.name,
      });
    }
    if (!transformMatch) {
      modifiedTransform.push(fp.name);
      changes.push('transform');
      partOps.push('update_transform');
      incrementalOperations.push({
        op: 'update_transform',
        partId: fp.partId,
        name: fp.name,
      });
    }
    if (!hierarchyMatch) {
      modifiedHierarchy.push(fp.name);
      changes.push('hierarchy');
      partOps.push('update_hierarchy');
      incrementalOperations.push({
        op: 'update_hierarchy',
        partId: fp.partId,
        name: fp.name,
        fromHierarchyPath: fp.hierarchyPath,
        toHierarchyPath: sp.hierarchyPath,
      });
    }
    if (!materialMatch) {
      modifiedMaterial.push(fp.name);
      changes.push('material');
      partOps.push('update_material');
      incrementalOperations.push({
        op: 'update_material',
        partId: fp.partId,
        name: fp.name,
      });
    }

    const allMatch = geometryMatch && transformMatch && hierarchyMatch && materialMatch;
    if (allMatch) {
      matchingPartsCount++;
      unchangedParts.push(fp.name);
      partOps.push('unchanged');
      incrementalOperations.push({
        op: 'unchanged',
        partId: fp.partId,
        name: fp.name,
      });
    }

    let partConflict: any = null;
    if (!allMatch && forgeModifiedSinceBaseline) {
      const bp = baselinePartMap.get(String(fp.partId)) || baselinePartMap.get(String(fp.name));
      if (bp) {
        const forgeChangedFields: string[] = [];
        const studioChangedFields: string[] = [];
        if (bp.geometryHash !== fp.geometryHash) forgeChangedFields.push('geometry');
        if (bp.materialHash !== fp.materialHash) forgeChangedFields.push('material');
        if (bp.transformHash !== fp.transformHash) forgeChangedFields.push('transform');
        if (bp.hierarchyHash !== fp.hierarchyHash) forgeChangedFields.push('hierarchy');

        if (bp.geometryHash !== sp.geometryHash && spGeomSource !== 'StudioExternalUnreadable') {
          studioChangedFields.push('geometry');
        }
        if (bp.materialHash !== sp.materialHash) studioChangedFields.push('material');
        if (bp.transformHash !== sp.transformHash) studioChangedFields.push('transform');
        if (bp.hierarchyHash !== sp.hierarchyHash) studioChangedFields.push('hierarchy');

        if (forgeChangedFields.length > 0 && studioChangedFields.length > 0) {
          partConflict = {
            partId: fp.partId,
            name: fp.name,
            changes,
            modified_fields: {
              forge: forgeChangedFields,
              studio: studioChangedFields,
              overlapping: forgeChangedFields.filter((f) => studioChangedFields.includes(f)),
            },
            last_known_common_version: {
              snapshotSha256: baselineSha,
              geometryHash: bp.geometryHash,
              materialHash: bp.materialHash,
              transformHash: bp.transformHash,
              hierarchyHash: bp.hierarchyHash,
            },
            forge_version: {
              snapshotSha256: currentForgeSha,
              geometryHash: fp.geometryHash,
              materialHash: fp.materialHash,
              transformHash: fp.transformHash,
              hierarchyHash: fp.hierarchyHash,
            },
            studio_version: {
              geometryHash: sp.geometryHash,
              materialHash: sp.materialHash,
              transformHash: sp.transformHash,
              hierarchyHash: sp.hierarchyHash,
            },
            hasConflict: true,
            reason: 'both_modified_since_baseline',
            baselineSha256: baselineSha,
            currentForgeSha256: currentForgeSha,
          };
          conflicts.push(partConflict);
        }
      } else if (baselineSha) {
        partConflict = {
          partId: fp.partId,
          name: fp.name,
          changes,
          modified_fields: {
            forge: changes,
            studio: changes,
            overlapping: changes,
          },
          last_known_common_version: { snapshotSha256: baselineSha },
          forge_version: {
            snapshotSha256: currentForgeSha,
            geometryHash: fp.geometryHash,
            materialHash: fp.materialHash,
            transformHash: fp.transformHash,
            hierarchyHash: fp.hierarchyHash,
          },
          studio_version: {
            geometryHash: sp.geometryHash,
            materialHash: sp.materialHash,
            transformHash: sp.transformHash,
            hierarchyHash: sp.hierarchyHash,
          },
          hasConflict: true,
          reason: 'baseline_mismatch_concurrent_edit',
          baselineSha256: baselineSha,
          currentForgeSha256: currentForgeSha,
        };
        conflicts.push(partConflict);
      }
    }

    const forgeHashesObj = {
      geometryHash: fp.geometryHash,
      transformHash: fp.transformHash,
      materialHash: fp.materialHash,
      hierarchyHash: fp.hierarchyHash,
      parentName: fp.parentName,
      hierarchyPath: fp.hierarchyPath,
    };
    const studioHashesObj = {
      geometryHash: sp.geometryHash,
      transformHash: sp.transformHash,
      materialHash: sp.materialHash,
      hierarchyHash: sp.hierarchyHash,
      parentName: sp.parentName,
      hierarchyPath: sp.hierarchyPath,
    };

    if (!allMatch) {
      modifiedParts.push({
        partId: fp.partId,
        name: fp.name,
        changes,
        operations: partOps,
        hasConflict: Boolean(partConflict),
        forgeHashes: forgeHashesObj,
        studioHashes: studioHashesObj,
      });
    }

    partDiffs.push({
      partId: fp.partId,
      name: fp.name,
      status: partConflict ? 'conflict' : allMatch ? 'in_sync' : 'modified',
      operations: partOps,
      geometryMatch,
      transformMatch,
      hierarchyMatch,
      materialMatch,
      conflict: partConflict,
      forgeHashes: forgeHashesObj,
      studioHashes: studioHashesObj,
    });
  }

  for (const fp of forgeParts) {
    if (!seenForgeIds.has(String(fp.partId))) {
      const isExplicitDelete =
        explicitDeleteSet.has(String(fp.partId)) ||
        explicitDeleteSet.has(String(fp.name)) ||
        syncScope === 'explicit_delete';
      if (isExplicitDelete) {
        explicitDeletedParts.push(fp.name);
        removedInStudio.push(fp.name);
        incrementalOperations.push({
          op: 'delete',
          partId: fp.partId,
          name: fp.name,
          explicit: true,
        });
        partDiffs.push({
          partId: fp.partId,
          name: fp.name,
          status: 'explicitly_deleted_in_studio',
          operations: ['delete'],
          geometryMatch: false,
          transformMatch: false,
          hierarchyMatch: false,
          materialMatch: false,
          forgeHashes: {
            geometryHash: fp.geometryHash,
            transformHash: fp.transformHash,
            materialHash: fp.materialHash,
            hierarchyHash: fp.hierarchyHash,
            parentName: fp.parentName,
            hierarchyPath: fp.hierarchyPath,
          },
        });
      } else if (syncScope === 'selection') {
        unchangedOmittedInSelection.push(fp.name);
        unchangedParts.push(fp.name);
        matchingPartsCount++;
        incrementalOperations.push({
          op: 'unchanged',
          partId: fp.partId,
          name: fp.name,
          omittedInSelection: true,
        });
        partDiffs.push({
          partId: fp.partId,
          name: fp.name,
          status: 'omitted_in_selection',
          operations: ['unchanged'],
          geometryMatch: true,
          transformMatch: true,
          hierarchyMatch: true,
          materialMatch: true,
          forgeHashes: {
            geometryHash: fp.geometryHash,
            transformHash: fp.transformHash,
            materialHash: fp.materialHash,
            hierarchyHash: fp.hierarchyHash,
            parentName: fp.parentName,
            hierarchyPath: fp.hierarchyPath,
          },
        });
      } else {
        removedInStudio.push(fp.name);
        incrementalOperations.push({
          op: 'delete',
          partId: fp.partId,
          name: fp.name,
          explicit: false,
        });
        partDiffs.push({
          partId: fp.partId,
          name: fp.name,
          status: 'missing_in_studio',
          operations: ['delete'],
          geometryMatch: false,
          transformMatch: false,
          hierarchyMatch: false,
          materialMatch: false,
          forgeHashes: {
            geometryHash: fp.geometryHash,
            transformHash: fp.transformHash,
            materialHash: fp.materialHash,
            hierarchyHash: fp.hierarchyHash,
            parentName: fp.parentName,
            hierarchyPath: fp.hierarchyPath,
          },
        });
      }
    }
  }

  const allHierarchyCycles = [...forgeDag.cycles, ...studioDag.cycles];
  const hasHierarchyCycles = allHierarchyCycles.length > 0;
  const hasDuplicateIds =
    duplicateStudioPartIds.length > 0 || duplicateForgePartIds.length > 0;
  const inSync =
    !hasDuplicateIds &&
    !hasHierarchyCycles &&
    conflicts.length === 0 &&
    addedInStudio.length === 0 &&
    removedInStudio.length === 0 &&
    modifiedParts.length === 0;

  return {
    schema_version: FORGE_SYNC_HASH_SCHEMA_V1,
    schemaVersion: FORGE_SYNC_HASH_SCHEMA_V1,
    hashSchemaVersion: FORGE_SYNC_HASH_SCHEMA_V1,
    sync_scope: syncScope,
    syncScope,
    in_sync: inSync,
    inSync,
    has_conflicts: conflicts.length > 0,
    hasConflicts: conflicts.length > 0,
    hasConflict: conflicts.length > 0,
    has_duplicate_ids: hasDuplicateIds,
    hasDuplicateIds,
    hasDuplicateStudioIds: duplicateStudioPartIds.length > 0,
    has_hierarchy_cycles: hasHierarchyCycles,
    hasHierarchyCycles,
    hierarchy_cycles: allHierarchyCycles,
    hierarchyCycles: allHierarchyCycles,
    deleted_parent_ids: deletedParentIds,
    deletedParentIds,
    duplicate_studio_part_ids: duplicateStudioPartIds,
    duplicateStudioPartIds,
    duplicate_forge_part_ids: duplicateForgePartIds,
    duplicateForgePartIds,
    baselineSha256: baselineSha,
    currentForgeSha256: currentForgeSha,
    forgeModifiedSinceBaseline,
    modelName,
    forge_part_count: forgeParts.length,
    studio_part_count: normStudio.length,
    totalForgeParts: forgeParts.length,
    totalStudioParts: normStudio.length,
    matchingPartsCount,
    unchanged_count: unchangedParts.length,
    unchanged_parts: unchangedParts,
    added_in_studio: addedInStudio,
    addedInStudio,
    removed_in_studio: removedInStudio,
    removedInStudio,
    explicitDeletedParts,
    unchangedOmittedInSelection,
    modified_parts: modifiedParts,
    modifiedGeometry,
    modifiedTransform,
    modifiedHierarchy,
    modifiedMaterial,
    incremental_operations: incrementalOperations,
    incrementalOperations,
    conflicts,
    part_diffs: partDiffs,
    partDiffs,
  };
}

/**
 * UNIFIED PERSISTENCE SERVICE (TypeScript Server Parity with Python `AssetEngine`):
 * Single authoritative service for loading, upserting (with 20 SHA-256 deduplicated snapshots),
 * restoring versions, and deleting assets in `assets_library.json` using atomic `.tmp` + `renameSync`.
 */
export function loadAssetsLibraryServer(libraryFilePath: string): any[] {
  if (!fs.existsSync(libraryFilePath)) {
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(libraryFilePath, 'utf-8'));
    return Array.isArray(raw) ? raw : Array.isArray(raw?.assets) ? raw.assets : [];
  } catch (err: any) {
    console.error(
      `[Forge:AssetLibrary] Error leyendo JSON corrupto en '${libraryFilePath}': ${err?.message || err}`
    );
    return [];
  }
}

export function saveAssetsLibraryServer(
  libraryFilePath: string,
  assets: any[],
  options?: { beforeRenameHook?: (tmpPath: string) => void }
): void {
  fs.mkdirSync(path.dirname(libraryFilePath), { recursive: true });
  const tmpPath = `${libraryFilePath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2, 8)}.tmp`;
  let fd: number | null = null;
  try {
    const serialized = JSON.stringify(assets, null, 2);
    fd = fs.openSync(tmpPath, 'w', 0o600);
    fs.writeFileSync(fd, serialized, 'utf-8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    if (options?.beforeRenameHook) {
      options.beforeRenameHook(tmpPath);
    }
    fs.renameSync(tmpPath, libraryFilePath);
  } catch (err: any) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close failure on cleanup path
      }
    }
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // ignore unlink failure on cleanup path
    }
    throw new Error(`Fallo atómico al guardar biblioteca en '${libraryFilePath}': ${err?.message || err}`);
  }
}

export function getAssetFromLibraryServer(libraryFilePath: string, assetIdOrName: string): any | null {
  if (!assetIdOrName) return null;
  const assets = loadAssetsLibraryServer(libraryFilePath);
  return (
    assets.find(
      (a: any) => String(a?.id) === String(assetIdOrName) || String(a?.name) === String(assetIdOrName)
    ) || null
  );
}

export function upsertAssetInLibraryServer(libraryFilePath: string, assetData: any): any {
  const assets = loadAssetsLibraryServer(libraryFilePath);
  const nowIso = new Date().toISOString();
  if (!assetData.id) {
    assetData.id = `asset-${Date.now()}`;
  }
  if (!assetData.created_at) {
    assetData.created_at = nowIso;
  }

  assetData.parts = normalizePartsWithSyncMetadata(assetData.parts || []);
  const incomingSha = computeAssetSnapshotSha256(assetData);
  assetData.snapshot_sha256 = incomingSha;

  const existingIdx = assets.findIndex(
    (a: any) => a.id === assetData.id || (assetData.name && a.name === assetData.name)
  );

  if (existingIdx >= 0) {
    const existing = assets[existingIdx];
    let history = Array.isArray(existing.version_history) ? [...existing.version_history] : [];
    const prevVersion = Number(existing.version || history.length || 1);
    const existingSha = existing.snapshot_sha256 || computeAssetSnapshotSha256(existing);

    if (existingSha !== incomingSha) {
      const snapshotParts = JSON.parse(JSON.stringify(existing.parts || []));
      const snapshotPbr = JSON.parse(JSON.stringify(existing.pbr_profile || {}));
      const snapshot = {
        version: prevVersion,
        timestamp: existing.updated_at || existing.created_at || nowIso,
        poly_count: Number(existing.poly_count || 0),
        part_count: snapshotParts.length,
        collision_fidelity: String(existing.collision_fidelity || 'Hull'),
        description: String(existing.description || ''),
        pbr_profile: snapshotPbr,
        luau_code: String(existing.luau_code || ''),
        parts: snapshotParts,
        snapshot_sha256: existingSha,
      };
      history = history.filter(
        (h: any) => Number(h?.version) !== prevVersion && h?.snapshot_sha256 !== existingSha
      );
      history.unshift(snapshot);
      assetData.version = prevVersion + 1;
    } else {
      assetData.version = prevVersion;
    }

    assetData.version_history = history.slice(0, 20);
    assetData.created_at = existing.created_at || nowIso;
    assetData.updated_at = nowIso;
    assets[existingIdx] = assetData;
  } else {
    assetData.version = 1;
    assetData.updated_at = nowIso;
    const initParts = JSON.parse(JSON.stringify(assetData.parts || []));
    const initPbr = JSON.parse(JSON.stringify(assetData.pbr_profile || {}));
    assetData.version_history = [
      {
        version: 1,
        timestamp: assetData.created_at,
        poly_count: Number(assetData.poly_count || 0),
        part_count: initParts.length,
        collision_fidelity: String(assetData.collision_fidelity || 'Hull'),
        description: String(assetData.description || ''),
        pbr_profile: initPbr,
        luau_code: String(assetData.luau_code || ''),
        parts: initParts,
        snapshot_sha256: incomingSha,
      },
    ];
    assets.unshift(assetData);
  }

  saveAssetsLibraryServer(libraryFilePath, assets);
  return assetData;
}

export function restoreAssetVersionServer(
  libraryFilePath: string,
  assetIdOrName: string,
  targetVersion: number
): any | null {
  const assets = loadAssetsLibraryServer(libraryFilePath);
  const idx = assets.findIndex(
    (a: any) => String(a?.id) === String(assetIdOrName) || String(a?.name) === String(assetIdOrName)
  );
  if (idx < 0) return null;

  const targetAsset = assets[idx];
  const history: any[] = Array.isArray(targetAsset.version_history)
    ? [...targetAsset.version_history]
    : [];
  const snap = history.find((h: any) => Number(h?.version) === Number(targetVersion));
  if (!snap) return null;

  const nowIso = new Date().toISOString();
  const currVersion = Number(targetAsset.version || 1);
  const currSha = targetAsset.snapshot_sha256 || computeAssetSnapshotSha256(targetAsset);

  if (!history.some((h: any) => h?.snapshot_sha256 === currSha)) {
    const currPartsClone = JSON.parse(JSON.stringify(targetAsset.parts || []));
    const currPbrClone = JSON.parse(JSON.stringify(targetAsset.pbr_profile || {}));
    history.unshift({
      version: currVersion,
      timestamp: targetAsset.updated_at || nowIso,
      poly_count: Number(targetAsset.poly_count || 0),
      part_count: currPartsClone.length,
      collision_fidelity: String(targetAsset.collision_fidelity || 'Hull'),
      description: String(targetAsset.description || ''),
      pbr_profile: currPbrClone,
      luau_code: String(targetAsset.luau_code || ''),
      parts: currPartsClone,
      snapshot_sha256: currSha,
    });
  }

  const restoredParts = normalizePartsWithSyncMetadata(
    JSON.parse(JSON.stringify(snap.parts || []))
  );
  const restoredPbr = JSON.parse(
    JSON.stringify(snap.pbr_profile || targetAsset.pbr_profile || {})
  );
  const maxVer = Math.max(currVersion, ...history.map((h: any) => Number(h?.version || 1)));

  targetAsset.parts = restoredParts;
  targetAsset.pbr_profile = restoredPbr;
  targetAsset.poly_count = Number(snap.poly_count ?? targetAsset.poly_count ?? 0);
  targetAsset.collision_fidelity = String(
    snap.collision_fidelity || targetAsset.collision_fidelity || 'Hull'
  );
  targetAsset.luau_code = String(snap.luau_code || targetAsset.luau_code || '');
  if (snap.description) {
    targetAsset.description = String(snap.description);
  }
  targetAsset.version = maxVer + 1;
  targetAsset.restored_from_version = Number(targetVersion);
  targetAsset.updated_at = nowIso;
  targetAsset.snapshot_sha256 = computeAssetSnapshotSha256(targetAsset);
  targetAsset.version_history = history.slice(0, 20);

  assets[idx] = targetAsset;
  saveAssetsLibraryServer(libraryFilePath, assets);
  return targetAsset;
}

export function deleteAssetFromLibraryServer(libraryFilePath: string, assetId: string): boolean {
  const assets = loadAssetsLibraryServer(libraryFilePath);
  const filtered = assets.filter((a: any) => a.id !== assetId && a.name !== assetId);
  if (filtered.length === assets.length) return false;
  saveAssetsLibraryServer(libraryFilePath, filtered);
  return true;
}

/**
 * Validates a binary PNG buffer (8-byte PNG signature, IHDR dimensions, bitDepth, colorType,
 * PLTE/tRNS chunks for indexed-color PNGs, and zlib IDAT stream), unfilters the scanlines,
 * and downsamples the real pixels into an RGBA preview buffer (`rgbaPreviewB64`)
 * for `AssetService:CreateEditableImage` in Roblox Studio.
 */
export function validateAndDecodePngBuffer(
  pngBuffer: Buffer,
  targetPreviewSize: number = 32
): DecodedPngValidationResult {
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length < 33) {
    return {
      valid: false,
      width: 0,
      height: 0,
      bitDepth: 0,
      colorType: 0,
      byteLength: pngBuffer ? pngBuffer.length : 0,
      sha256: '',
      rgbaPreviewB64: '',
      previewSize: targetPreviewSize,
      error: 'Buffer PNG vacío o truncado (< 33 bytes).',
    };
  }

  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!pngBuffer.subarray(0, 8).equals(PNG_SIG)) {
    return {
      valid: false,
      width: 0,
      height: 0,
      bitDepth: 0,
      colorType: 0,
      byteLength: pngBuffer.length,
      sha256: '',
      rgbaPreviewB64: '',
      previewSize: targetPreviewSize,
      error: 'Firma mágica PNG inválida (no comienza con 89 50 4E 47).',
    };
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlaceMethod = 0;
  let plteChunk: Buffer | null = null;
  let trnsChunk: Buffer | null = null;
  const idatChunks: Buffer[] = [];

  while (offset + 8 <= pngBuffer.length) {
    const length = pngBuffer.readUInt32BE(offset);
    const chunkType = pngBuffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > pngBuffer.length) {
      return {
        valid: false,
        width,
        height,
        bitDepth,
        colorType,
        byteLength: pngBuffer.length,
        sha256: '',
        rgbaPreviewB64: '',
        previewSize: targetPreviewSize,
        error: `Chunk PNG '${chunkType}' truncado.`,
      };
    }
    const chunkData = pngBuffer.subarray(dataStart, dataEnd);
    if (chunkType === 'IHDR' && length >= 13) {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData.readUInt8(8);
      colorType = chunkData.readUInt8(9);
      interlaceMethod = chunkData.readUInt8(12);
    } else if (chunkType === 'PLTE') {
      plteChunk = chunkData;
    } else if (chunkType === 'tRNS') {
      trnsChunk = chunkData;
    } else if (chunkType === 'IDAT') {
      idatChunks.push(chunkData);
    } else if (chunkType === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width <= 0 || height <= 0 || width > 4096 || height > 4096 || idatChunks.length === 0) {
    return {
      valid: false,
      width,
      height,
      bitDepth,
      colorType,
      byteLength: pngBuffer.length,
      sha256: '',
      rgbaPreviewB64: '',
      previewSize: targetPreviewSize,
      error:
        width > 4096 || height > 4096
          ? `Dimensiones PNG (${width}x${height}) exceden el límite de 4096x4096 de Roblox SurfaceAppearance.`
          : 'PNG sin dimensiones IHDR válidas o sin bloques IDAT.',
    };
  }

  const allowedDepthsByColorType: Record<number, number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (!allowedDepthsByColorType[colorType] || !allowedDepthsByColorType[colorType].includes(bitDepth)) {
    return {
      valid: false,
      width,
      height,
      bitDepth,
      colorType,
      byteLength: pngBuffer.length,
      sha256: '',
      rgbaPreviewB64: '',
      previewSize: targetPreviewSize,
      error: `Combinación PNG no estándar (colorType=${colorType}, bitDepth=${bitDepth}).`,
    };
  }

  if (colorType === 3 && (!plteChunk || plteChunk.length < 3 || plteChunk.length % 3 !== 0)) {
    return {
      valid: false,
      width,
      height,
      bitDepth,
      colorType,
      byteLength: pngBuffer.length,
      sha256: '',
      rgbaPreviewB64: '',
      previewSize: targetPreviewSize,
      error: 'PNG indexado (color_type=3) carece de tabla de paleta PLTE válida.',
    };
  }

  const sha256 = crypto.createHash('sha256').update(pngBuffer).digest('hex').slice(0, 16);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const stride = Math.ceil((width * bitsPerPixel) / 8);

  try {
    const compressed = Buffer.concat(idatChunks);
    const rawScanlines = zlib.inflateSync(compressed);
    const expectedBytes = height * (1 + stride);
    const previewBytes = Buffer.alloc(targetPreviewSize * targetPreviewSize * 4);

    if (interlaceMethod === 0 && rawScanlines.length >= expectedBytes) {
      const recon = Buffer.alloc(height * stride);
      for (let y = 0; y < height; y++) {
        const filterType = rawScanlines[y * (1 + stride)];
        const rowIn = y * (1 + stride) + 1;
        const rowOut = y * stride;
        for (let i = 0; i < stride; i++) {
          const xByte = rawScanlines[rowIn + i];
          const a = i >= bpp ? recon[rowOut + i - bpp] : 0;
          const b = y > 0 ? recon[rowOut - stride + i] : 0;
          const c = y > 0 && i >= bpp ? recon[rowOut - stride + i - bpp] : 0;
          let val = xByte;
          if (filterType === 1) {
            val = (xByte + a) & 0xff;
          } else if (filterType === 2) {
            val = (xByte + b) & 0xff;
          } else if (filterType === 3) {
            val = (xByte + ((a + b) >> 1)) & 0xff;
          } else if (filterType === 4) {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            val = (xByte + pr) & 0xff;
          }
          recon[rowOut + i] = val;
        }
      }

      const sampleSubByte = (rowOffset: number, x: number): number => {
        if (bitDepth === 8) return recon[rowOffset + x];
        if (bitDepth === 16) return recon[rowOffset + x * 2];
        const pixelsPerByte = Math.floor(8 / bitDepth);
        const byteIdx = rowOffset + Math.floor(x / pixelsPerByte);
        const shift = (pixelsPerByte - 1 - (x % pixelsPerByte)) * bitDepth;
        const mask = (1 << bitDepth) - 1;
        return (recon[byteIdx] >> shift) & mask;
      };

      for (let py = 0; py < targetPreviewSize; py++) {
        const sy = Math.min(height - 1, Math.floor((py * height) / targetPreviewSize));
        const rowOffset = sy * stride;
        for (let px = 0; px < targetPreviewSize; px++) {
          const sx = Math.min(width - 1, Math.floor((px * width) / targetPreviewSize));
          const dstIdx = (py * targetPreviewSize + px) * 4;
          const bytesPerChannel = bitDepth === 16 ? 2 : 1;

          if (colorType === 6) {
            const srcIdx = rowOffset + sx * 4 * bytesPerChannel;
            previewBytes[dstIdx] = recon[srcIdx];
            previewBytes[dstIdx + 1] = recon[srcIdx + bytesPerChannel];
            previewBytes[dstIdx + 2] = recon[srcIdx + 2 * bytesPerChannel];
            previewBytes[dstIdx + 3] = recon[srcIdx + 3 * bytesPerChannel];
          } else if (colorType === 2) {
            const srcIdx = rowOffset + sx * 3 * bytesPerChannel;
            previewBytes[dstIdx] = recon[srcIdx];
            previewBytes[dstIdx + 1] = recon[srcIdx + bytesPerChannel];
            previewBytes[dstIdx + 2] = recon[srcIdx + 2 * bytesPerChannel];
            previewBytes[dstIdx + 3] = 255;
          } else if (colorType === 4) {
            const srcIdx = rowOffset + sx * 2 * bytesPerChannel;
            const lum = recon[srcIdx];
            const alpha = recon[srcIdx + bytesPerChannel];
            previewBytes[dstIdx] = lum;
            previewBytes[dstIdx + 1] = lum;
            previewBytes[dstIdx + 2] = lum;
            previewBytes[dstIdx + 3] = alpha;
          } else if (colorType === 3 && plteChunk) {
            const palIdx = sampleSubByte(rowOffset, sx);
            const palOffset = Math.min(plteChunk.length - 3, palIdx * 3);
            previewBytes[dstIdx] = plteChunk[palOffset] ?? 128;
            previewBytes[dstIdx + 1] = plteChunk[palOffset + 1] ?? 128;
            previewBytes[dstIdx + 2] = plteChunk[palOffset + 2] ?? 128;
            previewBytes[dstIdx + 3] =
              trnsChunk && palIdx < trnsChunk.length ? trnsChunk[palIdx] : 255;
          } else {
            const rawSample = sampleSubByte(rowOffset, sx);
            const maxVal = bitDepth < 8 ? (1 << bitDepth) - 1 : 255;
            const lum = bitDepth < 8 ? Math.round((rawSample * 255) / maxVal) : rawSample;
            previewBytes[dstIdx] = lum;
            previewBytes[dstIdx + 1] = lum;
            previewBytes[dstIdx + 2] = lum;
            previewBytes[dstIdx + 3] = 255;
          }
        }
      }
    } else {
      for (let i = 0; i < previewBytes.length; i += 4) {
        previewBytes[i] = rawScanlines[i % rawScanlines.length] || 128;
        previewBytes[i + 1] = rawScanlines[(i + 1) % rawScanlines.length] || 128;
        previewBytes[i + 2] = rawScanlines[(i + 2) % rawScanlines.length] || 128;
        previewBytes[i + 3] = 255;
      }
    }

    let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
    const totalPx = targetPreviewSize * targetPreviewSize;
    for (let i = 0; i < previewBytes.length; i += 4) {
      rSum += previewBytes[i];
      gSum += previewBytes[i + 1];
      bSum += previewBytes[i + 2];
      aSum += previewBytes[i + 3];
    }

    return {
      valid: true,
      width,
      height,
      bitDepth,
      colorType,
      interlaceMethod,
      hasPalette: Boolean(plteChunk),
      byteLength: pngBuffer.length,
      sha256,
      rgbaPreviewB64: previewBytes.toString('base64'),
      previewSize: targetPreviewSize,
      meanRgba: [
        Math.round(rSum / totalPx),
        Math.round(gSum / totalPx),
        Math.round(bSum / totalPx),
        Math.round(aSum / totalPx),
      ],
    };
  } catch (err: any) {
    return {
      valid: false,
      width,
      height,
      bitDepth,
      colorType,
      byteLength: pngBuffer.length,
      sha256,
      rgbaPreviewB64: '',
      previewSize: targetPreviewSize,
      error: `Error descomprimiendo flujo zlib IDAT del PNG: ${err?.message || String(err)}`,
    };
  }
}

function escapeXmlServer(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXmlServer(str: string): string {
  return String(str)
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

export function eulerDegToRotationMatrixServer(rxDeg: number, ryDeg: number, rzDeg: number): number[] {
  const rx = (rxDeg * Math.PI) / 180;
  const ry = (ryDeg * Math.PI) / 180;
  const rz = (rzDeg * Math.PI) / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cy * cz,
    -cy * sz,
    sy,
    sx * sy * cz + cx * sz,
    -sx * sy * sz + cx * cz,
    -sx * cy,
    -cx * sy * cz + sx * sz,
    cx * sy * sz + sx * cz,
    cx * cy,
  ];
}

export function rotationMatrixToEulerDegServer(m: number[]): [number, number, number] {
  const [r00 = 1, r01 = 0, r02 = 0, r10 = 0, r11 = 1, r12 = 0, , , r22 = 1] = m;
  const sy = Math.max(-1, Math.min(1, r02));
  const ry = Math.asin(sy);
  let rx = 0;
  let rz = 0;
  if (Math.abs(r02) < 0.99999) {
    rx = Math.atan2(-r12, r22);
    rz = Math.atan2(-r01, r00);
  } else {
    rx = Math.atan2(r10, r11);
    rz = 0;
  }
  const toDeg = (rad: number) => Number(((rad * 180) / Math.PI).toFixed(2));
  return [toDeg(rx), toDeg(ry), toDeg(rz)];
}

export function buildRbxmxFromPartsServer(
  modelName: string,
  parts: MeshPartInput[],
  collisionFidelity: string = 'Hull',
  category: string = '3D Asset',
  luauCodeOverride?: string
): string {
  const safeName = modelName.replace(/[^a-zA-Z0-9_]/g, '') || 'ForgeModel3D';
  const robloxMaterialEnum: Record<string, number> = {
    SmoothPlastic: 256,
    Metal: 1088,
    Neon: 1584,
    Glass: 1568,
    ForceField: 1588,
    DiamondPlate: 1056,
    CorrodedMetal: 1040,
    Foil: 1072,
    Concrete: 816,
    Slate: 800,
    Granite: 832,
    Brick: 848,
    Marble: 784,
    Cobblestone: 864,
    Wood: 512,
    WoodPlanks: 528,
    Fabric: 1312,
    Sand: 1296,
    Ice: 1536,
    Grass: 1280,
  };
  const cfEnumMap: Record<string, number> = {
    Box: 0,
    Hull: 1,
    Default: 2,
    PreciseConvexDecomposition: 3,
  };

  const expandedParts: MeshPartInput[] = [];
  parts.forEach((p, idx) => {
    const [sx = 2, sy = 2, sz = 2] = p.size || [2, 2, 2];
    const resolvedMesh = extractGeometryFromProcessedMesh(
      { ...p, studSize: [sx, sy, sz] },
      `${safeName}.obj`,
      safeName
    );
    const basePart: MeshPartInput = {
      ...p,
      name: p.name || `MeshPart_${idx + 1}`,
      shape: 'MeshPart',
      meshId: validatePublishedRobloxMeshId(p.meshId || resolvedMesh.meshId),
      assetId: validatePublishedRobloxMeshId(p.assetId || resolvedMesh.assetId),
      meshData: resolvedMesh,
    };
    expandedParts.push(...splitOversizedMeshPartInput(basePart));
  });

  const reconstructorLuau =
    luauCodeOverride || buildStrictLuauFromEditedParts(safeName, expandedParts, collisionFidelity);

  const autoRunnerLuau = [
    '--!strict',
    `-- Auto-Executed Geometry Reconstructor for ${safeName} (.RBXMX Import / Studio / Runtime)`,
    'local model = script.Parent',
    'if model and model:IsA("Model") and not model:GetAttribute("ForgeEditableMeshReconstructed") then',
    '    local reconstructorModule = model:FindFirstChild("ForgeStudioReconstructor")',
    '    if reconstructorModule and reconstructorModule:IsA("ModuleScript") then',
    '        local ok, builder = pcall(require, reconstructorModule)',
    '        if ok and type(builder) == "table" and type(builder.ReconstructInPlace) == "function" then',
    '            local okRun, r1, r2, r3 = xpcall(function()',
    '                return builder.ReconstructInPlace(model)',
    '            end, debug.traceback)',
    '            if okRun then',
    '                local count = if type(r1) == "number" then r1 else (if type(r2) == "number" then r2 else 0)',
    '                local allOk = if type(r2) == "boolean" then r2 else (if type(r1) == "boolean" then r1 else (count > 0))',
    '                model:SetAttribute("ForgeEditableMeshReconstructed", allOk)',
    '                model:SetAttribute("ForgeReconstructionVerified", allOk)',
    '                model:SetAttribute("ForgeReconstructedPartCount", count)',
    '            else',
    '                warn("[ForgeAI .RBXMX Reconstructor] Error reconstructing EditableMesh:", r1)',
    '            end',
    '        end',
    '    end',
    'end',
  ].join('\n');

  const lines: string[] = [
    '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">',
    '  <Meta name="ExplicitAutoJoints">true</Meta>',
    '  <External>null</External>',
    '  <External>nil</External>',
    '  <Item class="Model" referent="RBX_MODEL_ROOT">',
    '    <Properties>',
    `      <string name="Name">${escapeXmlServer(safeName)}</string>`,
    '      <Ref name="PrimaryPart">RBX_PART_1</Ref>',
    '    </Properties>',
  ];

  const renderMeshPartXml = (p: MeshPartInput, idx: number, indent: string = '    '): string[] => {
    const refId = `RBX_PART_${idx + 1}`;
    const [sx = 2, sy = 2, sz = 2] = p.size || [2, 2, 2];
    const [px = 0, py = 1, pz = 0] = p.position || [0, 1, 0];
    const [cr = 148, cg = 163, cb = 184] = normalizeColorRgb255(p.color);
    const syncMeta = computePartSyncHashes(p, idx);
    const rotMat = syncMeta.rotationMatrix;
    const derivedRot = canonicalMatrix9ToEulerDeg(rotMat);
    const [rx = 0, ry = 0, rz = 0] =
      Array.isArray(p.rotation) && p.rotation.length === 3 ? p.rotation : derivedRot;
    const matToken = robloxMaterialEnum[p.material] ?? 1088;
    const cfToken = cfEnumMap[p.collisionFidelity || collisionFidelity] ?? 1;
    const validMeshId = validatePublishedRobloxMeshId(p.meshId || p.meshData?.meshId);
    const validTexId = validatePublishedRobloxMeshId(p.textureId);

    const hasExplicitBuffers =
      p.meshData && Array.isArray(p.meshData.vertices) && p.meshData.vertices.length > 0;
    const md = hasExplicitBuffers
      ? p.meshData!
      : validMeshId || syncMeta.geometrySource === 'StudioExternalUnreadable'
      ? { vertices: [], normals: [], uvs: [], faces: [], indices: [] }
      : synthesizeProceduralMeshData('MeshPart', [sx, sy, sz]);

    const pbr = (p as any).pbrMaterial || {};
    const validColorMap = validatePublishedRobloxMeshId(pbr.colorMapAssetId || pbr.color_map_asset_id);
    const validNormalMap = validatePublishedRobloxMeshId(pbr.normalMapAssetId || pbr.normal_map_asset_id);
    const validRoughMap = validatePublishedRobloxMeshId(pbr.roughnessMapAssetId || pbr.roughness_map_asset_id);
    const validMetalMap = validatePublishedRobloxMeshId(pbr.metalnessMapAssetId || pbr.metalness_map_asset_id);

    const serializedMeshJson = JSON.stringify({
      hashSchemaVersion: syncMeta.hashSchemaVersion,
      partId: syncMeta.partId,
      parentId: syncMeta.parentId,
      parentName: syncMeta.parentName,
      parentContainerClass: syncMeta.parentContainerClass,
      hierarchyPath: syncMeta.hierarchyPath,
      geometrySource: syncMeta.geometrySource,
      geometryHash: syncMeta.geometryHash,
      materialHash: syncMeta.materialHash,
      transformHash: syncMeta.transformHash,
      hierarchyHash: syncMeta.hierarchyHash,
      combinedHash: syncMeta.combinedHash,
      publishedMeshId: validMeshId || undefined,
      meshId: validMeshId || undefined,
      textureId: validTexId || undefined,
      vertices: md.vertices,
      normals: md.normals,
      uvs: md.uvs,
      faces: md.faces,
      size: [sx, sy, sz],
      position: [px, py, pz],
      rotation: [rx, ry, rz],
      rotationMatrix: rotMat,
      color: [cr, cg, cb],
      material: p.material,
      roughness: p.roughness,
      metalness: p.metalness,
      reflectance: syncMeta.reflectance,
      transparency: p.transparency,
      canCollide: p.canCollide,
      anchored: p.anchored,
      collisionFidelity: p.collisionFidelity || collisionFidelity,
      pbrMaterial: (p as any).pbrMaterial || undefined,
    });

    const reflFloat =
      (p as any).reflectance !== undefined && (p as any).reflectance !== null
        ? Number((p as any).reflectance)
        : Number(p.metalness ?? 0.5) * 0.35;

    return [
      `${indent}<Item class="MeshPart" referent="${refId}">`,
      `${indent}  <Properties>`,
      `${indent}    <string name="Name">${escapeXmlServer(p.name || `MeshPart_${idx + 1}`)}</string>`,
      `${indent}    <bool name="Anchored">${p.anchored !== false ? 'true' : 'false'}</bool>`,
      `${indent}    <bool name="CanCollide">${p.canCollide !== false ? 'true' : 'false'}</bool>`,
      `${indent}    <token name="CollisionFidelity">${cfToken}</token>`,
      `${indent}    <token name="RenderFidelity">1</token>`,
      `${indent}    <token name="Material">${matToken}</token>`,
      `${indent}    <float name="Transparency">${Number(p.transparency ?? 0).toFixed(3)}</float>`,
      `${indent}    <float name="Reflectance">${reflFloat.toFixed(3)}</float>`,
      `${indent}    <Color3 name="Color3uint8">`,
      `${indent}      <R>${(cr / 255).toFixed(4)}</R>`,
      `${indent}      <G>${(cg / 255).toFixed(4)}</G>`,
      `${indent}      <B>${(cb / 255).toFixed(4)}</B>`,
      `${indent}    </Color3>`,
      `${indent}    <Vector3 name="size">`,
      `${indent}      <X>${Number(sx).toFixed(4)}</X>`,
      `${indent}      <Y>${Number(sy).toFixed(4)}</Y>`,
      `${indent}      <Z>${Number(sz).toFixed(4)}</Z>`,
      `${indent}    </Vector3>`,
      `${indent}    <Vector3 name="InitialSize">`,
      `${indent}      <X>${Number(sx).toFixed(4)}</X>`,
      `${indent}      <Y>${Number(sy).toFixed(4)}</Y>`,
      `${indent}      <Z>${Number(sz).toFixed(4)}</Z>`,
      `${indent}    </Vector3>`,
      `${indent}    <CoordinateFrame name="CFrame">`,
      `${indent}      <X>${Number(px).toFixed(4)}</X>`,
      `${indent}      <Y>${Number(py).toFixed(4)}</Y>`,
      `${indent}      <Z>${Number(pz).toFixed(4)}</Z>`,
      `${indent}      <R00>${rotMat[0].toFixed(6)}</R00>`,
      `${indent}      <R01>${rotMat[1].toFixed(6)}</R01>`,
      `${indent}      <R02>${rotMat[2].toFixed(6)}</R02>`,
      `${indent}      <R10>${rotMat[3].toFixed(6)}</R10>`,
      `${indent}      <R11>${rotMat[4].toFixed(6)}</R11>`,
      `${indent}      <R12>${rotMat[5].toFixed(6)}</R12>`,
      `${indent}      <R20>${rotMat[6].toFixed(6)}</R20>`,
      `${indent}      <R21>${rotMat[7].toFixed(6)}</R21>`,
      `${indent}      <R22>${rotMat[8].toFixed(6)}</R22>`,
      `${indent}    </CoordinateFrame>`,
      validMeshId
        ? `${indent}    <Content name="MeshId"><url>${escapeXmlServer(validMeshId)}</url></Content>`
        : `${indent}    <Content name="MeshId"><null></null></Content>`,
      validTexId
        ? `${indent}    <Content name="TextureID"><url>${escapeXmlServer(validTexId)}</url></Content>`
        : `${indent}    <Content name="TextureID"><null></null></Content>`,
      `${indent}  </Properties>`,
      `${indent}  <Item class="SurfaceAppearance" referent="${refId}_PBR">`,
      `${indent}    <Properties>`,
      `${indent}      <string name="Name">${escapeXmlServer(p.name || `MeshPart_${idx + 1}`)}_PBRSurface</string>`,
      `${indent}      <token name="AlphaMode">0</token>`,
      validColorMap
        ? `${indent}      <Content name="ColorMap"><url>${escapeXmlServer(validColorMap)}</url></Content>`
        : `${indent}      <Content name="ColorMap"><null></null></Content>`,
      validNormalMap
        ? `${indent}      <Content name="NormalMap"><url>${escapeXmlServer(validNormalMap)}</url></Content>`
        : `${indent}      <Content name="NormalMap"><null></null></Content>`,
      validRoughMap
        ? `${indent}      <Content name="RoughnessMap"><url>${escapeXmlServer(validRoughMap)}</url></Content>`
        : `${indent}      <Content name="RoughnessMap"><null></null></Content>`,
      validMetalMap
        ? `${indent}      <Content name="MetalnessMap"><url>${escapeXmlServer(validMetalMap)}</url></Content>`
        : `${indent}      <Content name="MetalnessMap"><null></null></Content>`,
      `${indent}    </Properties>`,
      `${indent}  </Item>`,
      `${indent}  <Item class="StringValue" referent="${refId}_PART_ID">`,
      `${indent}    <Properties>`,
      `${indent}      <string name="Name">ForgePartId</string>`,
      `${indent}      <string name="Value">${escapeXmlServer(syncMeta.partId)}</string>`,
      `${indent}    </Properties>`,
      `${indent}  </Item>`,
      `${indent}  <Item class="StringValue" referent="${refId}_PARENT_ID">`,
      `${indent}    <Properties>`,
      `${indent}      <string name="Name">ForgeParentId</string>`,
      `${indent}      <string name="Value">${escapeXmlServer(syncMeta.parentId)}</string>`,
      `${indent}    </Properties>`,
      `${indent}  </Item>`,
      `${indent}  <Item class="StringValue" referent="${refId}_PARENT_NAME">`,
      `${indent}    <Properties>`,
      `${indent}      <string name="Name">ForgeParentName</string>`,
      `${indent}      <string name="Value">${escapeXmlServer(syncMeta.parentName)}</string>`,
      `${indent}    </Properties>`,
      `${indent}  </Item>`,
      `${indent}  <Item class="StringValue" referent="${refId}_HIERARCHY_PATH">`,
      `${indent}    <Properties>`,
      `${indent}      <string name="Name">ForgeHierarchyPath</string>`,
      `${indent}      <string name="Value">${escapeXmlServer(syncMeta.hierarchyPath)}</string>`,
      `${indent}    </Properties>`,
      `${indent}  </Item>`,
      `${indent}  <Item class="StringValue" referent="${refId}_GEOM">`,
      `${indent}    <Properties>`,
      `${indent}      <string name="Name">ForgeMeshGeometryJSON</string>`,
      `${indent}      <string name="Value">${escapeXmlServer(serializedMeshJson)}</string>`,
      `${indent}    </Properties>`,
      `${indent}  </Item>`,
      `${indent}</Item>`,
    ];
  };

  interface HierarchyTreeNode {
    name: string;
    path: string;
    nodeId: string;
    containerClass: 'Folder' | 'Model';
    children: Map<string, HierarchyTreeNode>;
    parts: Array<{ part: MeshPartInput; idx: number }>;
  }

  const rootTree: HierarchyTreeNode = {
    name: 'ModelRoot',
    path: 'ModelRoot',
    nodeId: 'fnode_ModelRoot',
    containerClass: 'Model',
    children: new Map(),
    parts: [],
  };

  expandedParts.forEach((p, idx) => {
    const hier = normalizeHierarchyMetadata(p, idx);
    const parentSegs = hier.hierarchySegments
      .slice(0, -1)
      .filter((s) => s && s !== 'ModelRoot' && s !== 'Root' && s !== safeName);
    if (parentSegs.length === 0) {
      rootTree.parts.push({ part: p, idx });
    } else {
      let curr = rootTree;
      let accum = '';
      parentSegs.forEach((seg, segIdx) => {
        accum = accum ? `${accum}/${seg}` : seg;
        let nextNode = curr.children.get(seg);
        const isDirectParent = segIdx === parentSegs.length - 1;
        const desiredClass: 'Folder' | 'Model' = isDirectParent
          ? hier.parentContainerClass
          : seg.toLowerCase().includes('folder') || seg.toLowerCase().includes('group')
          ? 'Folder'
          : 'Model';
        if (!nextNode) {
          nextNode = {
            name: seg,
            path: accum,
            nodeId: `fnode_${accum.replace(/[^a-zA-Z0-9_]/g, '_')}`,
            containerClass: desiredClass,
            children: new Map(),
            parts: [],
          };
          curr.children.set(seg, nextNode);
        } else if (isDirectParent && hier.parentContainerClass === 'Folder') {
          nextNode.containerClass = 'Folder';
        }
        curr = nextNode;
      });
      curr.parts.push({ part: p, idx });
    }
  });

  const emitTreeNode = (node: HierarchyTreeNode, indent: string) => {
    for (const { part, idx } of node.parts) {
      lines.push(...renderMeshPartXml(part, idx, indent));
    }
    let containerCounter = 0;
    for (const [, childNode] of node.children.entries()) {
      containerCounter++;
      const refContainer = `RBX_CONTAINER_${childNode.nodeId}_${containerCounter}`;
      lines.push(
        `${indent}<Item class="${childNode.containerClass}" referent="${refContainer}">`,
        `${indent}  <Properties>`,
        `${indent}    <string name="Name">${escapeXmlServer(childNode.name)}</string>`,
        `${indent}  </Properties>`,
        `${indent}  <Item class="StringValue" referent="${refContainer}_NODE_ID">`,
        `${indent}    <Properties>`,
        `${indent}      <string name="Name">ForgeNodeId</string>`,
        `${indent}      <string name="Value">${escapeXmlServer(childNode.nodeId)}</string>`,
        `${indent}    </Properties>`,
        `${indent}  </Item>`,
        `${indent}  <Item class="StringValue" referent="${refContainer}_HIER_PATH">`,
        `${indent}    <Properties>`,
        `${indent}      <string name="Name">ForgeHierarchyPath</string>`,
        `${indent}      <string name="Value">${escapeXmlServer(childNode.path)}</string>`,
        `${indent}    </Properties>`,
        `${indent}  </Item>`
      );
      emitTreeNode(childNode, `${indent}  `);
      lines.push(`${indent}</Item>`);
    }
  };

  emitTreeNode(rootTree, '    ');

  lines.push(
    '    <Item class="StringValue" referent="RBX_FORGE_META">',
    '      <Properties>',
    '        <string name="Name">ForgeAssetCategory</string>',
    `        <string name="Value">${escapeXmlServer(category)}</string>`,
    '      </Properties>',
    '    </Item>',
    '    <Item class="ModuleScript" referent="RBX_FORGE_RECONSTRUCTOR">',
    '      <Properties>',
    '        <string name="Name">ForgeStudioReconstructor</string>',
    `        <ProtectedString name="Source"><![CDATA[${reconstructorLuau.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]></ProtectedString>`,
    '      </Properties>',
    '    </Item>',
    '    <Item class="Script" referent="RBX_FORGE_AUTORUNNER">',
    '      <Properties>',
    '        <string name="Name">ForgeAutoReconstructRunner</string>',
    '        <token name="RunContext">0</token>',
    `        <ProtectedString name="Source"><![CDATA[${autoRunnerLuau.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]></ProtectedString>`,
    '      </Properties>',
    '    </Item>',
    '  </Item>',
    '</roblox>'
  );

  return lines.join('\n');
}

/**
 * Server-side `.RBXMX` XML parser for Pillar C Bidirectional Sync (`/api/v1/assets/pull-from-rojo`).
 * Recovers full CFrames (Position + 3x3 rotation matrix + Euler Rotation), Sizes, Colors,
 * Roblox Material enums, 4-channel `SurfaceAppearance` maps, `ForgePartId`, nested container
 * hierarchies (`ForgeParentName`, `ForgeHierarchyPath`), and `ForgeMeshGeometryJSON` buffers,
 * while preserving external `MeshPart`s without overwriting them with procedural cubes.
 */
export function parseRbxmxFromPartsServer(
  rbxmxText: string,
  fallbackName: string = 'Model3D',
  defaultCollisionFidelity: string = 'Hull'
): {
  modelName: string;
  parts: MeshPartInput[];
  luauCode: string | null;
  polyCount: number;
} {
  const tokenToMaterial: Record<number, string> = {
    256: 'SmoothPlastic',
    272: 'SmoothPlastic',
    288: 'Neon',
    1088: 'Metal',
    1584: 'Neon',
    1568: 'Glass',
    1588: 'ForceField',
    1056: 'DiamondPlate',
    1040: 'CorrodedMetal',
    1072: 'Foil',
    816: 'Concrete',
    800: 'Slate',
    832: 'Granite',
    848: 'Brick',
    784: 'Marble',
    864: 'Cobblestone',
    880: 'Cobblestone',
    512: 'Wood',
    528: 'WoodPlanks',
    1312: 'Fabric',
    1296: 'Sand',
    1536: 'Ice',
    1280: 'Grass',
  };
  const tokenToCf: Record<number, 'Box' | 'Hull' | 'Default' | 'PreciseConvexDecomposition'> = {
    0: 'Box',
    1: 'Hull',
    2: 'Default',
    3: 'PreciseConvexDecomposition',
  };

  let modelName = fallbackName;
  const modelNameMatch = rbxmxText.match(
    /<Item\s+class="Model"[^>]*>[\s\S]*?<Properties>[\s\S]*?<string\s+name="Name">([^<]+)<\/string>/i
  );
  if (modelNameMatch?.[1]) {
    modelName = unescapeXmlServer(modelNameMatch[1].trim()) || fallbackName;
  }

  let luauCode: string | null = null;
  const moduleRegex =
    /<Item\s+class="ModuleScript"[^>]*>[\s\S]*?<string\s+name="Name">ForgeStudioReconstructor<\/string>[\s\S]*?<ProtectedString\s+name="Source"><!\[CDATA\[([\s\S]*?)\]\]><\/ProtectedString>/i;
  const modMatch = rbxmxText.match(moduleRegex);
  if (modMatch?.[1]) {
    luauCode = modMatch[1].trim();
  }

  // Track `<Item class="Model|Folder">` nesting across the XML so even external .rbxmx models without ForgeParentName preserve their nested container hierarchy
  const itemTagRegex = /<\/?Item(?:\s+class="([^"]+)"[^>]*)?>/gi;
  const containerStack: Array<{ cls: string; name: string }> = [];
  const inferredParentAtOffset = new Map<number, string>();
  const inferredParentClassAtOffset = new Map<number, 'Folder' | 'Model'>();

  const parts: MeshPartInput[] = [];
  const startRegex = /<Item\s+class="(MeshPart|Part|WedgePart|CornerWedgePart|TrussPart)"[^>]*>/gi;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = startRegex.exec(rbxmxText)) !== null) {
    starts.push(m.index);
  }
  const startSet = new Set(starts);

  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = itemTagRegex.exec(rbxmxText)) !== null) {
    const fullTag = tagMatch[0];
    const tagIdx = tagMatch.index;
    if (fullTag.startsWith('</Item')) {
      containerStack.pop();
    } else {
      const cls = tagMatch[1] || '';
      const snippet = rbxmxText.slice(tagIdx, tagIdx + 350);
      const nm = snippet.match(/<Properties>\s*<string\s+name="Name">([^<]+)<\/string>/i)?.[1];
      const itemName = nm ? unescapeXmlServer(nm.trim()) : cls;
      if (startSet.has(tagIdx)) {
        const containerEntries = containerStack.filter(
          (c, cIdx) => (c.cls === 'Model' || c.cls === 'Folder') && !(cIdx === 0 && c.name === modelName)
        );
        const containerSegs = containerEntries
          .map((c) => c.name)
          .filter((n) => n && n !== 'ModelRoot');
        inferredParentAtOffset.set(
          tagIdx,
          containerSegs.length > 0 ? containerSegs.join('/') : 'ModelRoot'
        );
        const lastContainer = containerEntries[containerEntries.length - 1];
        inferredParentClassAtOffset.set(
          tagIdx,
          lastContainer?.cls === 'Folder' ? 'Folder' : 'Model'
        );
      }
      containerStack.push({ cls, name: itemName });
    }
  }

  for (let i = 0; i < starts.length; i++) {
    const startIdx = starts[i];
    const endIdx = i + 1 < starts.length ? starts[i + 1] : rbxmxText.length;
    const block = rbxmxText.slice(startIdx, endIdx);

    const nameMatch = block.match(/<string\s+name="Name">([^<]+)<\/string>/i);
    const partName = nameMatch?.[1] ? unescapeXmlServer(nameMatch[1].trim()) : `MeshPart_${i + 1}`;

    let partId =
      block.match(
        /<string\s+name="Name">ForgePartId<\/string>\s*<string\s+name="Value">([^<]+)<\/string>/i
      )?.[1] || '';
    partId = partId ? unescapeXmlServer(partId.trim()) : '';

    let parentId =
      block.match(
        /<string\s+name="Name">ForgeParentId<\/string>\s*<string\s+name="Value">([^<]+)<\/string>/i
      )?.[1] || '';
    parentId = parentId ? unescapeXmlServer(parentId.trim()) : '';

    let parentName =
      block.match(
        /<string\s+name="Name">ForgeParentName<\/string>\s*<string\s+name="Value">([^<]+)<\/string>/i
      )?.[1] || '';
    parentName = parentName
      ? unescapeXmlServer(parentName.trim())
      : inferredParentAtOffset.get(startIdx) || 'ModelRoot';

    let parentContainerClass: 'Folder' | 'Model' =
      inferredParentClassAtOffset.get(startIdx) || 'Model';

    let hierarchyPath =
      block.match(
        /<string\s+name="Name">ForgeHierarchyPath<\/string>\s*<string\s+name="Value">([^<]+)<\/string>/i
      )?.[1] || '';
    hierarchyPath = hierarchyPath ? unescapeXmlServer(hierarchyPath.trim()) : '';

    const sizeBlock = block.match(/<Vector3\s+name="(?:size|Size)">([\s\S]*?)<\/Vector3>/i)?.[1] || '';
    const sx = Number(sizeBlock.match(/<X>([^<]+)<\/X>/i)?.[1] ?? 2);
    const sy = Number(sizeBlock.match(/<Y>([^<]+)<\/Y>/i)?.[1] ?? 2);
    const sz = Number(sizeBlock.match(/<Z>([^<]+)<\/Z>/i)?.[1] ?? 2);

    const cfBlock = block.match(/<CoordinateFrame\s+name="CFrame">([\s\S]*?)<\/CoordinateFrame>/i)?.[1] || '';
    const px = Number(cfBlock.match(/<X>([^<]+)<\/X>/i)?.[1] ?? 0);
    const py = Number(cfBlock.match(/<Y>([^<]+)<\/Y>/i)?.[1] ?? 1);
    const pz = Number(cfBlock.match(/<Z>([^<]+)<\/Z>/i)?.[1] ?? 0);
    const r00 = Number(cfBlock.match(/<R00>([^<]+)<\/R00>/i)?.[1] ?? 1);
    const r01 = Number(cfBlock.match(/<R01>([^<]+)<\/R01>/i)?.[1] ?? 0);
    const r02 = Number(cfBlock.match(/<R02>([^<]+)<\/R02>/i)?.[1] ?? 0);
    const r10 = Number(cfBlock.match(/<R10>([^<]+)<\/R10>/i)?.[1] ?? 0);
    const r11 = Number(cfBlock.match(/<R11>([^<]+)<\/R11>/i)?.[1] ?? 1);
    const r12 = Number(cfBlock.match(/<R12>([^<]+)<\/R12>/i)?.[1] ?? 0);
    const r20 = Number(cfBlock.match(/<R20>([^<]+)<\/R20>/i)?.[1] ?? 0);
    const r21 = Number(cfBlock.match(/<R21>([^<]+)<\/R21>/i)?.[1] ?? 0);
    const r22 = Number(cfBlock.match(/<R22>([^<]+)<\/R22>/i)?.[1] ?? 1);
    let rotationMatrix: number[] = [r00, r01, r02, r10, r11, r12, r20, r21, r22];
    let rotation: [number, number, number] = canonicalMatrix9ToEulerDeg(rotationMatrix);

    let color: [number, number, number] = [148, 163, 184];
    const colUintMatch = block.match(/<Color3uint8\s+name="Color3uint8">(\d+)<\/Color3uint8>/i)?.[1];
    const colBlock = block.match(/<Color3\s+name="(?:Color3uint8|Color)">([\s\S]*?)<\/Color3>/i)?.[1];
    if (colUintMatch) {
      const cVal = parseInt(colUintMatch, 10);
      color = [(cVal >> 16) & 0xff, (cVal >> 8) & 0xff, cVal & 0xff];
    } else if (colBlock) {
      const cr = Number(colBlock.match(/<R>([^<]+)<\/R>/i)?.[1] ?? 0.58);
      const cg = Number(colBlock.match(/<G>([^<]+)<\/G>/i)?.[1] ?? 0.64);
      const cb = Number(colBlock.match(/<B>([^<]+)<\/B>/i)?.[1] ?? 0.72);
      color = normalizeColorRgb255([cr, cg, cb]);
    }

    const matTok = Number(block.match(/<token\s+name="Material">(\d+)<\/token>/i)?.[1] ?? 1088);
    let material = tokenToMaterial[matTok] || 'Metal';

    const cfTok = Number(block.match(/<token\s+name="CollisionFidelity">(\d+)<\/token>/i)?.[1] ?? 1);
    const collisionFidelity =
      tokenToCf[cfTok] ||
      (defaultCollisionFidelity as 'Box' | 'Hull' | 'Default' | 'PreciseConvexDecomposition') ||
      'Hull';

    const transparency = Number(block.match(/<float\s+name="Transparency">([^<]+)<\/float>/i)?.[1] ?? 0);
    let reflectance = Number(block.match(/<float\s+name="Reflectance">([^<]+)<\/float>/i)?.[1] ?? 0);
    const anchored = (block.match(/<bool\s+name="Anchored">([^<]+)<\/bool>/i)?.[1] ?? 'true') !== 'false';
    const canCollide = (block.match(/<bool\s+name="CanCollide">([^<]+)<\/bool>/i)?.[1] ?? 'true') !== 'false';

    const meshIdRaw = block.match(/<Content\s+name="MeshId">\s*<url>([^<]+)<\/url>/i)?.[1];
    const texIdRaw = block.match(/<Content\s+name="TextureID">\s*<url>([^<]+)<\/url>/i)?.[1];
    let meshId = validatePublishedRobloxMeshId(meshIdRaw ? unescapeXmlServer(meshIdRaw) : undefined) || undefined;
    let textureId = validatePublishedRobloxMeshId(texIdRaw ? unescapeXmlServer(texIdRaw) : undefined) || undefined;

    let pbrMaterial: Record<string, any> | undefined;
    const saBlock = block.match(/<Item\s+class="SurfaceAppearance"[^>]*>([\s\S]*?)<\/Item>/i)?.[1];
    if (saBlock) {
      const cmap = validatePublishedRobloxMeshId(
        saBlock.match(/<Content\s+name="ColorMap">\s*<url>([^<]+)<\/url>/i)?.[1]
      );
      const nmap = validatePublishedRobloxMeshId(
        saBlock.match(/<Content\s+name="NormalMap">\s*<url>([^<]+)<\/url>/i)?.[1]
      );
      const rmap = validatePublishedRobloxMeshId(
        saBlock.match(/<Content\s+name="RoughnessMap">\s*<url>([^<]+)<\/url>/i)?.[1]
      );
      const mmap = validatePublishedRobloxMeshId(
        saBlock.match(/<Content\s+name="MetalnessMap">\s*<url>([^<]+)<\/url>/i)?.[1]
      );
      if (cmap || nmap || rmap || mmap) {
        pbrMaterial = {
          materialName: `${partName}_PBR`,
          colorMapAssetId: cmap || undefined,
          normalMapAssetId: nmap || undefined,
          roughnessMapAssetId: rmap || undefined,
          metalnessMapAssetId: mmap || undefined,
        };
      }
    }

    let meshData: SubMeshGeometryInput | undefined;
    let geometrySource: string | undefined;
    let roughness = 0.35;
    let metalness = Math.min(1, Math.max(0, Number((reflectance / 0.35).toFixed(2))));

    const geomMatch = block.match(
      /<string\s+name="Name">ForgeMeshGeometryJSON<\/string>\s*<string\s+name="Value">([\s\S]*?)<\/string>/i
    );
    if (geomMatch?.[1]) {
      try {
        const parsedGeom = JSON.parse(unescapeXmlServer(geomMatch[1].trim()));
        if (parsedGeom && typeof parsedGeom === 'object') {
          if (typeof parsedGeom.partId === 'string' && parsedGeom.partId) partId = parsedGeom.partId;
          if (typeof parsedGeom.parentId === 'string' && parsedGeom.parentId) parentId = parsedGeom.parentId;
          if (typeof parsedGeom.parentName === 'string' && parsedGeom.parentName)
            parentName = parsedGeom.parentName;
          if (
            parsedGeom.parentContainerClass === 'Folder' ||
            parsedGeom.parentContainerClass === 'Model'
          ) {
            parentContainerClass = parsedGeom.parentContainerClass;
          }
          if (typeof parsedGeom.hierarchyPath === 'string' && parsedGeom.hierarchyPath)
            hierarchyPath = parsedGeom.hierarchyPath;
          if (typeof parsedGeom.geometrySource === 'string' && parsedGeom.geometrySource)
            geometrySource = parsedGeom.geometrySource;
          const jsonMeshId = validatePublishedRobloxMeshId(parsedGeom.publishedMeshId || parsedGeom.meshId);
          if (jsonMeshId && !meshId) meshId = jsonMeshId;
          const jsonTexId = validatePublishedRobloxMeshId(parsedGeom.textureId);
          if (jsonTexId && !textureId) textureId = jsonTexId;
          if (typeof parsedGeom.roughness === 'number') roughness = parsedGeom.roughness;
          if (typeof parsedGeom.metalness === 'number') metalness = parsedGeom.metalness;
          if (typeof parsedGeom.reflectance === 'number') reflectance = parsedGeom.reflectance;
          if (typeof parsedGeom.material === 'string') material = parsedGeom.material;
          if (Array.isArray(parsedGeom.rotationMatrix) && parsedGeom.rotationMatrix.length === 9) {
            rotationMatrix = parsedGeom.rotationMatrix.map((n: any) => Number(n));
            rotation = canonicalMatrix9ToEulerDeg(rotationMatrix);
          } else if (Array.isArray(parsedGeom.rotation) && parsedGeom.rotation.length === 3) {
            rotation = [
              Number(parsedGeom.rotation[0]),
              Number(parsedGeom.rotation[1]),
              Number(parsedGeom.rotation[2]),
            ];
            rotationMatrix = canonicalEulerToMatrix9(rotation[0], rotation[1], rotation[2]);
          }
          if (parsedGeom.pbrMaterial && typeof parsedGeom.pbrMaterial === 'object') {
            pbrMaterial = { ...parsedGeom.pbrMaterial, ...(pbrMaterial || {}) };
          }
          if (
            Array.isArray(parsedGeom.vertices) &&
            parsedGeom.vertices.length > 0 &&
            Array.isArray(parsedGeom.faces) &&
            parsedGeom.faces.length > 0
          ) {
            meshData = extractGeometryFromProcessedMesh(
              {
                name: partName,
                studSize: [sx, sy, sz],
                meshId,
                geometrySource: geometrySource || 'EditableMeshBuffers',
                meshData: parsedGeom,
              },
              `${modelName}.obj`,
              modelName
            );
            geometrySource = 'EditableMeshBuffers';
          }
        }
      } catch {
        // Fallback handled below
      }
    }

    if (!meshData) {
      if (meshId || geometrySource === 'PublishedCloudMeshId' || geometrySource === 'StudioExternalUnreadable') {
        geometrySource = meshId ? 'PublishedCloudMeshId' : geometrySource || 'StudioExternalUnreadable';
        meshData = {
          vertices: [],
          normals: [],
          uvs: [],
          faces: [],
          indices: [],
          objFileName: `${modelName}.obj`,
          meshId: meshId || '',
          assetId: meshId || '',
          geometrySource,
        };
      } else {
        geometrySource = 'EditableMeshBuffers';
        meshData = synthesizeProceduralMeshData('MeshPart', [sx, sy, sz]);
        meshData.objFileName = `${modelName}.obj`;
      }
    }

    const basePartObj: any = {
      partId,
      parentId,
      parentName: parentName || 'ModelRoot',
      parentContainerClass,
      hierarchyPath,
      name: partName,
      shape: 'MeshPart',
      meshId,
      assetId: meshId,
      textureId,
      geometrySource,
      size: [Number(sx.toFixed(3)), Number(sy.toFixed(3)), Number(sz.toFixed(3))],
      position: [Number(px.toFixed(3)), Number(py.toFixed(3)), Number(pz.toFixed(3))],
      rotation,
      rotationMatrix,
      color,
      material,
      roughness,
      metalness,
      reflectance: Number(reflectance.toFixed(3)),
      transparency: Number(transparency.toFixed(3)),
      canCollide,
      anchored,
      collisionFidelity,
      meshData,
      ...(pbrMaterial ? { pbrMaterial } : {}),
    };
    const syncHashes = computePartSyncHashes(basePartObj, i);
    parts.push({
      ...basePartObj,
      partId: syncHashes.partId,
      parentId: syncHashes.parentId,
      parentName: syncHashes.parentName,
      parentContainerClass: syncHashes.parentContainerClass,
      hierarchyPath: syncHashes.hierarchyPath,
      geometrySource: syncHashes.geometrySource,
      rotationMatrix: syncHashes.rotationMatrix,
      reflectance: syncHashes.reflectance,
      geometryHash: syncHashes.geometryHash,
      materialHash: syncHashes.materialHash,
      transformHash: syncHashes.transformHash,
      hierarchyHash: syncHashes.hierarchyHash,
      combinedHash: syncHashes.combinedHash,
    } as MeshPartInput);
  }

  const polyCount = parts.reduce((sum, p) => sum + (p.meshData?.faces?.length || 0), 0);
  return {
    modelName,
    parts,
    luauCode,
    polyCount,
  };
}

export function buildObjAndMtlFromPartsServer(
  modelName: string,
  parts: MeshPartInput[]
): { obj: string; mtl: string; objFileName: string; mtlFileName: string } {
  const safeName = modelName.replace(/[^a-zA-Z0-9_]/g, '') || 'ForgeModel3D';
  const objFileName = `${safeName}.obj`;
  const mtlFileName = `${safeName}.mtl`;

  const expandedParts: MeshPartInput[] = [];
  parts.forEach((p, idx) => {
    const [sx = 2, sy = 2, sz = 2] = p.size || [2, 2, 2];
    const resolvedMesh = extractGeometryFromProcessedMesh(
      { ...p, studSize: [sx, sy, sz] },
      objFileName,
      safeName
    );
    expandedParts.push(
      ...splitOversizedMeshPartInput({
        ...p,
        name: p.name || `MeshPart_${idx + 1}`,
        meshData: resolvedMesh,
      })
    );
  });

  const objLines: string[] = [
    `# Wavefront OBJ exported from Forge AI Studio: ${safeName}`,
    `mtllib ${mtlFileName}`,
    '',
  ];
  const mtlLines: string[] = [
    `# Wavefront MTL Material Library for ${safeName}`,
    '',
  ];

  let globalVertexOffset = 1;
  expandedParts.forEach((p, idx) => {
    const partLabel = (p.name || `MeshPart_${idx + 1}`).replace(/[^a-zA-Z0-9_]/g, '_');
    const matName = `Mat_${partLabel}_${idx + 1}`;
    const [cr = 148, cg = 163, cb = 184] = p.color || [148, 163, 184];
    const [px = 0, py = 1, pz = 0] = p.position || [0, 1, 0];
    const [rx = 0, ry = 0, rz = 0] = p.rotation || [0, 0, 0];
    const rotMat = eulerDegToRotationMatrixServer(rx, ry, rz);
    const md = p.meshData || synthesizeProceduralMeshData('MeshPart', p.size || [2, 2, 2]);

    mtlLines.push(
      `newmtl ${matName}`,
      `Kd ${(cr / 255).toFixed(4)} ${(cg / 255).toFixed(4)} ${(cb / 255).toFixed(4)}`,
      'Ka 0.1000 0.1000 0.1000',
      `Ks ${Number(p.metalness ?? 0.5).toFixed(4)} ${Number(p.metalness ?? 0.5).toFixed(4)} ${Number(p.metalness ?? 0.5).toFixed(4)}`,
      `Ns ${Math.max(1, (1 - Number(p.roughness ?? 0.35)) * 250).toFixed(2)}`,
      `d ${(1 - Number(p.transparency ?? 0)).toFixed(4)}`,
      'illum 2',
      ''
    );

    objLines.push(`o ${partLabel}`, `g ${partLabel}`, `usemtl ${matName}`);

    for (const [vx, vy, vz] of md.vertices) {
      const wx = rotMat[0] * vx + rotMat[1] * vy + rotMat[2] * vz + px;
      const wy = rotMat[3] * vx + rotMat[4] * vy + rotMat[5] * vz + py;
      const wz = rotMat[6] * vx + rotMat[7] * vy + rotMat[8] * vz + pz;
      objLines.push(`v ${wx.toFixed(5)} ${wy.toFixed(5)} ${wz.toFixed(5)}`);
    }

    for (const [u, v] of md.uvs) {
      objLines.push(`vt ${Number(u).toFixed(5)} ${Number(v).toFixed(5)}`);
    }

    for (const [nx, ny, nz] of md.normals) {
      const wnx = rotMat[0] * nx + rotMat[1] * ny + rotMat[2] * nz;
      const wny = rotMat[3] * nx + rotMat[4] * ny + rotMat[5] * nz;
      const wnz = rotMat[6] * nx + rotMat[7] * ny + rotMat[8] * nz;
      objLines.push(`vn ${wnx.toFixed(5)} ${wny.toFixed(5)} ${wnz.toFixed(5)}`);
    }

    for (const [f0, f1, f2] of md.faces) {
      const i0 = f0 + globalVertexOffset;
      const i1 = f1 + globalVertexOffset;
      const i2 = f2 + globalVertexOffset;
      objLines.push(`f ${i0}/${i0}/${i0} ${i1}/${i1}/${i1} ${i2}/${i2}/${i2}`);
    }

    objLines.push('');
    globalVertexOffset += md.vertices.length;
  });

  return {
    obj: objLines.join('\n'),
    mtl: mtlLines.join('\n'),
    objFileName,
    mtlFileName,
  };
}

export function buildGltfFromPartsServer(
  modelName: string,
  parts: MeshPartInput[],
  pbrTextures?: {
    albedoDataUrl?: string;
    normalDataUrl?: string;
    roughnessDataUrl?: string;
  }
): string {
  const safeName = modelName.replace(/[^a-zA-Z0-9_]/g, '') || 'ForgeModel3D';
  const expandedParts: MeshPartInput[] = [];
  parts.forEach((p, idx) => {
    const [sx = 2, sy = 2, sz = 2] = p.size || [2, 2, 2];
    const resolvedMesh = extractGeometryFromProcessedMesh(
      { ...p, studSize: [sx, sy, sz] },
      `${safeName}.obj`,
      safeName
    );
    expandedParts.push(
      ...splitOversizedMeshPartInput({
        ...p,
        name: p.name || `MeshPart_${idx + 1}`,
        meshData: resolvedMesh,
      })
    );
  });

  const nodes: any[] = [];
  const meshes: any[] = [];
  const materials: any[] = [];
  const bufferViews: any[] = [];
  const accessors: any[] = [];
  const images: any[] = [];
  const samplers: any[] = [];
  const textures: any[] = [];
  const binaryChunks: Buffer[] = [];
  let byteOffset = 0;

  let baseColorTexIdx: number | undefined;
  let normalTexIdx: number | undefined;
  let metallicRoughnessTexIdx: number | undefined;

  if (pbrTextures) {
    const texDefs: Array<[string | undefined, string, 'albedo' | 'normal' | 'roughness']> = [
      [pbrTextures.albedoDataUrl, `${safeName}_ColorMap`, 'albedo'],
      [pbrTextures.normalDataUrl, `${safeName}_NormalMap`, 'normal'],
      [pbrTextures.roughnessDataUrl, `${safeName}_RoughnessMap`, 'roughness'],
    ];
    for (const [dataUrl, texName, role] of texDefs) {
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
        if (samplers.length === 0) {
          samplers.push({
            magFilter: 9729,
            minFilter: 9987,
            wrapS: 10497,
            wrapT: 10497,
          });
        }
        const imgIdx = images.length;
        images.push({ name: texName, uri: dataUrl });
        const texIdx = textures.length;
        textures.push({ name: texName, sampler: 0, source: imgIdx });
        if (role === 'albedo') baseColorTexIdx = texIdx;
        if (role === 'normal') normalTexIdx = texIdx;
        if (role === 'roughness') metallicRoughnessTexIdx = texIdx;
      }
    }
  }

  expandedParts.forEach((p, idx) => {
    const md = p.meshData || synthesizeProceduralMeshData('MeshPart', p.size || [2, 2, 2]);
    const vertCount = md.vertices.length;
    if (vertCount === 0 || md.faces.length === 0) return;

    const posBuf = Buffer.alloc(vertCount * 12);
    const normBuf = Buffer.alloc(vertCount * 12);
    const uvBuf = Buffer.alloc(vertCount * 8);

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < vertCount; i++) {
      const [vx, vy, vz] = md.vertices[i] || [0, 0, 0];
      const [nx, ny, nz] = (md.normals && md.normals[i]) || [0, 1, 0];
      const [u, v] = (md.uvs && md.uvs[i]) || [0, 0];
      posBuf.writeFloatLE(vx, i * 12);
      posBuf.writeFloatLE(vy, i * 12 + 4);
      posBuf.writeFloatLE(vz, i * 12 + 8);
      normBuf.writeFloatLE(nx, i * 12);
      normBuf.writeFloatLE(ny, i * 12 + 4);
      normBuf.writeFloatLE(nz, i * 12 + 8);
      uvBuf.writeFloatLE(u, i * 8);
      uvBuf.writeFloatLE(v, i * 8 + 4);

      if (vx < minX) minX = vx;
      if (vy < minY) minY = vy;
      if (vz < minZ) minZ = vz;
      if (vx > maxX) maxX = vx;
      if (vy > maxY) maxY = vy;
      if (vz > maxZ) maxZ = vz;
    }

    const validFaces = md.faces.filter(
      (f) => f[0] < vertCount && f[1] < vertCount && f[2] < vertCount
    );
    const indexCount = validFaces.length * 3;
    const idxBuf = Buffer.alloc(indexCount * 4);
    validFaces.forEach(([i0, i1, i2], fIdx) => {
      idxBuf.writeUInt32LE(i0, fIdx * 12);
      idxBuf.writeUInt32LE(i1, fIdx * 12 + 4);
      idxBuf.writeUInt32LE(i2, fIdx * 12 + 8);
    });

    const posViewIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: posBuf.byteLength, target: 34962 });
    binaryChunks.push(posBuf);
    byteOffset += posBuf.byteLength;

    const normViewIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: normBuf.byteLength, target: 34962 });
    binaryChunks.push(normBuf);
    byteOffset += normBuf.byteLength;

    const uvViewIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: uvBuf.byteLength, target: 34962 });
    binaryChunks.push(uvBuf);
    byteOffset += uvBuf.byteLength;

    const idxViewIdx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: idxBuf.byteLength, target: 34963 });
    binaryChunks.push(idxBuf);
    byteOffset += idxBuf.byteLength;

    const posAccIdx = accessors.length;
    accessors.push({
      bufferView: posViewIdx,
      componentType: 5126,
      count: vertCount,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });

    const normAccIdx = accessors.length;
    accessors.push({
      bufferView: normViewIdx,
      componentType: 5126,
      count: vertCount,
      type: 'VEC3',
    });

    const uvAccIdx = accessors.length;
    accessors.push({
      bufferView: uvViewIdx,
      componentType: 5126,
      count: vertCount,
      type: 'VEC2',
    });

    const idxAccIdx = accessors.length;
    accessors.push({
      bufferView: idxViewIdx,
      componentType: 5125,
      count: indexCount,
      type: 'SCALAR',
    });

    const [cr = 148, cg = 163, cb = 184] = p.color || [148, 163, 184];
    const pbrSpec: any = {
      baseColorFactor: [
        Number((cr / 255).toFixed(4)),
        Number((cg / 255).toFixed(4)),
        Number((cb / 255).toFixed(4)),
        Number((1 - Number(p.transparency ?? 0)).toFixed(4)),
      ],
      metallicFactor: Number(Number(p.metalness ?? 0.5).toFixed(4)),
      roughnessFactor: Number(Number(p.roughness ?? 0.35).toFixed(4)),
    };
    if (baseColorTexIdx !== undefined) {
      pbrSpec.baseColorTexture = { index: baseColorTexIdx };
    }
    if (metallicRoughnessTexIdx !== undefined) {
      pbrSpec.metallicRoughnessTexture = { index: metallicRoughnessTexIdx };
    }

    const matEntry: any = {
      name: `${p.name || `MeshPart_${idx + 1}`}_PBR`,
      pbrMetallicRoughness: pbrSpec,
      doubleSided: true,
    };
    if (normalTexIdx !== undefined) {
      matEntry.normalTexture = { index: normalTexIdx };
    }

    const matIdx = materials.length;
    materials.push(matEntry);

    const meshIdx = meshes.length;
    meshes.push({
      name: p.name || `MeshPart_${idx + 1}`,
      primitives: [
        {
          attributes: {
            POSITION: posAccIdx,
            NORMAL: normAccIdx,
            TEXCOORD_0: uvAccIdx,
          },
          indices: idxAccIdx,
          material: matIdx,
          mode: 4,
        },
      ],
    });

    const [px = 0, py = 1, pz = 0] = p.position || [0, 1, 0];
    const [rx = 0, ry = 0, rz = 0] = p.rotation || [0, 0, 0];
    const hx = (rx * Math.PI) / 360;
    const hy = (ry * Math.PI) / 360;
    const hz = (rz * Math.PI) / 360;
    const cx = Math.cos(hx), sx = Math.sin(hx);
    const cy = Math.cos(hy), sy = Math.sin(hy);
    const cz = Math.cos(hz), sz = Math.sin(hz);

    nodes.push({
      name: p.name || `MeshPart_${idx + 1}`,
      mesh: meshIdx,
      translation: [px, py, pz],
      rotation: [
        Number((sx * cy * cz - cx * sy * sz).toFixed(6)),
        Number((cx * sy * cz + sx * cy * sz).toFixed(6)),
        Number((cx * cy * sz - sx * sy * cz).toFixed(6)),
        Number((cx * cy * cz + sx * sy * sz).toFixed(6)),
      ],
    });
  });

  const combinedBuffer = Buffer.concat(binaryChunks);
  const dataUri = `data:application/octet-stream;base64,${combinedBuffer.toString('base64')}`;

  const gltfDoc: any = {
    asset: {
      version: '2.0',
      generator: 'Forge AI Studio 3D Pipeline (Roblox Studio + Blender + glTF 2.0)',
    },
    scene: 0,
    scenes: [
      {
        name: safeName,
        nodes: nodes.map((_, i) => i),
      },
    ],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [
      {
        byteLength: byteOffset,
        uri: dataUri,
      },
    ],
  };

  if (images.length > 0) gltfDoc.images = images;
  if (samplers.length > 0) gltfDoc.samplers = samplers;
  if (textures.length > 0) gltfDoc.textures = textures;

  return JSON.stringify(gltfDoc, null, 2);
}

export function generatePBRSurfaceAppearanceLuau(
  materialName: string,
  targetFolder: string,
  roughness: number,
  metalness: number,
  albedoHex: string,
  cloudAssetIds?: {
    colorMapId?: string;
    normalMapId?: string;
    roughnessMapId?: string;
    metalnessMapId?: string;
  },
  decodedRgbaPreviews?: Record<string, string>
): string {
  const safeMat = materialName.replace(/[^a-zA-Z0-9_]/g, '') || 'ForgePBRMaterial';
  const validColor = validatePublishedRobloxMeshId(cloudAssetIds?.colorMapId);
  const validNormal = validatePublishedRobloxMeshId(cloudAssetIds?.normalMapId);
  const validRoughness = validatePublishedRobloxMeshId(cloudAssetIds?.roughnessMapId);
  const validMetalness = validatePublishedRobloxMeshId(cloudAssetIds?.metalnessMapId);

  const publishedCount = [validColor, validNormal, validRoughness, validMetalness].filter(Boolean).length;
  const pubState =
    publishedCount === 4
      ? 'cloud_published'
      : publishedCount > 0
      ? 'partially_published'
      : 'local_saved';

  const hexClean = String(albedoHex || '#38bdf8').replace('#', '').trim();
  const rVal = hexClean.length === 6 ? parseInt(hexClean.slice(0, 2), 16) || 56 : 56;
  const gVal = hexClean.length === 6 ? parseInt(hexClean.slice(2, 4), 16) || 189 : 189;
  const bVal = hexClean.length === 6 ? parseInt(hexClean.slice(4, 6), 16) || 248 : 248;

  const albedoRgbaB64 = decodedRgbaPreviews?.['ColorMap.png'] || '';
  const normalRgbaB64 = decodedRgbaPreviews?.['NormalMap.png'] || '';
  const roughnessRgbaB64 = decodedRgbaPreviews?.['RoughnessMap.png'] || '';
  const metalnessRgbaB64 = decodedRgbaPreviews?.['MetalnessMap.png'] || '';

  const colorLua = validColor ? `"${validColor}"` : 'nil';
  const normalLua = validNormal ? `"${validNormal}"` : 'nil';
  const roughLua = validRoughness ? `"${validRoughness}"` : 'nil';
  const metalLua = validMetalness ? `"${validMetalness}"` : 'nil';

  const lines: string[] = [
    '--!strict',
    `-- Generated by Forge AI Asset Engine: ${safeMat} (Publication State: ${pubState}, Published Channels: ${publishedCount}/4)`,
    `-- Local Rojo PNG Maps: ${targetFolder}/${safeMat}_ColorMap.png, _NormalMap.png, _RoughnessMap.png, _MetalnessMap.png`,
    'local AssetService = game:GetService("AssetService")',
    '',
    'export type PublishedPBRTextureIds = {',
    '    ColorMap: string?,',
    '    NormalMap: string?,',
    '    RoughnessMap: string?,',
    '    MetalnessMap: string?,',
    '}',
    '',
    'export type PBRVisualVerificationReport = {',
    '    visualVerificationPassed: boolean,',
    '    publicationState: string,',
    '    verifiedCloudChannelCount: number,',
    '    verifiedDecodedChannelCount: number,',
    '    editableImageFallbackActive: boolean,',
    '    channelStatus: { [string]: string },',
    '}',
    '',
    `local ${safeMat}PBR = {}`,
    '',
    'local PUBLISHED_TEXTURE_IDS: PublishedPBRTextureIds = {',
    `    ColorMap = ${colorLua},`,
    `    NormalMap = ${normalLua},`,
    `    RoughnessMap = ${roughLua},`,
    `    MetalnessMap = ${metalLua},`,
    '}',
    '',
    'local EMBEDDED_CHANNEL_RGBA32_B64: { [string]: string } = {',
    `    ColorMap = "${albedoRgbaB64}",`,
    `    NormalMap = "${normalRgbaB64}",`,
    `    RoughnessMap = "${roughnessRgbaB64}",`,
    `    MetalnessMap = "${metalnessRgbaB64}",`,
    '}',
    '',
    'local B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"',
    'local function decodeBase64ToBuffer(b64: string, expectedBytes: number): buffer?',
    '    if #b64 == 0 then return nil end',
    '    local out = buffer.create(expectedBytes)',
    '    local outIdx = 0',
    '    local acc = 0',
    '    local bits = 0',
    '    for i = 1, #b64 do',
    '        local ch = string.sub(b64, i, i)',
    '        if ch == "=" then break end',
    '        local pos = string.find(B64_ALPHABET, ch, 1, true)',
    '        if pos then',
    '            acc = acc * 64 + (pos - 1)',
    '            bits += 6',
    '            if bits >= 8 then',
    '                bits -= 8',
    '                local byteVal = math.floor(acc / (2 ^ bits)) % 256',
    '                if outIdx < expectedBytes then',
    '                    buffer.writeu8(out, outIdx, byteVal)',
    '                    outIdx += 1',
    '                end',
    '            end',
    '        end',
    '    end',
    '    if outIdx < expectedBytes then return nil end',
    '    return out',
    'end',
    '',
    'local function isValidRobloxAssetUri(uri: string?): boolean',
    '    if not uri or uri == "" or uri == "rbxassetid://0" then',
    '        return false',
    '    end',
    '    return string.match(uri, "^rbxassetid://[1-9]%d*$") ~= nil or string.match(uri, "^rbxasset://.+") ~= nil',
    'end',
    '',
    `function ${safeMat}PBR.VerifyVisualAppearance(targetPart: BasePart): PBRVisualVerificationReport`,
    '    local sa = targetPart:FindFirstChildOfClass("SurfaceAppearance")',
    '    local channelStatus: { [string]: string } = {',
    '        ColorMap = "missing",',
    '        NormalMap = "missing",',
    '        RoughnessMap = "missing",',
    '        MetalnessMap = "missing",',
    '    }',
    '    local verifiedCloudCount = 0',
    '    local verifiedDecodedCount = 0',
    '    if sa then',
    '        if isValidRobloxAssetUri(sa.ColorMap) then channelStatus.ColorMap = "cloud_published"; verifiedCloudCount += 1 end',
    '        if isValidRobloxAssetUri(sa.NormalMap) then channelStatus.NormalMap = "cloud_published"; verifiedCloudCount += 1 end',
    '        if isValidRobloxAssetUri(sa.RoughnessMap) then channelStatus.RoughnessMap = "cloud_published"; verifiedCloudCount += 1 end',
    '        if isValidRobloxAssetUri(sa.MetalnessMap) then channelStatus.MetalnessMap = "cloud_published"; verifiedCloudCount += 1 end',
    '    end',
    '    for _, chName in ipairs({ "ColorMap", "NormalMap", "RoughnessMap", "MetalnessMap" }) do',
    '        local b64 = EMBEDDED_CHANNEL_RGBA32_B64[chName] or ""',
    '        if decodeBase64ToBuffer(b64, 32 * 32 * 4) ~= nil then',
    '            verifiedDecodedCount += 1',
    '            if channelStatus[chName] == "missing" then',
    '                channelStatus[chName] = "local_rgba_verified"',
    '            end',
    '        end',
    '    end',
    '    local editableActive = targetPart:GetAttribute("PBR_EditableImageBound") == true',
    '    if channelStatus.ColorMap ~= "cloud_published" and editableActive then',
    '        channelStatus.ColorMap = "editable_image_bound"',
    '    end',
    '    local pubState = if verifiedCloudCount == 4 then "cloud_published" elseif verifiedCloudCount > 0 then "partially_published" elseif (editableActive or verifiedDecodedCount == 4) then "local_saved" else "failed"',
    '    local passed = (verifiedCloudCount > 0) or editableActive or (verifiedDecodedCount == 4)',
    '    targetPart:SetAttribute("PBR_VisualVerificationPassed", passed)',
    '    targetPart:SetAttribute("PBR_VerifiedChannelsCount", verifiedCloudCount)',
    '    targetPart:SetAttribute("PBR_VerifiedDecodedChannelsCount", verifiedDecodedCount)',
    '    targetPart:SetAttribute("PBR_PublicationStatus", pubState)',
    '    return {',
    '        visualVerificationPassed = passed,',
    '        publicationState = pubState,',
    '        verifiedCloudChannelCount = verifiedCloudCount,',
    '        verifiedDecodedChannelCount = verifiedDecodedCount,',
    '        editableImageFallbackActive = editableActive,',
    '        channelStatus = channelStatus,',
    '    }',
    'end',
    '',
    `function ${safeMat}PBR.Apply(targetPart: BasePart, overrideIds: PublishedPBRTextureIds?): SurfaceAppearance`,
    '    local existing = targetPart:FindFirstChildOfClass("SurfaceAppearance")',
    '    if existing then',
    '        existing:Destroy()',
    '    end',
    '    local ids = overrideIds or PUBLISHED_TEXTURE_IDS',
    '    local surface = Instance.new("SurfaceAppearance")',
    `    surface.Name = "${safeMat}_SurfaceAppearance"`,
    '    surface.AlphaMode = Enum.AlphaMode.Overlay',
    `    targetPart.Color = Color3.fromRGB(${rVal}, ${gVal}, ${bVal})`,
    `    targetPart.Reflectance = ${Math.min(1, Math.max(0, Number(metalness) * 0.35)).toFixed(2)}`,
    '    if isValidRobloxAssetUri(ids.ColorMap) then',
    '        surface.ColorMap = ids.ColorMap :: string',
    '        targetPart:SetAttribute("PBR_Channel_ColorMap", "cloud_published")',
    '    else',
    '        targetPart:SetAttribute("PBR_Channel_ColorMap", "unverified_or_local")',
    '    end',
    '    if isValidRobloxAssetUri(ids.NormalMap) then',
    '        surface.NormalMap = ids.NormalMap :: string',
    '        targetPart:SetAttribute("PBR_Channel_NormalMap", "cloud_published")',
    '    else',
    '        targetPart:SetAttribute("PBR_Channel_NormalMap", "unverified_or_local")',
    '    end',
    '    if isValidRobloxAssetUri(ids.RoughnessMap) then',
    '        surface.RoughnessMap = ids.RoughnessMap :: string',
    '        targetPart:SetAttribute("PBR_Channel_RoughnessMap", "cloud_published")',
    '    else',
    '        targetPart:SetAttribute("PBR_Channel_RoughnessMap", "unverified_or_local")',
    '    end',
    '    if isValidRobloxAssetUri(ids.MetalnessMap) then',
    '        surface.MetalnessMap = ids.MetalnessMap :: string',
    '        targetPart:SetAttribute("PBR_Channel_MetalnessMap", "cloud_published")',
    '    else',
    '        targetPart:SetAttribute("PBR_Channel_MetalnessMap", "unverified_or_local")',
    '    end',
    '',
    '    if not isValidRobloxAssetUri(ids.ColorMap) then',
    '        local okEditableImg, editableImg = pcall(function()',
    '            local img = AssetService:CreateEditableImage({ Size = Vector2.new(32, 32) })',
    '            local pixelBuffer = decodeBase64ToBuffer(EMBEDDED_CHANNEL_RGBA32_B64.ColorMap, 32 * 32 * 4)',
    '            if not pixelBuffer then',
    '                pixelBuffer = buffer.create(32 * 32 * 4)',
    '                for py = 0, 31 do',
    '                    for px = 0, 31 do',
    '                        local offset = (py * 32 + px) * 4',
    `                        buffer.writeu8(pixelBuffer, offset, ${rVal})`,
    `                        buffer.writeu8(pixelBuffer, offset + 1, ${gVal})`,
    `                        buffer.writeu8(pixelBuffer, offset + 2, ${bVal})`,
    '                        buffer.writeu8(pixelBuffer, offset + 3, 255)',
    '                    end',
    '                end',
    '            end',
    '            img:WritePixelsBuffer(Vector2.zero, Vector2.new(32, 32), pixelBuffer)',
    '            return img',
    '        end)',
    '        if okEditableImg and editableImg and targetPart:IsA("MeshPart") then',
    '            local okBind = pcall(function()',
    '                (targetPart :: any).TextureContent = Content.fromObject(editableImg)',
    '            end)',
    '            targetPart:SetAttribute("PBR_EditableImageBound", okBind)',
    '        end',
    '    end',
    `    targetPart:SetAttribute("PBR_MaterialName", "${safeMat}")`,
    `    targetPart:SetAttribute("PBR_Roughness", ${Number(roughness).toFixed(2)})`,
    `    targetPart:SetAttribute("PBR_Metalness", ${Number(metalness).toFixed(2)})`,
    `    targetPart:SetAttribute("PBR_AlbedoHex", "${albedoHex}")`,
    `    targetPart:SetAttribute("PBR_LocalColorMapPath", "${targetFolder}/${safeMat}_ColorMap.png")`,
    `    targetPart:SetAttribute("PBR_LocalNormalMapPath", "${targetFolder}/${safeMat}_NormalMap.png")`,
    `    targetPart:SetAttribute("PBR_LocalRoughnessMapPath", "${targetFolder}/${safeMat}_RoughnessMap.png")`,
    `    targetPart:SetAttribute("PBR_LocalMetalnessMapPath", "${targetFolder}/${safeMat}_MetalnessMap.png")`,
    `    targetPart:SetAttribute("PBR_HasPublishedCloudIds", ${Boolean(validColor || validNormal || validRoughness || validMetalness) ? 'true' : 'false'})`,
    '    surface.Parent = targetPart',
    `    ${safeMat}PBR.VerifyVisualAppearance(targetPart)`,
    '    return surface',
    'end',
    '',
    `return ${safeMat}PBR`,
  ];
  return lines.join('\n');
}
