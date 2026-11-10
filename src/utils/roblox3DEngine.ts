import * as THREE from 'three';

export interface MeshPart3DSpec {
  name: string;
  shape: 'Block' | 'Cylinder' | 'Ball' | 'Wedge' | 'CornerWedge';
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
}

export interface PBRProfileSpec {
  albedo_hex: string;
  roughness: number;
  metalness: number;
  emissive_hex: string;
  roblox_material: string;
  pattern: string;
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

  if (pattern === 'BrushedTitanium' || pattern === 'Metal') {
    for (let y = 0; y < size; y += 2) {
      const shade = 235 + Math.floor(Math.sin(y * 0.4) * 18);
      aCtx.fillStyle = `rgba(${shade}, ${shade}, 255, 0.05)`;
      aCtx.fillRect(0, y, size, 1);

      nCtx.fillStyle = y % 4 === 0 ? 'rgb(128, 136, 255)' : 'rgb(128, 120, 255)';
      nCtx.fillRect(0, y, size, 1);
    }
    // Panel seam lines
    aCtx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    aCtx.lineWidth = 2;
    aCtx.strokeRect(8, 8, size - 16, size - 16);
    nCtx.strokeStyle = 'rgb(100, 100, 255)';
    nCtx.lineWidth = 3;
    nCtx.strokeRect(8, 8, size - 16, size - 16);
  } else if (pattern === 'HexGridCarbon' || pattern === 'DiamondPlate') {
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
  } else if (pattern === 'WeatheredStone' || pattern === 'Slate') {
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
    // CyberPanel
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
 * Creates a true Roblox WedgePart BufferGeometry of size [w, h, d].
 */
export function createWedgeGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;

  // Slope goes from back-top (y=+hh, z=-hd) to front-bottom (y=-hh, z=+hd)
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

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Builds a Three.js Group from a Forge3DAsset specification, with support for
 * LOD segment scaling, wireframe overlay, and CollisionFidelity visualization.
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
    if (part.shape === 'Cylinder') {
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

    const mat = new THREE.MeshPhysicalMaterial({
      color: baseColor,
      roughness: isNeon ? 0.08 : Math.max(0.05, Math.min(1, part.roughness ?? 0.35)),
      metalness: isNeon ? 0.1 : Math.max(0, Math.min(1, part.metalness ?? 0.65)),
      emissive: isNeon ? baseColor : new THREE.Color(0x000000),
      emissiveIntensity: isNeon ? 1.6 : 0,
      transparent: isGlass,
      opacity: isGlass ? Math.max(0.2, 1 - (part.transparency || 0.45)) : 1,
      transmission: isGlass && !isSoftwareGl ? 0.75 : 0,
      clearcoat: part.material === 'SmoothPlastic' || isGlass ? 0.8 : 0.2,
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

    // Count triangles
    const indexAttr = geom.getIndex();
    const posAttr = geom.getAttribute('position');
    if (indexAttr) {
      totalTriangles += Math.round(indexAttr.count / 3);
    } else if (posAttr) {
      totalTriangles += Math.round(posAttr.count / 3);
    }

    // Optional Collision Fidelity Hull Wireframe Overlay
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
 * so developers can compare their 3D model's dimensions against a Roblox avatar.
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

  // Legs (2 studs high)
  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.0, 0.95), mat);
  leftLeg.position.set(-0.5, 1.0, 0);
  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.0, 0.95), mat);
  rightLeg.position.set(0.5, 1.0, 0);

  // Torso (2 studs high)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.0, 1.0), mat);
  torso.position.set(0, 3.0, 0);

  // Arms
  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.0, 0.95), mat);
  leftArm.position.set(-1.5, 3.0, 0);
  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.0, 0.95), mat);
  rightArm.position.set(1.5, 3.0, 0);

  // Head (1.2 studs high)
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.2, 16), mat);
  head.position.set(0, 4.65, 0);

  dummy.add(leftLeg, rightLeg, torso, leftArm, rightArm, head);
  dummy.position.set(-5.2, 0, 0);
  return dummy;
}

/**
 * Converts a 2D image into a 3D Relief / Volumetric Heightmap Mesh (Image-to-3D Geometry)
 */
export async function convertImageTo3DHeightmapMesh(
  imageDataUrl: string,
  gridRes: number = 48,
  extrusionDepth: number = 2.2
): Promise<{ mesh: THREE.Mesh; triangleCount: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = gridRes;
      canvas.height = gridRes;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, gridRes, gridRes);
      const imgData = ctx.getImageData(0, 0, gridRes, gridRes).data;

      const geom = new THREE.PlaneGeometry(6, 6, gridRes - 1, gridRes - 1);
      geom.rotateX(-Math.PI / 2);

      const posAttr = geom.attributes.position;
      const colors = new Float32Array(posAttr.count * 3);

      for (let i = 0; i < posAttr.count; i++) {
        const r = imgData[i * 4] / 255;
        const g = imgData[i * 4 + 1] / 255;
        const b = imgData[i * 4 + 2] / 255;
        const a = imgData[i * 4 + 3] / 255;
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) * a;

        posAttr.setY(i, luminance * extrusionDepth);
        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      }

      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geom.computeVertexNormals();

      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.35,
        metalness: 0.4,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.name = 'ImageTo3D_ExtrudedMesh';
      mesh.position.y = 0.05;

      const triCount = (gridRes - 1) * (gridRes - 1) * 2;
      resolve({ mesh, triangleCount: triCount });
    };
    img.onerror = reject;
    img.src = imageDataUrl;
  });
}

/**
 * Exports any Three.js Object3D / Group to Wavefront .OBJ format
 * ready for direct import into Roblox Studio's Asset Manager / MeshPart!
 */
export function exportObject3DToOBJ(rootObject: THREE.Object3D): string {
  let output = '# Forge AI Studio - Roblox Ready 3D Mesh (.OBJ)\n';
  output += '# Units: Roblox Studs | Max Tris per MeshPart: 10,000\n\n';

  let vertexOffset = 1;
  const v = new THREE.Vector3();

  rootObject.updateMatrixWorld(true);

  rootObject.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const geom = mesh.geometry;
      if (!geom) return;

      const posAttr = geom.getAttribute('position');
      if (!posAttr) return;

      output += `o ${mesh.name || 'RobloxSubMesh'}\n`;

      for (let i = 0; i < posAttr.count; i++) {
        v.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
        output += `v ${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}\n`;
      }

      const indexAttr = geom.getIndex();
      if (indexAttr) {
        for (let i = 0; i < indexAttr.count; i += 3) {
          const a = indexAttr.getX(i) + vertexOffset;
          const b = indexAttr.getX(i + 1) + vertexOffset;
          const c = indexAttr.getX(i + 2) + vertexOffset;
          output += `f ${a} ${b} ${c}\n`;
        }
      } else {
        for (let i = 0; i < posAttr.count; i += 3) {
          const a = i + vertexOffset;
          const b = i + 1 + vertexOffset;
          const c = i + 2 + vertexOffset;
          output += `f ${a} ${b} ${c}\n`;
        }
      }

      vertexOffset += posAttr.count;
      output += '\n';
    }
  });

  return output;
}
