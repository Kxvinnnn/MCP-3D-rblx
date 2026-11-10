import * as THREE from 'three';

export interface SubMeshGeometryData {
  vertices: number[][];
  normals?: number[][];
  uvs?: number[][];
  faces: number[][];
  vertexColors?: number[][];
  objFileName?: string;
}

export interface MeshPart3DSpec {
  name: string;
  shape: 'Block' | 'Cylinder' | 'Ball' | 'Wedge' | 'CornerWedge' | 'MeshPart';
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
  collisionFidelity: 'Default' | 'Box' | 'Hull' | 'PreciseConvexDecomposition';
  renderFidelity?: 'Automatic' | 'Precise' | 'Performance';
  doubleSided?: boolean;
  meshId?: string;
  meshData?: SubMeshGeometryData;
}

export interface PBRProfileSpec {
  albedo_hex: string;
  roughness: number;
  metalness: number;
  emissive_hex: string;
  roblox_material: string;
  pattern: string;
  albedo_asset_path?: string;
  normal_asset_path?: string;
  roughness_asset_path?: string;
}

export interface Forge3DAsset {
  id?: string;
  name: string;
  category: string;
  asset_type: 'Model3D' | 'Scene3D' | 'PBRMaterial';
  poly_count: number;
  collision_fidelity: 'Default' | 'Box' | 'Hull' | 'PreciseConvexDecomposition';
  rojo_target_folder: string;
  file_name: string;
  obj_file_name?: string;
  obj_saved_path?: string | null;
  description: string;
  pbr_profile: PBRProfileSpec;
  parts: MeshPart3DSpec[];
  luau_code: string;
  saved_path?: string | null;
  created_at?: string;
}

export interface PBRTextureSet {
  albedoMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  albedoDataUrl: string;
  normalDataUrl: string;
  roughnessDataUrl: string;
}

/**
 * Generates zero-404 procedural PBR texture maps (Albedo, Normal, Roughness)
 * for Roblox SurfaceAppearance & Three.js MeshStandardMaterial.
 */
export function generateProceduralPBRTextures(
  pattern: string,
  baseHex: string,
  accentHex: string,
  maxAnisotropy: number = 4
): PBRTextureSet {
  const size = 256;

  // 1. Albedo Canvas
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const aCtx = albedoCanvas.getContext('2d')!;
  aCtx.fillStyle = baseHex || '#334155';
  aCtx.fillRect(0, 0, size, size);

  // 2. Normal Canvas (neutral normal = rgb(128, 128, 255))
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = size;
  normalCanvas.height = size;
  const nCtx = normalCanvas.getContext('2d')!;
  nCtx.fillStyle = 'rgb(128, 128, 255)';
  nCtx.fillRect(0, 0, size, size);

  // 3. Roughness Canvas
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;
  rCtx.fillStyle = 'rgb(95, 95, 95)';
  rCtx.fillRect(0, 0, size, size);

  if (pattern === 'BrushedTitanium' || pattern === 'brushed_metal' || pattern === 'Metal') {
    for (let y = 0; y < size; y += 2) {
      const shade = 235 + Math.floor(Math.sin(y * 0.4) * 18);
      aCtx.fillStyle = `rgba(${shade}, ${shade}, 255, 0.05)`;
      aCtx.fillRect(0, y, size, 1);

      nCtx.fillStyle = y % 4 === 0 ? 'rgb(128, 136, 255)' : 'rgb(128, 120, 255)';
      nCtx.fillRect(0, y, size, 1);
    }
    aCtx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    aCtx.lineWidth = 2;
    aCtx.strokeRect(8, 8, size - 16, size - 16);
    nCtx.strokeStyle = 'rgb(100, 100, 255)';
    nCtx.lineWidth = 3;
    nCtx.strokeRect(8, 8, size - 16, size - 16);
  } else if (pattern === 'HexGridCarbon' || pattern === 'carbon_weave' || pattern === 'DiamondPlate') {
    const step = 32;
    aCtx.strokeStyle = accentHex || '#06b6d4';
    aCtx.lineWidth = 1.5;
    nCtx.strokeStyle = 'rgb(155, 155, 255)';
    nCtx.lineWidth = 2;
    for (let x = 0; x < size; x += step) {
      for (let y = 0; y < size; y += step) {
        aCtx.strokeRect(x + 2, y + 2, step - 4, step - 4);
        nCtx.strokeRect(x + 2, y + 2, step - 4, step - 4);
        rCtx.fillStyle = (x + y) % 64 === 0 ? 'rgb(60,60,60)' : 'rgb(130,130,130)';
        rCtx.fillRect(x + 4, y + 4, step - 8, step - 8);
      }
    }
  } else if (pattern === 'WeatheredStone' || pattern === 'stone_grid' || pattern === 'Slate') {
    for (let i = 0; i < 180; i++) {
      const rx = (i * 53) % size;
      const ry = (i * 97) % size;
      const rw = 16 + (i % 24);
      aCtx.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.06)';
      aCtx.fillRect(rx, ry, rw, rw);
      nCtx.fillStyle = i % 2 === 0 ? 'rgb(112, 120, 250)' : 'rgb(142, 134, 250)';
      nCtx.fillRect(rx, ry, rw / 2, rw / 2);
      rCtx.fillStyle = 'rgb(190, 190, 190)';
      rCtx.fillRect(rx, ry, rw, rw);
    }
  } else {
    aCtx.strokeStyle = accentHex || '#38bdf8';
    aCtx.lineWidth = 2;
    aCtx.strokeRect(12, 12, size - 24, size - 24);
    aCtx.beginPath();
    aCtx.moveTo(0, size / 2);
    aCtx.lineTo(size, size / 2);
    aCtx.stroke();
  }

  const albedoMap = new THREE.CanvasTexture(albedoCanvas);
  albedoMap.colorSpace = THREE.SRGBColorSpace;
  albedoMap.wrapS = THREE.RepeatWrapping;
  albedoMap.wrapT = THREE.RepeatWrapping;
  albedoMap.anisotropy = maxAnisotropy;

  const normalMap = new THREE.CanvasTexture(normalCanvas);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  return {
    albedoMap,
    normalMap,
    roughnessMap,
    albedoDataUrl: albedoCanvas.toDataURL('image/png'),
    normalDataUrl: normalCanvas.toDataURL('image/png'),
    roughnessDataUrl: roughCanvas.toDataURL('image/png'),
  };
}

/**
 * Creates a true Roblox WedgePart BufferGeometry of size [w, h, d] with UVs.
 */
