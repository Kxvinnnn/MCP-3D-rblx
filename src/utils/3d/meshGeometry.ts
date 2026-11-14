import * as THREE from 'three';
import {
  DegenerateGeometryReport,
  Forge3DAsset,
  MeshPart3DSpec,
  PBRTextureSet,
  SubMeshGeometryData,
  resolveRgbTuple,
} from './types.ts';
import { generateProceduralPBRTextures } from './pbrTextures.ts';

/**
 * Splits a high-polygon MeshPart exceeding `maxVertsPerPart` or `maxFacesPerPart`
 * into contiguous sub-meshes (`_Sub1`, `_Sub2`, ...) with remapped vertex, normal, UV,
 * and triangle index buffers so zero triangles are ever truncated.
 */
export function splitOversizedMeshPart(
  part: MeshPart3DSpec,
  maxVertsPerPart: number = 9000,
  maxFacesPerPart: number = 9500
): MeshPart3DSpec[] {
  const md = ensurePartHasMeshData(part);
  if (md.vertices.length <= maxVertsPerPart && md.faces.length <= maxFacesPerPart) {
    return [{ ...part, meshData: md }];
  }

  const splitParts: MeshPart3DSpec[] = [];
  let chunkFaces: number[][] = [];
  let usedVerts = new Set<number>();

  const flushChunk = (chunkIdx: number) => {
    if (chunkFaces.length === 0) return;
    const oldToNew = new Map<number, number>();
    const newVerts: number[][] = [];
    const newNorms: number[][] = [];
    const newUvs: number[][] = [];
    const newFaces: number[][] = [];

    const totalV = md.vertices.length;
    const totalN = md.normals?.length || 0;
    const totalUv = md.uvs?.length || 0;

    for (const tri of chunkFaces) {
      const remappedTri: number[] = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const oldIdx = tri[k];
        const safeOld = oldIdx >= 0 && oldIdx < totalV ? oldIdx : 0;
        let mapped = oldToNew.get(safeOld);
        if (mapped === undefined) {
          mapped = newVerts.length;
          oldToNew.set(safeOld, mapped);
          newVerts.push(md.vertices[safeOld] || [0, 0, 0]);
          newNorms.push(safeOld < totalN && md.normals ? md.normals[safeOld] : [0, 1, 0]);
          newUvs.push(safeOld < totalUv && md.uvs ? md.uvs[safeOld] : [0, 0]);
        }
        remappedTri[k] = mapped;
      }
      newFaces.push(remappedTri);
    }

    splitParts.push({
      ...part,
      name: `${part.name}_Sub${chunkIdx}`,
      meshData: {
        vertices: newVerts,
        normals: newNorms,
        uvs: newUvs,
        faces: newFaces,
        objFileName: md.objFileName,
      },
    });
  };

  let chunkCounter = 1;
  for (const tri of md.faces) {
    if (!Array.isArray(tri) || tri.length < 3) continue;
    let newVertCount = usedVerts.size;
    if (!usedVerts.has(tri[0])) newVertCount++;
    if (!usedVerts.has(tri[1])) newVertCount++;
    if (!usedVerts.has(tri[2])) newVertCount++;

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
      return [{ ...part, meshData: md }];
    }
    flushChunk(chunkCounter);
  }

  return splitParts.length > 0 ? splitParts : [{ ...part, meshData: md }];
}

/**
 * Creates a true Roblox WedgePart BufferGeometry of size [w, h, d] with UVs.
 */
