/**
 * @module generation3DEngine
 * @description
 * Engine 1/7 — 3D Generation & EditableMesh Geometry Engine (TypeScript Server Module).
 *
 * RESPONSIBILITIES:
 * 1. Validate published Roblox Cloud Mesh URIs (`validatePublishedRobloxMeshId`) without
 *    ever inventing fictional hash-based `rbxassetid://` IDs or `rbxassetid://0`.
 * 2. Parse Wavefront `.OBJ` files (`parseWavefrontObjGeometry`) and uploaded sub-meshes
 *    (`extractGeometryFromProcessedMesh`, `extractPartsFromUploadedMesh`) into real
 *    vertex, normal, UV, and 0-based triangle index buffers.
 * 3. Automatically split high-polygon meshes exceeding 9,000 vertices or 9,500 triangles
 *    into contiguous sub-parts (`splitOversizedMeshPartInput`) so zero faces are lost.
 * 4. Generate `--!strict` Luau builder modules (`buildStrictLuauFromEditedParts`) that
 *    reconstruct geometry via `AssetService:CreateEditableMesh()`, verify triangle counts
 *    (`editableMesh:GetTriangles()`), release memory (`editableMesh:Destroy()`), and
 *    support in-place `.RBXMX` reconstruction (`ReconstructInPlace`).
 */

export interface SubMeshGeometryInput {
  vertices: Array<[number, number, number]>;
  normals: Array<[number, number, number]>;
  uvs: Array<[number, number]>;
  faces: Array<[number, number, number]>;
  indices?: number[];
  vertexColors?: Array<[number, number, number]>;
  objFileName?: string;
  meshId?: string;
  assetId?: string;
  geometrySource?: string;
}

export interface MeshPartInput {
  partId?: string;
  parentId?: string;
  parentName?: string;
  hierarchyPath?: string;
  name: string;
  shape: string;
  meshId?: string;
  assetId?: string;
  textureId?: string;
  geometrySource?: string;
  size: number[];
  position: number[];
  rotation: number[];
  rotationMatrix?: number[];
  color: number[];
  material: string;
  roughness: number;
  metalness: number;
  transparency: number;
  canCollide: boolean;
  anchored: boolean;
  collisionFidelity: string;
  meshData?: SubMeshGeometryInput;
  pbrMaterial?: Record<string, any>;
  geometryHash?: string;
  materialHash?: string;
  transformHash?: string;
}

/**
 * Validates whether a candidate string is a real published Roblox asset URI
 * (`rbxassetid://<positive_integer>` or `rbxasset://...`).
 * Never invents fictional hash-based IDs or `rbxassetid://0`.
 * Returns `""` when no verified cloud asset ID exists so geometry is built directly
 * from buffers via `AssetService:CreateEditableMesh()`.
 */
export function validatePublishedRobloxMeshId(candidate?: string | null): string {
  const raw = String(candidate || '').trim();
  if (!raw || raw.startsWith('rbxassetid://0') || raw === 'None' || raw === 'undefined') {
    return '';
  }
  if (/^rbxassetid:\/\/[1-9]\d*$/.test(raw)) {
    return raw;
  }
  if (/^rbxasset:\/\/.+/.test(raw)) {
    return raw;
  }
  return '';
}

/**
 * Backwards-compatible alias for `validatePublishedRobloxMeshId` that never invents
 * fictional `rbxassetid://` hashes.
 */
export function normalizeValidMeshId(
  candidate: string | undefined,
  _modelName?: string,
  _partName?: string,
  _vertexCount: number = 0,
  _faceCount: number = 0
): string {
  return validatePublishedRobloxMeshId(candidate);
}

/**
 * Splits a high-polygon `MeshPartInput` exceeding `maxVertsPerPart` or `maxFacesPerPart`
 * into multiple contiguous sub-meshes (`_Sub1`, `_Sub2`, ...) with remapped vertex, normal,
 * UV, and triangle index buffers so zero triangles are ever discarded or truncated.
 */
export function splitOversizedMeshPartInput(
  part: MeshPartInput,
  maxVertsPerPart: number = 9000,
  maxFacesPerPart: number = 9500
): MeshPartInput[] {
  const md = part.meshData;
  if (!md || !Array.isArray(md.faces) || md.faces.length === 0) {
    return [part];
  }
  if (md.vertices.length <= maxVertsPerPart && md.faces.length <= maxFacesPerPart) {
    return [part];
  }

  const splitParts: MeshPartInput[] = [];
  let chunkFaces: Array<[number, number, number]> = [];
  let usedVerts = new Set<number>();

  const flushChunk = (chunkIdx: number) => {
    if (chunkFaces.length === 0) return;
    const oldToNew = new Map<number, number>();
    const newVerts: Array<[number, number, number]> = [];
    const newNorms: Array<[number, number, number]> = [];
    const newUvs: Array<[number, number]> = [];
    const newFaces: Array<[number, number, number]> = [];
    const newFlatIndices: number[] = [];

    const totalV = md.vertices.length;
    const totalN = Array.isArray(md.normals) ? md.normals.length : 0;
    const totalUv = Array.isArray(md.uvs) ? md.uvs.length : 0;

    for (const tri of chunkFaces) {
      const remappedTri: [number, number, number] = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const oldIdx = tri[k];
        const safeOld = oldIdx >= 0 && oldIdx < totalV ? oldIdx : 0;
        let mapped = oldToNew.get(safeOld);
        if (mapped === undefined) {
          mapped = newVerts.length;
          oldToNew.set(safeOld, mapped);
          newVerts.push(md.vertices[safeOld] || [0, 0, 0]);
          newNorms.push(safeOld < totalN ? md.normals[safeOld] : [0, 1, 0]);
          newUvs.push(safeOld < totalUv ? md.uvs[safeOld] : [0, 0]);
        }
        remappedTri[k] = mapped;
      }
      newFaces.push(remappedTri);
      newFlatIndices.push(remappedTri[0], remappedTri[1], remappedTri[2]);
    }

    const subGeom: SubMeshGeometryInput = {
      vertices: newVerts,
      normals: newNorms,
      uvs: newUvs,
      faces: newFaces,
      indices: newFlatIndices,
      objFileName: md.objFileName,
      meshId: validatePublishedRobloxMeshId(md.meshId),
      assetId: validatePublishedRobloxMeshId(md.assetId),
    };

    splitParts.push({
      ...part,
      name: `${part.name}_Sub${chunkIdx}`,
      meshData: subGeom,
    });
  };

  let chunkCounter = 1;
  for (const tri of md.faces) {
    if (!Array.isArray(tri) || tri.length < 3) continue;
    const triVerts = [tri[0], tri[1], tri[2]];
    let newVertCount = usedVerts.size;
    for (const vIdx of triVerts) {
      if (!usedVerts.has(vIdx)) newVertCount++;
    }
    if (
      chunkFaces.length > 0 &&
      (chunkFaces.length + 1 > maxFacesPerPart || newVertCount > maxVertsPerPart)
    ) {
      flushChunk(chunkCounter);
      chunkCounter++;
      chunkFaces = [];
      usedVerts = new Set<number>();
    }
    chunkFaces.push([tri[0], tri[1], tri[2]]);
    usedVerts.add(tri[0]);
    usedVerts.add(tri[1]);
    usedVerts.add(tri[2]);
  }

  if (chunkFaces.length > 0) {
    if (chunkCounter === 1) {
      return [part];
    }
    flushChunk(chunkCounter);
  }

  return splitParts.length > 0 ? splitParts : [part];
}

