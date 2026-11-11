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

/**
 * Computes a deterministic 32-bit FNV-1a hex hash over normalized LF string content.
 * Matches `computeLuauContentHash` inside `ForgeAIStudioPlugin.server.luau`
 * so Roblox Studio can verify exact script content synchronization against Rojo on disk.
 */
export function computeFnv1a32Hex(text: string): string {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  const bytes = Buffer.from(normalized, 'utf-8');
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Computes deterministic per-part SHA-256 hashes (geometry, material/PBR, transform, hierarchy)
 * and ensures a stable `partId` (`forgePartId`) and `parentName` hierarchy field.
 */
export function computePartSyncHashes(part: any, indexFallback: number = 0): {
  partId: string;
  parentName: string;
  hierarchyPath: string;
  geometryHash: string;
  materialHash: string;
  transformHash: string;
  combinedHash: string;
} {
  const safePartName =
    String(part?.name || `MeshPart_${indexFallback + 1}`).trim() || `MeshPart_${indexFallback + 1}`;
  const parentName =
    String(part?.parentName || part?.parent_name || 'ModelRoot').trim() || 'ModelRoot';
  const partId =
    String(part?.partId || part?.part_id || '').trim() ||
    `fpart_${safePartName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const hierarchyPath = `${parentName}/${safePartName}`;

  const md = part?.meshData || {};
  const geomPayload = JSON.stringify({
    v: md.vertices || [],
    n: md.normals || [],
    uv: md.uvs || [],
    f: md.faces || [],
    meshId: part?.meshId || md.meshId || '',
  });
  const geometryHash = crypto.createHash('sha256').update(geomPayload).digest('hex').slice(0, 16);

  const matPayload = JSON.stringify({
    color: part?.color || [148, 163, 184],
    material: part?.material || 'Metal',
    roughness: Number(part?.roughness ?? 0.35).toFixed(3),
    metalness: Number(part?.metalness ?? 0.65).toFixed(3),
    transparency: Number(part?.transparency ?? 0).toFixed(3),
    pbr: part?.pbrMaterial || null,
  });
  const materialHash = crypto.createHash('sha256').update(matPayload).digest('hex').slice(0, 16);

  const transformPayload = JSON.stringify({
    size: (part?.size || [2, 2, 2]).map((n: number) => Number(Number(n).toFixed(3))),
    position: (part?.position || [0, 1, 0]).map((n: number) => Number(Number(n).toFixed(3))),
    rotation: (part?.rotation || [0, 0, 0]).map((n: number) => Number(Number(n).toFixed(2))),
    parentName,
  });
  const transformHash = crypto
    .createHash('sha256')
    .update(transformPayload)
    .digest('hex')
    .slice(0, 16);

  const combinedHash = crypto
    .createHash('sha256')
    .update(`${partId}:${geometryHash}:${materialHash}:${transformHash}`)
    .digest('hex')
    .slice(0, 16);

  return {
    partId,
    parentName,
    hierarchyPath,
    geometryHash,
    materialHash,
    transformHash,
    combinedHash,
  };
}

/**
 * Normalizes a part list so every part carries a stable `partId`, `parentName`, `hierarchyPath`,
 * and deterministic `geometryHash`, `materialHash`, and `transformHash`.
 */
export function normalizePartsWithSyncMetadata(parts: any[]): any[] {
  if (!Array.isArray(parts)) return [];
  return parts.map((p, idx) => {
    const syncMeta = computePartSyncHashes(p, idx);
    return {
      ...p,
      partId: syncMeta.partId,
      parentName: syncMeta.parentName,
      hierarchyPath: syncMeta.hierarchyPath,
      geometryHash: syncMeta.geometryHash,
      materialHash: syncMeta.materialHash,
      transformHash: syncMeta.transformHash,
    };
  });
}

/**
 * Computes a canonical SHA-256 snapshot digest across an asset's geometry (`parts` + `meshData`),
 * hierarchy (`parentName`), and PBR state (`pbr_profile` + per-part `pbrMaterial`) so the unified
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
      g: hashes.geometryHash,
      m: hashes.materialHash,
      t: hashes.transformHash,
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
 * Compares the web editor asset (`forgeAsset`) against a live Roblox Studio DataModel part list
 * (`studioParts`) using stable `partId` (`ForgePartId`) identifiers, reporting exact differences
 * across geometry, transformations, hierarchies, and materials.
 */
export function computeDataModelSyncDiffServer(
  forgeAsset: any,
  studioParts: any[]
): {
  inSync: boolean;
  modelName: string;
  totalForgeParts: number;
  totalStudioParts: number;
  matchingPartsCount: number;
  addedInStudio: string[];
  removedInStudio: string[];
  modifiedGeometry: string[];
  modifiedTransform: string[];
  modifiedHierarchy: string[];
  modifiedMaterial: string[];
  partDiffs: Array<{
    partId: string;
    name: string;
    status: 'in_sync' | 'modified' | 'added_in_studio' | 'missing_in_studio';
    geometryMatch: boolean;
    transformMatch: boolean;
    hierarchyMatch: boolean;
    materialMatch: boolean;
    forgeHashes?: { geometryHash: string; transformHash: string; materialHash: string; parentName: string };
    studioHashes?: { geometryHash: string; transformHash: string; materialHash: string; parentName: string };
  }>;
} {
  const forgeParts = normalizePartsWithSyncMetadata(forgeAsset?.parts || []);
  const normStudio = normalizePartsWithSyncMetadata(studioParts || []);

  const forgeById = new Map<string, any>();
  const forgeByName = new Map<string, any>();
  for (const fp of forgeParts) {
    forgeById.set(fp.partId, fp);
    forgeByName.set(fp.name, fp);
  }

  const seenForgeIds = new Set<string>();
  const addedInStudio: string[] = [];
  const removedInStudio: string[] = [];
  const modifiedGeometry: string[] = [];
  const modifiedTransform: string[] = [];
  const modifiedHierarchy: string[] = [];
  const modifiedMaterial: string[] = [];
  const partDiffs: Array<any> = [];
  let matchingPartsCount = 0;

  for (const sp of normStudio) {
    const fp = forgeById.get(sp.partId) || forgeByName.get(sp.name);
    if (!fp) {
      addedInStudio.push(sp.name);
      partDiffs.push({
        partId: sp.partId,
        name: sp.name,
        status: 'added_in_studio',
        geometryMatch: false,
        transformMatch: false,
        hierarchyMatch: false,
        materialMatch: false,
        studioHashes: {
          geometryHash: sp.geometryHash,
          transformHash: sp.transformHash,
          materialHash: sp.materialHash,
          parentName: sp.parentName,
        },
      });
      continue;
    }

    seenForgeIds.add(fp.partId);
    const geometryMatch = fp.geometryHash === sp.geometryHash;
    const transformMatch = fp.transformHash === sp.transformHash;
    const hierarchyMatch = fp.parentName === sp.parentName;
    const materialMatch = fp.materialHash === sp.materialHash;

    if (!geometryMatch) modifiedGeometry.push(fp.name);
    if (!transformMatch) modifiedTransform.push(fp.name);
    if (!hierarchyMatch) modifiedHierarchy.push(fp.name);
    if (!materialMatch) modifiedMaterial.push(fp.name);

    const allMatch = geometryMatch && transformMatch && hierarchyMatch && materialMatch;
    if (allMatch) matchingPartsCount++;

    partDiffs.push({
      partId: fp.partId,
      name: fp.name,
      status: allMatch ? 'in_sync' : 'modified',
      geometryMatch,
      transformMatch,
      hierarchyMatch,
      materialMatch,
      forgeHashes: {
        geometryHash: fp.geometryHash,
        transformHash: fp.transformHash,
        materialHash: fp.materialHash,
        parentName: fp.parentName,
      },
      studioHashes: {
        geometryHash: sp.geometryHash,
        transformHash: sp.transformHash,
        materialHash: sp.materialHash,
        parentName: sp.parentName,
      },
    });
  }

  for (const fp of forgeParts) {
    if (!seenForgeIds.has(fp.partId)) {
      removedInStudio.push(fp.name);
      partDiffs.push({
        partId: fp.partId,
        name: fp.name,
        status: 'missing_in_studio',
        geometryMatch: false,
        transformMatch: false,
        hierarchyMatch: false,
        materialMatch: false,
        forgeHashes: {
          geometryHash: fp.geometryHash,
          transformHash: fp.transformHash,
          materialHash: fp.materialHash,
          parentName: fp.parentName,
        },
      });
    }
  }

  const inSync =
    addedInStudio.length === 0 &&
    removedInStudio.length === 0 &&
    modifiedGeometry.length === 0 &&
    modifiedTransform.length === 0 &&
    modifiedHierarchy.length === 0 &&
    modifiedMaterial.length === 0 &&
    forgeParts.length === normStudio.length;

  return {
    inSync,
    modelName: String(forgeAsset?.name || 'Model3D'),
    totalForgeParts: forgeParts.length,
    totalStudioParts: normStudio.length,
    matchingPartsCount,
    addedInStudio,
    removedInStudio,
    modifiedGeometry,
    modifiedTransform,
    modifiedHierarchy,
    modifiedMaterial,
    partDiffs,
  };
}

/**
 * UNIFIED PERSISTENCE SERVICE (TypeScript Server Parity with Python `AssetEngine`):
 * Single authoritative service for loading, upserting (with 20 SHA-256 deduplicated snapshots),
 * restoring versions, and deleting assets in `assets_library.json`.
 */
export function loadAssetsLibraryServer(libraryFilePath: string): any[] {
  if (!fs.existsSync(libraryFilePath)) {
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(libraryFilePath, 'utf-8'));
    return Array.isArray(raw) ? raw : Array.isArray(raw?.assets) ? raw.assets : [];
  } catch {
    return [];
  }
}

export function saveAssetsLibraryServer(libraryFilePath: string, assets: any[]): void {
  fs.mkdirSync(path.dirname(libraryFilePath), { recursive: true });
  fs.writeFileSync(libraryFilePath, JSON.stringify(assets, null, 2), 'utf-8');
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

  expandedParts.forEach((p, idx) => {
    const refId = `RBX_PART_${idx + 1}`;
    const [sx = 2, sy = 2, sz = 2] = p.size || [2, 2, 2];
    const [px = 0, py = 1, pz = 0] = p.position || [0, 1, 0];
    const [rx = 0, ry = 0, rz = 0] = p.rotation || [0, 0, 0];
    const [cr = 148, cg = 163, cb = 184] = p.color || [148, 163, 184];
    const rotMat = eulerDegToRotationMatrixServer(rx, ry, rz);
    const matToken = robloxMaterialEnum[p.material] ?? 1088;
    const cfToken = cfEnumMap[p.collisionFidelity || collisionFidelity] ?? 1;
    const md = p.meshData || synthesizeProceduralMeshData('MeshPart', [sx, sy, sz]);
    const validMeshId = validatePublishedRobloxMeshId(p.meshId || md.meshId);
    const validTexId = validatePublishedRobloxMeshId(p.textureId);

    const syncMeta = computePartSyncHashes(p, idx);
    const pbr = (p as any).pbrMaterial || {};
    const validColorMap = validatePublishedRobloxMeshId(pbr.colorMapAssetId);
    const validNormalMap = validatePublishedRobloxMeshId(pbr.normalMapAssetId);
    const validRoughMap = validatePublishedRobloxMeshId(pbr.roughnessMapAssetId);
    const validMetalMap = validatePublishedRobloxMeshId(pbr.metalnessMapAssetId);

    const serializedMeshJson = JSON.stringify({
      partId: syncMeta.partId,
      parentName: syncMeta.parentName,
      hierarchyPath: syncMeta.hierarchyPath,
      geometryHash: syncMeta.geometryHash,
      materialHash: syncMeta.materialHash,
      transformHash: syncMeta.transformHash,
      vertices: md.vertices,
      normals: md.normals,
      uvs: md.uvs,
      faces: md.faces,
      size: [sx, sy, sz],
      position: [px, py, pz],
      rotation: [rx, ry, rz],
      color: [cr, cg, cb],
      material: p.material,
      roughness: p.roughness,
      metalness: p.metalness,
      transparency: p.transparency,
      canCollide: p.canCollide,
      anchored: p.anchored,
      collisionFidelity: p.collisionFidelity || collisionFidelity,
      pbrMaterial: (p as any).pbrMaterial || undefined,
    });

    lines.push(
      `    <Item class="MeshPart" referent="${refId}">`,
      '      <Properties>',
      `        <string name="Name">${escapeXmlServer(p.name || `MeshPart_${idx + 1}`)}</string>`,
      `        <bool name="Anchored">${p.anchored !== false ? 'true' : 'false'}</bool>`,
      `        <bool name="CanCollide">${p.canCollide !== false ? 'true' : 'false'}</bool>`,
      `        <token name="CollisionFidelity">${cfToken}</token>`,
      '        <token name="RenderFidelity">1</token>',
      `        <token name="Material">${matToken}</token>`,
      `        <float name="Transparency">${Number(p.transparency ?? 0).toFixed(3)}</float>`,
      `        <float name="Reflectance">${(Number(p.metalness ?? 0.5) * 0.35).toFixed(3)}</float>`,
      '        <Color3 name="Color3uint8">',
      `          <R>${(cr / 255).toFixed(4)}</R>`,
      `          <G>${(cg / 255).toFixed(4)}</G>`,
      `          <B>${(cb / 255).toFixed(4)}</B>`,
      '        </Color3>',
      '        <Vector3 name="size">',
      `          <X>${Number(sx).toFixed(4)}</X>`,
      `          <Y>${Number(sy).toFixed(4)}</Y>`,
      `          <Z>${Number(sz).toFixed(4)}</Z>`,
      '        </Vector3>',
      '        <Vector3 name="InitialSize">',
      `          <X>${Number(sx).toFixed(4)}</X>`,
      `          <Y>${Number(sy).toFixed(4)}</Y>`,
      `          <Z>${Number(sz).toFixed(4)}</Z>`,
      '        </Vector3>',
      '        <CoordinateFrame name="CFrame">',
      `          <X>${Number(px).toFixed(4)}</X>`,
      `          <Y>${Number(py).toFixed(4)}</Y>`,
      `          <Z>${Number(pz).toFixed(4)}</Z>`,
      `          <R00>${rotMat[0].toFixed(6)}</R00>`,
      `          <R01>${rotMat[1].toFixed(6)}</R01>`,
      `          <R02>${rotMat[2].toFixed(6)}</R02>`,
      `          <R10>${rotMat[3].toFixed(6)}</R10>`,
      `          <R11>${rotMat[4].toFixed(6)}</R11>`,
      `          <R12>${rotMat[5].toFixed(6)}</R12>`,
      `          <R20>${rotMat[6].toFixed(6)}</R20>`,
      `          <R21>${rotMat[7].toFixed(6)}</R21>`,
      `          <R22>${rotMat[8].toFixed(6)}</R22>`,
      '        </CoordinateFrame>',
      validMeshId
        ? `        <Content name="MeshId"><url>${escapeXmlServer(validMeshId)}</url></Content>`
        : '        <Content name="MeshId"><null></null></Content>',
      validTexId
        ? `        <Content name="TextureID"><url>${escapeXmlServer(validTexId)}</url></Content>`
        : '        <Content name="TextureID"><null></null></Content>',
      '      </Properties>',
      `      <Item class="SurfaceAppearance" referent="${refId}_PBR">`,
      '        <Properties>',
      `          <string name="Name">${escapeXmlServer(p.name || `MeshPart_${idx + 1}`)}_PBRSurface</string>`,
      '          <token name="AlphaMode">0</token>',
      validColorMap
        ? `          <Content name="ColorMap"><url>${escapeXmlServer(validColorMap)}</url></Content>`
        : '          <Content name="ColorMap"><null></null></Content>',
      validNormalMap
        ? `          <Content name="NormalMap"><url>${escapeXmlServer(validNormalMap)}</url></Content>`
        : '          <Content name="NormalMap"><null></null></Content>',
      validRoughMap
        ? `          <Content name="RoughnessMap"><url>${escapeXmlServer(validRoughMap)}</url></Content>`
        : '          <Content name="RoughnessMap"><null></null></Content>',
      validMetalMap
        ? `          <Content name="MetalnessMap"><url>${escapeXmlServer(validMetalMap)}</url></Content>`
        : '          <Content name="MetalnessMap"><null></null></Content>',
      '        </Properties>',
      '      </Item>',
      `      <Item class="StringValue" referent="${refId}_PART_ID">`,
      '        <Properties>',
      '          <string name="Name">ForgePartId</string>',
      `          <string name="Value">${escapeXmlServer(syncMeta.partId)}</string>`,
      '        </Properties>',
      '      </Item>',
      `      <Item class="StringValue" referent="${refId}_PARENT_NAME">`,
      '        <Properties>',
      '          <string name="Name">ForgeParentName</string>',
      `          <string name="Value">${escapeXmlServer(syncMeta.parentName)}</string>`,
      '        </Properties>',
      '      </Item>',
      `      <Item class="StringValue" referent="${refId}_GEOM">`,
      '        <Properties>',
      '          <string name="Name">ForgeMeshGeometryJSON</string>',
      `          <string name="Value">${escapeXmlServer(serializedMeshJson)}</string>`,
      '        </Properties>',
      '      </Item>',
      '    </Item>'
    );
  });

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
 * Recovers full CFrames (Position + Euler Rotation from 3x3 rotation matrix), Sizes, Colors,
 * Roblox Material enums, 4-channel `SurfaceAppearance` maps, `ForgePartId`, `ForgeParentName`,
 * and `ForgeMeshGeometryJSON` buffers.
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

  const parts: MeshPartInput[] = [];
  const startRegex = /<Item\s+class="(MeshPart|Part|WedgePart|CornerWedgePart|TrussPart)"[^>]*>/gi;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = startRegex.exec(rbxmxText)) !== null) {
    starts.push(m.index);
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

    let parentName =
      block.match(
        /<string\s+name="Name">ForgeParentName<\/string>\s*<string\s+name="Value">([^<]+)<\/string>/i
      )?.[1] || '';
    parentName = parentName ? unescapeXmlServer(parentName.trim()) : 'ModelRoot';

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
    let rotation: [number, number, number] = rotationMatrixToEulerDegServer([
      r00, r01, r02, r10, r11, r12, r20, r21, r22,
    ]);

    let color: [number, number, number] = [148, 163, 184];
    const colBlock = block.match(/<Color3\s+name="(?:Color3uint8|Color)">([\s\S]*?)<\/Color3>/i)?.[1];
    if (colBlock) {
      let cr = Number(colBlock.match(/<R>([^<]+)<\/R>/i)?.[1] ?? 0.58);
      let cg = Number(colBlock.match(/<G>([^<]+)<\/G>/i)?.[1] ?? 0.64);
      let cb = Number(colBlock.match(/<B>([^<]+)<\/B>/i)?.[1] ?? 0.72);
      if (cr <= 1 && cg <= 1 && cb <= 1) {
        cr = Math.round(cr * 255);
        cg = Math.round(cg * 255);
        cb = Math.round(cb * 255);
      }
      color = [
        Math.max(0, Math.min(255, Math.round(cr))),
        Math.max(0, Math.min(255, Math.round(cg))),
        Math.max(0, Math.min(255, Math.round(cb))),
      ];
    }

    const matTok = Number(block.match(/<token\s+name="Material">(\d+)<\/token>/i)?.[1] ?? 1088);
    let material = tokenToMaterial[matTok] || 'Metal';

    const cfTok = Number(block.match(/<token\s+name="CollisionFidelity">(\d+)<\/token>/i)?.[1] ?? 1);
    const collisionFidelity =
      tokenToCf[cfTok] ||
      (defaultCollisionFidelity as 'Box' | 'Hull' | 'Default' | 'PreciseConvexDecomposition') ||
      'Hull';

    const transparency = Number(block.match(/<float\s+name="Transparency">([^<]+)<\/float>/i)?.[1] ?? 0);
    const reflectance = Number(block.match(/<float\s+name="Reflectance">([^<]+)<\/float>/i)?.[1] ?? 0.2);
    const anchored = (block.match(/<bool\s+name="Anchored">([^<]+)<\/bool>/i)?.[1] ?? 'true') !== 'false';
    const canCollide = (block.match(/<bool\s+name="CanCollide">([^<]+)<\/bool>/i)?.[1] ?? 'true') !== 'false';

    const meshIdRaw = block.match(/<Content\s+name="MeshId">\s*<url>([^<]+)<\/url>/i)?.[1];
    const texIdRaw = block.match(/<Content\s+name="TextureID">\s*<url>([^<]+)<\/url>/i)?.[1];
    const meshId = validatePublishedRobloxMeshId(meshIdRaw ? unescapeXmlServer(meshIdRaw) : undefined) || undefined;
    const textureId = validatePublishedRobloxMeshId(texIdRaw ? unescapeXmlServer(texIdRaw) : undefined) || undefined;

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
    let roughness = 0.35;
    let metalness = Math.min(1, Math.max(0, Number((reflectance / 0.35).toFixed(2))));

    const geomMatch = block.match(
      /<string\s+name="Name">ForgeMeshGeometryJSON<\/string>\s*<string\s+name="Value">([\s\S]*?)<\/string>/i
    );
    if (geomMatch?.[1]) {
      try {
        const parsedGeom = JSON.parse(unescapeXmlServer(geomMatch[1].trim()));
        if (parsedGeom && Array.isArray(parsedGeom.vertices) && Array.isArray(parsedGeom.faces)) {
          meshData = extractGeometryFromProcessedMesh(
            {
              name: partName,
              studSize: [sx, sy, sz],
              meshData: parsedGeom,
            },
            `${modelName}.obj`,
            modelName
          );
          if (typeof parsedGeom.partId === 'string' && parsedGeom.partId) partId = parsedGeom.partId;
          if (typeof parsedGeom.parentName === 'string' && parsedGeom.parentName)
            parentName = parsedGeom.parentName;
          if (typeof parsedGeom.roughness === 'number') roughness = parsedGeom.roughness;
          if (typeof parsedGeom.metalness === 'number') metalness = parsedGeom.metalness;
          if (typeof parsedGeom.material === 'string') material = parsedGeom.material;
          if (Array.isArray(parsedGeom.rotation) && parsedGeom.rotation.length === 3) {
            rotation = [
              Number(parsedGeom.rotation[0]),
              Number(parsedGeom.rotation[1]),
              Number(parsedGeom.rotation[2]),
            ];
          }
          if (parsedGeom.pbrMaterial && typeof parsedGeom.pbrMaterial === 'object') {
            pbrMaterial = { ...(pbrMaterial || {}), ...parsedGeom.pbrMaterial };
          }
        }
      } catch {
        // Fallback to synthesized geometry below
      }
    }

    if (!meshData) {
      meshData = synthesizeProceduralMeshData('MeshPart', [sx, sy, sz]);
      meshData.objFileName = `${modelName}.obj`;
      if (meshId) {
        meshData.meshId = meshId;
        meshData.assetId = meshId;
      }
    }

    const basePartObj: any = {
      partId: partId || `fpart_${partName.replace(/[^a-zA-Z0-9_]/g, '_')}`,
      parentName: parentName || 'ModelRoot',
      name: partName,
      shape: 'MeshPart',
      meshId,
      assetId: meshId,
      textureId,
      size: [Number(sx.toFixed(3)), Number(sy.toFixed(3)), Number(sz.toFixed(3))],
      position: [Number(px.toFixed(3)), Number(py.toFixed(3)), Number(pz.toFixed(3))],
      rotation,
      color,
      material,
      roughness,
      metalness,
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
      parentName: syncHashes.parentName,
      hierarchyPath: syncHashes.hierarchyPath,
      geometryHash: syncHashes.geometryHash,
      materialHash: syncHashes.materialHash,
      transformHash: syncHashes.transformHash,
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