export function createWedgeGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;

  const positions = new Float32Array([
    -hw, -hh, -hd,  hw, -hh, -hd,  hw, -hh,  hd,
    -hw, -hh, -hd,  hw, -hh,  hd, -hw, -hh,  hd,
    -hw, -hh, -hd, -hw,  hh, -hd,  hw,  hh, -hd,
    -hw, -hh, -hd,  hw,  hh, -hd,  hw, -hh, -hd,
    -hw,  hh, -hd, -hw, -hh,  hd,  hw, -hh,  hd,
    -hw,  hh, -hd,  hw, -hh,  hd,  hw,  hh, -hd,
    -hw, -hh, -hd, -hw, -hh,  hd, -hw,  hh, -hd,
     hw, -hh, -hd,  hw,  hh, -hd,  hw, -hh,  hd,
  ]);

  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let i = 0; i < positions.length / 3; i++) {
    uvs[i * 2] = (positions[i * 3] + hw) / Math.max(w, 0.001);
    uvs[i * 2 + 1] = (positions[i * 3 + 2] + hd) / Math.max(d, 0.001);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Reconstructs a real Three.js BufferGeometry from preserved SubMeshGeometryData.
 */
export function buildBufferGeometryFromMeshData(
  meshData: SubMeshGeometryData,
  targetStudSize?: number[]
): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const verts = meshData.vertices || [];
  const faces = meshData.faces || [];
  const norms = meshData.normals || [];
  const uvs = meshData.uvs || [];
  const vColors = meshData.vertexColors || [];

  let scaleX = 1;
  let scaleY = 1;
  let scaleZ = 1;
  if (targetStudSize && targetStudSize.length >= 3 && verts.length >= 3) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < verts.length; i++) {
      const vx = verts[i][0] ?? 0;
      const vy = verts[i][1] ?? 0;
      const vz = verts[i][2] ?? 0;
      if (vx < minX) minX = vx;
      if (vx > maxX) maxX = vx;
      if (vy < minY) minY = vy;
      if (vy > maxY) maxY = vy;
      if (vz < minZ) minZ = vz;
      if (vz > maxZ) maxZ = vz;
    }
    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const spanZ = maxZ - minZ;
    if (spanX > 1e-4 && targetStudSize[0] > 0.05) scaleX = targetStudSize[0] / spanX;
    if (spanY > 1e-4 && targetStudSize[1] > 0.05) scaleY = targetStudSize[1] / spanY;
    if (spanZ > 1e-4 && targetStudSize[2] > 0.05) scaleZ = targetStudSize[2] / spanZ;
  }

  const posArray = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    posArray[i * 3] = (verts[i][0] ?? 0) * scaleX;
    posArray[i * 3 + 1] = (verts[i][1] ?? 0) * scaleY;
    posArray[i * 3 + 2] = (verts[i][2] ?? 0) * scaleZ;
  }
  geom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

  const isScaledNonUniform =
    Math.abs(scaleX - 1) > 1e-3 ||
    Math.abs(scaleY - 1) > 1e-3 ||
    Math.abs(scaleZ - 1) > 1e-3;

  if (!isScaledNonUniform && norms.length === verts.length && norms.length > 0) {
    const normArray = new Float32Array(norms.length * 3);
    for (let i = 0; i < norms.length; i++) {
      normArray[i * 3] = norms[i][0] ?? 0;
      normArray[i * 3 + 1] = norms[i][1] ?? 1;
      normArray[i * 3 + 2] = norms[i][2] ?? 0;
    }
    geom.setAttribute('normal', new THREE.BufferAttribute(normArray, 3));
  }

  if (uvs.length === verts.length && uvs.length > 0) {
    const uvArray = new Float32Array(uvs.length * 2);
    for (let i = 0; i < uvs.length; i++) {
      uvArray[i * 2] = uvs[i][0] ?? 0;
      uvArray[i * 2 + 1] = uvs[i][1] ?? 0;
    }
    geom.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
  }

  if (vColors.length === verts.length && vColors.length > 0) {
    const colorArray = new Float32Array(vColors.length * 3);
    for (let i = 0; i < vColors.length; i++) {
      colorArray[i * 3] = vColors[i][0] ?? 1;
      colorArray[i * 3 + 1] = vColors[i][1] ?? 1;
      colorArray[i * 3 + 2] = vColors[i][2] ?? 1;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
  }

  if (faces.length > 0) {
    const indices: number[] = [];
    for (let i = 0; i < faces.length; i++) {
      const [a, b, c] = faces[i];
      if (a !== undefined && b !== undefined && c !== undefined) {
        indices.push(a, b, c);
      }
    }
    geom.setIndex(indices);
  }

  if (!geom.getAttribute('normal')) {
    geom.computeVertexNormals();
  }
  geom.computeBoundingBox();
  return geom;
}

/**
 * Builds a Three.js Group from a Forge3DAsset specification.
 */