/**
 * Parses an uploaded Wavefront .OBJ mesh (`v`, `vn`, `vt`, `f`) to extract real vertex,
 * normal, UV, and 0-based triangle index buffers.
 */
export function parseWavefrontObjGeometry(
  objText: string,
  objFileName?: string,
  _modelName: string = 'UploadedMeshModel',
  _partName: string = 'MeshPart_1'
): SubMeshGeometryInput {
  const rawPositions: Array<[number, number, number]> = [];
  const rawNormals: Array<[number, number, number]> = [];
  const rawUvs: Array<[number, number]> = [];

  const outVertices: Array<[number, number, number]> = [];
  const outUvs: Array<[number, number]> = [];
  const outNormals: Array<[number, number, number] | null> = [];
  const faces: Array<[number, number, number]> = [];

  // Maps "vIdx|vtIdx|vnIdx" -> unified 0-based vertex index
  const uniqueCornerMap = new Map<string, number>();

  const resolveIndex = (tokenStr: string | undefined, currentLen: number): number => {
    if (!tokenStr) return -1;
    const raw = parseInt(tokenStr, 10);
    if (Number.isNaN(raw) || raw === 0) return -1;
    const resolved = raw > 0 ? raw - 1 : currentLen + raw;
    return resolved >= 0 && resolved < currentLen ? resolved : -1;
  };

  const lines = (objText || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const prefix = parts[0];
    if (prefix === 'v' && parts.length >= 4) {
      const vx = parseFloat(parts[1]);
      const vy = parseFloat(parts[2]);
      const vz = parseFloat(parts[3]);
      if (!Number.isNaN(vx) && !Number.isNaN(vy) && !Number.isNaN(vz)) {
        rawPositions.push([vx, vy, vz]);
      }
    } else if (prefix === 'vn' && parts.length >= 4) {
      const nx = parseFloat(parts[1]);
      const ny = parseFloat(parts[2]);
      const nz = parseFloat(parts[3]);
      if (!Number.isNaN(nx) && !Number.isNaN(ny) && !Number.isNaN(nz)) {
        const mag = Math.hypot(nx, ny, nz);
        rawNormals.push(mag > 1e-6 ? [nx / mag, ny / mag, nz / mag] : [0, 1, 0]);
      }
    } else if (prefix === 'vt' && parts.length >= 3) {
      const u = parseFloat(parts[1]);
      const v = parseFloat(parts[2]);
      if (!Number.isNaN(u) && !Number.isNaN(v)) {
        rawUvs.push([u, v]);
      }
    } else if (prefix === 'f' && parts.length >= 4) {
      const faceUnifiedIndices: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const subTokens = parts[i].split('/');
        const vIdx = resolveIndex(subTokens[0], rawPositions.length);
        if (vIdx < 0) continue;
        const vtIdx = subTokens.length >= 2 ? resolveIndex(subTokens[1], rawUvs.length) : -1;
        const vnIdx = subTokens.length >= 3 ? resolveIndex(subTokens[2], rawNormals.length) : -1;

        const cornerKey = `${vIdx}|${vtIdx}|${vnIdx}`;
        let unifiedIdx = uniqueCornerMap.get(cornerKey);
        if (unifiedIdx === undefined) {
          unifiedIdx = outVertices.length;
          uniqueCornerMap.set(cornerKey, unifiedIdx);
          const pos = rawPositions[vIdx];
          outVertices.push([pos[0], pos[1], pos[2]]);
          if (vtIdx >= 0 && vtIdx < rawUvs.length) {
            const uv = rawUvs[vtIdx];
            outUvs.push([uv[0], uv[1]]);
          } else {
            outUvs.push([0, 0]);
          }
          if (vnIdx >= 0 && vnIdx < rawNormals.length) {
            const nm = rawNormals[vnIdx];
            outNormals.push([nm[0], nm[1], nm[2]]);
          } else {
            outNormals.push(null);
          }
        }
        faceUnifiedIndices.push(unifiedIdx);
      }

      for (let i = 1; i < faceUnifiedIndices.length - 1; i++) {
        const i0 = faceUnifiedIndices[0];
        const i1 = faceUnifiedIndices[i];
        const i2 = faceUnifiedIndices[i + 1];
        if (i0 !== i1 && i1 !== i2 && i0 !== i2) {
          faces.push([i0, i1, i2]);
        }
      }
    }
  }

  if (outVertices.length === 0 && rawPositions.length > 0) {
    for (let i = 0; i < rawPositions.length; i++) {
      outVertices.push([...rawPositions[i]]);
      outUvs.push(i < rawUvs.length ? [...rawUvs[i]] : [0, 0]);
      outNormals.push(i < rawNormals.length ? [...rawNormals[i]] : null);
    }
  }

  // Compute area-weighted smooth normals for any vertex corner lacking an explicit vn
  const accum: Array<[number, number, number]> = outVertices.map(() => [0, 0, 0]);
  for (const [i0, i1, i2] of faces) {
    if (i0 < outVertices.length && i1 < outVertices.length && i2 < outVertices.length) {
      const v0 = outVertices[i0];
      const v1 = outVertices[i1];
      const v2 = outVertices[i2];
      const ux = v1[0] - v0[0];
      const uy = v1[1] - v0[1];
      const uz = v1[2] - v0[2];
      const wx = v2[0] - v0[0];
      const wy = v2[1] - v0[1];
      const wz = v2[2] - v0[2];
      const nx = uy * wz - uz * wy;
      const ny = uz * wx - ux * wz;
      const nz = ux * wy - uy * wx;
      for (const idx of [i0, i1, i2]) {
        accum[idx][0] += nx;
        accum[idx][1] += ny;
        accum[idx][2] += nz;
      }
    }
  }

  const finalNormals: Array<[number, number, number]> = outVertices.map((_, i) => {
    const explicitNorm = outNormals[i];
    if (explicitNorm) return explicitNorm;
    const [nx, ny, nz] = accum[i];
    const mag = Math.hypot(nx, ny, nz);
    return mag > 1e-6 ? [nx / mag, ny / mag, nz / mag] : [0, 1, 0];
  });

  const indices: number[] = [];
  for (const tri of faces) {
    indices.push(tri[0], tri[1], tri[2]);
  }

  return {
    vertices: outVertices,
    normals: finalNormals,
    uvs: outUvs,
    faces,
    indices,
    objFileName,
    meshId: '',
    assetId: '',
  };
}