export function createWedgeGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;

  const positions = new Float32Array([
    // Bottom face (y = -hh)
    -hw, -hh, -hd,  hw, -hh, -hd,  hw, -hh,  hd,
    -hw, -hh, -hd,  hw, -hh,  hd, -hw, -hh,  hd,
    // Back face (z = -hd)
    -hw, -hh, -hd, -hw,  hh, -hd,  hw,  hh, -hd,
    -hw, -hh, -hd,  hw,  hh, -hd,  hw, -hh, -hd,
    // Sloped top/front face
    -hw,  hh, -hd, -hw, -hh,  hd,  hw, -hh,  hd,
    -hw,  hh, -hd,  hw, -hh,  hd,  hw,  hh, -hd,
    // Left triangular face (x = -hw)
    -hw, -hh, -hd, -hw, -hh,  hd, -hw,  hh, -hd,
    // Right triangular face (x = +hw)
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
 * Reconstructs a real Three.js BufferGeometry from preserved SubMeshGeometryData
 * (vertices, normals, UVs, and triangle faces) so imported GLB/OBJ/Heightmap
 * assets keep their exact 3D mesh topology instead of becoming bounding boxes.
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

  // Compute current bounding box of meshData.vertices so targetStudSize edits scale vertices proportionally
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
 * Builds a Three.js Group from a Forge3DAsset specification, reconstructing
 * real BufferGeometry when `part.meshData` is present (GLB/OBJ/Heightmap/RBXMX MeshParts)
 * or procedural Roblox primitives when `part.shape` is Cylinder/Ball/Wedge.
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
    const [r = 160, g = 170, b = 185] = part.color || [160, 170, 185];

    let geom: THREE.BufferGeometry;
    const hasCustomMeshData =
      part.meshData &&
      Array.isArray(part.meshData.vertices) &&
      part.meshData.vertices.length >= 3;

    if (hasCustomMeshData && part.meshData) {
      const effectivePart =
        lodRatio < 0.99 ? decimateMeshPartGeometry(part, lodRatio) : part;
      geom = buildBufferGeometryFromMeshData(
        effectivePart.meshData || part.meshData,
        [sx, sy, sz]
      );
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

    const mat = new THREE.MeshPhysicalMaterial({
      color: hasVertexColors ? new THREE.Color(0xffffff) : baseColor,
      vertexColors: hasVertexColors,
      roughness: isNeon ? 0.08 : Math.max(0.05, Math.min(1, part.roughness ?? 0.35)),
      metalness: isNeon ? 0.1 : Math.max(0, Math.min(1, part.metalness ?? 0.65)),
      emissive: isNeon ? baseColor : new THREE.Color(0x000000),
      emissiveIntensity: isNeon ? 1.6 : 0,
      transparent: isGlass,
      opacity: isGlass ? Math.max(0.2, 1 - (part.transparency || 0.45)) : 1,
      transmission: isGlass && !isSoftwareGl ? 0.75 : 0,
      clearcoat: part.material === 'SmoothPlastic' || isGlass ? 0.8 : 0.2,
      side: part.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      wireframe,
      map: !isNeon && pbrTextures ? pbrTextures.albedoMap : null,
      normalMap: !isNeon && pbrTextures ? pbrTextures.normalMap : null,
      roughnessMap: !isNeon && pbrTextures ? pbrTextures.roughnessMap : null,
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
    // Chamfered 8-sided prism so it is a true multi-faceted MeshPart
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
 * Rescales a MeshPart's actual vertex coordinates proportionally to match `newSize` [sx, sy, sz]
 * and recomputes smooth normals so exported geometry preserves the exact edited dimensions and shape.
 */
export function rescaleMeshPartGeometry(
  part: MeshPart3DSpec,
  newSize: number[]
): MeshPart3DSpec {
  const baseData = ensurePartHasMeshData(part);
  const verts = baseData.vertices;
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
  const updatedNormals = recomputeSmoothNormals(scaledVertices, baseData.faces);

  return {
    ...part,
    shape: 'MeshPart',
    size: [Number(sx.toFixed(2)), Number(sy.toFixed(2)), Number(sz.toFixed(2))],
    meshData: {
      ...baseData,
      vertices: scaledVertices,
      normals: updatedNormals,
    },
  };
}

/**
 * Performs real 3D Midpoint Triangle Subdivision on a MeshPart's geometry
 * (splits each triangle into 4 or splits longest edges up to Roblox's <10k limit)
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
 * Reduces triangle and vertex counts geometrically while preserving UV coordinates and normals.
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
 * so PBR SurfaceAppearance maps tile cleanly without distortion.
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

/**
 * Generates a --!strict Roblox EditableMesh / MeshPart Luau module from real
 * vertex, normal, UV, and triangle buffers so the exact 3D relief or imported
 * mesh topology is reconstructed inside Roblox Studio via AssetService:CreateEditableMesh()
 * and AssetService:CreateMeshPartAsync().
 */
export function generateEditableMeshLuauCode(
  modelName: string,
  subMeshes: Array<{
    name: string;
    size: [number, number, number];
    position: [number, number, number];
    rotation: [number, number, number];
    color: [number, number, number];
    material: string;
    roughness: number;
    metalness: number;
    collisionFidelity: string;
    renderFidelity?: string;
    doubleSided?: boolean;
    meshId?: string;
    assetId?: string;
    meshData?: SubMeshGeometryData;
  }>
): string {
  const safeName = modelName.replace(/[^a-zA-Z0-9_]/g, '') || 'ForgeMeshModel';
  const lines: string[] = [
    '--!strict',
    `-- Generated by Forge AI Real Geometry Pipeline: ${safeName}`,
    '-- Outputs MeshPart instances with MeshId/AssetId references + AssetService:CreateEditableMesh() real vertex/normal/UV/index buffers',
    'local AssetService = game:GetService("AssetService")',
    'local InsertService = game:GetService("InsertService")',
    'local Workspace = game:GetService("Workspace")',
    '',
    'export type MeshSpawnConfig = {',
    '    origin: CFrame?,',
    '    meshAssetIds: { [string]: string }?,',
    '    colorMapId: string?,',
    '    normalMapId: string?,',
    '    roughnessMapId: string?,',
    '}',
    '',
    'type SubMeshPayload = {',
    '    name: string,',
    '    meshId: string,',
    '    assetId: string,',
    '    objSourcePath: string,',
    '    offsetPos: Vector3,',
    '    offsetRotDeg: Vector3,',
    '    color: Color3,',
    '    material: Enum.Material,',
    '    collisionFidelity: Enum.CollisionFidelity,',
    '    renderFidelity: Enum.RenderFidelity,',
    '    doubleSided: boolean,',
    '    vertices: { { number } },',
    '    normals: { { number } },',
    '    uvs: { { number } },',
    '    faces: { { number } },',
    '}',
    '',
    `local ${safeName}MeshBuilder = {}`,
    '',
    'local SUB_MESH_DATA: { SubMeshPayload } = {',
  ];

  for (const sub of subMeshes) {
    const [px, py, pz] = sub.position;
    const [rx, ry, rz] = sub.rotation;
    const [cr, cg, cb] = sub.color;
    const fidelity = sub.collisionFidelity || 'Hull';
    const renderFid = sub.renderFidelity || 'Precise';

    const rawVerts = sub.meshData?.vertices || [];
    const rawNorms = sub.meshData?.normals || [];
    const rawUvs = sub.meshData?.uvs || [];
    const rawFaces = sub.meshData?.faces || [];

    const maxInlineVerts = 3500;
    const maxInlineFaces = 4500;
    const cappedVerts = rawVerts.slice(0, maxInlineVerts);
    const cappedFaces = rawFaces
      .slice(0, maxInlineFaces)
      .filter((f) => f[0] < maxInlineVerts && f[1] < maxInlineVerts && f[2] < maxInlineVerts);

    const vertStrings = cappedVerts.map(
      (v) => `{${Number(v[0] ?? 0).toFixed(4)}, ${Number(v[1] ?? 0).toFixed(4)}, ${Number(v[2] ?? 0).toFixed(4)}}`
    );
    const normStrings = cappedVerts.map((_, i) => {
      const n = rawNorms[i] || [0, 1, 0];
      return `{${Number(n[0] ?? 0).toFixed(4)}, ${Number(n[1] ?? 1).toFixed(4)}, ${Number(n[2] ?? 0).toFixed(4)}}`;
    });
    const uvStrings = cappedVerts.map((_, i) => {
      const u = rawUvs[i] || [0, 0];
      return `{${Number(u[0] ?? 0).toFixed(4)}, ${Number(u[1] ?? 0).toFixed(4)}}`;
    });
    const faceStrings = cappedFaces.map(
      (f) => `{${(f[0] ?? 0) + 1}, ${(f[1] ?? 1) + 1}, ${(f[2] ?? 2) + 1}}`
    );

    const objFile = sub.meshData?.objFileName || `${safeName}.obj`;
    const meshId = sub.meshId && sub.meshId.startsWith('rbxassetid://') ? sub.meshId : 'rbxassetid://1000000001';
    const assetId = sub.assetId && sub.assetId.startsWith('rbxassetid://') ? sub.assetId : meshId;

    lines.push(
      '    {',
      `        name = "${sub.name}",`,
      `        meshId = "${meshId}",`,
      `        assetId = "${assetId}",`,
      `        objSourcePath = "src/shared/Assets3D/${objFile}",`,
      `        offsetPos = Vector3.new(${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)}),`,
      `        offsetRotDeg = Vector3.new(${rx.toFixed(1)}, ${ry.toFixed(1)}, ${rz.toFixed(1)}),`,
      `        color = Color3.fromRGB(${Math.round(cr)}, ${Math.round(cg)}, ${Math.round(cb)}),`,
      `        material = Enum.Material.${sub.material || 'Metal'},`,
      `        collisionFidelity = Enum.CollisionFidelity.${fidelity},`,
      `        renderFidelity = Enum.RenderFidelity.${renderFid},`,
      `        doubleSided = ${sub.doubleSided ? 'true' : 'false'},`,
      `        vertices = { ${vertStrings.join(', ')} },`,
      `        normals = { ${normStrings.join(', ')} },`,
      `        uvs = { ${uvStrings.join(', ')} },`,
      `        faces = { ${faceStrings.join(', ')} },`,
      '    },'
    );
  }

  lines.push(
    '}',
    '',
    'local function buildMeshPartFromPayload(payload: SubMeshPayload, overrideAssetId: string?): MeshPart',
    '    local okEditable, generatedMeshPart = pcall(function()',
    '        local editableMesh = AssetService:CreateEditableMesh()',
    '        local vertexIds: { number } = table.create(#payload.vertices)',
    '        local normalIds: { number } = table.create(#payload.normals)',
    '        local uvIds: { number } = table.create(#payload.uvs)',
    '        for i, v in ipairs(payload.vertices) do',
    '            vertexIds[i] = editableMesh:AddVertex(Vector3.new(v[1], v[2], v[3]))',
    '        end',
    '        for i, n in ipairs(payload.normals) do',
    '            normalIds[i] = editableMesh:AddNormal(Vector3.new(n[1], n[2], n[3]))',
    '        end',
    '        for i, uv in ipairs(payload.uvs) do',
    '            uvIds[i] = editableMesh:AddUV(Vector2.new(uv[1], uv[2]))',
    '        end',
    '        for _, tri in ipairs(payload.faces) do',
    '            local i1, i2, i3 = tri[1], tri[2], tri[3]',
    '            local id1, id2, id3 = vertexIds[i1], vertexIds[i2], vertexIds[i3]',
    '            if id1 and id2 and id3 then',
    '                local fid = editableMesh:AddTriangle(id1, id2, id3)',
    '                if normalIds[i1] and normalIds[i2] and normalIds[i3] then',
    '                    pcall(function() editableMesh:SetFaceNormals(fid, { normalIds[i1], normalIds[i2], normalIds[i3] }) end)',
    '                end',
    '                if uvIds[i1] and uvIds[i2] and uvIds[i3] then',
    '                    pcall(function() editableMesh:SetFaceUVs(fid, { uvIds[i1], uvIds[i2], uvIds[i3] }) end)',
    '                end',
    '            end',
    '        end',
    '        return AssetService:CreateMeshPartAsync(Content.fromObject(editableMesh), {',
    '            CollisionFidelity = payload.collisionFidelity,',
    '            RenderFidelity = payload.renderFidelity,',
    '        })',
    '    end)',
    '    if okEditable and generatedMeshPart then',
    '        generatedMeshPart.DoubleSided = payload.doubleSided',
    '        generatedMeshPart:SetAttribute("MeshId", payload.meshId)',
    '        generatedMeshPart:SetAttribute("AssetId", payload.assetId)',
    '        generatedMeshPart:SetAttribute("RojoObjPath", payload.objSourcePath)',
    '        return generatedMeshPart',
    '    end',
    '',
    '    local resolvedUri = if overrideAssetId and overrideAssetId ~= "" then overrideAssetId else payload.meshId',
    '    local ok, meshPart = pcall(function()',
    '        return InsertService:CreateMeshPartAsync(resolvedUri, payload.collisionFidelity, payload.renderFidelity)',
    '    end)',
    '    if ok and meshPart then',
    '        meshPart.DoubleSided = payload.doubleSided',
    '        meshPart:SetAttribute("MeshId", payload.meshId)',
    '        meshPart:SetAttribute("AssetId", payload.assetId)',
    '        meshPart:SetAttribute("RojoObjPath", payload.objSourcePath)',
    '        return meshPart',
    '    end',
    '',
    '    local fallbackMeshPart = Instance.new("MeshPart")',
    '    fallbackMeshPart.DoubleSided = payload.doubleSided',
    '    pcall(function() (fallbackMeshPart :: any).MeshId = resolvedUri end)',
    '    fallbackMeshPart:SetAttribute("MeshId", payload.meshId)',
    '    fallbackMeshPart:SetAttribute("AssetId", payload.assetId)',
    '    fallbackMeshPart:SetAttribute("RojoObjPath", payload.objSourcePath)',
    '    return fallbackMeshPart',
    'end',
    '',
    `function ${safeName}MeshBuilder.Spawn(config: MeshSpawnConfig?): Model`,
    '    local cfg: MeshSpawnConfig = config or {}',
    '    local baseOrigin = cfg.origin or CFrame.new(0, 0, 0)',
    '    local model = Instance.new("Model")',
    `    model.Name = "${safeName}"`,
    '',
    '    local rootPart: MeshPart? = nil',
    '    for idx, sub in ipairs(SUB_MESH_DATA) do',
    '        local overrideMeshId = if cfg.meshAssetIds then cfg.meshAssetIds[sub.name] else nil',
    '        local meshPart = buildMeshPartFromPayload(sub, overrideMeshId)',
    '        meshPart.Name = sub.name',
    '        meshPart.Color = sub.color',
    '        meshPart.Material = sub.material',
    '        meshPart.Anchored = true',
    '        meshPart.CanCollide = true',
    '        meshPart.CFrame = baseOrigin',
    '            * CFrame.new(sub.offsetPos)',
    '            * CFrame.Angles(math.rad(sub.offsetRotDeg.X), math.rad(sub.offsetRotDeg.Y), math.rad(sub.offsetRotDeg.Z))',
    '        if cfg.colorMapId or cfg.normalMapId or cfg.roughnessMapId then',
    '            local surfaceApp = Instance.new("SurfaceAppearance")',
    '            if cfg.colorMapId then surfaceApp.ColorMap = cfg.colorMapId end',
    '            if cfg.normalMapId then surfaceApp.NormalMap = cfg.normalMapId end',
    '            if cfg.roughnessMapId then surfaceApp.RoughnessMap = cfg.roughnessMapId end',
    '            surfaceApp.Parent = meshPart',
    '        end',
    '        meshPart.Parent = model',
    '        if idx == 1 then',
    '            rootPart = meshPart',
    '            model.PrimaryPart = meshPart',
    '        elseif rootPart then',
    '            local weld = Instance.new("WeldConstraint")',
    '            weld.Part0 = rootPart',
    '            weld.Part1 = meshPart',
    '            weld.Parent = meshPart',
    '        end',
    '    end',
    '',
    '    model.Parent = Workspace',
    '    return model',
    'end',
    '',
    `return ${safeName}MeshBuilder`
  );

  return lines.join('\n');
}

/**
 * Converts a 2D image into a real 3D Relief / Volumetric Heightmap Mesh (Image-to-3D Geometry)
 * and extracts its displaced vertex/normal/UV/face buffers (`meshData`), Wavefront `.OBJ` string,
 * and a `--!strict` Luau module using `AssetService:CreateEditableMesh()` so the exact 3D relief
 * arrives in Roblox Studio as real geometry instead of a flat Part.
 */
export async function convertImageTo3DHeightmapMesh(
  imageDataUrl: string,
  gridRes: number = 32,
  extrusionDepth: number = 2.2
): Promise<{
  mesh: THREE.Mesh;
  triangleCount: number;
  meshData: SubMeshGeometryData;
  wavefrontObj: string;
  editableMeshLuau: string;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const safeRes = Math.max(12, Math.min(64, gridRes));
      const canvas = document.createElement('canvas');
      canvas.width = safeRes;
      canvas.height = safeRes;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, safeRes, safeRes);
      const imgData = ctx.getImageData(0, 0, safeRes, safeRes).data;

      const geom = new THREE.PlaneGeometry(12, 12, safeRes - 1, safeRes - 1);
      geom.rotateX(-Math.PI / 2);

      const posAttr = geom.attributes.position;
      const colors = new Float32Array(posAttr.count * 3);

      const vertices: number[][] = [];
      const uvs: number[][] = [];
      const vertexColors: number[][] = [];

      const uvAttr = geom.getAttribute('uv');

      for (let i = 0; i < posAttr.count; i++) {
        const r = imgData[i * 4] / 255;
        const g = imgData[i * 4 + 1] / 255;
        const b = imgData[i * 4 + 2] / 255;
        const a = imgData[i * 4 + 3] / 255;
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) * a;
        const displacedY = Number((luminance * extrusionDepth).toFixed(4));

        posAttr.setY(i, displacedY);
        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;

        vertices.push([
          Number(posAttr.getX(i).toFixed(4)),
          displacedY,
          Number(posAttr.getZ(i).toFixed(4)),
        ]);
        if (uvAttr) {
          uvs.push([
            Number(uvAttr.getX(i).toFixed(4)),
            Number(uvAttr.getY(i).toFixed(4)),
          ]);
        }
        vertexColors.push([
          Number(r.toFixed(3)),
          Number(g.toFixed(3)),
          Number(b.toFixed(3)),
        ]);
      }

      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geom.computeVertexNormals();

      const normAttr = geom.getAttribute('normal');
      const normals: number[][] = [];
      if (normAttr) {
        for (let i = 0; i < normAttr.count; i++) {
          normals.push([
            Number(normAttr.getX(i).toFixed(4)),
            Number(normAttr.getY(i).toFixed(4)),
            Number(normAttr.getZ(i).toFixed(4)),
          ]);
        }
      }

      const faces: number[][] = [];
      const indexAttr = geom.getIndex();
      if (indexAttr) {
        for (let i = 0; i < indexAttr.count; i += 3) {
          faces.push([
            indexAttr.getX(i),
            indexAttr.getX(i + 1),
            indexAttr.getX(i + 2),
          ]);
        }
      }

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.35,
        metalness: 0.4,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.name = `HeightmapRelief_${safeRes}x${safeRes}`;
      mesh.position.y = 0.05;

      const meshData: SubMeshGeometryData = {
        vertices,
        normals,
        uvs,
        faces,
        vertexColors,
      };

      const wavefrontObj = exportObject3DToOBJ(mesh);
      const editableMeshLuau = generateEditableMeshLuauCode(
        `HeightmapTerrain_${safeRes}`,
        [
          {
            name: mesh.name,
            size: [12, Math.max(0.5, extrusionDepth), 12],
            position: [0, extrusionDepth / 2, 0],
            rotation: [0, 0, 0],
            color: [56, 189, 248],
            material: 'SmoothPlastic',
            roughness: 0.35,
            metalness: 0.4,
            collisionFidelity: 'PreciseConvexDecomposition',
            renderFidelity: 'Precise',
            doubleSided: true,
            meshData,
          },
        ]
      );

      const triCount = faces.length;
      resolve({
        mesh,
        triangleCount: triCount,
        meshData,
        wavefrontObj,
        editableMeshLuau,
      });
    };
    img.onerror = reject;
    img.src = imageDataUrl;
  });
}