export function buildThreeGroupFromAsset(
  asset: Forge3DAsset,
  options: {
    lodRatio?: number;
    wireframe?: boolean;
    showCollisions?: boolean;
    isSoftwareGl?: boolean;
    pbrTextures?: PBRTextureSet | null;
  } = {}
): { group: THREE.Group; triangleCount: number; partCount: number } {
  const {
    lodRatio = 1.0,
    wireframe = false,
    showCollisions = false,
    isSoftwareGl = false,
    pbrTextures = null,
  } = options;

  const group = new THREE.Group();
  group.name = asset.name || 'Forge3DAsset';

  let totalTriangles = 0;
  const segScale = Math.max(0.25, Math.min(1.0, lodRatio));
  const cylRadialSegs = Math.max(8, Math.round(28 * segScale));
  const sphereSegs = Math.max(8, Math.round(24 * segScale));

  for (const part of asset.parts || []) {
    const [sx = 2, sy = 2, sz = 2] = part.size || [2, 2, 2];
    const [px = 0, py = 1, pz = 0] = part.position || [0, 1, 0];
    const [rx = 0, ry = 0, rz = 0] = part.rotation || [0, 0, 0];
    const [r, g, b] = resolveRgbTuple(part.color);

    let geom: THREE.BufferGeometry;
    const hasCustomMeshData =
      part.meshData &&
      Array.isArray(part.meshData.vertices) &&
      part.meshData.vertices.length >= 3;

    if (hasCustomMeshData && part.meshData) {
      let selectedMeshData: SubMeshGeometryData = part.meshData;
      const lodList = Array.isArray(part.meshData.lodLevels) ? part.meshData.lodLevels : [];
      if (lodRatio < 0.99 && lodList.length > 0) {
        const targetLvl = lodRatio <= 0.45 ? 2 : lodRatio <= 0.78 ? 1 : 0;
        const matchedLod = lodList.find((l) => l.level === targetLvl);
        if (matchedLod && matchedLod.vertices.length >= 3 && matchedLod.faces.length >= 1) {
          selectedMeshData = {
            ...part.meshData,
            vertices: matchedLod.vertices,
            normals: matchedLod.normals,
            uvs: matchedLod.uvs,
            faces: matchedLod.faces,
          };
        } else {
          selectedMeshData = decimateMeshPartGeometry(part, lodRatio).meshData || part.meshData;
        }
      } else if (lodRatio < 0.99) {
        selectedMeshData = decimateMeshPartGeometry(part, lodRatio).meshData || part.meshData;
      }
      geom = buildBufferGeometryFromMeshData(selectedMeshData, [sx, sy, sz]);
    } else if (part.shape === 'Cylinder') {
      geom = new THREE.CylinderGeometry(sx / 2, sx / 2, sy, cylRadialSegs);
    } else if (part.shape === 'Ball') {
      geom = new THREE.SphereGeometry(sx / 2, sphereSegs, sphereSegs);
    } else if (part.shape === 'Wedge' || part.shape === 'CornerWedge') {
      geom = createWedgeGeometry(sx, sy, sz);
    } else {
      const boxSeg = segScale < 0.5 ? 1 : 2;
      geom = new THREE.BoxGeometry(sx, sy, sz, boxSeg, boxSeg, boxSeg);
    }

    const isNeon = part.material === 'Neon';
    const isGlass = part.material === 'Glass' || (part.transparency || 0) > 0.15;
    const baseColor = new THREE.Color(`rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`);
    const hasVertexColors = Boolean(geom.getAttribute('color'));

    let resolvedPbr = pbrTextures;
    if (part.pbrMaterial && part.pbrMaterial.pattern) {
      resolvedPbr = generateProceduralPBRTextures(
        part.pbrMaterial.pattern,
        part.pbrMaterial.albedoHex || `#${baseColor.getHexString()}`,
        part.pbrMaterial.emissiveHex || '#38bdf8',
        4,
        part.pbrMaterial.roughness ?? part.roughness ?? 0.35,
        part.pbrMaterial.metalness ?? part.metalness ?? 0.65
      );
    }

    const mat = new THREE.MeshPhysicalMaterial({
      color: hasVertexColors ? new THREE.Color(0xffffff) : baseColor,
      vertexColors: hasVertexColors,
      roughness: isNeon ? 0.08 : Math.max(0.05, Math.min(1, part.pbrMaterial?.roughness ?? part.roughness ?? 0.35)),
      metalness: isNeon ? 0.1 : Math.max(0, Math.min(1, part.pbrMaterial?.metalness ?? part.metalness ?? 0.65)),
      emissive: isNeon ? baseColor : new THREE.Color(0x000000),
      emissiveIntensity: isNeon ? 1.6 : 0,
      transparent: isGlass,
      opacity: isGlass ? Math.max(0.2, 1 - (part.transparency || 0.45)) : 1,
      transmission: isGlass && !isSoftwareGl ? 0.75 : 0,
      clearcoat: part.material === 'SmoothPlastic' || isGlass ? 0.8 : 0.2,
      side: part.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      wireframe,
      map: !isNeon && resolvedPbr ? resolvedPbr.albedoMap : null,
      normalMap: !isNeon && resolvedPbr ? resolvedPbr.normalMap : null,
      roughnessMap: !isNeon && resolvedPbr ? resolvedPbr.roughnessMap : null,
      metalnessMap: !isNeon && resolvedPbr ? resolvedPbr.metalnessMap : null,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = part.name;
    mesh.position.set(px, py, pz);
    mesh.rotation.set(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz)
    );
    mesh.castShadow = !isSoftwareGl && !isGlass;
    mesh.receiveShadow = !isSoftwareGl;
    mesh.userData = { partSpec: part };

    const indexAttr = geom.getIndex();
    const posAttr = geom.getAttribute('position');
    if (indexAttr) {
      totalTriangles += Math.round(indexAttr.count / 3);
    } else if (posAttr) {
      totalTriangles += Math.round(posAttr.count / 3);
    }

    if (showCollisions && part.canCollide) {
      const hullColor =
        part.collisionFidelity === 'Box'
          ? 0x22c55e
          : part.collisionFidelity === 'PreciseConvexDecomposition'
          ? 0xf43f5e
          : 0x38bdf8;
      const edges = new THREE.EdgesGeometry(geom, 12);
      const lineMat = new THREE.LineBasicMaterial({ color: hullColor });
      const hullWire = new THREE.LineSegments(edges, lineMat);
      hullWire.scale.setScalar(1.015);
      mesh.add(hullWire);
    }

    group.add(mesh);
  }

  return {
    group,
    triangleCount: totalTriangles,
    partCount: (asset.parts || []).length,
  };
}

/**
 * Extracts SubMeshGeometryData from any Three.js BufferGeometry
 */
export function extractMeshDataFromBufferGeometry(
  geom: THREE.BufferGeometry,
  objFileName?: string
): SubMeshGeometryData {
  const g = geom.clone();
  if (!g.getAttribute('normal')) {
    g.computeVertexNormals();
  }
  const posAttr = g.getAttribute('position');
  const normAttr = g.getAttribute('normal');
  const uvAttr = g.getAttribute('uv');
  const indexAttr = g.getIndex();

  const vertices: number[][] = [];
  const normals: number[][] = [];
  const uvs: number[][] = [];
  const faces: number[][] = [];

  if (posAttr) {
    for (let i = 0; i < posAttr.count; i++) {
      vertices.push([
        Number(posAttr.getX(i).toFixed(4)),
        Number(posAttr.getY(i).toFixed(4)),
        Number(posAttr.getZ(i).toFixed(4)),
      ]);
      if (normAttr && i < normAttr.count) {
        normals.push([
          Number(normAttr.getX(i).toFixed(4)),
          Number(normAttr.getY(i).toFixed(4)),
          Number(normAttr.getZ(i).toFixed(4)),
        ]);
      } else {
        normals.push([0, 1, 0]);
      }
      if (uvAttr && i < uvAttr.count) {
        uvs.push([
          Number(uvAttr.getX(i).toFixed(4)),
          Number(uvAttr.getY(i).toFixed(4)),
        ]);
      } else {
        uvs.push([0, 0]);
      }
    }
  }

  if (indexAttr) {
    for (let i = 0; i < indexAttr.count - 2; i += 3) {
      faces.push([
        indexAttr.getX(i),
        indexAttr.getX(i + 1),
        indexAttr.getX(i + 2),
      ]);
    }
  } else if (posAttr) {
    for (let i = 0; i < posAttr.count - 2; i += 3) {
      faces.push([i, i + 1, i + 2]);
    }
  }

  g.dispose();
  return { vertices, normals, uvs, faces, objFileName };
}

/**
 * Ensures a MeshPart3DSpec has real indexed meshData (synthesizing high-detail topology if missing)
 */
export function ensurePartHasMeshData(part: MeshPart3DSpec): SubMeshGeometryData {
  if (
    part.meshData &&
    Array.isArray(part.meshData.vertices) &&
    part.meshData.vertices.length >= 3 &&
    Array.isArray(part.meshData.faces) &&
    part.meshData.faces.length >= 1
  ) {
    return part.meshData;
  }
  const [sx = 2, sy = 2, sz = 2] = part.size || [2, 2, 2];
  let geom: THREE.BufferGeometry;
  if (part.shape === 'Cylinder') {
    geom = new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 16);
  } else if (part.shape === 'Ball') {
    geom = new THREE.SphereGeometry(sx / 2, 16, 12);
  } else if (part.shape === 'Wedge' || part.shape === 'CornerWedge') {
    geom = createWedgeGeometry(sx, sy, sz);
  } else {
    geom = new THREE.CylinderGeometry(sx * 0.46, sx * 0.5, sy, 8, 2);
    geom.scale(1, 1, sz / Math.max(sx, 0.01));
  }
  return extractMeshDataFromBufferGeometry(geom, part.meshData?.objFileName);
}