/**
 * Extracts real vertex, index (faces), normal, and UV data from a processed or uploaded sub-mesh payload.
 */
export function extractGeometryFromProcessedMesh(
  sub: any,
  defaultObjFileName?: string,
  modelName: string = 'ProcessedMeshModel'
): SubMeshGeometryInput {
  const objFile = sub?.objFileName || defaultObjFileName;
  const partName = String(sub?.name || 'MeshPart_1');
  const rawMeshId = sub?.meshId || sub?.mesh_id || sub?.meshData?.meshId;
  const rawAssetId = sub?.assetId || sub?.asset_id || sub?.meshData?.assetId || rawMeshId;
  const validMeshId = validatePublishedRobloxMeshId(rawMeshId);
  const validAssetId = validatePublishedRobloxMeshId(rawAssetId) || validMeshId;

  if (
    sub?.meshData &&
    Array.isArray(sub.meshData.vertices) &&
    sub.meshData.vertices.length > 0
  ) {
    const verts: Array<[number, number, number]> = sub.meshData.vertices;
    let faces: Array<[number, number, number]> = Array.isArray(sub.meshData.faces)
      ? sub.meshData.faces
      : [];
    if (faces.length === 0 && Array.isArray(sub.meshData.indices) && sub.meshData.indices.length >= 3) {
      faces = [];
      for (let i = 0; i < sub.meshData.indices.length - 2; i += 3) {
        faces.push([
          Number(sub.meshData.indices[i]),
          Number(sub.meshData.indices[i + 1]),
          Number(sub.meshData.indices[i + 2]),
        ]);
      }
    }
    const norms: Array<[number, number, number]> =
      Array.isArray(sub.meshData.normals) && sub.meshData.normals.length === verts.length
        ? sub.meshData.normals
        : verts.map(() => [0, 1, 0]);
    const uvs: Array<[number, number]> =
      Array.isArray(sub.meshData.uvs) && sub.meshData.uvs.length === verts.length
        ? sub.meshData.uvs
        : verts.map(() => [0, 0]);

    const indices: number[] = [];
    for (const tri of faces) {
      indices.push(tri[0], tri[1], tri[2]);
    }
    return {
      vertices: verts,
      normals: norms,
      uvs,
      faces,
      indices,
      vertexColors: sub.meshData.vertexColors,
      objFileName: sub.meshData.objFileName || objFile,
      meshId: validMeshId,
      assetId: validAssetId,
    };
  }

  if (Array.isArray(sub?.vertices) && sub.vertices.length > 0) {
    const verts: Array<[number, number, number]> = sub.vertices;
    let faces: Array<[number, number, number]> = Array.isArray(sub.faces) ? sub.faces : [];
    if (faces.length === 0 && Array.isArray(sub.indices) && sub.indices.length >= 3) {
      faces = [];
      for (let i = 0; i < sub.indices.length - 2; i += 3) {
        faces.push([
          Number(sub.indices[i]),
          Number(sub.indices[i + 1]),
          Number(sub.indices[i + 2]),
        ]);
      }
    }
    const norms: Array<[number, number, number]> =
      Array.isArray(sub.normals) && sub.normals.length === verts.length
        ? sub.normals
        : verts.map(() => [0, 1, 0]);
    const uvs: Array<[number, number]> =
      Array.isArray(sub.uvs) && sub.uvs.length === verts.length
        ? sub.uvs
        : verts.map(() => [0, 0]);

    const indices: number[] = [];
    for (const tri of faces) {
      indices.push(tri[0], tri[1], tri[2]);
    }
    return {
      vertices: verts,
      normals: norms,
      uvs,
      faces,
      indices,
      objFileName: objFile,
      meshId: validMeshId,
      assetId: validAssetId,
    };
  }

  const objChunk = sub?.wavefrontObjChunk || sub?.objChunk;
  if (typeof objChunk === 'string' && objChunk.includes('v ')) {
    const parsedObj = parseWavefrontObjGeometry(objChunk, objFile, modelName, partName);
    if (parsedObj.vertices.length > 0 && parsedObj.faces.length > 0) {
      parsedObj.meshId = validMeshId;
      parsedObj.assetId = validAssetId;
      return parsedObj;
    }
  }

  const rawGeomSource = String(
    sub?.geometrySource || sub?.geometry_source || sub?.meshData?.geometrySource || ''
  ).trim();
  if (
    validMeshId ||
    rawGeomSource === 'PublishedCloudMeshId' ||
    rawGeomSource === 'StudioExternalUnreadable'
  ) {
    return {
      vertices: [],
      normals: [],
      uvs: [],
      faces: [],
      indices: [],
      objFileName: objFile,
      meshId: validMeshId,
      assetId: validAssetId,
      geometrySource: validMeshId
        ? 'PublishedCloudMeshId'
        : rawGeomSource || 'StudioExternalUnreadable',
    };
  }

  const studSize = sub?.studSize || sub?.size || [2, 2, 2];
  const synth = synthesizeProceduralMeshData(sub?.shape || 'MeshPart', studSize);
  synth.objFileName = objFile;
  synth.meshId = validMeshId;
  synth.assetId = validAssetId;
  synth.geometrySource = 'EditableMeshBuffers';
  return synth;
}

/**
 * Extracts `MeshPartInput[]` directly from uploaded Wavefront `.OBJ` text or uploaded
 * sub-mesh geometry arrays, preserving exact vertex, normal, and triangle index data
 * and splitting oversized meshes (>9,000 vertices / >9,500 faces) into sub-meshes.
 */