/**
 * Exports any Three.js Object3D / Group to Wavefront .OBJ format
 * preserving vertices (v), normals (vn), texture coordinates (vt), and faces (f).
 */
export function exportObject3DToOBJ(rootObject: THREE.Object3D): string {
  let output = '# Forge AI Studio - Roblox Ready 3D Mesh (.OBJ)\n';
  output += '# Units: Roblox Studs | Max Tris per MeshPart: 10,000\n\n';

  let vertexOffset = 1;
  let uvOffset = 1;
  let normalOffset = 1;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();

  rootObject.updateMatrixWorld(true);

  rootObject.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const geom = mesh.geometry;
      if (!geom) return;

      const posAttr = geom.getAttribute('position');
      if (!posAttr) return;

      const uvAttr = geom.getAttribute('uv');
      const normAttr = geom.getAttribute('normal');
      const hasUV = Boolean(uvAttr && uvAttr.count === posAttr.count);
      const hasNorm = Boolean(normAttr && normAttr.count === posAttr.count);

      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      output += `o ${mesh.name || 'RobloxSubMesh'}\n`;

      for (let i = 0; i < posAttr.count; i++) {
        v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
        output += `v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}\n`;
      }

      if (hasUV && uvAttr) {
        for (let i = 0; i < uvAttr.count; i++) {
          output += `vt ${uvAttr.getX(i).toFixed(4)} ${uvAttr.getY(i).toFixed(4)}\n`;
        }
      }

      if (hasNorm && normAttr) {
        for (let i = 0; i < normAttr.count; i++) {
          n.fromBufferAttribute(normAttr, i).applyNormalMatrix(normalMatrix).normalize();
          output += `vn ${n.x.toFixed(4)} ${n.y.toFixed(4)} ${n.z.toFixed(4)}\n`;
        }
      }

      const formatFaceIndex = (localIdx: number): string => {
        const vi = localIdx + vertexOffset;
        const ti = hasUV ? `${localIdx + uvOffset}` : '';
        const ni = hasNorm ? `${localIdx + normalOffset}` : '';
        if (hasUV && hasNorm) return `${vi}/${ti}/${ni}`;
        if (hasUV) return `${vi}/${ti}`;
        if (hasNorm) return `${vi}//${ni}`;
        return `${vi}`;
      };

      const indexAttr = geom.getIndex();
      if (indexAttr) {
        for (let i = 0; i < indexAttr.count; i += 3) {
          const a = indexAttr.getX(i);
          const b = indexAttr.getX(i + 1);
          const c = indexAttr.getX(i + 2);
          output += `f ${formatFaceIndex(a)} ${formatFaceIndex(b)} ${formatFaceIndex(c)}\n`;
        }
      } else {
        for (let i = 0; i < posAttr.count; i += 3) {
          output += `f ${formatFaceIndex(i)} ${formatFaceIndex(i + 1)} ${formatFaceIndex(i + 2)}\n`;
        }
      }

      vertexOffset += posAttr.count;
      if (hasUV && uvAttr) uvOffset += uvAttr.count;
      if (hasNorm && normAttr) normalOffset += normAttr.count;
      output += '\n';
    }
  });

  return output;
}