/**
 * Recomputes smooth vertex normals from a vertex/face list
 */
export function recomputeSmoothNormals(
  vertices: number[][],
  faces: number[][]
): number[][] {
  const accum = vertices.map(() => [0, 0, 0]);
  for (const [i0, i1, i2] of faces) {
    const v0 = vertices[i0];
    const v1 = vertices[i1];
    const v2 = vertices[i2];
    if (!v0 || !v1 || !v2) continue;
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
  return accum.map(([nx, ny, nz]) => {
    const len = Math.hypot(nx, ny, nz);
    return len > 1e-6
      ? [
          Number((nx / len).toFixed(4)),
          Number((ny / len).toFixed(4)),
          Number((nz / len).toFixed(4)),
        ]
      : [0, 1, 0];
  });
}

/**
 * Rescales a MeshPart's actual vertex coordinates non-destructively from `part.baseMeshData`
 */
export function rescaleMeshPartGeometry(
  part: MeshPart3DSpec,
  newSize: number[]
): MeshPart3DSpec {
  const currentMesh = ensurePartHasMeshData(part);
  const immutableBase: SubMeshGeometryData =
    part.baseMeshData && part.baseMeshData.vertices?.length > 0
      ? part.baseMeshData
      : {
          vertices: currentMesh.vertices.map((v) => [...v]),
          normals: (currentMesh.normals || []).map((n) => [...n]),
          uvs: (currentMesh.uvs || []).map((u) => [...u]),
          faces: currentMesh.faces.map((f) => [...f]),
          vertexColors: currentMesh.vertexColors,
          objFileName: currentMesh.objFileName,
        };

  const verts = immutableBase.vertices;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const v of verts) {
    if (v[0] < minX) minX = v[0];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2];
    if (v[2] > maxZ) maxZ = v[2];
  }
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const spanX = Math.max(maxX - minX, 1e-4);
  const spanY = Math.max(maxY - minY, 1e-4);
  const spanZ = Math.max(maxZ - minZ, 1e-4);

  const sx = Math.max(0.2, newSize[0] ?? part.size[0] ?? 2);
  const sy = Math.max(0.2, newSize[1] ?? part.size[1] ?? 2);
  const sz = Math.max(0.2, newSize[2] ?? part.size[2] ?? 2);

  const scaledVertices = verts.map((v) => [
    Number(((v[0] - cx) * (sx / spanX)).toFixed(4)),
    Number(((v[1] - cy) * (sy / spanY)).toFixed(4)),
    Number(((v[2] - cz) * (sz / spanZ)).toFixed(4)),
  ]);
  const updatedNormals = recomputeSmoothNormals(scaledVertices, immutableBase.faces);

  return {
    ...part,
    shape: 'MeshPart',
    size: [Number(sx.toFixed(2)), Number(sy.toFixed(2)), Number(sz.toFixed(2))],
    baseMeshData: immutableBase,
    meshData: {
      ...immutableBase,
      vertices: scaledVertices,
      normals: updatedNormals,
    },
  };
}

/**
 * Performs real 3D Midpoint Triangle Subdivision on a MeshPart's geometry
 */