export function extractPartsFromUploadedMesh(
  modelName: string,
  uploadedMeshObj?: string,
  uploadedSubMeshes?: any[],
  collisionFidelity: string = 'Hull'
): MeshPartInput[] {
  const safeModel = modelName.replace(/[^a-zA-Z0-9_]/g, '') || 'UploadedMeshModel';
  const objFileName = `${safeModel}.obj`;
  const parts: MeshPartInput[] = [];

  if (Array.isArray(uploadedSubMeshes) && uploadedSubMeshes.length > 0) {
    uploadedSubMeshes.forEach((sub, idx) => {
      const partName = String(sub?.name || `${safeModel}_MeshPart_${idx + 1}`);
      const geom = extractGeometryFromProcessedMesh(sub, objFileName, safeModel);
      const validMeshId = validatePublishedRobloxMeshId(sub?.meshId || sub?.mesh_id || geom.meshId);
      const validAssetId = validatePublishedRobloxMeshId(
        sub?.assetId || sub?.asset_id || geom.assetId || validMeshId
      );
      geom.meshId = validMeshId;
      geom.assetId = validAssetId;
      geom.objFileName = objFileName;

      let studSize: number[] = sub?.studSize || sub?.size || [];
      if (!Array.isArray(studSize) || studSize.length !== 3) {
        if (geom.vertices.length > 0) {
          const xs = geom.vertices.map((v) => v[0]);
          const ys = geom.vertices.map((v) => v[1]);
          const zs = geom.vertices.map((v) => v[2]);
          studSize = [
            Math.max(0.2, Math.max(...xs) - Math.min(...xs)),
            Math.max(0.2, Math.max(...ys) - Math.min(...ys)),
            Math.max(0.2, Math.max(...zs) - Math.min(...zs)),
          ];
        } else {
          studSize = [2, 2, 2];
        }
      }

      const rawPart: MeshPartInput = {
        name: partName,
        shape: 'MeshPart',
        meshId: validMeshId,
        assetId: validAssetId,
        textureId: validatePublishedRobloxMeshId(sub?.textureId || sub?.texture_id) || undefined,
        size: studSize,
        position: sub?.studPosition || sub?.position || [0, studSize[1] * 0.5, 0],
        rotation: sub?.studRotation || sub?.rotation || [0, 0, 0],
        color: sub?.colorRgb || sub?.color || [148, 163, 184],
        material: sub?.robloxMaterial || sub?.material || 'Metal',
        roughness: typeof sub?.roughness === 'number' ? sub.roughness : 0.35,
        metalness: typeof sub?.metalness === 'number' ? sub.metalness : 0.65,
        transparency: typeof sub?.transparency === 'number' ? sub.transparency : 0,
        canCollide: sub?.canCollide !== false,
        anchored: sub?.anchored !== false,
        collisionFidelity: sub?.collisionFidelity || collisionFidelity,
        meshData: geom,
      };
      parts.push(...splitOversizedMeshPartInput(rawPart));
    });
  } else if (typeof uploadedMeshObj === 'string' && uploadedMeshObj.includes('v ')) {
    const partName = `${safeModel}_MeshPart_1`;
    const geom = parseWavefrontObjGeometry(uploadedMeshObj, objFileName, safeModel, partName);
    let studSize = [4, 4, 4];
    if (geom.vertices.length > 0) {
      const xs = geom.vertices.map((v) => v[0]);
      const ys = geom.vertices.map((v) => v[1]);
      const zs = geom.vertices.map((v) => v[2]);
      studSize = [
        Math.max(0.2, Math.max(...xs) - Math.min(...xs)),
        Math.max(0.2, Math.max(...ys) - Math.min(...ys)),
        Math.max(0.2, Math.max(...zs) - Math.min(...zs)),
      ];
    }

    const rawPart: MeshPartInput = {
      name: partName,
      shape: 'MeshPart',
      meshId: '',
      assetId: '',
      size: studSize,
      position: [0, studSize[1] * 0.5, 0],
      rotation: [0, 0, 0],
      color: [148, 163, 184],
      material: 'Metal',
      roughness: 0.35,
      metalness: 0.65,
      transparency: 0,
      canCollide: true,
      anchored: true,
      collisionFidelity,
      meshData: geom,
    };
    parts.push(...splitOversizedMeshPartInput(rawPart));
  }

  return parts;
}

/**
 * Generates indexed triangle mesh buffers (vertices, normals, UVs, and 0-based triangle
 * index faces) in local Stud coordinates so every sub-part is serialized as a real
 * Roblox `MeshPart` without defaulting to primitive 'Block' parts.
 */