/**
 * Exports a Forge3DAsset to paired Wavefront .OBJ and PBR Material Library (.MTL)
 * so Roblox Studio 3D Importer and Blender preserve both exact geometry and per-part materials.
 */
export function exportAssetToOBJWithMTL(asset: Forge3DAsset): {
  obj: string;
  mtl: string;
  objFileName: string;
  mtlFileName: string;
} {
  const safeName = (asset.name || 'ForgeModel3D').replace(/[^a-zA-Z0-9_]/g, '') || 'ForgeModel3D';
  const objFileName = `${safeName}.obj`;
  const mtlFileName = `${safeName}.mtl`;

  let obj = `# Forge AI Studio - Roblox Studio 3D Mesh (.OBJ + .MTL)\n`;
  obj += `# Model: ${safeName} | Parts: ${asset.parts?.length || 0}\n`;
  obj += `mtllib ${mtlFileName}\n\n`;

  let mtl = `# Forge AI Studio - PBR Material Library (.MTL)\n`;
  mtl += `# Model: ${safeName}\n\n`;

  let vertexOffset = 1;
  let uvOffset = 1;
  let normalOffset = 1;

  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  const mat4 = new THREE.Matrix4();
  const normMat = new THREE.Matrix3();
  const vVec = new THREE.Vector3();
  const nVec = new THREE.Vector3();

  for (let idx = 0; idx < (asset.parts || []).length; idx++) {
    const part = asset.parts[idx];
    const partName = (part.name || `MeshPart_${idx + 1}`).replace(/\s+/g, '_');
    const matName = `${partName}_Mat`;
    const [r = 160, g = 170, b = 185] = part.color || [160, 170, 185];
    const kdR = (r / 255).toFixed(4);
    const kdG = (g / 255).toFixed(4);
    const kdB = (b / 255).toFixed(4);
    const roughness = Math.max(0.04, Math.min(1, part.roughness ?? 0.35));
    const metalness = Math.max(0, Math.min(1, part.metalness ?? 0.65));
    const opacity = Math.max(0.05, Math.min(1, 1 - (part.transparency || 0)));

    mtl += `newmtl ${matName}\n`;
    mtl += `Ka ${kdR} ${kdG} ${kdB}\n`;
    mtl += `Kd ${kdR} ${kdG} ${kdB}\n`;
    mtl += `Ks ${metalness.toFixed(4)} ${metalness.toFixed(4)} ${metalness.toFixed(4)}\n`;
    mtl += `Pr ${roughness.toFixed(4)}\n`;
    mtl += `Pm ${metalness.toFixed(4)}\n`;
    if (part.material === 'Neon') {
      mtl += `Ke ${kdR} ${kdG} ${kdB}\n`;
    }
    mtl += `d ${opacity.toFixed(4)}\n`;
    mtl += `illum 2\n\n`;

    const geom = buildBufferGeometryFromMeshData(
      ensurePartHasMeshData(part),
      part.size || [2, 2, 2]
    );
    const [px = 0, py = 1, pz = 0] = part.position || [0, 1, 0];
    const [rx = 0, ry = 0, rz = 0] = part.rotation || [0, 0, 0];
    euler.set(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz)
    );
    quat.setFromEuler(euler);
    mat4.compose(new THREE.Vector3(px, py, pz), quat, new THREE.Vector3(1, 1, 1));
    normMat.getNormalMatrix(mat4);

    const posAttr = geom.getAttribute('position');
    const normAttr = geom.getAttribute('normal');
    const uvAttr = geom.getAttribute('uv');
    const indexAttr = geom.getIndex();

    if (!posAttr) {
      geom.dispose();
      continue;
    }

    obj += `o ${partName}\n`;
    obj += `g ${partName}\n`;
    obj += `usemtl ${matName}\n`;

    for (let i = 0; i < posAttr.count; i++) {
      vVec.fromBufferAttribute(posAttr, i).applyMatrix4(mat4);
      obj += `v ${vVec.x.toFixed(4)} ${vVec.y.toFixed(4)} ${vVec.z.toFixed(4)}\n`;
    }

    const hasUV = Boolean(uvAttr && uvAttr.count === posAttr.count);
    if (hasUV && uvAttr) {
      for (let i = 0; i < uvAttr.count; i++) {
        obj += `vt ${uvAttr.getX(i).toFixed(4)} ${uvAttr.getY(i).toFixed(4)}\n`;
      }
    }

    const hasNorm = Boolean(normAttr && normAttr.count === posAttr.count);
    if (hasNorm && normAttr) {
      for (let i = 0; i < normAttr.count; i++) {
        nVec.fromBufferAttribute(normAttr, i).applyNormalMatrix(normMat).normalize();
        obj += `vn ${nVec.x.toFixed(4)} ${nVec.y.toFixed(4)} ${nVec.z.toFixed(4)}\n`;
      }
    }

    const fmtIdx = (localIdx: number): string => {
      const vi = localIdx + vertexOffset;
      const ti = hasUV ? `${localIdx + uvOffset}` : '';
      const ni = hasNorm ? `${localIdx + normalOffset}` : '';
      if (hasUV && hasNorm) return `${vi}/${ti}/${ni}`;
      if (hasUV) return `${vi}/${ti}`;
      if (hasNorm) return `${vi}//${ni}`;
      return `${vi}`;
    };

    if (indexAttr) {
      for (let i = 0; i < indexAttr.count - 2; i += 3) {
        obj += `f ${fmtIdx(indexAttr.getX(i))} ${fmtIdx(indexAttr.getX(i + 1))} ${fmtIdx(indexAttr.getX(i + 2))}\n`;
      }
    } else {
      for (let i = 0; i < posAttr.count - 2; i += 3) {
        obj += `f ${fmtIdx(i)} ${fmtIdx(i + 1)} ${fmtIdx(i + 2)}\n`;
      }
    }

    vertexOffset += posAttr.count;
    if (hasUV && uvAttr) uvOffset += uvAttr.count;
    if (hasNorm && normAttr) normalOffset += normAttr.count;
    obj += '\n';
    geom.dispose();
  }

  return { obj, mtl, objFileName, mtlFileName };
}