export function subdivideMeshPartGeometry(part: MeshPart3DSpec): MeshPart3DSpec {
  const baseData = ensurePartHasMeshData(part);
  if (baseData.faces.length * 4 > 9600) {
    return part;
  }
  const vertices = baseData.vertices.map((v) => [...v]);
  const uvs = (baseData.uvs || vertices.map(() => [0, 0])).map((u) => [...u]);
  const midpointCache = new Map<string, number>();

  const getMidpointIndex = (i1: number, i2: number): number => {
    const key = i1 < i2 ? `${i1}_${i2}` : `${i2}_${i1}`;
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;

    const v1 = vertices[i1];
    const v2 = vertices[i2];
    const u1 = uvs[i1] || [0, 0];
    const u2 = uvs[i2] || [0, 0];

    const newIdx = vertices.length;
    vertices.push([
      Number(((v1[0] + v2[0]) * 0.5).toFixed(4)),
      Number(((v1[1] + v2[1]) * 0.5).toFixed(4)),
      Number(((v1[2] + v2[2]) * 0.5).toFixed(4)),
    ]);
    uvs.push([
      Number(((u1[0] + u2[0]) * 0.5).toFixed(4)),
      Number(((u1[1] + u2[1]) * 0.5).toFixed(4)),
    ]);
    midpointCache.set(key, newIdx);
    return newIdx;
  };

  const newFaces: number[][] = [];
  for (const [a, b, c] of baseData.faces) {
    if (vertices[a] && vertices[b] && vertices[c]) {
      const ab = getMidpointIndex(a, b);
      const bc = getMidpointIndex(b, c);
      const ca = getMidpointIndex(c, a);
      newFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
  }

  const normals = recomputeSmoothNormals(vertices, newFaces);
  return {
    ...part,
    shape: 'MeshPart',
    meshData: {
      ...baseData,
      vertices,
      normals,
      uvs,
      faces: newFaces,
    },
  };
}

/**
 * Applies Laplacian Vertex Smoothing to a MeshPart's geometry and recomputes smooth normals
 */
export function smoothMeshPartGeometry(
  part: MeshPart3DSpec,
  iterations: number = 1,
  lambda: number = 0.38
): MeshPart3DSpec {
  const baseData = ensurePartHasMeshData(part);
  let currentVerts = baseData.vertices.map((v) => [...v]);
  const faces = baseData.faces;

  const neighbors: Array<Set<number>> = currentVerts.map(() => new Set<number>());
  for (const [a, b, c] of faces) {
    if (a < currentVerts.length && b < currentVerts.length && c < currentVerts.length) {
      neighbors[a].add(b);
      neighbors[a].add(c);
      neighbors[b].add(a);
      neighbors[b].add(c);
      neighbors[c].add(a);
      neighbors[c].add(b);
    }
  }

  for (let iter = 0; iter < iterations; iter++) {
    const nextVerts = currentVerts.map((v, idx) => {
      const nbrs = Array.from(neighbors[idx]);
      if (nbrs.length === 0) return v;
      let avgX = 0, avgY = 0, avgZ = 0;
      for (const nIdx of nbrs) {
        avgX += currentVerts[nIdx][0];
        avgY += currentVerts[nIdx][1];
        avgZ += currentVerts[nIdx][2];
      }
      avgX /= nbrs.length;
      avgY /= nbrs.length;
      avgZ /= nbrs.length;
      return [
        Number((v[0] + lambda * (avgX - v[0])).toFixed(4)),
        Number((v[1] + lambda * (avgY - v[1])).toFixed(4)),
        Number((v[2] + lambda * (avgZ - v[2])).toFixed(4)),
      ];
    });
    currentVerts = nextVerts;
  }

  const normals = recomputeSmoothNormals(currentVerts, faces);
  return {
    ...part,
    shape: 'MeshPart',
    meshData: {
      ...baseData,
      vertices: currentVerts,
      normals,
    },
  };
}

/**
 * Real 3D Spatial Grid Vertex-Clustering Mesh Decimation
 */
export function decimateMeshPartGeometry(
  part: MeshPart3DSpec,
  targetRatio: number = 0.65
): MeshPart3DSpec {
  const baseData = ensurePartHasMeshData(part);
  const clampedRatio = Math.max(0.2, Math.min(1.0, targetRatio));
  if (clampedRatio >= 0.98 || baseData.faces.length <= 16) {
    return part;
  }

  const verts = baseData.vertices;
  const uvs = baseData.uvs || [];
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const v of verts) {
    if (v[0] < minX) minX = v[0];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2];
    if (v[2] > maxZ) maxZ = v[2];
  }

  const gridDivs = Math.max(4, Math.round(Math.cbrt(verts.length * clampedRatio) * 1.6));
  const stepX = Math.max((maxX - minX) / gridDivs, 1e-4);
  const stepY = Math.max((maxY - minY) / gridDivs, 1e-4);
  const stepZ = Math.max((maxZ - minZ) / gridDivs, 1e-4);

  const cellMap = new Map<
    string,
    { sumX: number; sumY: number; sumZ: number; sumU: number; sumV: number; count: number; newIndex: number }
  >();
  const oldToNewIndex: number[] = new Array(verts.length);

  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    const uv = uvs[i] || [0, 0];
    const gx = Math.floor((v[0] - minX) / stepX);
    const gy = Math.floor((v[1] - minY) / stepY);
    const gz = Math.floor((v[2] - minZ) / stepZ);
    const key = `${gx}_${gy}_${gz}`;
    let cluster = cellMap.get(key);
    if (!cluster) {
      cluster = {
        sumX: 0,
        sumY: 0,
        sumZ: 0,
        sumU: 0,
        sumV: 0,
        count: 0,
        newIndex: cellMap.size,
      };
      cellMap.set(key, cluster);
    }
    cluster.sumX += v[0];
    cluster.sumY += v[1];
    cluster.sumZ += v[2];
    cluster.sumU += uv[0];
    cluster.sumV += uv[1];
    cluster.count += 1;
    oldToNewIndex[i] = cluster.newIndex;
  }

  const newVertices: number[][] = [];
  const newUvs: number[][] = [];
  for (const cluster of cellMap.values()) {
    newVertices.push([
      Number((cluster.sumX / cluster.count).toFixed(4)),
      Number((cluster.sumY / cluster.count).toFixed(4)),
      Number((cluster.sumZ / cluster.count).toFixed(4)),
    ]);
    newUvs.push([
      Number((cluster.sumU / cluster.count).toFixed(4)),
      Number((cluster.sumV / cluster.count).toFixed(4)),
    ]);
  }

  const faceSet = new Set<string>();
  const newFaces: number[][] = [];
  for (const [a, b, c] of baseData.faces) {
    const na = oldToNewIndex[a];
    const nb = oldToNewIndex[b];
    const nc = oldToNewIndex[c];
    if (na !== undefined && nb !== undefined && nc !== undefined && na !== nb && nb !== nc && na !== nc) {
      const key = `${na}_${nb}_${nc}`;
      if (!faceSet.has(key)) {
        faceSet.add(key);
        newFaces.push([na, nb, nc]);
      }
    }
  }

  if (newFaces.length < 4) {
    return part;
  }

  const newNormals = recomputeSmoothNormals(newVertices, newFaces);
  return {
    ...part,
    shape: 'MeshPart',
    meshData: {
      ...baseData,
      vertices: newVertices,
      normals: newNormals,
      uvs: newUvs,
      faces: newFaces,
    },
  };
}