export function synthesizeProceduralMeshData(
  shape: string = 'MeshPart',
  size: number[] = [2, 2, 2]
): SubMeshGeometryInput {
  const [sx = 2, sy = 2, sz = 2] = size;
  const hx = sx * 0.5;
  const hy = sy * 0.5;
  const hz = sz * 0.5;
  const normShape = (shape || 'MeshPart').trim();

  if (normShape === 'Wedge') {
    const faces: Array<[number, number, number]> = [
      [0, 2, 1],
      [0, 3, 2],
      [3, 5, 2],
      [3, 4, 5],
      [0, 1, 5],
      [0, 5, 4],
      [0, 4, 3],
      [1, 2, 5],
    ];
    return {
      vertices: [
        [-hx, -hy, -hz],
        [hx, -hy, -hz],
        [hx, -hy, hz],
        [-hx, -hy, hz],
        [-hx, hy, hz],
        [hx, hy, hz],
      ],
      normals: [
        [0, -1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, 1],
        [0, 0.7071, -0.7071],
        [0, 0.7071, -0.7071],
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0.5],
        [1, 0.5],
      ],
      faces,
      indices: faces.flat(),
    };
  }

  if (normShape === 'Cylinder') {
    const segments = 12;
    const vertices: Array<[number, number, number]> = [];
    const normals: Array<[number, number, number]> = [];
    const uvs: Array<[number, number]> = [];
    const faces: Array<[number, number, number]> = [];

    for (let i = 0; i < segments; i++) {
      const theta = (2 * Math.PI * i) / segments;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      const u = i / segments;
      vertices.push([hx * ct, -hy, hz * st]);
      normals.push([ct, 0, st]);
      uvs.push([u, 0]);

      vertices.push([hx * ct, hy, hz * st]);
      normals.push([ct, 0, st]);
      uvs.push([u, 1]);
    }

    const bottomCenterIdx = vertices.length;
    vertices.push([0, -hy, 0]);
    normals.push([0, -1, 0]);
    uvs.push([0.5, 0.5]);

    const topCenterIdx = vertices.length;
    vertices.push([0, hy, 0]);
    normals.push([0, 1, 0]);
    uvs.push([0.5, 0.5]);

    for (let i = 0; i < segments; i++) {
      const nxt = (i + 1) % segments;
      const b0 = i * 2;
      const t0 = i * 2 + 1;
      const b1 = nxt * 2;
      const t1 = nxt * 2 + 1;
      faces.push([b0, b1, t1]);
      faces.push([b0, t1, t0]);
      faces.push([bottomCenterIdx, b1, b0]);
      faces.push([topCenterIdx, t0, t1]);
    }

    return { vertices, normals, uvs, faces, indices: faces.flat() };
  }

  if (normShape === 'Ball') {
    const latBands = 6;
    const lonBands = 10;
    const vertices: Array<[number, number, number]> = [];
    const normals: Array<[number, number, number]> = [];
    const uvs: Array<[number, number]> = [];
    const faces: Array<[number, number, number]> = [];

    for (let lat = 0; lat <= latBands; lat++) {
      const theta = (lat * Math.PI) / latBands;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);
      for (let lon = 0; lon <= lonBands; lon++) {
        const phi = (lon * 2 * Math.PI) / lonBands;
        const sinP = Math.sin(phi);
        const cosP = Math.cos(phi);
        const nx = cosP * sinT;
        const ny = cosT;
        const nz = sinP * sinT;
        vertices.push([hx * nx, hy * ny, hz * nz]);
        normals.push([nx, ny, nz]);
        uvs.push([lon / lonBands, lat / latBands]);
      }
    }

    for (let lat = 0; lat < latBands; lat++) {
      for (let lon = 0; lon < lonBands; lon++) {
        const first = lat * (lonBands + 1) + lon;
        const second = first + lonBands + 1;
        faces.push([first, second, first + 1]);
        faces.push([second, second + 1, first + 1]);
      }
    }

    return { vertices, normals, uvs, faces, indices: faces.flat() };
  }

  // Default MeshPart topology: Chamfered 3-ring Octagonal Hull Mesh (26 vertices, 48 triangles)
  const segments = 8;
  const bevelScale = 0.82;
  const ringLevels: Array<[number, number, number]> = [
    [-hy, bevelScale, 0],
    [0, 1.0, 0.5],
    [hy, bevelScale, 1.0],
  ];
  const vertices: Array<[number, number, number]> = [];
  const normals: Array<[number, number, number]> = [];
  const uvs: Array<[number, number]> = [];
  const faces: Array<[number, number, number]> = [];

  for (const [yPos, radialScale, vCoord] of ringLevels) {
    const nyComp = yPos < 0 ? -0.35 : yPos > 0 ? 0.35 : 0;
    for (let i = 0; i < segments; i++) {
      const theta = (2 * Math.PI * i) / segments + Math.PI / segments;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      const vx = hx * radialScale * ct;
      const vz = hz * radialScale * st;
      const nLen = Math.hypot(ct, nyComp, st) || 1;
      vertices.push([
        Number(vx.toFixed(4)),
        Number(yPos.toFixed(4)),
        Number(vz.toFixed(4)),
      ]);
      normals.push([
        Number((ct / nLen).toFixed(4)),
        Number((nyComp / nLen).toFixed(4)),
        Number((st / nLen).toFixed(4)),
      ]);
      uvs.push([Number((i / segments).toFixed(4)), vCoord]);
    }
  }

  const bottomCapIdx = vertices.length;
  vertices.push([0, Number((-hy).toFixed(4)), 0]);
  normals.push([0, -1, 0]);
  uvs.push([0.5, 0]);

  const topCapIdx = vertices.length;
  vertices.push([0, Number(hy.toFixed(4)), 0]);
  normals.push([0, 1, 0]);
  uvs.push([0.5, 1]);

  for (let r = 0; r < 2; r++) {
    const ringA = r * segments;
    const ringB = (r + 1) * segments;
    for (let i = 0; i < segments; i++) {
      const nxt = (i + 1) % segments;
      const a0 = ringA + i;
      const a1 = ringA + nxt;
      const b0 = ringB + i;
      const b1 = ringB + nxt;
      faces.push([a0, a1, b1]);
      faces.push([a0, b1, b0]);
    }
  }

  const topRing = 2 * segments;
  for (let i = 0; i < segments; i++) {
    const nxt = (i + 1) % segments;
    faces.push([bottomCapIdx, nxt, i]);
    faces.push([topCapIdx, topRing + i, topRing + nxt]);
  }

  return {
    vertices,
    normals,
    uvs,
    faces,
    indices: faces.flat(),
  };
}

/**
 * Generates a `--!strict` Luau module that builds real `MeshPart` instances via
 * `AssetService:CreateEditableMesh()` + `AssetService:CreateMeshPartAsync()`,
 * validates triangle creation, destroys temporary `EditableMesh` resources, and
 * exposes `.Spawn(origin: CFrame?): Model` and `.ReconstructInPlace(targetModel: Model)`.
 */