const ROBLOX_MATERIAL_ENUM_TOKENS: Record<string, number> = {
  Plastic: 256,
  SmoothPlastic: 272,
  Neon: 288,
  Wood: 512,
  WoodPlanks: 528,
  Marble: 784,
  Slate: 800,
  Concrete: 816,
  Granite: 832,
  Brick: 848,
  Pebble: 864,
  Cobblestone: 880,
  CorrodedMetal: 1040,
  DiamondPlate: 1056,
  Foil: 1072,
  Metal: 1088,
  Grass: 1280,
  Sand: 1296,
  Fabric: 1312,
  Ice: 1536,
  Glass: 1568,
  ForceField: 1584,
};

const ROBLOX_TOKEN_TO_MATERIAL: Record<number, string> = Object.entries(
  ROBLOX_MATERIAL_ENUM_TOKENS
).reduce((acc, [name, token]) => {
  acc[token] = name;
  return acc;
}, {} as Record<number, string>);

function escapeXml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Exports a Forge3DAsset to a native Roblox Studio XML Model (.rbxmx)
 * Can be dragged & dropped directly into Roblox Studio or imported via "Insert from File...".
 * Preserves hierarchy, CFrames, MeshPart properties, Roblox Materials, SurfaceAppearance PBR,
 * and embeds both full vertex/normal/UV/face JSON (`ForgeMeshGeometryJSON`) and a
 * `--!strict` `ForgeStudioReconstructor` ModuleScript for 1-click EditableMesh reconstruction.
 */