/**
 * Recomputes Tri-Planar / Box-Projected UV coordinates and smooth normals on a MeshPart
 */
export function recomputeNormalsAndBoxUVs(part: MeshPart3DSpec): MeshPart3DSpec {
  const baseData = ensurePartHasMeshData(part);
  const verts = baseData.vertices;
  const normals = recomputeSmoothNormals(verts, baseData.faces);

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const v of verts) {
    if (v[0] < minX) minX = v[0];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2];
    if (v[2] > maxZ) maxZ = v[2];
  }
  const spanX = Math.max(maxX - minX, 1e-4);
  const spanY = Math.max(maxY - minY, 1e-4);
  const spanZ = Math.max(maxZ - minZ, 1e-4);

  const uvs = verts.map((v, idx) => {
    const n = normals[idx] || [0, 1, 0];
    const ax = Math.abs(n[0]);
    const ay = Math.abs(n[1]);
    const az = Math.abs(n[2]);
    if (ay >= ax && ay >= az) {
      return [
        Number(((v[0] - minX) / spanX).toFixed(4)),
        Number(((v[2] - minZ) / spanZ).toFixed(4)),
      ];
    }
    if (ax >= ay && ax >= az) {
      return [
        Number(((v[2] - minZ) / spanZ).toFixed(4)),
        Number(((v[1] - minY) / spanY).toFixed(4)),
      ];
    }
    return [
      Number(((v[0] - minX) / spanX).toFixed(4)),
      Number(((v[1] - minY) / spanY).toFixed(4)),
    ];
  });

  return {
    ...part,
    shape: 'MeshPart',
    meshData: {
      ...baseData,
      normals,
      uvs,
    },
  };
}

/**
 * Grounds all parts in a Forge3DAsset so the lowest point of the entire model sits flush at Y = 0 Studs
 */
export function snapAssetToGroundY0(asset: Forge3DAsset): Forge3DAsset {
  if (!asset.parts || asset.parts.length === 0) return asset;
  let minWorldY = Infinity;
  for (const part of asset.parts) {
    const py = part.position?.[1] ?? 0;
    const sy = part.size?.[1] ?? 2;
    const lowY = py - sy * 0.5;
    if (lowY < minWorldY) minWorldY = lowY;
  }
  if (!Number.isFinite(minWorldY) || Math.abs(minWorldY) < 1e-4) return asset;

  const updatedParts = asset.parts.map((part) => ({
    ...part,
    position: [
      part.position?.[0] ?? 0,
      Number(((part.position?.[1] ?? 0) - minWorldY).toFixed(3)),
      part.position?.[2] ?? 0,
    ],
  }));
  return {
    ...asset,
    parts: updatedParts,
  };
}

/**
 * Validates and non-destructively repairs degenerate geometry on a MeshPart
 */
