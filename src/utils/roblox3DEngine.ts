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
  meshData: SubMeshGeometryData
): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  const verts = meshData.vertices || [];
  const faces = meshData.faces || [];
  const norms = meshData.normals || [];
  const uvs = meshData.uvs || [];
  const vColors = meshData.vertexColors || [];

  const posArray = new Float32Array(verts.length * 3);
  for (let i = 0; i < verts.length; i++) {
    posArray[i * 3] = verts[i][0] ?? 0;
    posArray[i * 3 + 1] = verts[i][1] ?? 0;
    posArray[i * 3 + 2] = verts[i][2] ?? 0;
  }
  geom.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

  if (norms.length === verts.length && norms.length > 0) {
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
 * real BufferGeometry when `part.meshData` is present (GLB/OBJ/Heightmap MeshParts)
 * or procedural Roblox primitives when `part.shape` is Block/Cylinder/Ball/Wedge.
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
      geom = buildBufferGeometryFromMeshData(part.meshData);
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
    '    size: Vector3,',
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
    const [sx, sy, sz] = sub.size;
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
    const meshId = sub.meshId || `rbxmesh://${safeName}/${sub.name}`;
    const assetId = sub.assetId || 'rbxassetid://0';

    lines.push(
      '    {',
      `        name = "${sub.name}",`,
      `        meshId = "${meshId}",`,
      `        assetId = "${assetId}",`,
      `        objSourcePath = "src/shared/Assets3D/${objFile}",`,
      `        size = Vector3.new(${sx.toFixed(2)}, ${sy.toFixed(2)}, ${sz.toFixed(2)}),`,
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
    '    local resolvedUri = if overrideAssetId and overrideAssetId ~= "" then overrideAssetId else payload.meshId',
    '    local hasPublishedAsset = string.match(resolvedUri, "^rbxassetid://([1-9]%d*)$") ~= nil',
    '        or string.match(payload.assetId, "^rbxassetid://([1-9]%d*)$") ~= nil',
    '    if hasPublishedAsset then',
    '        local targetUri = if string.match(resolvedUri, "^rbxassetid://([1-9]%d*)$") then resolvedUri else payload.assetId',
    '        local ok, meshPart = pcall(function()',
    '            return InsertService:CreateMeshPartAsync(targetUri, payload.collisionFidelity, payload.renderFidelity)',
    '        end)',
    '        if ok and meshPart then',
    '            meshPart.DoubleSided = payload.doubleSided',
    '            meshPart.Size = payload.size',
    '            meshPart:SetAttribute("MeshId", payload.meshId)',
    '            meshPart:SetAttribute("AssetId", payload.assetId)',
    '            meshPart:SetAttribute("RojoObjPath", payload.objSourcePath)',
    '            return meshPart',
    '        end',
    '    end',
    '',
    '    local editableMesh = AssetService:CreateEditableMesh()',
    '    local vertexIds: { number } = table.create(#payload.vertices)',
    '    local normalIds: { number } = table.create(#payload.normals)',
    '    local uvIds: { number } = table.create(#payload.uvs)',
    '    for i, v in ipairs(payload.vertices) do',
    '        vertexIds[i] = editableMesh:AddVertex(Vector3.new(v[1], v[2], v[3]))',
    '    end',
    '    for i, n in ipairs(payload.normals) do',
    '        normalIds[i] = editableMesh:AddNormal(Vector3.new(n[1], n[2], n[3]))',
    '    end',
    '    for i, uv in ipairs(payload.uvs) do',
    '        uvIds[i] = editableMesh:AddUV(Vector2.new(uv[1], uv[2]))',
    '    end',
    '    for _, tri in ipairs(payload.faces) do',
    '        local i1, i2, i3 = tri[1], tri[2], tri[3]',
    '        local id1, id2, id3 = vertexIds[i1], vertexIds[i2], vertexIds[i3]',
    '        if id1 and id2 and id3 then',
    '            local fid = editableMesh:AddTriangle(id1, id2, id3)',
    '            if normalIds[i1] and normalIds[i2] and normalIds[i3] then',
    '                pcall(function() editableMesh:SetFaceNormals(fid, { normalIds[i1], normalIds[i2], normalIds[i3] }) end)',
    '            end',
    '            if uvIds[i1] and uvIds[i2] and uvIds[i3] then',
    '                pcall(function() editableMesh:SetFaceUVs(fid, { uvIds[i1], uvIds[i2], uvIds[i3] }) end)',
    '            end',
    '        end',
    '    end',
    '    local generatedMeshPart = AssetService:CreateMeshPartAsync(Content.fromObject(editableMesh), {',
    '        CollisionFidelity = payload.collisionFidelity,',
    '        RenderFidelity = payload.renderFidelity,',
    '    })',
    '    generatedMeshPart.DoubleSided = payload.doubleSided',
    '    generatedMeshPart.Size = payload.size',
    '    generatedMeshPart:SetAttribute("MeshId", payload.meshId)',
    '    generatedMeshPart:SetAttribute("AssetId", payload.assetId)',
    '    generatedMeshPart:SetAttribute("RojoObjPath", payload.objSourcePath)',
    '    return generatedMeshPart',
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
      // Cap resolution for inline Luau EditableMesh while keeping high fidelity
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