export function buildStrictLuauFromEditedParts(
  modelName: string,
  parts: MeshPartInput[],
  collisionFidelity: string = 'Hull'
): string {
  const safeName = modelName.replace(/[^a-zA-Z0-9_]/g, '') || 'EditedModel3D';
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

  const lines: string[] = [
    '--!strict',
    `-- Generated & Updated by Forge AI Asset & 3D Model Editor: ${safeName} (EditableMesh + Verified AssetService Pipeline)`,
    'local AssetService = game:GetService("AssetService")',
    'local InsertService = game:GetService("InsertService")',
    'local Workspace = game:GetService("Workspace")',
    '',
    'type VertexList = { { number } }',
    'type NormalList = { { number } }',
    'type UVList = { { number } }',
    'type IndexBuffer = { number }',
    'type FaceIndexList = { { number } }',
    '',
    'export type MeshPartDescriptor = {',
    '    Name: string,',
    '    PublishedMeshId: string,',
    '    PublishedAssetId: string,',
    '    TextureId: string?,',
    '    ObjSourcePath: string,',
    '    CollisionFidelity: Enum.CollisionFidelity,',
    '    Size: Vector3,',
    '    Vertices: VertexList,',
    '    Normals: NormalList,',
    '    UVs: UVList,',
    '    Indices: IndexBuffer,',
    '    Faces: FaceIndexList,',
    '}',
    '',
    'local function createTrueMeshPart(desc: MeshPartDescriptor): (MeshPart, boolean, string?)',
    '    local editableMeshInstance: EditableMesh? = nil',
    '    local expectedTriCount = math.floor(#desc.Indices / 3)',
    '    local addedTriCount = 0',
    '    local lastErrorReason: string? = nil',
    '',
    '    -- 1. Construct real MeshPart geometry directly from Vertex, Normal, UV, and Triangle Index buffers via EditableMesh',
    '    if #desc.Vertices >= 3 and expectedTriCount >= 1 then',
    '        local okEditable, generatedOrErr = xpcall(function()',
    '            local editableMesh = AssetService:CreateEditableMesh()',
    '            if not editableMesh then',
    '                error("AssetService:CreateEditableMesh() returned nil for " .. tostring(desc.Name))',
    '            end',
    '            editableMeshInstance = editableMesh',
    '            local vertexIds = table.create(#desc.Vertices)',
    '            local normalIds = table.create(#desc.Normals)',
    '            local uvIds = table.create(#desc.UVs)',
    '',
    '            for i, v in ipairs(desc.Vertices) do',
    '                vertexIds[i] = editableMesh:AddVertex(Vector3.new(v[1], v[2], v[3]))',
    '            end',
    '            for i, n in ipairs(desc.Normals) do',
    '                normalIds[i] = editableMesh:AddNormal(Vector3.new(n[1], n[2], n[3]))',
    '            end',
    '            for i, uv in ipairs(desc.UVs) do',
    '                uvIds[i] = editableMesh:AddUV(Vector2.new(uv[1], uv[2]))',
    '            end',
    '',
    '            for t = 0, expectedTriCount - 1 do',
    '                local baseIdx = t * 3',
    '                local i1, i2, i3 = desc.Indices[baseIdx + 1], desc.Indices[baseIdx + 2], desc.Indices[baseIdx + 3]',
    '                local v1, v2, v3 = vertexIds[i1], vertexIds[i2], vertexIds[i3]',
    '                if v1 and v2 and v3 and v1 ~= v2 and v2 ~= v3 and v1 ~= v3 then',
    '                    local fid = editableMesh:AddTriangle(v1, v2, v3)',
    '                    if fid then',
    '                        addedTriCount += 1',
    '                        if normalIds[i1] and normalIds[i2] and normalIds[i3] then',
    '                            pcall(function()',
    '                                editableMesh:SetFaceNormals(fid, { normalIds[i1], normalIds[i2], normalIds[i3] })',
    '                            end)',
    '                        end',
    '                        if uvIds[i1] and uvIds[i2] and uvIds[i3] then',
    '                            pcall(function()',
    '                                editableMesh:SetFaceUVs(fid, { uvIds[i1], uvIds[i2], uvIds[i3] })',
    '                            end)',
    '                        end',
    '                    end',
    '                end',
    '            end',
    '',
    '            if addedTriCount == 0 or addedTriCount < expectedTriCount then',
    '                error(string.format("Incomplete triangle creation for %s: created %d of %d expected", desc.Name, addedTriCount, expectedTriCount))',
    '            end',
    '            local meshTriangles = editableMesh:GetTriangles()',
    '            if type(meshTriangles) == "table" and #meshTriangles < expectedTriCount then',
    '                error(string.format("EditableMesh:GetTriangles() count mismatch for %s: got %d of %d", desc.Name, #meshTriangles, expectedTriCount))',
    '            end',
    '',
    '            local createdPart = AssetService:CreateMeshPartAsync(Content.fromObject(editableMesh), {',
    '                CollisionFidelity = desc.CollisionFidelity,',
    '                RenderFidelity = Enum.RenderFidelity.Precise,',
    '                FluidFidelity = Enum.FluidFidelity.Automatic,',
    '            })',
    '            if not createdPart then',
    '                error("AssetService:CreateMeshPartAsync() returned nil for " .. tostring(desc.Name))',
    '            end',
    '            return createdPart',
    '        end, debug.traceback)',
    '',
    '        if editableMeshInstance then',
    '            pcall(function() editableMeshInstance:Destroy() end)',
    '            editableMeshInstance = nil',
    '        end',
    '',
    '        if okEditable and generatedOrErr and typeof(generatedOrErr) == "Instance" and generatedOrErr:IsA("MeshPart") then',
    '            local generatedMeshPart = generatedOrErr :: MeshPart',
    '            generatedMeshPart.Name = desc.Name',
    '            generatedMeshPart.Size = desc.Size',
    '            if desc.TextureId and desc.TextureId ~= "" then',
    '                generatedMeshPart.TextureID = desc.TextureId',
    '            end',
    '            generatedMeshPart:SetAttribute("RojoObjPath", desc.ObjSourcePath)',
    '            generatedMeshPart:SetAttribute("VertexCount", #desc.Vertices)',
    '            generatedMeshPart:SetAttribute("TriangleCount", addedTriCount)',
    '            generatedMeshPart:SetAttribute("ExpectedTriangleCount", expectedTriCount)',
    '            generatedMeshPart:SetAttribute("GeometrySource", "EditableMeshBuffer")',
    '            generatedMeshPart:SetAttribute("ForgeGeometryVerified", true)',
    '            return generatedMeshPart, true, nil',
    '        else',
    '            lastErrorReason = tostring(generatedOrErr)',
    '            warn(string.format("[ForgeAI EditableMesh] Failed reconstructing %s: %s", tostring(desc.Name), lastErrorReason))',
    '        end',
    '    else',
    '        lastErrorReason = "Insufficient vertex or triangle index buffer data"',
    '    end',
    '',
    '    -- 2. Only if a real published Roblox Cloud MeshId (`rbxassetid://<id>`) was explicitly provided:',
    '    local targetMeshUri = if desc.PublishedMeshId ~= "" then desc.PublishedMeshId else desc.PublishedAssetId',
    '    if targetMeshUri ~= "" then',
    '        local okInsert, loadedOrErr = pcall(function()',
    '            return InsertService:CreateMeshPartAsync(targetMeshUri, desc.CollisionFidelity, Enum.RenderFidelity.Precise)',
    '        end)',
    '        if okInsert and loadedOrErr and typeof(loadedOrErr) == "Instance" and loadedOrErr:IsA("MeshPart") then',
    '            local loadedMeshPart = loadedOrErr :: MeshPart',
    '            loadedMeshPart.Name = desc.Name',
    '            loadedMeshPart.Size = desc.Size',
    '            if desc.TextureId and desc.TextureId ~= "" then',
    '                loadedMeshPart.TextureID = desc.TextureId',
    '            end',
    '            loadedMeshPart:SetAttribute("PublishedMeshId", targetMeshUri)',
    '            loadedMeshPart:SetAttribute("RojoObjPath", desc.ObjSourcePath)',
    '            loadedMeshPart:SetAttribute("VertexCount", #desc.Vertices)',
    '            loadedMeshPart:SetAttribute("TriangleCount", #desc.Faces)',
    '            loadedMeshPart:SetAttribute("GeometrySource", "PublishedCloudAsset")',
    '            loadedMeshPart:SetAttribute("ForgeGeometryVerified", true)',
    '            return loadedMeshPart, true, nil',
    '        else',
    '            lastErrorReason = "InsertService:CreateMeshPartAsync failed for " .. tostring(targetMeshUri)',
    '            warn("[ForgeAI EditableMesh] " .. lastErrorReason)',
    '        end',
    '    end',
    '',
    '    -- 3. Unverified fallback container MeshPart (never marked as verified geometry, never assigns read-only MeshPart.MeshId)',
    '    local meshPart = Instance.new("MeshPart")',
    '    meshPart.Name = desc.Name',
    '    meshPart.Size = desc.Size',
    '    meshPart:SetAttribute("RojoObjPath", desc.ObjSourcePath)',
    '    meshPart:SetAttribute("VertexCount", #desc.Vertices)',
    '    meshPart:SetAttribute("TriangleCount", #desc.Faces)',
    '    meshPart:SetAttribute("GeometrySource", "UnverifiedFallbackContainer")',
    '    meshPart:SetAttribute("ForgeGeometryVerified", false)',
    '    meshPart:SetAttribute("ForgeReconstructionError", lastErrorReason or "EditableMesh creation failed")',
    '    return meshPart, false, lastErrorReason',
    'end',
    '',
    'local function ensureHierarchyContainer(rootModel: Model, parentPath: string?): Instance',
    '    if not parentPath or parentPath == "" or parentPath == "ModelRoot" or parentPath == rootModel.Name then',
    '        return rootModel',
    '    end',
    '    local current: Instance = rootModel',
    '    local accumPath = ""',
    '    for segment in string.gmatch(parentPath, "[^/\\]+") do',
    '        if segment ~= "" and segment ~= "ModelRoot" and segment ~= rootModel.Name then',
    '            accumPath = if accumPath == "" then segment else (accumPath .. "/" .. segment)',
    '            local existing = current:FindFirstChild(segment)',
    '            if not existing or (not existing:IsA("Model") and not existing:IsA("Folder")) then',
    '                local container = Instance.new("Model")',
    '                container.Name = segment',
    '                container:SetAttribute("ForgeNodeId", "fnode_" .. string.gsub(accumPath, "[^%w_]", "_"))',
    '                container:SetAttribute("ForgeHierarchyPath", accumPath)',
    '                container.Parent = current',
    '                current = container',
    '            else',
    '                current = existing',
    '            end',
    '        end',
    '    end',
    '    return current',
    'end',
    '',
    `local ${safeName}Builder = {}`,
    '',
    `function ${safeName}Builder.Spawn(origin: CFrame?): Model`,
    '    local baseOrigin = origin or CFrame.new(0, 0, 0)',
    '    local model = Instance.new("Model")',
    `    model.Name = "${safeName}"`,
    '    model:SetAttribute("ForgeSyncOriginCFrame", baseOrigin)',
    `    local totalExpectedParts = ${expandedParts.length}`,
    '    local verifiedPartCount = 0',
    '    local failedPartCount = 0',
    '',
  ];

  expandedParts.forEach((p, idx) => {
    const [sx = 2, sy = 2, sz = 2] = p.size || [2, 2, 2];
    const [px = 0, py = 1, pz = 0] = p.position || [0, 1, 0];
    const [rx = 0, ry = 0, rz = 0] = p.rotation || [0, 0, 0];
    const [cr = 180, cg = 180, cb = 180] = p.color || [180, 180, 180];
    const vName = `meshPart_${idx + 1}`;
    const okFlag = `isVerified_${idx + 1}`;
    const cfMode = p.collisionFidelity || collisionFidelity || 'Hull';
    const partLabel = p.name || `MeshPart_${idx + 1}`;
    const partIdStr =
      String(p.partId || '').trim() || `fpart_${partLabel.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const parentNameStr = String(p.parentName || 'ModelRoot').trim() || 'ModelRoot';
    const parentIdStr =
      String(p.parentId || '').trim() ||
      (parentNameStr === 'ModelRoot'
        ? 'fnode_ModelRoot'
        : `fnode_${parentNameStr.replace(/[^a-zA-Z0-9_]/g, '_')}`);
    const hierarchyPathStr =
      String(p.hierarchyPath || '').trim() || `${parentNameStr}/${partLabel}`;
    const meshIdStr = validatePublishedRobloxMeshId(p.meshId || p.meshData?.meshId);
    const assetIdStr = validatePublishedRobloxMeshId(p.assetId || p.meshData?.assetId || meshIdStr);
    const texIdStr = validatePublishedRobloxMeshId(p.textureId);

    const hasExplicitBuffers =
      p.meshData && Array.isArray(p.meshData.vertices) && p.meshData.vertices.length > 0;
    const resolvedMesh = hasExplicitBuffers
      ? p.meshData!
      : meshIdStr || p.geometrySource === 'StudioExternalUnreadable'
      ? { vertices: [], normals: [], uvs: [], faces: [], indices: [], objFileName: `${safeName}.obj` }
      : synthesizeProceduralMeshData('MeshPart', [sx, sy, sz]);

    const vEntries: string[] = [];
    const nEntries: string[] = [];
    const uvEntries: string[] = [];

    for (let i = 0; i < resolvedMesh.vertices.length; i++) {
      const v = resolvedMesh.vertices[i] || [0, 0, 0];
      vEntries.push(`{${Number(v[0]).toFixed(4)},${Number(v[1]).toFixed(4)},${Number(v[2]).toFixed(4)}}`);
      const n = (resolvedMesh.normals && resolvedMesh.normals[i]) || [0, 1, 0];
      nEntries.push(`{${Number(n[0]).toFixed(4)},${Number(n[1]).toFixed(4)},${Number(n[2]).toFixed(4)}}`);
      const uv = (resolvedMesh.uvs && resolvedMesh.uvs[i]) || [0, 0];
      uvEntries.push(`{${Number(uv[0]).toFixed(4)},${Number(uv[1]).toFixed(4)}}`);
    }

    const fEntries: string[] = [];
    const flatIndexEntries: string[] = [];
    const vertCount = resolvedMesh.vertices.length;
    for (let i = 0; i < resolvedMesh.faces.length; i++) {
      const f = resolvedMesh.faces[i];
      if (f && f[0] < vertCount && f[1] < vertCount && f[2] < vertCount) {
        const i1 = f[0] + 1;
        const i2 = f[1] + 1;
        const i3 = f[2] + 1;
        fEntries.push(`{${i1},${i2},${i3}}`);
        flatIndexEntries.push(`${i1}`, `${i2}`, `${i3}`);
      }
    }

    const objFile = resolvedMesh.objFileName || `${safeName}.obj`;

    lines.push(
      `    -- Sub-MeshPart #${idx + 1}: ${partLabel} (${vEntries.length} verts, ${fEntries.length} tris)`,
      `    local ${vName}, ${okFlag}, _ = createTrueMeshPart({`,
      `        Name = "${partLabel}",`,
      `        PublishedMeshId = "${meshIdStr}",`,
      `        PublishedAssetId = "${assetIdStr}",`,
      `        TextureId = "${texIdStr}",`,
      `        ObjSourcePath = "src/shared/Assets3D/${objFile}",`,
      `        CollisionFidelity = Enum.CollisionFidelity.${cfMode},`,
      `        Size = Vector3.new(${Number(sx).toFixed(3)}, ${Number(sy).toFixed(3)}, ${Number(sz).toFixed(3)}),`,
      `        Vertices = {${vEntries.join(',')}},`,
      `        Normals = {${nEntries.join(',')}},`,
      `        UVs = {${uvEntries.join(',')}},`,
      `        Indices = {${flatIndexEntries.join(',')}},`,
      `        Faces = {${fEntries.join(',')}},`,
      '    })',
      `    if ${okFlag} then verifiedPartCount += 1 else failedPartCount += 1 end`,
      `    ${vName}.CFrame = baseOrigin * CFrame.new(${Number(px).toFixed(4)}, ${Number(py).toFixed(4)}, ${Number(pz).toFixed(4)}) * CFrame.Angles(math.rad(${Number(rx).toFixed(2)}), math.rad(${Number(ry).toFixed(2)}), math.rad(${Number(rz).toFixed(2)}))`,
      `    ${vName}.Color = Color3.fromRGB(${Math.round(cr)}, ${Math.round(cg)}, ${Math.round(cb)})`,
      `    ${vName}.Material = Enum.Material.${p.material || 'Metal'}`,
      `    ${vName}.Transparency = ${Number(p.transparency ?? 0).toFixed(2)}`,
      `    ${vName}.Anchored = ${p.anchored !== false ? 'true' : 'false'}`,
      `    ${vName}.CanCollide = ${p.canCollide !== false ? 'true' : 'false'}`,
      `    ${vName}:SetAttribute("ForgePartId", "${partIdStr}")`,
      `    ${vName}:SetAttribute("ForgeParentId", "${parentIdStr}")`,
      `    ${vName}:SetAttribute("ForgeParentName", "${parentNameStr}")`,
      `    ${vName}:SetAttribute("ForgeHierarchyPath", "${hierarchyPathStr}")`,
      `    ${vName}:SetAttribute("CollisionFidelity", "${cfMode}")`,
      `    ${vName}:SetAttribute("Roughness", ${Number(p.roughness ?? 0.35).toFixed(2)})`,
      `    ${vName}:SetAttribute("Metalness", ${Number(p.metalness ?? 0.6).toFixed(2)})`,
      `    ${vName}.Parent = ensureHierarchyContainer(model, "${parentNameStr}")`,
      ''
    );
    if (idx === 0) {
      lines.push(`    model.PrimaryPart = ${vName}`, '');
    }
  });

  lines.push(
    '    local allVerified = (totalExpectedParts > 0) and (verifiedPartCount == totalExpectedParts) and (failedPartCount == 0)',
    '    model:SetAttribute("ForgeEditableMeshReconstructed", allVerified)',
    '    model:SetAttribute("ForgeReconstructionVerified", allVerified)',
    '    model:SetAttribute("ForgeVerifiedPartCount", verifiedPartCount)',
    '    model:SetAttribute("ForgeFailedPartCount", failedPartCount)',
    '    model.Parent = Workspace',
    '    return model',
    'end',
    '',
    `-- Reconstructs EditableMesh geometry in-place on an imported .RBXMX Model`,
    `-- Returns: (reconstructedCount: number, allVerified: boolean, expectedCount: number)`,
    `function ${safeName}Builder.ReconstructInPlace(targetModel: Model): (number, boolean, number)`,
    '    local reconstructedCount = 0',
    `    local expectedCount = ${expandedParts.length}`,
    '    local spawned = (' + safeName + 'Builder.Spawn(targetModel:GetPivot()))',
    '    for _, generatedChild in ipairs(spawned:GetDescendants()) do',
    '        if generatedChild:IsA("MeshPart") then',
    '            local isPartVerified = generatedChild:GetAttribute("ForgeGeometryVerified") == true',
    '            local existing = targetModel:FindFirstChild(generatedChild.Name, true)',
    '            if isPartVerified then',
    '                local targetParent: Instance = targetModel',
    '                if existing and existing:IsA("BasePart") then',
    '                    targetParent = existing.Parent or targetModel',
    '                    generatedChild.CFrame = existing.CFrame',
    '                    for _, child in ipairs(existing:GetChildren()) do',
    '                        child:Clone().Parent = generatedChild',
    '                    end',
    '                    existing:Destroy()',
    '                else',
    '                    local pName = tostring(generatedChild:GetAttribute("ForgeParentName") or "ModelRoot")',
    '                    targetParent = ensureHierarchyContainer(targetModel, pName)',
    '                end',
    '                generatedChild.Parent = targetParent',
    '                reconstructedCount += 1',
    '            else',
    '                if existing then',
    '                    existing:SetAttribute("ForgeGeometryVerified", false)',
    '                    existing:SetAttribute("ForgeReconstructionError", generatedChild:GetAttribute("ForgeReconstructionError"))',
    '                end',
    '            end',
    '        end',
    '    end',
    '    spawned:Destroy()',
    '    local allVerified = (expectedCount > 0) and (reconstructedCount == expectedCount)',
    '    targetModel:SetAttribute("ForgeEditableMeshReconstructed", allVerified)',
    '    targetModel:SetAttribute("ForgeReconstructionVerified", allVerified)',
    '    targetModel:SetAttribute("ForgeReconstructedCount", reconstructedCount)',
    '    return reconstructedCount, allVerified, expectedCount',
    'end',
    '',
    `return ${safeName}Builder`
  );
  return lines.join('\n');
}