export function validateAndRepairDegenerateGeometry(part: MeshPart3DSpec): {
  repairedPart: MeshPart3DSpec;
  report: DegenerateGeometryReport;
} {
  const baseData = ensurePartHasMeshData(part);
  const rawVerts = baseData.vertices || [];
  const rawNorms = baseData.normals || [];
  const rawUvs = baseData.uvs || [];
  const rawFaces = baseData.faces || [];

  let nanOrInfCount = 0;
  let collapsedIndexTriangles = 0;
  let zeroAreaTriangles = 0;
  let duplicateTriangles = 0;
  let repairedUVsCount = 0;

  const cleanVerts: number[][] = rawVerts.map((v) => {
    const x = Number.isFinite(v?.[0]) ? v[0] : 0;
    const y = Number.isFinite(v?.[1]) ? v[1] : 0;
    const z = Number.isFinite(v?.[2]) ? v[2] : 0;
    if (!Number.isFinite(v?.[0]) || !Number.isFinite(v?.[1]) || !Number.isFinite(v?.[2])) {
      nanOrInfCount++;
    }
    return [Number(x.toFixed(4)), Number(y.toFixed(4)), Number(z.toFixed(4))];
  });

  const cleanUvs: number[][] = cleanVerts.map((_, idx) => {
    const uv = rawUvs[idx];
    if (!uv || !Number.isFinite(uv[0]) || !Number.isFinite(uv[1])) {
      repairedUVsCount++;
      return [0, 0];
    }
    return [Number(uv[0].toFixed(4)), Number(uv[1].toFixed(4))];
  });

  const validFaces: number[][] = [];
  const seenTriKeys = new Set<string>();
  const usedVertexSet = new Set<number>();

  for (const tri of rawFaces) {
    if (!Array.isArray(tri) || tri.length < 3) {
      collapsedIndexTriangles++;
      continue;
    }
    const [a, b, c] = tri;
    if (
      a === undefined ||
      b === undefined ||
      c === undefined ||
      a < 0 ||
      b < 0 ||
      c < 0 ||
      a >= cleanVerts.length ||
      b >= cleanVerts.length ||
      c >= cleanVerts.length ||
      a === b ||
      b === c ||
      a === c
    ) {
      collapsedIndexTriangles++;
      continue;
    }

    const v0 = cleanVerts[a];
    const v1 = cleanVerts[b];
    const v2 = cleanVerts[c];
    const ux = v1[0] - v0[0];
    const uy = v1[1] - v0[1];
    const uz = v1[2] - v0[2];
    const wx = v2[0] - v0[0];
    const wy = v2[1] - v0[1];
    const wz = v2[2] - v0[2];
    const cx = uy * wz - uz * wy;
    const cy = uz * wx - ux * wz;
    const cz = ux * wy - uy * wx;
    const doubleArea = Math.hypot(cx, cy, cz);

    if (doubleArea < 1e-6) {
      zeroAreaTriangles++;
      continue;
    }

    const sortedKey = [a, b, c].slice().sort((x, y) => x - y).join('_');
    if (seenTriKeys.has(sortedKey)) {
      duplicateTriangles++;
      continue;
    }
    seenTriKeys.add(sortedKey);
    validFaces.push([a, b, c]);
    usedVertexSet.add(a);
    usedVertexSet.add(b);
    usedVertexSet.add(c);
  }

  const oldToNew = new Map<number, number>();
  const compactedVerts: number[][] = [];
  const compactedUvs: number[][] = [];

  for (let i = 0; i < cleanVerts.length; i++) {
    if (usedVertexSet.has(i)) {
      oldToNew.set(i, compactedVerts.length);
      compactedVerts.push(cleanVerts[i]);
      compactedUvs.push(cleanUvs[i]);
    }
  }

  const orphanedVerticesRemoved = cleanVerts.length - compactedVerts.length;
  const compactedFaces = validFaces.map(([a, b, c]) => [
    oldToNew.get(a) ?? 0,
    oldToNew.get(b) ?? 0,
    oldToNew.get(c) ?? 0,
  ]);

  const finalVerts = compactedVerts.length >= 3 ? compactedVerts : cleanVerts;
  const finalFaces = compactedFaces.length >= 1 ? compactedFaces : rawFaces;
  const finalUvs = compactedVerts.length >= 3 ? compactedUvs : cleanUvs;
  const recomputedNorms = recomputeSmoothNormals(finalVerts, finalFaces);

  let repairedNormalsCount = 0;
  if (rawNorms.length !== finalVerts.length) {
    repairedNormalsCount = finalVerts.length;
  }

  let allZeroUvs = true;
  for (const uv of finalUvs) {
    if (Math.abs(uv[0]) > 1e-4 || Math.abs(uv[1]) > 1e-4) {
      allZeroUvs = false;
      break;
    }
  }

  let repairedPart: MeshPart3DSpec = {
    ...part,
    shape: 'MeshPart',
    meshData: {
      ...baseData,
      vertices: finalVerts,
      normals: recomputedNorms,
      uvs: finalUvs,
      faces: finalFaces,
    },
  };

  if (allZeroUvs) {
    repairedPart = recomputeNormalsAndBoxUVs(repairedPart);
    repairedUVsCount = finalVerts.length;
  }

  const totalIssues =
    nanOrInfCount +
    collapsedIndexTriangles +
    zeroAreaTriangles +
    duplicateTriangles +
    orphanedVerticesRemoved;

  const report: DegenerateGeometryReport = {
    partName: part.name,
    isClean: totalIssues === 0 && repairedUVsCount === 0,
    nanOrInfCount,
    collapsedIndexTriangles,
    zeroAreaTriangles,
    duplicateTriangles,
    orphanedVerticesRemoved,
    repairedNormalsCount,
    repairedUVsCount,
    verticesBefore: rawVerts.length,
    verticesAfter: finalVerts.length,
    trianglesBefore: rawFaces.length,
    trianglesAfter: finalFaces.length,
    summary:
      totalIssues === 0
        ? `Geometría limpia en '${part.name}' (${finalVerts.length}v, ${finalFaces.length} tris, UVs y normales verificadas).`
        : `Auto-reparación en '${part.name}': ${zeroAreaTriangles + collapsedIndexTriangles} tris degenerados, ${duplicateTriangles} duplicados y ${orphanedVerticesRemoved} vértices huérfanos corregidos.`,
  };

  return { repairedPart, report };
}

/**
 * Smart Mesh Splitting (`División Inteligente`)
 */