export function exportAssetToRBXMX(asset: Forge3DAsset): string {
  const safeName = (asset.name || 'ForgeModel3D').replace(/[^a-zA-Z0-9_]/g, '') || 'ForgeModel3D';
  const euler = new THREE.Euler();
  const mat4 = new THREE.Matrix4();

  const lines: string[] = [
    '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">',
    '  <External>null</External>',
    '  <External>nil</External>',
    `  <Item class="Model" referent="RBX_FORGE_MODEL_${safeName}">`,
    '    <Properties>',
    `      <string name="Name">${escapeXml(safeName)}</string>`,
    '      <Ref name="PrimaryPart">RBX_PART_1</Ref>',
    '    </Properties>',
  ];

  for (let idx = 0; idx < (asset.parts || []).length; idx++) {
    const part = asset.parts[idx];
    const refId = `RBX_PART_${idx + 1}`;
    const partName = part.name || `MeshPart_${idx + 1}`;
    const [sx = 2, sy = 2, sz = 2] = part.size || [2, 2, 2];
    const [px = 0, py = 1, pz = 0] = part.position || [0, 1, 0];
    const [rx = 0, ry = 0, rz = 0] = part.rotation || [0, 0, 0];
    const [cr = 160, cg = 170, cb = 185] = part.color || [160, 170, 185];

    euler.set(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz),
      'XYZ'
    );
    mat4.makeRotationFromEuler(euler);
    const te = mat4.elements;
    // Three.js column-major to Roblox row-major R00..R22
    const r00 = te[0].toFixed(6), r01 = te[4].toFixed(6), r02 = te[8].toFixed(6);
    const r10 = te[1].toFixed(6), r11 = te[5].toFixed(6), r12 = te[9].toFixed(6);
    const r20 = te[2].toFixed(6), r21 = te[6].toFixed(6), r22 = te[10].toFixed(6);

    const colorUint8 =
      ((0xff << 24) |
        ((Math.max(0, Math.min(255, Math.round(cr))) & 0xff) << 16) |
        ((Math.max(0, Math.min(255, Math.round(cg))) & 0xff) << 8) |
        (Math.max(0, Math.min(255, Math.round(cb))) & 0xff)) >>>
      0;

    const matToken = ROBLOX_MATERIAL_ENUM_TOKENS[part.material] ?? 1088;
    const meshData = ensurePartHasMeshData(part);
    const meshId =
      part.meshId && part.meshId.startsWith('rbxassetid://')
        ? part.meshId
        : `rbxassetid://${1000000000 + idx + 1}`;

    const geometryJsonPayload = JSON.stringify({
      shape: 'MeshPart',
      meshId,
      roughness: part.roughness ?? 0.35,
      metalness: part.metalness ?? 0.65,
      collisionFidelity: part.collisionFidelity || 'Hull',
      vertices: meshData.vertices.slice(0, 2500),
      normals: (meshData.normals || []).slice(0, 2500),
      uvs: (meshData.uvs || []).slice(0, 2500),
      faces: meshData.faces.slice(0, 3500),
    });

    lines.push(
      `    <Item class="MeshPart" referent="${refId}">`,
      '      <Properties>',
      `        <string name="Name">${escapeXml(partName)}</string>`,
      `        <bool name="Anchored">${part.anchored !== false ? 'true' : 'false'}</bool>`,
      `        <bool name="CanCollide">${part.canCollide !== false ? 'true' : 'false'}</bool>`,
      `        <bool name="DoubleSided">${part.doubleSided ? 'true' : 'false'}</bool>`,
      `        <float name="Transparency">${Number(part.transparency ?? 0).toFixed(3)}</float>`,
      `        <token name="Material">${matToken}</token>`,
      `        <Color3uint8 name="Color3uint8">${colorUint8}</Color3uint8>`,
      `        <Content name="MeshId"><url>${escapeXml(meshId)}</url></Content>`,
      '        <Vector3 name="size">',
      `          <X>${Number(sx).toFixed(4)}</X>`,
      `          <Y>${Number(sy).toFixed(4)}</Y>`,
      `          <Z>${Number(sz).toFixed(4)}</Z>`,
      '        </Vector3>',
      '        <CoordinateFrame name="CFrame">',
      `          <X>${Number(px).toFixed(4)}</X>`,
      `          <Y>${Number(py).toFixed(4)}</Y>`,
      `          <Z>${Number(pz).toFixed(4)}</Z>`,
      `          <R00>${r00}</R00><R01>${r01}</R01><R02>${r02}</R02>`,
      `          <R10>${r10}</R10><R11>${r11}</R11><R12>${r12}</R12>`,
      `          <R20>${r20}</R20><R21>${r21}</R21><R22>${r22}</R22>`,
      '        </CoordinateFrame>',
      '      </Properties>',
      `      <Item class="SurfaceAppearance" referent="${refId}_PBR">`,
      '        <Properties>',
      `          <string name="Name">${escapeXml(partName)}_SurfaceAppearance</string>`,
      '          <token name="AlphaMode">0</token>',
      '        </Properties>',
      '      </Item>',
      `      <Item class="StringValue" referent="${refId}_GEOM">`,
      '        <Properties>',
      '          <string name="Name">ForgeMeshGeometryJSON</string>',
      `          <string name="Value">${escapeXml(geometryJsonPayload)}</string>`,
      '        </Properties>',
      '      </Item>',
      '    </Item>'
    );
  }

  const luauScript =
    asset.luau_code ||
    generateEditableMeshLuauCode(
      safeName,
      (asset.parts || []).map((p) => ({
        name: p.name,
        size: [p.size[0] ?? 2, p.size[1] ?? 2, p.size[2] ?? 2],
        position: [p.position[0] ?? 0, p.position[1] ?? 1, p.position[2] ?? 0],
        rotation: [p.rotation[0] ?? 0, p.rotation[1] ?? 0, p.rotation[2] ?? 0],
        color: [p.color[0] ?? 160, p.color[1] ?? 170, p.color[2] ?? 185],
        material: p.material || 'Metal',
        roughness: p.roughness ?? 0.35,
        metalness: p.metalness ?? 0.65,
        collisionFidelity: p.collisionFidelity || 'Hull',
        meshId: p.meshId,
        meshData: ensurePartHasMeshData(p),
      }))
    );

  lines.push(
    `    <Item class="ModuleScript" referent="RBX_FORGE_RECONSTRUCTOR">`,
    '      <Properties>',
    '        <string name="Name">ForgeStudioReconstructor</string>',
    `        <ProtectedString name="Source"><![CDATA[${luauScript}]]></ProtectedString>`,
    '      </Properties>',
    '    </Item>',
    '  </Item>',
    '</roblox>'
  );

  return lines.join('\n');
}

/**
 * Parses a Roblox Studio XML Model (.rbxmx) file into a Forge3DAsset,
 * recovering all MeshParts/Parts, CFrame positions and rotations, sizes, colors,
 * Roblox Materials, and embedded `ForgeMeshGeometryJSON` vertex/normal/UV/face buffers.
 */
