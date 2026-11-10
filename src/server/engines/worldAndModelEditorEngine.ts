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
}

export interface MeshPartInput {
  name: string;
  shape: string;
  meshId?: string;
  assetId?: string;
  textureId?: string;
  size: number[];
  position: number[];
  rotation: number[];
  color: number[];
  material: string;
  roughness: number;
  metalness: number;
  transparency: number;
  canCollide: boolean;
  anchored: boolean;
  collisionFidelity: string;
  meshData?: SubMeshGeometryInput;
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
 * normal, UV, and 0-based triangle index buffers. If the uploaded .OBJ omits `vn` records,
 * normalized vertex normals are automatically computed from triangle face cross-products.
 */
export function parseWavefrontObjGeometry(
  objText: string,
  objFileName?: string,
  _modelName: string = 'UploadedMeshModel',
  _partName: string = 'MeshPart_1'
): SubMeshGeometryInput {
  const vertices: Array<[number, number, number]> = [];
  const rawNormals: Array<[number, number, number]> = [];
  const rawUvs: Array<[number, number]> = [];
  const faces: Array<[number, number, number]> = [];
  const vertexNormalMap = new Map<number, [number, number, number]>();
  const vertexUvMap = new Map<number, [number, number]>();

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
        vertices.push([vx, vy, vz]);
      }
    } else if (prefix === 'vn' && parts.length >= 4) {
      const nx = parseFloat(parts[1]);
      const ny = parseFloat(parts[2]);
      const nz = parseFloat(parts[3]);
      if (!Number.isNaN(nx) && !Number.isNaN(ny) && !Number.isNaN(nz)) {
        rawNormals.push([nx, ny, nz]);
      }
    } else if (prefix === 'vt' && parts.length >= 3) {
      const u = parseFloat(parts[1]);
      const v = parseFloat(parts[2]);
      if (!Number.isNaN(u) && !Number.isNaN(v)) {
        rawUvs.push([u, v]);
      }
    } else if (prefix === 'f' && parts.length >= 4) {
      const vIndices: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const subTokens = parts[i].split('/');
        const rawV = parseInt(subTokens[0], 10);
        if (Number.isNaN(rawV)) continue;
        const vIdx = rawV > 0 ? rawV - 1 : vertices.length + rawV;
        if (vIdx < 0) continue;
        vIndices.push(vIdx);

        if (subTokens.length >= 2 && subTokens[1]) {
          const rawVt = parseInt(subTokens[1], 10);
          if (!Number.isNaN(rawVt)) {
            const vtIdx = rawVt > 0 ? rawVt - 1 : rawUvs.length + rawVt;
            if (vtIdx >= 0 && vtIdx < rawUvs.length) {
              vertexUvMap.set(vIdx, rawUvs[vtIdx]);
            }
          }
        }
        if (subTokens.length >= 3 && subTokens[2]) {
          const rawVn = parseInt(subTokens[2], 10);
          if (!Number.isNaN(rawVn)) {
            const vnIdx = rawVn > 0 ? rawVn - 1 : rawNormals.length + rawVn;
            if (vnIdx >= 0 && vnIdx < rawNormals.length) {
              vertexNormalMap.set(vIdx, rawNormals[vnIdx]);
            }
          }
        }
      }
      for (let i = 1; i < vIndices.length - 1; i++) {
        faces.push([vIndices[0], vIndices[i], vIndices[i + 1]]);
      }
    }
  }

  let normals: Array<[number, number, number]> = [];
  if (rawNormals.length > 0) {
    normals = vertices.map((_, i) => {
      if (vertexNormalMap.has(i)) return vertexNormalMap.get(i)!;
      if (i < rawNormals.length) return rawNormals[i];
      return [0, 1, 0];
    });
  } else {
    const accum: Array<[number, number, number]> = vertices.map(() => [0, 0, 0]);
    for (const [i0, i1, i2] of faces) {
      if (i0 < vertices.length && i1 < vertices.length && i2 < vertices.length) {
        const v0 = vertices[i0];
        const v1 = vertices[i1];
        const v2 = vertices[i2];
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
    normals = accum.map(([nx, ny, nz]) => {
      const mag = Math.hypot(nx, ny, nz);
      return mag > 1e-6 ? [nx / mag, ny / mag, nz / mag] : [0, 1, 0];
    });
  }

  const uvs: Array<[number, number]> = vertices.map((_, i) => {
    if (vertexUvMap.has(i)) return vertexUvMap.get(i)!;
    if (i < rawUvs.length) return rawUvs[i];
    return [0, 0];
  });

  const indices: number[] = [];
  for (const tri of faces) {
    indices.push(tri[0], tri[1], tri[2]);
  }

  return {
    vertices,
    normals,
    uvs,
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

  const studSize = sub?.studSize || sub?.size || [2, 2, 2];
  const synth = synthesizeProceduralMeshData(sub?.shape || 'MeshPart', studSize);
  synth.objFileName = objFile;
  synth.meshId = validMeshId;
  synth.assetId = validAssetId;
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
    'local function createTrueMeshPart(desc: MeshPartDescriptor): MeshPart',
    '    -- 1. Construct real MeshPart geometry directly from Vertex, Normal, UV, and Triangle Index buffers via EditableMesh',
    '    if #desc.Vertices > 0 and #desc.Indices >= 3 then',
    '        local okEditable, generatedMeshPart = pcall(function()',
    '            local editableMesh = AssetService:CreateEditableMesh()',
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
    '            local stepCount = math.floor(#desc.Indices / 3)',
    '            for t = 0, stepCount - 1 do',
    '                local baseIdx = t * 3',
    '                local i1, i2, i3 = desc.Indices[baseIdx + 1], desc.Indices[baseIdx + 2], desc.Indices[baseIdx + 3]',
    '                local v1, v2, v3 = vertexIds[i1], vertexIds[i2], vertexIds[i3]',
    '                if v1 and v2 and v3 then',
    '                    local fid = editableMesh:AddTriangle(v1, v2, v3)',
    '                    if normalIds[i1] and normalIds[i2] and normalIds[i3] then',
    '                        pcall(function()',
    '                            editableMesh:SetFaceNormals(fid, { normalIds[i1], normalIds[i2], normalIds[i3] })',
    '                        end)',
    '                    end',
    '                    if uvIds[i1] and uvIds[i2] and uvIds[i3] then',
    '                        pcall(function()',
    '                            editableMesh:SetFaceUVs(fid, { uvIds[i1], uvIds[i2], uvIds[i3] })',
    '                        end)',
    '                    end',
    '                end',
    '            end',
    '',
    '            return AssetService:CreateMeshPartAsync(Content.fromObject(editableMesh), {',
    '                CollisionFidelity = desc.CollisionFidelity,',
    '                RenderFidelity = Enum.RenderFidelity.Precise,',
    '                FluidFidelity = Enum.FluidFidelity.Automatic,',
    '            })',
    '        end)',
    '',
    '        if okEditable and generatedMeshPart then',
    '            generatedMeshPart.Name = desc.Name',
    '            generatedMeshPart.Size = desc.Size',
    '            if desc.TextureId and desc.TextureId ~= "" then',
    '                generatedMeshPart.TextureID = desc.TextureId',
    '            end',
    '            generatedMeshPart:SetAttribute("RojoObjPath", desc.ObjSourcePath)',
    '            generatedMeshPart:SetAttribute("VertexCount", #desc.Vertices)',
    '            generatedMeshPart:SetAttribute("TriangleCount", #desc.Faces)',
    '            generatedMeshPart:SetAttribute("GeometrySource", "EditableMeshBuffer")',
    '            return generatedMeshPart',
    '        end',
    '    end',
    '',
    '    -- 2. Only if a real published Roblox Cloud MeshId (`rbxassetid://<id>`) was explicitly provided:',
    '    local targetMeshUri = if desc.PublishedMeshId ~= "" then desc.PublishedMeshId else desc.PublishedAssetId',
    '    if targetMeshUri ~= "" then',
    '        local okInsert, loadedMeshPart = pcall(function()',
    '            return InsertService:CreateMeshPartAsync(targetMeshUri, desc.CollisionFidelity, Enum.RenderFidelity.Precise)',
    '        end)',
    '        if okInsert and loadedMeshPart then',
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
    '            return loadedMeshPart',
    '        end',
    '    end',
    '',
    '    -- 3. Container MeshPart (never assigns read-only MeshPart.MeshId)',
    '    local meshPart = Instance.new("MeshPart")',
    '    meshPart.Name = desc.Name',
    '    meshPart.Size = desc.Size',
    '    meshPart:SetAttribute("RojoObjPath", desc.ObjSourcePath)',
    '    meshPart:SetAttribute("VertexCount", #desc.Vertices)',
    '    meshPart:SetAttribute("TriangleCount", #desc.Faces)',
    '    meshPart:SetAttribute("GeometrySource", "PendingEditableMeshPermission")',
    '    return meshPart',
    'end',
    '',
    `local ${safeName}Builder = {}`,
    '',
    `function ${safeName}Builder.Spawn(origin: CFrame?): Model`,
    '    local baseOrigin = origin or CFrame.new(0, 0, 0)',
    '    local model = Instance.new("Model")',
    `    model.Name = "${safeName}"`,
    '',
  ];

  expandedParts.forEach((p, idx) => {
    const [sx = 2, sy = 2, sz = 2] = p.size || [2, 2, 2];
    const [px = 0, py = 1, pz = 0] = p.position || [0, 1, 0];
    const [rx = 0, ry = 0, rz = 0] = p.rotation || [0, 0, 0];
    const [cr = 180, cg = 180, cb = 180] = p.color || [180, 180, 180];
    const vName = `meshPart_${idx + 1}`;
    const cfMode = p.collisionFidelity || collisionFidelity || 'Hull';
    const partLabel = p.name || `MeshPart_${idx + 1}`;
    const resolvedMesh = p.meshData || synthesizeProceduralMeshData('MeshPart', [sx, sy, sz]);

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
    const meshIdStr = validatePublishedRobloxMeshId(p.meshId || resolvedMesh.meshId);
    const assetIdStr = validatePublishedRobloxMeshId(p.assetId || resolvedMesh.assetId || meshIdStr);
    const texIdStr = validatePublishedRobloxMeshId(p.textureId);

    lines.push(
      `    -- Sub-MeshPart #${idx + 1}: ${partLabel} (${vEntries.length} verts, ${fEntries.length} tris)`,
      `    local ${vName} = createTrueMeshPart({`,
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
      `    ${vName}.CFrame = baseOrigin * CFrame.new(${Number(px).toFixed(2)}, ${Number(py).toFixed(2)}, ${Number(pz).toFixed(2)}) * CFrame.Angles(math.rad(${Number(rx).toFixed(1)}), math.rad(${Number(ry).toFixed(1)}), math.rad(${Number(rz).toFixed(1)}))`,
      `    ${vName}.Color = Color3.fromRGB(${Math.round(cr)}, ${Math.round(cg)}, ${Math.round(cb)})`,
      `    ${vName}.Material = Enum.Material.${p.material || 'Metal'}`,
      `    ${vName}.Transparency = ${Number(p.transparency ?? 0).toFixed(2)}`,
      `    ${vName}.Anchored = ${p.anchored !== false ? 'true' : 'false'}`,
      `    ${vName}.CanCollide = ${p.canCollide !== false ? 'true' : 'false'}`,
      `    ${vName}:SetAttribute("CollisionFidelity", "${cfMode}")`,
      `    ${vName}:SetAttribute("Roughness", ${Number(p.roughness ?? 0.35).toFixed(2)})`,
      `    ${vName}:SetAttribute("Metalness", ${Number(p.metalness ?? 0.6).toFixed(2)})`,
      `    ${vName}.Parent = model`,
      ''
    );
    if (idx === 0) {
      lines.push(`    model.PrimaryPart = ${vName}`, '');
    }
  });

  lines.push(
    '    model.Parent = Workspace',
    '    return model',
    'end',
    '',
    `-- Reconstructs EditableMesh geometry in-place on an imported .RBXMX Model`,
    `function ${safeName}Builder.ReconstructInPlace(targetModel: Model): number`,
    '    local reconstructedCount = 0',
    '    local spawned = (' + safeName + 'Builder.Spawn(targetModel:GetPivot()))',
    '    for _, generatedChild in ipairs(spawned:GetChildren()) do',
    '        if generatedChild:IsA("MeshPart") then',
    '            local existing = targetModel:FindFirstChild(generatedChild.Name)',
    '            if existing and existing:IsA("BasePart") then',
    '                generatedChild.CFrame = existing.CFrame',
    '                for _, child in ipairs(existing:GetChildren()) do',
    '                    child:Clone().Parent = generatedChild',
    '                end',
    '                existing:Destroy()',
    '            end',
    '            generatedChild.Parent = targetModel',
    '            reconstructedCount += 1',
    '        end',
    '    end',
    '    spawned:Destroy()',
    '    targetModel:SetAttribute("ForgeEditableMeshReconstructed", true)',
    '    targetModel:SetAttribute("ForgeReconstructedCount", reconstructedCount)',
    '    return reconstructedCount',
    'end',
    '',
    `return ${safeName}Builder`
  );
  return lines.join('\n');
}

function escapeXmlServer(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function eulerDegToRotationMatrixServer(rxDeg: number, ryDeg: number, rzDeg: number): number[] {
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
    '            local okRun, countOrErr = xpcall(function()',
    '                return builder.ReconstructInPlace(model)',
    '            end, debug.traceback)',
    '            if okRun then',
    '                model:SetAttribute("ForgeReconstructionVerified", true)',
    '                model:SetAttribute("ForgeReconstructedPartCount", countOrErr)',
    '            else',
    '                warn("[ForgeAI .RBXMX Reconstructor] Error reconstructing EditableMesh:", countOrErr)',
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

    const serializedMeshJson = JSON.stringify({
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
      `          <string name="Name">${escapeXmlServer(p.name)}_PBRSurface</string>`,
      '          <token name="AlphaMode">0</token>',
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
  }
): string {
  const safeMat = materialName.replace(/[^a-zA-Z0-9_]/g, '') || 'ForgePBRMaterial';
  const validColor = validatePublishedRobloxMeshId(cloudAssetIds?.colorMapId);
  const validNormal = validatePublishedRobloxMeshId(cloudAssetIds?.normalMapId);
  const validRoughness = validatePublishedRobloxMeshId(cloudAssetIds?.roughnessMapId);
  const validMetalness = validatePublishedRobloxMeshId(cloudAssetIds?.metalnessMapId);

  const hexClean = String(albedoHex || '#38bdf8').replace('#', '').trim();
  const rVal = hexClean.length === 6 ? parseInt(hexClean.slice(0, 2), 16) || 56 : 56;
  const gVal = hexClean.length === 6 ? parseInt(hexClean.slice(2, 4), 16) || 189 : 189;
  const bVal = hexClean.length === 6 ? parseInt(hexClean.slice(4, 6), 16) || 248 : 248;

  const lines: string[] = [
    '--!strict',
    `-- Generated by Forge AI Asset Engine: PBR SurfaceAppearance + EditableImage (${safeMat})`,
    `-- Local Rojo PNG Maps: ${targetFolder}/${safeMat}_ColorMap.png, _NormalMap.png, _RoughnessMap.png`,
    'local AssetService = game:GetService("AssetService")',
    '',
    `local ${safeMat}PBR = {}`,
    '',
    'local function createProceduralEditableTexture(r: number, g: number, b: number, rough: number): Content?',
    '    local ok, content = pcall(function()',
    '        local width, height = 64, 64',
    '        local editableImage = AssetService:CreateEditableImage({ Size = Vector2.new(width, height) })',
    '        local pixels = buffer.create(width * height * 4)',
    '        for y = 0, height - 1 do',
    '            for x = 0, width - 1 do',
    '                local idx = (y * width + x) * 4',
    '                local grain = math.floor(math.sin(x * 0.45) * math.cos(y * 0.45) * 14 * (1 - rough * 0.5))',
    '                buffer.writeu8(pixels, idx + 0, math.clamp(r + grain, 0, 255))',
    '                buffer.writeu8(pixels, idx + 1, math.clamp(g + grain, 0, 255))',
    '                buffer.writeu8(pixels, idx + 2, math.clamp(b + grain, 0, 255))',
    '                buffer.writeu8(pixels, idx + 3, 255)',
    '            end',
    '        end',
    '        editableImage:WritePixelsBuffer(Vector2.zero, Vector2.new(width, height), pixels)',
    '        return Content.fromObject(editableImage)',
    '    end)',
    '    if ok then return content end',
    '    return nil',
    'end',
    '',
    `function ${safeMat}PBR.Apply(targetPart: BasePart): SurfaceAppearance`,
    '    local existing = targetPart:FindFirstChildOfClass("SurfaceAppearance")',
    '    if existing then',
    '        existing:Destroy()',
    '    end',
    '    local surface = Instance.new("SurfaceAppearance")',
    `    surface.Name = "${safeMat}_SurfaceAppearance"`,
    '    surface.AlphaMode = Enum.AlphaMode.Overlay',
    `    targetPart.Color = Color3.fromRGB(${rVal}, ${gVal}, ${bVal})`,
  ];

  if (validColor) {
    lines.push(`    surface.ColorMap = "${validColor}"`);
  }
  if (validNormal) {
    lines.push(`    surface.NormalMap = "${validNormal}"`);
  }
  if (validRoughness) {
    lines.push(`    surface.RoughnessMap = "${validRoughness}"`);
  }
  if (validMetalness) {
    lines.push(`    surface.MetalnessMap = "${validMetalness}"`);
  }

  if (!validColor) {
    lines.push(
      '    -- When no published Cloud ColorMap ID is supplied yet, synthesize runtime EditableImage texture:',
      `    local runtimeColorContent = createProceduralEditableTexture(${rVal}, ${gVal}, ${bVal}, ${Number(roughness).toFixed(2)})`,
      '    if runtimeColorContent and targetPart:IsA("MeshPart") then',
      '        pcall(function()',
      '            (targetPart :: any).TextureContent = runtimeColorContent',
      '        end)',
      '    end'
    );
  }

  lines.push(
    `    targetPart:SetAttribute("PBR_MaterialName", "${safeMat}")`,
    `    targetPart:SetAttribute("PBR_Roughness", ${Number(roughness).toFixed(2)})`,
    `    targetPart:SetAttribute("PBR_Metalness", ${Number(metalness).toFixed(2)})`,
    `    targetPart:SetAttribute("PBR_AlbedoHex", "${albedoHex}")`,
    `    targetPart:SetAttribute("PBR_LocalColorMapPath", "${targetFolder}/${safeMat}_ColorMap.png")`,
    `    targetPart:SetAttribute("PBR_LocalNormalMapPath", "${targetFolder}/${safeMat}_NormalMap.png")`,
    `    targetPart:SetAttribute("PBR_LocalRoughnessMapPath", "${targetFolder}/${safeMat}_RoughnessMap.png")`,
    `    targetPart:SetAttribute("PBR_HasPublishedCloudIds", ${Boolean(validColor || validNormal || validRoughness || validMetalness) ? 'true' : 'false'})`,
    '    surface.Parent = targetPart',
    '    return surface',
    'end',
    '',
    `return ${safeMat}PBR`
  );
  return lines.join('\n');
}

export function generateWorldEnvironmentLuau(
  sceneName: string,
  biome: 'CyberpunkOrbital' | 'MedievalForge' | 'ArcticResearchBase',
  placedAssetNames: string[]
): string {
  const safeScene = sceneName.replace(/[^a-zA-Z0-9_]/g, '') || 'ForgeWorldScene';
  const biomeConfig = {
    CyberpunkOrbital: {
      ambient: [18, 24, 38],
      outdoor: [30, 41, 59],
      clockTime: 21.5,
      brightness: 2.4,
      density: 0.34,
      atmoColor: [14, 165, 233],
    },
    MedievalForge: {
      ambient: [42, 28, 22],
      outdoor: [68, 45, 34],
      clockTime: 18.2,
      brightness: 2.1,
      density: 0.42,
      atmoColor: [249, 115, 22],
    },
    ArcticResearchBase: {
      ambient: [38, 52, 68],
      outdoor: [96, 125, 155],
      clockTime: 11.0,
      brightness: 2.8,
      density: 0.28,
      atmoColor: [186, 230, 253],
    },
  }[biome] || {
    ambient: [18, 24, 38],
    outdoor: [30, 41, 59],
    clockTime: 21.5,
    brightness: 2.4,
    density: 0.34,
    atmoColor: [14, 165, 233],
  };

  const lines: string[] = [
    '--!strict',
    `-- Generated by Forge AI World Engine: ${safeScene} (Biome: ${biome})`,
    'local Lighting = game:GetService("Lighting")',
    'local ReplicatedStorage = game:GetService("ReplicatedStorage")',
    'local Workspace = game:GetService("Workspace")',
    '',
    `local ${safeScene}World = {}`,
    '',
    `function ${safeScene}World.BuildEnvironment(): Folder`,
    `    Lighting.Ambient = Color3.fromRGB(${biomeConfig.ambient.join(', ')})`,
    `    Lighting.OutdoorAmbient = Color3.fromRGB(${biomeConfig.outdoor.join(', ')})`,
    `    Lighting.ClockTime = ${biomeConfig.clockTime}`,
    `    Lighting.Brightness = ${biomeConfig.brightness}`,
    '    Lighting.GlobalShadows = true',
    '',
    '    local atmosphere = Lighting:FindFirstChildOfClass("Atmosphere") or Instance.new("Atmosphere")',
    `    atmosphere.Density = ${biomeConfig.density}`,
    `    atmosphere.Color = Color3.fromRGB(${biomeConfig.atmoColor.join(', ')})`,
    '    atmosphere.Parent = Lighting',
    '',
    '    local worldFolder = Instance.new("Folder")',
    `    worldFolder.Name = "${safeScene}_Zone"`,
    '    worldFolder.Parent = Workspace',
    '',
  ];

  placedAssetNames.forEach((assetName, i) => {
    const offsetX = (i - Math.floor(placedAssetNames.length / 2)) * 18;
    lines.push(
      `    -- Spatial MeshPart Anchor for Asset: ${assetName}`,
      `    local anchor_${i + 1} = Instance.new("MeshPart")`,
      `    anchor_${i + 1}.Name = "${assetName}_SpawnPad"`,
      `    anchor_${i + 1}.Size = Vector3.new(10, 0.6, 10)`,
      `    anchor_${i + 1}.Position = Vector3.new(${offsetX}, 0.3, 0)`,
      `    anchor_${i + 1}.Anchored = true`,
      `    anchor_${i + 1}.Material = Enum.Material.Metal`,
      `    anchor_${i + 1}.Color = Color3.fromRGB(30, 41, 59)`,
      `    anchor_${i + 1}:SetAttribute("SpawnTargetAsset", "${assetName}")`,
      `    anchor_${i + 1}.Parent = worldFolder`,
      ''
    );
  });

  lines.push(
    '    return worldFolder',
    'end',
    '',
    `return ${safeScene}World`
  );
  return lines.join('\n');
}