export function smartSplitMeshPartGeometry(part: MeshPart3DSpec): {
  splitParts: MeshPart3DSpec[];
  mode: 'topological_islands' | 'principal_axis_plane' | 'unchanged';
  summary: string;
} {
  const md = ensurePartHasMeshData(part);
  if (md.faces.length < 4) {
    return {
      splitParts: [part],
      mode: 'unchanged',
      summary: `La pieza '${part.name}' tiene muy pocos triángulos (${md.faces.length}) para dividirse.`,
    };
  }

  const vertToFaces = new Map<number, number[]>();
  md.faces.forEach(([a, b, c], fIdx) => {
    for (const vIdx of [a, b, c]) {
      let list = vertToFaces.get(vIdx);
      if (!list) {
        list = [];
        vertToFaces.set(vIdx, list);
      }
      list.push(fIdx);
    }
  });

  const visitedFaces = new Uint8Array(md.faces.length);
  const islands: number[][][] = [];

  for (let fIdx = 0; fIdx < md.faces.length; fIdx++) {
    if (visitedFaces[fIdx]) continue;
    const component: number[][] = [];
    const queue: number[] = [fIdx];
    visitedFaces[fIdx] = 1;

    while (queue.length > 0) {
      const curr = queue.pop()!;
      const tri = md.faces[curr];
      component.push(tri);
      for (const vIdx of tri) {
        const nbrFaces = vertToFaces.get(vIdx) || [];
        for (const nf of nbrFaces) {
          if (!visitedFaces[nf]) {
            visitedFaces[nf] = 1;
            queue.push(nf);
          }
        }
      }
    }
    if (component.length > 0) {
      islands.push(component);
    }
  }

  const buildSubPartFromFaces = (subsetFaces: number[][], suffix: string): MeshPart3DSpec => {
    const oldToNew = new Map<number, number>();
    const subVerts: number[][] = [];
    const subUvs: number[][] = [];
    const remappedFaces: number[][] = [];

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const tri of subsetFaces) {
      const rTri = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const oldIdx = tri[k];
        let mapped = oldToNew.get(oldIdx);
        if (mapped === undefined) {
          mapped = subVerts.length;
          oldToNew.set(oldIdx, mapped);
          const v = md.vertices[oldIdx] || [0, 0, 0];
          subVerts.push([v[0], v[1], v[2]]);
          subUvs.push(md.uvs?.[oldIdx] ? [...md.uvs[oldIdx]] : [0, 0]);
          if (v[0] < minX) minX = v[0];
          if (v[0] > maxX) maxX = v[0];
          if (v[1] < minY) minY = v[1];
          if (v[1] > maxY) maxY = v[1];
          if (v[2] < minZ) minZ = v[2];
          if (v[2] > maxZ) maxZ = v[2];
        }
        rTri[k] = mapped;
      }
      remappedFaces.push(rTri);
    }

    const cx = Number.isFinite(minX) ? (minX + maxX) * 0.5 : 0;
    const cy = Number.isFinite(minY) ? (minY + maxY) * 0.5 : 0;
    const cz = Number.isFinite(minZ) ? (minZ + maxZ) * 0.5 : 0;

    const centeredVerts = subVerts.map(([vx, vy, vz]) => [
      Number((vx - cx).toFixed(4)),
      Number((vy - cy).toFixed(4)),
      Number((vz - cz).toFixed(4)),
    ]);
    const subNormals = recomputeSmoothNormals(centeredVerts, remappedFaces);

    const newSize: [number, number, number] = [
      Math.max(0.2, Number((maxX - minX).toFixed(2))),
      Math.max(0.2, Number((maxY - minY).toFixed(2))),
      Math.max(0.2, Number((maxZ - minZ).toFixed(2))),
    ];
    const [px = 0, py = 1, pz = 0] = part.position || [0, 1, 0];

    const subMeshData: SubMeshGeometryData = {
      vertices: centeredVerts,
      normals: subNormals,
      uvs: subUvs,
      faces: remappedFaces,
      objFileName: md.objFileName,
    };

    return {
      ...part,
      name: `${part.name}_${suffix}`,
      shape: 'MeshPart',
      size: newSize,
      position: [
        Number((px + cx).toFixed(2)),
        Number((py + cy).toFixed(2)),
        Number((pz + cz).toFixed(2)),
      ],
      baseMeshData: subMeshData,
      meshData: subMeshData,
    };
  };

  if (islands.length > 1) {
    const splitParts = islands.map((islandFaces, idx) =>
      buildSubPartFromFaces(islandFaces, `Isle${idx + 1}`)
    );
    return {
      splitParts,
      mode: 'topological_islands',
      summary: `'${part.name}' dividido por conectividad topológica en ${splitParts.length} islas MeshPart independientes con UVs y normales preservadas.`,
    };
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const v of md.vertices) {
    if (v[0] < minX) minX = v[0];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2];
    if (v[2] > maxZ) maxZ = v[2];
  }
  const spans = [maxX - minX, maxY - minY, maxZ - minZ];
  const axis = spans[0] >= spans[1] && spans[0] >= spans[2] ? 0 : spans[1] >= spans[2] ? 1 : 2;
  const axisLabel = axis === 0 ? 'X' : axis === 1 ? 'Y' : 'Z';
  const median =
    axis === 0 ? (minX + maxX) * 0.5 : axis === 1 ? (minY + maxY) * 0.5 : (minZ + maxZ) * 0.5;

  const facesA: number[][] = [];
  const facesB: number[][] = [];
  for (const tri of md.faces) {
    const v0 = md.vertices[tri[0]] || [0, 0, 0];
    const v1 = md.vertices[tri[1]] || [0, 0, 0];
    const v2 = md.vertices[tri[2]] || [0, 0, 0];
    const centroidAxis = (v0[axis] + v1[axis] + v2[axis]) / 3;
    if (centroidAxis <= median) {
      facesA.push(tri);
    } else {
      facesB.push(tri);
    }
  }

  if (facesA.length === 0 || facesB.length === 0) {
    const half = Math.floor(md.faces.length / 2);
    return {
      splitParts: [
        buildSubPartFromFaces(md.faces.slice(0, half), 'HalfA'),
        buildSubPartFromFaces(md.faces.slice(half), 'HalfB'),
      ],
      mode: 'principal_axis_plane',
      summary: `'${part.name}' dividido equilibradamente en 2 MeshParts preservando UVs y normales.`,
    };
  }

  return {
    splitParts: [
      buildSubPartFromFaces(facesA, `${axisLabel}Neg`),
      buildSubPartFromFaces(facesB, `${axisLabel}Pos`),
    ],
    mode: 'principal_axis_plane',
    summary: `'${part.name}' dividido por plano principal ${axisLabel} en 2 MeshParts (${facesA.length} y ${facesB.length} tris) con UVs y normales intactas.`,
  };
}

/**
 * Builds a Roblox R15 Character Scale Reference Dummy (5.5 Studs tall)
 */
export function buildRobloxR15ScaleDummy(): THREE.Group {
  const dummy = new THREE.Group();
  dummy.name = 'Roblox_R15_Scale_Reference';

  const mat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    roughness: 0.4,
    metalness: 0.2,
    transparent: true,
    opacity: 0.55,
  });

  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.0, 0.95), mat);
  leftLeg.position.set(-0.5, 1.0, 0);
  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.0, 0.95), mat);
  rightLeg.position.set(0.5, 1.0, 0);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.0, 1.0), mat);
  torso.position.set(0, 3.0, 0);

  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.0, 0.95), mat);
  leftArm.position.set(-1.5, 3.0, 0);
  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.0, 0.95), mat);
  rightArm.position.set(1.5, 3.0, 0);

  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.2, 16), mat);
  head.position.set(0, 4.65, 0);

  dummy.add(leftLeg, rightLeg, torso, leftArm, rightArm, head);
  dummy.position.set(-5.2, 0, 0);
  return dummy;
}