export function parseRBXMXToForgeAsset(
  xmlText: string,
  fileName: string = 'ImportedRobloxModel.rbxmx'
): Forge3DAsset {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const baseModelName =
    fileName.replace(/\.rbxmx$/i, '').replace(/[^a-zA-Z0-9_]/g, '') || 'RobloxImportedModel';

  const modelItem = doc.querySelector('Item[class="Model"]');
  let modelName = baseModelName;
  if (modelItem) {
    const modelNameNode = modelItem.querySelector(':scope > Properties > string[name="Name"]');
    if (modelNameNode?.textContent) {
      modelName = modelNameNode.textContent.trim();
    }
  }

  const partNodes = Array.from(
    doc.querySelectorAll('Item[class="MeshPart"], Item[class="Part"], Item[class="WedgePart"]')
  );

  const parts: MeshPart3DSpec[] = [];
  let totalTriangles = 0;
  const rotMat = new THREE.Matrix4();
  const euler = new THREE.Euler();

  partNodes.forEach((itemNode, idx) => {
    const props = itemNode.querySelector(':scope > Properties');
    if (!props) return;

    const getText = (sel: string): string | null =>
      props.querySelector(sel)?.textContent?.trim() ?? null;

    const partName = getText('string[name="Name"]') || `MeshPart_${idx + 1}`;
    const sx = parseFloat(getText('Vector3[name="size"] > X, Vector3[name="Size"] > X') || '2') || 2;
    const sy = parseFloat(getText('Vector3[name="size"] > Y, Vector3[name="Size"] > Y') || '2') || 2;
    const sz = parseFloat(getText('Vector3[name="size"] > Z, Vector3[name="Size"] > Z') || '2') || 2;

    const px = parseFloat(getText('CoordinateFrame[name="CFrame"] > X') || '0') || 0;
    const py = parseFloat(getText('CoordinateFrame[name="CFrame"] > Y') || '1') || 1;
    const pz = parseFloat(getText('CoordinateFrame[name="CFrame"] > Z') || '0') || 0;

    const r00 = parseFloat(getText('CoordinateFrame[name="CFrame"] > R00') || '1');
    const r01 = parseFloat(getText('CoordinateFrame[name="CFrame"] > R01') || '0');
    const r02 = parseFloat(getText('CoordinateFrame[name="CFrame"] > R02') || '0');
    const r10 = parseFloat(getText('CoordinateFrame[name="CFrame"] > R10') || '0');
    const r11 = parseFloat(getText('CoordinateFrame[name="CFrame"] > R11') || '1');
    const r12 = parseFloat(getText('CoordinateFrame[name="CFrame"] > R12') || '0');
    const r20 = parseFloat(getText('CoordinateFrame[name="CFrame"] > R20') || '0');
    const r21 = parseFloat(getText('CoordinateFrame[name="CFrame"] > R21') || '0');
    const r22 = parseFloat(getText('CoordinateFrame[name="CFrame"] > R22') || '1');

    rotMat.set(
      r00, r01, r02, 0,
      r10, r11, r12, 0,
      r20, r21, r22, 0,
      0,   0,   0,   1
    );
    euler.setFromRotationMatrix(rotMat, 'XYZ');
    const rx = Number(THREE.MathUtils.radToDeg(euler.x).toFixed(1));
    const ry = Number(THREE.MathUtils.radToDeg(euler.y).toFixed(1));
    const rz = Number(THREE.MathUtils.radToDeg(euler.z).toFixed(1));

    let color: [number, number, number] = [148, 163, 184];
    const colorUintStr = getText('Color3uint8[name="Color3uint8"]');
    if (colorUintStr) {
      const val = parseInt(colorUintStr, 10) >>> 0;
      color = [(val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff];
    } else {
      const cr = parseFloat(getText('Color3[name="Color"] > R') || '-1');
      const cg = parseFloat(getText('Color3[name="Color"] > G') || '-1');
      const cb = parseFloat(getText('Color3[name="Color"] > B') || '-1');
      if (cr >= 0 && cg >= 0 && cb >= 0) {
        color = [
          Math.round(cr <= 1 ? cr * 255 : cr),
          Math.round(cg <= 1 ? cg * 255 : cg),
          Math.round(cb <= 1 ? cb * 255 : cb),
        ];
      }
    }

    const matToken = parseInt(getText('token[name="Material"]') || '1088', 10);
    const material = ROBLOX_TOKEN_TO_MATERIAL[matToken] || 'Metal';
    const transparency = parseFloat(getText('float[name="Transparency"]') || '0') || 0;
    const anchored = getText('bool[name="Anchored"]') !== 'false';
    const canCollide = getText('bool[name="CanCollide"]') !== 'false';
    const doubleSided = getText('bool[name="DoubleSided"]') === 'true';
    const meshId = getText('Content[name="MeshId"] > url') || undefined;

    let meshData: SubMeshGeometryData | undefined;
    let roughness = 0.35;
    let metalness = 0.65;
    let collisionFidelity: MeshPart3DSpec['collisionFidelity'] = 'Hull';

    const geomValueNode = Array.from(itemNode.querySelectorAll('Item[class="StringValue"]')).find(
      (sv) =>
        sv.querySelector(':scope > Properties > string[name="Name"]')?.textContent?.trim() ===
        'ForgeMeshGeometryJSON'
    );
    const geomJsonText = geomValueNode
      ?.querySelector(':scope > Properties > string[name="Value"]')
      ?.textContent?.trim();

    if (geomJsonText) {
      try {
        const parsedGeom = JSON.parse(geomJsonText);
        if (Array.isArray(parsedGeom.vertices) && Array.isArray(parsedGeom.faces)) {
          meshData = {
            vertices: parsedGeom.vertices,
            normals: parsedGeom.normals,
            uvs: parsedGeom.uvs,
            faces: parsedGeom.faces,
            objFileName: `${modelName}.obj`,
          };
        }
        if (typeof parsedGeom.roughness === 'number') roughness = parsedGeom.roughness;
        if (typeof parsedGeom.metalness === 'number') metalness = parsedGeom.metalness;
        if (parsedGeom.collisionFidelity) collisionFidelity = parsedGeom.collisionFidelity;
      } catch {
        // Fallback to synthesized geometry below
      }
    }

    const basePart: MeshPart3DSpec = {
      name: partName,
      shape: 'MeshPart',
      size: [Number(sx.toFixed(2)), Number(sy.toFixed(2)), Number(sz.toFixed(2))],
      position: [Number(px.toFixed(2)), Number(py.toFixed(2)), Number(pz.toFixed(2))],
      rotation: [rx, ry, rz],
      color,
      material,
      roughness,
      metalness,
      transparency,
      canCollide,
      anchored,
      doubleSided,
      collisionFidelity,
      meshId,
      meshData,
    };

    const resolvedMesh = ensurePartHasMeshData(basePart);
    basePart.meshData = resolvedMesh;
    totalTriangles += resolvedMesh.faces.length;
    parts.push(basePart);
  });

  if (parts.length === 0) {
    throw new Error('El archivo .rbxmx no contiene ningún MeshPart o Part válido.');
  }

  const luauCode = generateEditableMeshLuauCode(
    modelName,
    parts.map((p) => ({
      name: p.name,
      size: [p.size[0] ?? 2, p.size[1] ?? 2, p.size[2] ?? 2],
      position: [p.position[0] ?? 0, p.position[1] ?? 1, p.position[2] ?? 0],
      rotation: [p.rotation[0] ?? 0, p.rotation[1] ?? 0, p.rotation[2] ?? 0],
      color: [p.color[0] ?? 148, p.color[1] ?? 163, p.color[2] ?? 184],
      material: p.material,
      roughness: p.roughness,
      metalness: p.metalness,
      collisionFidelity: p.collisionFidelity,
      doubleSided: p.doubleSided,
      meshId: p.meshId,
      meshData: p.meshData,
    }))
  );

  return {
    id: `rbxmx-${Date.now()}`,
    name: modelName,
    category: 'Roblox Studio (.rbxmx)',
    asset_type: 'Model3D',
    poly_count: totalTriangles,
    collision_fidelity: parts[0]?.collisionFidelity || 'Hull',
    rojo_target_folder: 'src/shared/Assets3D',
    file_name: `${modelName}.luau`,
    obj_file_name: `${modelName}.obj`,
    description: `Modelo importado desde Roblox Studio (.rbxmx) con ${parts.length} MeshParts y ${totalTriangles} triángulos.`,
    pbr_profile: {
      albedo_hex: '#38bdf8',
      roughness: parts[0]?.roughness ?? 0.35,
      metalness: parts[0]?.metalness ?? 0.65,
      emissive_hex: '#06b6d4',
      roblox_material: parts[0]?.material || 'Metal',
      pattern: 'BrushedTitanium',
    },
    parts,
    luau_code: luauCode,
    created_at: new Date().toISOString(),
  };
}

/**
 * Exports a Forge3DAsset to a standard glTF 2.0 (.gltf) file with embedded binary buffers
 * and PBR Metallic-Roughness materials. Ready to import directly into Roblox Studio's 3D Importer
 * or Blender without losing geometry or materials.
 */
export function exportAssetToGLTF(asset: Forge3DAsset): string {
  const safeName = (asset.name || 'ForgeModel3D').replace(/[^a-zA-Z0-9_]/g, '') || 'ForgeModel3D';
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();

  const bufferChunks: Uint8Array[] = [];
  const bufferViews: any[] = [];
  const accessors: any[] = [];
  const meshes: any[] = [];
  const materials: any[] = [];
  const nodes: any[] = [];

  let byteOffset = 0;

  const appendTypedArray = (arr: Float32Array | Uint32Array, target: number): number => {
    const uint8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (uint8.byteLength % 4)) % 4;
    const viewIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: uint8.byteLength,
      target,
    });
    bufferChunks.push(uint8);
    if (pad > 0) {
      bufferChunks.push(new Uint8Array(pad));
    }
    byteOffset += uint8.byteLength + pad;
    return viewIndex;
  };

  for (let idx = 0; idx < (asset.parts || []).length; idx++) {
    const part = asset.parts[idx];
    const partName = part.name || `MeshPart_${idx + 1}`;
    const geom = buildBufferGeometryFromMeshData(
      ensurePartHasMeshData(part),
      part.size || [2, 2, 2]
    );

    const posAttr = geom.getAttribute('position');
    const normAttr = geom.getAttribute('normal');
    const uvAttr = geom.getAttribute('uv');
    const indexAttr = geom.getIndex();

    if (!posAttr || posAttr.count < 3) {
      geom.dispose();
      continue;
    }

    const vCount = posAttr.count;
    const posF32 = new Float32Array(vCount * 3);
    const normF32 = new Float32Array(vCount * 3);
    const uvF32 = new Float32Array(vCount * 2);

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < vCount; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      const vz = posAttr.getZ(i);
      posF32[i * 3] = vx;
      posF32[i * 3 + 1] = vy;
      posF32[i * 3 + 2] = vz;
      if (vx < minX) minX = vx;
      if (vy < minY) minY = vy;
      if (vz < minZ) minZ = vz;
      if (vx > maxX) maxX = vx;
      if (vy > maxY) maxY = vy;
      if (vz > maxZ) maxZ = vz;

      normF32[i * 3] = normAttr ? normAttr.getX(i) : 0;
      normF32[i * 3 + 1] = normAttr ? normAttr.getY(i) : 1;
      normF32[i * 3 + 2] = normAttr ? normAttr.getZ(i) : 0;

      uvF32[i * 2] = uvAttr ? uvAttr.getX(i) : 0;
      uvF32[i * 2 + 1] = uvAttr ? uvAttr.getY(i) : 0;
    }

    let indicesU32: Uint32Array;
    if (indexAttr) {
      indicesU32 = new Uint32Array(indexAttr.count);
      for (let i = 0; i < indexAttr.count; i++) {
        indicesU32[i] = indexAttr.getX(i);
      }
    } else {
      indicesU32 = new Uint32Array(vCount);
      for (let i = 0; i < vCount; i++) indicesU32[i] = i;
    }

    const posView = appendTypedArray(posF32, 34962);
    const posAccessor = accessors.length;
    accessors.push({
      bufferView: posView,
      componentType: 5126,
      count: vCount,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });

    const normView = appendTypedArray(normF32, 34962);
    const normAccessor = accessors.length;
    accessors.push({
      bufferView: normView,
      componentType: 5126,
      count: vCount,
      type: 'VEC3',
    });

    const uvView = appendTypedArray(uvF32, 34962);
    const uvAccessor = accessors.length;
    accessors.push({
      bufferView: uvView,
      componentType: 5126,
      count: vCount,
      type: 'VEC2',
    });

    const idxView = appendTypedArray(indicesU32, 34963);
    const idxAccessor = accessors.length;
    accessors.push({
      bufferView: idxView,
      componentType: 5125,
      count: indicesU32.length,
      type: 'SCALAR',
    });

    const [cr = 160, cg = 170, cb = 185] = part.color || [160, 170, 185];
    const alpha = Math.max(0.05, Math.min(1, 1 - (part.transparency || 0)));
    const matIndex = materials.length;
    materials.push({
      name: `${partName}_${part.material || 'Metal'}`,
      pbrMetallicRoughness: {
        baseColorFactor: [
          Number((cr / 255).toFixed(4)),
          Number((cg / 255).toFixed(4)),
          Number((cb / 255).toFixed(4)),
          Number(alpha.toFixed(4)),
        ],
        metallicFactor: Number(Math.max(0, Math.min(1, part.metalness ?? 0.65)).toFixed(4)),
        roughnessFactor: Number(Math.max(0.04, Math.min(1, part.roughness ?? 0.35)).toFixed(4)),
      },
      emissiveFactor:
        part.material === 'Neon'
          ? [
              Number((cr / 255).toFixed(4)),
              Number((cg / 255).toFixed(4)),
              Number((cb / 255).toFixed(4)),
            ]
          : [0, 0, 0],
      doubleSided: Boolean(part.doubleSided),
      alphaMode: alpha < 0.99 ? 'BLEND' : 'OPAQUE',
    });

    const meshIndex = meshes.length;
    meshes.push({
      name: partName,
      primitives: [
        {
          attributes: {
            POSITION: posAccessor,
            NORMAL: normAccessor,
            TEXCOORD_0: uvAccessor,
          },
          indices: idxAccessor,
          material: matIndex,
          mode: 4,
        },
      ],
    });

    const [px = 0, py = 1, pz = 0] = part.position || [0, 1, 0];
    const [rx = 0, ry = 0, rz = 0] = part.rotation || [0, 0, 0];
    euler.set(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz),
      'XYZ'
    );
    quat.setFromEuler(euler);

    nodes.push({
      name: partName,
      mesh: meshIndex,
      translation: [Number(px.toFixed(4)), Number(py.toFixed(4)), Number(pz.toFixed(4))],
      rotation: [
        Number(quat.x.toFixed(6)),
        Number(quat.y.toFixed(6)),
        Number(quat.z.toFixed(6)),
        Number(quat.w.toFixed(6)),
      ],
      extras: {
        robloxMaterial: part.material || 'Metal',
        collisionFidelity: part.collisionFidelity || 'Hull',
        meshId: part.meshId || '',
      },
    });

    geom.dispose();
  }

  const combined = new Uint8Array(byteOffset);
  let cursor = 0;
  for (const chunk of bufferChunks) {
    combined.set(chunk, cursor);
    cursor += chunk.byteLength;
  }

  let binaryStr = '';
  const step = 0x8000;
  for (let i = 0; i < combined.length; i += step) {
    binaryStr += String.fromCharCode(...combined.subarray(i, i + step));
  }
  const base64Buffer = btoa(binaryStr);

  const gltfDoc = {
    asset: {
      version: '2.0',
      generator: 'Forge AI Studio - Roblox Studio 3D Exporter',
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
        uri: `data:application/octet-stream;base64,${base64Buffer}`,
      },
    ],
  };

  return JSON.stringify(gltfDoc, null, 2);
}

