import * as THREE from 'three';
import {
  Forge3DAsset,
  MeshPart3DSpec,
  PartPBRMaterialSpec,
  ROBLOX_MATERIAL_ENUM_TOKENS,
  ROBLOX_TOKEN_TO_MATERIAL,
  SubMeshGeometryData,
  resolveRgbTuple,
  validatePublishedRobloxMeshId,
} from './types.ts';
import {
  buildBufferGeometryFromMeshData,
  ensurePartHasMeshData,
  splitOversizedMeshPart,
} from './meshGeometry.ts';
import { generateEditableMeshLuauCode } from './luauExporter.ts';

function escapeXml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Exports any Three.js Object3D / Group to Wavefront .OBJ format
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
 * Converts a 2D image into a real 3D Relief / Volumetric Heightmap Mesh
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

      resolve({
        mesh,
        triangleCount: faces.length,
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
 * Exports a Forge3DAsset to paired Wavefront .OBJ and PBR Material Library (.MTL)
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
    const [r, g, b] = resolveRgbTuple(part.color);
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

/**
 * Exports a Forge3DAsset to a native Roblox Studio XML Model (.rbxmx)
 */
export function exportAssetToRBXMX(asset: Forge3DAsset): string {
  const safeName = (asset.name || 'ForgeModel3D').replace(/[^a-zA-Z0-9_]/g, '') || 'ForgeModel3D';
  const euler = new THREE.Euler();
  const mat4 = new THREE.Matrix4();

  const expandedParts: MeshPart3DSpec[] = [];
  for (const part of asset.parts || []) {
    expandedParts.push(...splitOversizedMeshPart(part));
  }

  interface RbxmxHierarchyNode {
    name: string;
    path: string;
    children: Map<string, RbxmxHierarchyNode>;
    partBlocks: string[][];
  }

  const rootTree: RbxmxHierarchyNode = {
    name: 'Root',
    path: 'Root',
    children: new Map(),
    partBlocks: [],
  };

  const ensureContainerNode = (segments: string[]): RbxmxHierarchyNode => {
    let curr = rootTree;
    let accum = 'Root';
    for (const seg of segments) {
      if (!seg || seg === 'Root' || seg === safeName) continue;
      accum = `${accum}/${seg}`;
      let next = curr.children.get(seg);
      if (!next) {
        next = {
          name: seg,
          path: accum,
          children: new Map(),
          partBlocks: [],
        };
        curr.children.set(seg, next);
      }
      curr = next;
    }
    return curr;
  };

  for (let idx = 0; idx < expandedParts.length; idx++) {
    const part = expandedParts[idx];
    const refId = `RBX_PART_${idx + 1}`;
    const partName = part.name || `MeshPart_${idx + 1}`;
    const [sx = 2, sy = 2, sz = 2] = part.size || [2, 2, 2];
    const [px = 0, py = 1, pz = 0] = part.position || [0, 1, 0];
    const [rx = 0, ry = 0, rz = 0] = part.rotation || [0, 0, 0];
    const [cr, cg, cb] = resolveRgbTuple(part.color);

    let r00: string, r01: string, r02: string;
    let r10: string, r11: string, r12: string;
    let r20: string, r21: string, r22: string;
    if (Array.isArray(part.rotationMatrix) && part.rotationMatrix.length === 9) {
      r00 = Number(part.rotationMatrix[0]).toFixed(6);
      r01 = Number(part.rotationMatrix[1]).toFixed(6);
      r02 = Number(part.rotationMatrix[2]).toFixed(6);
      r10 = Number(part.rotationMatrix[3]).toFixed(6);
      r11 = Number(part.rotationMatrix[4]).toFixed(6);
      r12 = Number(part.rotationMatrix[5]).toFixed(6);
      r20 = Number(part.rotationMatrix[6]).toFixed(6);
      r21 = Number(part.rotationMatrix[7]).toFixed(6);
      r22 = Number(part.rotationMatrix[8]).toFixed(6);
    } else {
      euler.set(
        THREE.MathUtils.degToRad(rx),
        THREE.MathUtils.degToRad(ry),
        THREE.MathUtils.degToRad(rz),
        'XYZ'
      );
      mat4.makeRotationFromEuler(euler);
      const te = mat4.elements;
      r00 = te[0].toFixed(6); r01 = te[4].toFixed(6); r02 = te[8].toFixed(6);
      r10 = te[1].toFixed(6); r11 = te[5].toFixed(6); r12 = te[9].toFixed(6);
      r20 = te[2].toFixed(6); r21 = te[6].toFixed(6); r22 = te[10].toFixed(6);
    }

    const colorUint8 =
      ((0xff << 24) |
        ((Math.max(0, Math.min(255, Math.round(cr))) & 0xff) << 16) |
        ((Math.max(0, Math.min(255, Math.round(cg))) & 0xff) << 8) |
        (Math.max(0, Math.min(255, Math.round(cb))) & 0xff)) >>>
      0;

    const matToken = ROBLOX_MATERIAL_ENUM_TOKENS[part.material] ?? 1088;
    const validMeshId = validatePublishedRobloxMeshId(part.meshId);
    const hasEditableBuffers = Boolean(
      part.meshData &&
        Array.isArray(part.meshData.vertices) &&
        part.meshData.vertices.length > 0 &&
        Array.isArray(part.meshData.faces) &&
        part.meshData.faces.length > 0
    );
    const isExternalOnly =
      !hasEditableBuffers &&
      (Boolean(validMeshId) ||
        part.geometrySource === 'PublishedCloudMeshId' ||
        part.geometrySource === 'StudioExternalUnreadable');
    const meshData = isExternalOnly ? undefined : ensurePartHasMeshData(part);
    const geometrySource = hasEditableBuffers
      ? 'EditableMeshBuffers'
      : validMeshId
      ? 'PublishedCloudMeshId'
      : part.geometrySource === 'StudioExternalUnreadable'
      ? 'StudioExternalUnreadable'
      : 'EditableMeshBuffers';

    const validColorMap = validatePublishedRobloxMeshId(
      part.pbrMaterial?.colorMapAssetId || asset.pbr_profile?.color_map_asset_id
    );
    const validNormalMap = validatePublishedRobloxMeshId(
      part.pbrMaterial?.normalMapAssetId || asset.pbr_profile?.normal_map_asset_id
    );
    const validRoughnessMap = validatePublishedRobloxMeshId(
      part.pbrMaterial?.roughnessMapAssetId || asset.pbr_profile?.roughness_map_asset_id
    );
    const validMetalnessMap = validatePublishedRobloxMeshId(
      part.pbrMaterial?.metalnessMapAssetId || asset.pbr_profile?.metalness_map_asset_id
    );

    const partId = part.partId || `${safeName}::${partName}::${idx + 1}`;
    const rawParent = (part.parentName || 'Root').trim();
    const rawHPath = (part.hierarchyPath || '').trim();
    const rawSegments = (rawHPath || `${rawParent}/${partName}`)
      .replace(/\\/g, '/')
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    const normalizedSegments =
      rawSegments[0] === 'Root'
        ? rawSegments
        : rawSegments[0] === safeName
        ? ['Root', ...rawSegments.slice(1)]
        : ['Root', ...rawSegments];
    if (normalizedSegments[normalizedSegments.length - 1] !== partName) {
      normalizedSegments.push(partName);
    }
    const containerSegments = normalizedSegments.slice(1, -1);
    const parentName =
      containerSegments.length > 0 ? containerSegments[containerSegments.length - 1] : 'Root';
    const hierarchyPath = normalizedSegments.join('/');
    const parentId =
      part.parentId ||
      (containerSegments.length > 0
        ? `node::Root/${containerSegments.join('/')}`
        : 'node::Root');

    const geometryJsonPayload = JSON.stringify({
      partId,
      name: partName,
      parentId,
      parentName,
      hierarchyPath,
      geometrySource,
      shape: 'MeshPart',
      meshId: validMeshId,
      size: [sx, sy, sz],
      position: [px, py, pz],
      rotation: [rx, ry, rz],
      rotationMatrix: [
        Number(r00), Number(r01), Number(r02),
        Number(r10), Number(r11), Number(r12),
        Number(r20), Number(r21), Number(r22),
      ],
      color: [cr, cg, cb],
      material: part.material || 'Metal',
      roughness: part.pbrMaterial?.roughness ?? part.roughness ?? 0.35,
      metalness: part.pbrMaterial?.metalness ?? part.metalness ?? 0.65,
      collisionFidelity: part.collisionFidelity || 'Hull',
      pbrMaterial: part.pbrMaterial
        ? {
            pattern: part.pbrMaterial.pattern,
            albedoHex: part.pbrMaterial.albedoHex,
            emissiveHex: part.pbrMaterial.emissiveHex,
            roughness: part.pbrMaterial.roughness,
            metalness: part.pbrMaterial.metalness,
            colorMapAssetId: validColorMap || undefined,
            normalMapAssetId: validNormalMap || undefined,
            roughnessMapAssetId: validRoughnessMap || undefined,
            metalnessMapAssetId: validMetalnessMap || undefined,
          }
        : undefined,
      vertices: meshData ? meshData.vertices : [],
      normals: meshData ? meshData.normals || [] : [],
      uvs: meshData ? meshData.uvs || [] : [],
      faces: meshData ? meshData.faces : [],
    });

    const partBlock: string[] = [
      `<Item class="MeshPart" referent="${refId}">`,
      '  <Properties>',
      `    <string name="Name">${escapeXml(partName)}</string>`,
      `    <bool name="Anchored">${part.anchored !== false ? 'true' : 'false'}</bool>`,
      `    <bool name="CanCollide">${part.canCollide !== false ? 'true' : 'false'}</bool>`,
      `    <bool name="DoubleSided">${part.doubleSided ? 'true' : 'false'}</bool>`,
      `    <float name="Transparency">${Number(part.transparency ?? 0).toFixed(3)}</float>`,
      `    <token name="Material">${matToken}</token>`,
      `    <Color3uint8 name="Color3uint8">${colorUint8}</Color3uint8>`,
      validMeshId
        ? `    <Content name="MeshId"><url>${escapeXml(validMeshId)}</url></Content>`
        : '    <Content name="MeshId"><null></null></Content>',
      '    <Vector3 name="size">',
      `      <X>${Number(sx).toFixed(4)}</X>`,
      `      <Y>${Number(sy).toFixed(4)}</Y>`,
      `      <Z>${Number(sz).toFixed(4)}</Z>`,
      '    </Vector3>',
      '    <Vector3 name="InitialSize">',
      `      <X>${Number(sx).toFixed(4)}</X>`,
      `      <Y>${Number(sy).toFixed(4)}</Y>`,
      `      <Z>${Number(sz).toFixed(4)}</Z>`,
      '    </Vector3>',
      '    <CoordinateFrame name="CFrame">',
      `      <X>${Number(px).toFixed(4)}</X>`,
      `      <Y>${Number(py).toFixed(4)}</Y>`,
      `      <Z>${Number(pz).toFixed(4)}</Z>`,
      `      <R00>${r00}</R00><R01>${r01}</R01><R02>${r02}</R02>`,
      `      <R10>${r10}</R10><R11>${r11}</R11><R12>${r12}</R12>`,
      `      <R20>${r20}</R20><R21>${r21}</R21><R22>${r22}</R22>`,
      '    </CoordinateFrame>',
      '  </Properties>',
      `  <Item class="SurfaceAppearance" referent="${refId}_PBR">`,
      '    <Properties>',
      `      <string name="Name">${escapeXml(partName)}_SurfaceAppearance</string>`,
      '      <token name="AlphaMode">0</token>',
      validColorMap
        ? `      <Content name="ColorMap"><url>${escapeXml(validColorMap)}</url></Content>`
        : '      <Content name="ColorMap"><null></null></Content>',
      validNormalMap
        ? `      <Content name="NormalMap"><url>${escapeXml(validNormalMap)}</url></Content>`
        : '      <Content name="NormalMap"><null></null></Content>',
      validRoughnessMap
        ? `      <Content name="RoughnessMap"><url>${escapeXml(validRoughnessMap)}</url></Content>`
        : '      <Content name="RoughnessMap"><null></null></Content>',
      validMetalnessMap
        ? `      <Content name="MetalnessMap"><url>${escapeXml(validMetalnessMap)}</url></Content>`
        : '      <Content name="MetalnessMap"><null></null></Content>',
      '    </Properties>',
      '  </Item>',
      `  <Item class="StringValue" referent="${refId}_PID">`,
      '    <Properties>',
      '      <string name="Name">ForgePartId</string>',
      `      <string name="Value">${escapeXml(partId)}</string>`,
      '    </Properties>',
      '  </Item>',
      `  <Item class="StringValue" referent="${refId}_PARENT_ID">`,
      '    <Properties>',
      '      <string name="Name">ForgeParentId</string>',
      `      <string name="Value">${escapeXml(parentId)}</string>`,
      '    </Properties>',
      '  </Item>',
      `  <Item class="StringValue" referent="${refId}_PARENT">`,
      '    <Properties>',
      '      <string name="Name">ForgeParentName</string>',
      `      <string name="Value">${escapeXml(parentName)}</string>`,
      '    </Properties>',
      '  </Item>',
      `  <Item class="StringValue" referent="${refId}_HPATH">`,
      '    <Properties>',
      '      <string name="Name">ForgeHierarchyPath</string>',
      `      <string name="Value">${escapeXml(hierarchyPath)}</string>`,
      '    </Properties>',
      '  </Item>',
      `  <Item class="StringValue" referent="${refId}_GSOURCE">`,
      '    <Properties>',
      '      <string name="Name">ForgeGeometrySource</string>',
      `      <string name="Value">${escapeXml(geometrySource)}</string>`,
      '    </Properties>',
      '  </Item>',
      ...(meshData
        ? [
            `  <Item class="StringValue" referent="${refId}_GEOM">`,
            '    <Properties>',
            '      <string name="Name">ForgeMeshGeometryJSON</string>',
            `      <string name="Value">${escapeXml(geometryJsonPayload)}</string>`,
            '    </Properties>',
            '  </Item>',
          ]
        : []),
      '</Item>',
    ];

    const targetNode = ensureContainerNode(containerSegments);
    targetNode.partBlocks.push(partBlock);
  }

  const lines: string[] = [
    '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">',
    '  <Meta name="ExplicitAutoJoints">true</Meta>',
    '  <External>null</External>',
    '  <External>nil</External>',
    `  <Item class="Model" referent="RBX_FORGE_MODEL_${safeName}">`,
    '    <Properties>',
    `      <string name="Name">${escapeXml(safeName)}</string>`,
    '      <Ref name="PrimaryPart">RBX_PART_1</Ref>',
    '    </Properties>',
  ];

  let containerRefCounter = 0;
  const emitHierarchyNode = (node: RbxmxHierarchyNode, indent: string) => {
    for (const block of node.partBlocks) {
      for (const l of block) {
        lines.push(`${indent}${l}`);
      }
    }
    for (const child of node.children.values()) {
      containerRefCounter += 1;
      const cRef = `RBX_CONTAINER_${containerRefCounter}`;
      lines.push(
        `${indent}<Item class="Model" referent="${cRef}">`,
        `${indent}  <Properties>`,
        `${indent}    <string name="Name">${escapeXml(child.name)}</string>`,
        `${indent}  </Properties>`,
        `${indent}  <Item class="StringValue" referent="${cRef}_NODEID">`,
        `${indent}    <Properties>`,
        `${indent}      <string name="Name">ForgeNodeId</string>`,
        `${indent}      <string name="Value">${escapeXml(`node::${child.path}`)}</string>`,
        `${indent}    </Properties>`,
        `${indent}  </Item>`,
        `${indent}  <Item class="StringValue" referent="${cRef}_HPATH">`,
        `${indent}    <Properties>`,
        `${indent}      <string name="Name">ForgeHierarchyPath</string>`,
        `${indent}      <string name="Value">${escapeXml(child.path)}</string>`,
        `${indent}    </Properties>`,
        `${indent}  </Item>`
      );
      emitHierarchyNode(child, `${indent}  `);
      lines.push(`${indent}</Item>`);
    }
  };

  emitHierarchyNode(rootTree, '    ');

  const luauScript = generateEditableMeshLuauCode(
    safeName,
    expandedParts.map((p) => {
      const validMeshId = validatePublishedRobloxMeshId(p.meshId);
      const hasBufs = Boolean(
        p.meshData &&
          Array.isArray(p.meshData.vertices) &&
          p.meshData.vertices.length > 0 &&
          Array.isArray(p.meshData.faces) &&
          p.meshData.faces.length > 0
      );
      const isExt =
        !hasBufs &&
        (Boolean(validMeshId) ||
          p.geometrySource === 'PublishedCloudMeshId' ||
          p.geometrySource === 'StudioExternalUnreadable');
      return {
        name: p.name,
        size: [p.size[0] ?? 2, p.size[1] ?? 2, p.size[2] ?? 2],
        position: [p.position[0] ?? 0, p.position[1] ?? 1, p.position[2] ?? 0],
        rotation: [p.rotation[0] ?? 0, p.rotation[1] ?? 0, p.rotation[2] ?? 0],
        color: [p.color[0] ?? 160, p.color[1] ?? 170, p.color[2] ?? 185],
        material: p.material || 'Metal',
        roughness: p.pbrMaterial?.roughness ?? p.roughness ?? 0.35,
        metalness: p.pbrMaterial?.metalness ?? p.metalness ?? 0.65,
        collisionFidelity: p.collisionFidelity || 'Hull',
        meshId: validMeshId,
        meshData: isExt ? undefined : ensurePartHasMeshData(p),
      };
    })
  );

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

  lines.push(
    `    <Item class="ModuleScript" referent="RBX_FORGE_RECONSTRUCTOR">`,
    '      <Properties>',
    '        <string name="Name">ForgeStudioReconstructor</string>',
    `        <ProtectedString name="Source"><![CDATA[${luauScript.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]></ProtectedString>`,
    '      </Properties>',
    '    </Item>',
    `    <Item class="Script" referent="RBX_FORGE_AUTORUNNER">`,
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
 * Parses a Roblox Studio XML Model (.rbxmx) file into a Forge3DAsset
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
    const rotationMatrix = [r00, r01, r02, r10, r11, r12, r20, r21, r22];

    rotMat.set(
      r00, r01, r02, 0,
      r10, r11, r12, 0,
      r20, r21, r22, 0,
      0,   0,   0,   1
    );
    euler.setFromRotationMatrix(rotMat, 'XYZ');
    const rx = Number(THREE.MathUtils.radToDeg(euler.x).toFixed(4));
    const ry = Number(THREE.MathUtils.radToDeg(euler.y).toFixed(4));
    const rz = Number(THREE.MathUtils.radToDeg(euler.z).toFixed(4));

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
    const meshId = validatePublishedRobloxMeshId(getText('Content[name="MeshId"] > url')) || undefined;

    const ancestorSegments: string[] = [];
    let currParent = itemNode.parentElement;
    while (currParent && currParent !== modelItem) {
      if (currParent.tagName === 'Item') {
        const pClass = currParent.getAttribute('class') || '';
        if (pClass === 'Model' || pClass === 'Folder') {
          const pName =
            currParent
              .querySelector(':scope > Properties > string[name="Name"]')
              ?.textContent?.trim() || '';
          if (pName && pName !== modelName && pName !== 'Root') {
            ancestorSegments.unshift(pName);
          }
        }
      }
      currParent = currParent.parentElement;
    }

    const surfNode = itemNode.querySelector('Item[class="SurfaceAppearance"] > Properties');
    const surfColorMap = validatePublishedRobloxMeshId(
      surfNode?.querySelector('Content[name="ColorMap"] > url')?.textContent
    );
    const surfNormalMap = validatePublishedRobloxMeshId(
      surfNode?.querySelector('Content[name="NormalMap"] > url')?.textContent
    );
    const surfRoughMap = validatePublishedRobloxMeshId(
      surfNode?.querySelector('Content[name="RoughnessMap"] > url')?.textContent
    );
    const surfMetalMap = validatePublishedRobloxMeshId(
      surfNode?.querySelector('Content[name="MetalnessMap"] > url')?.textContent
    );

    let meshData: SubMeshGeometryData | undefined;
    let roughness = 0.35;
    let metalness = 0.65;
    let collisionFidelity: MeshPart3DSpec['collisionFidelity'] = 'Hull';
    let pbrMaterial: PartPBRMaterialSpec | undefined;

    const stringValues = Array.from(itemNode.querySelectorAll(':scope > Item[class="StringValue"]'));
    const findStringValue = (targetName: string): string | undefined => {
      const node = stringValues.find(
        (sv) =>
          sv.querySelector(':scope > Properties > string[name="Name"]')?.textContent?.trim() ===
          targetName
      );
      return node?.querySelector(':scope > Properties > string[name="Value"]')?.textContent?.trim();
    };

    let partId = findStringValue('ForgePartId');
    let parentId = findStringValue('ForgeParentId');
    let parentName =
      ancestorSegments.length > 0
        ? ancestorSegments[ancestorSegments.length - 1]
        : findStringValue('ForgeParentName') || 'Root';
    let hierarchyPath =
      ancestorSegments.length > 0
        ? `Root/${ancestorSegments.join('/')}/${partName}`
        : findStringValue('ForgeHierarchyPath') || `Root/${partName}`;
    let geometrySource = findStringValue('ForgeGeometrySource') as MeshPart3DSpec['geometrySource'];
    const geomJsonText = findStringValue('ForgeMeshGeometryJSON');

    if (geomJsonText) {
      try {
        const parsedGeom = JSON.parse(geomJsonText);
        if (!partId && typeof parsedGeom.partId === 'string') partId = parsedGeom.partId;
        if (!parentId && typeof parsedGeom.parentId === 'string') parentId = parsedGeom.parentId;
        if (ancestorSegments.length === 0 && typeof parsedGeom.parentName === 'string' && parsedGeom.parentName) {
          parentName = parsedGeom.parentName;
        }
        if (ancestorSegments.length === 0 && typeof parsedGeom.hierarchyPath === 'string' && parsedGeom.hierarchyPath) {
          hierarchyPath = parsedGeom.hierarchyPath;
        }
        if (
          Array.isArray(parsedGeom.vertices) &&
          parsedGeom.vertices.length > 0 &&
          Array.isArray(parsedGeom.faces) &&
          parsedGeom.faces.length > 0
        ) {
          meshData = {
            vertices: parsedGeom.vertices,
            normals: parsedGeom.normals,
            uvs: parsedGeom.uvs,
            faces: parsedGeom.faces,
            objFileName: `${modelName}.obj`,
          };
          geometrySource = 'EditableMeshBuffers';
        }
        if (typeof parsedGeom.roughness === 'number') roughness = parsedGeom.roughness;
        if (typeof parsedGeom.metalness === 'number') metalness = parsedGeom.metalness;
        if (parsedGeom.collisionFidelity) collisionFidelity = parsedGeom.collisionFidelity;
        if (parsedGeom.pbrMaterial && typeof parsedGeom.pbrMaterial === 'object') {
          pbrMaterial = parsedGeom.pbrMaterial;
        }
      } catch {
        // Ignore invalid JSON
      }
    }

    if (surfColorMap || surfNormalMap || surfRoughMap || surfMetalMap) {
      pbrMaterial = {
        ...(pbrMaterial || {}),
        roughness,
        metalness,
        colorMapAssetId: surfColorMap || pbrMaterial?.colorMapAssetId,
        normalMapAssetId: surfNormalMap || pbrMaterial?.normalMapAssetId,
        roughnessMapAssetId: surfRoughMap || pbrMaterial?.roughnessMapAssetId,
        metalnessMapAssetId: surfMetalMap || pbrMaterial?.metalnessMapAssetId,
      };
    }

    const hasRealBuffers = Boolean(
      meshData &&
        Array.isArray(meshData.vertices) &&
        meshData.vertices.length > 0 &&
        Array.isArray(meshData.faces) &&
        meshData.faces.length > 0
    );
    const isExternalPart =
      !hasRealBuffers &&
      (Boolean(meshId) ||
        geometrySource === 'PublishedCloudMeshId' ||
        geometrySource === 'StudioExternalUnreadable' ||
        itemNode.getAttribute('class') === 'MeshPart');

    if (!geometrySource) {
      geometrySource = hasRealBuffers
        ? 'EditableMeshBuffers'
        : meshId
        ? 'PublishedCloudMeshId'
        : isExternalPart
        ? 'StudioExternalUnreadable'
        : 'EditableMeshBuffers';
    }

    const resolvedPartId = partId || `${modelName}::${partName}::${idx + 1}`;
    const basePart: MeshPart3DSpec = {
      partId: resolvedPartId,
      name: partName,
      parentId: parentId || (ancestorSegments.length > 0 ? `node::Root/${ancestorSegments.join('/')}` : 'node::Root'),
      parentName,
      hierarchyPath,
      geometrySource,
      rotationMatrix,
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
      pbrMaterial,
      meshData,
      baseMeshData: meshData,
    };

    if (!isExternalPart) {
      const resolvedMesh = ensurePartHasMeshData(basePart);
      basePart.meshData = resolvedMesh;
      totalTriangles += resolvedMesh.faces.length;
    } else if (meshData?.faces) {
      totalTriangles += meshData.faces.length;
    }
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
 * Exports a Forge3DAsset to a standard glTF 2.0 (.gltf) file
 */
export function exportAssetToGLTF(
  asset: Forge3DAsset,
  pbrBundle?: {
    albedoDataUrl?: string;
    normalDataUrl?: string;
    roughnessDataUrl?: string;
    metalnessDataUrl?: string;
    metallicRoughnessDataUrl?: string;
  }
): string {
  const safeName = (asset.name || 'ForgeModel3D').replace(/[^a-zA-Z0-9_]/g, '') || 'ForgeModel3D';
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();

  const bufferChunks: Uint8Array[] = [];
  const bufferViews: any[] = [];
  const accessors: any[] = [];
  const meshes: any[] = [];
  const materials: any[] = [];
  const nodes: any[] = [];
  const images: any[] = [];
  const samplers: any[] = [];
  const textures: any[] = [];

  let baseColorTexIdx: number | undefined;
  let normalTexIdx: number | undefined;
  let metallicRoughnessTexIdx: number | undefined;
  let metalnessStandAloneTexIdx: number | undefined;

  if (pbrBundle) {
    const packedOrm = pbrBundle.metallicRoughnessDataUrl || pbrBundle.roughnessDataUrl;
    const texSpecs: Array<
      [string | undefined, string, 'albedo' | 'normal' | 'metallic_roughness' | 'metalness']
    > = [
      [pbrBundle.albedoDataUrl, `${safeName}_ColorMap`, 'albedo'],
      [pbrBundle.normalDataUrl, `${safeName}_NormalMap`, 'normal'],
      [packedOrm, `${safeName}_MetallicRoughnessMap`, 'metallic_roughness'],
      [pbrBundle.metalnessDataUrl, `${safeName}_MetalnessMap`, 'metalness'],
    ];
    for (const [dataUrl, texName, role] of texSpecs) {
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
        if (role === 'metallic_roughness') metallicRoughnessTexIdx = texIdx;
        if (role === 'metalness') metalnessStandAloneTexIdx = texIdx;
      }
    }
  }

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

  const expandedParts: MeshPart3DSpec[] = [];
  for (const part of asset.parts || []) {
    expandedParts.push(...splitOversizedMeshPart(part));
  }

  for (let idx = 0; idx < expandedParts.length; idx++) {
    const part = expandedParts[idx];
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

    const [cr, cg, cb] = resolveRgbTuple(part.color);
    const alpha = Math.max(0.05, Math.min(1, 1 - (part.transparency || 0)));
    const effMetalness = part.pbrMaterial?.metalness ?? part.metalness ?? 0.65;
    const effRoughness = part.pbrMaterial?.roughness ?? part.roughness ?? 0.35;

    const pbrSpec: any = {
      baseColorFactor: [
        Number((cr / 255).toFixed(4)),
        Number((cg / 255).toFixed(4)),
        Number((cb / 255).toFixed(4)),
        Number(alpha.toFixed(4)),
      ],
      metallicFactor: Number(Math.max(0, Math.min(1, effMetalness)).toFixed(4)),
      roughnessFactor: Number(Math.max(0.04, Math.min(1, effRoughness)).toFixed(4)),
    };
    if (baseColorTexIdx !== undefined) {
      pbrSpec.baseColorTexture = { index: baseColorTexIdx };
    }
    if (metallicRoughnessTexIdx !== undefined) {
      pbrSpec.metallicRoughnessTexture = { index: metallicRoughnessTexIdx };
    }

    const matDef: any = {
      name: `${partName}_${part.material || 'Metal'}`,
      pbrMetallicRoughness: pbrSpec,
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
      extras: {
        metalnessMapTextureIndex: metalnessStandAloneTexIdx ?? null,
        robloxSurfaceAppearance: part.pbrMaterial || null,
      },
    };
    if (normalTexIdx !== undefined) {
      matDef.normalTexture = { index: normalTexIdx };
    }

    const matIndex = materials.length;
    materials.push(matDef);

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
        publishedMeshId: validatePublishedRobloxMeshId(part.meshId),
        pbrMaterial: part.pbrMaterial || null,
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

  const gltfDoc: any = {
    asset: {
      version: '2.0',
      generator: 'Forge AI Studio - Roblox Studio 3D Exporter (glTF 2.0 + 4-Channel PBR)',
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

  if (images.length > 0) gltfDoc.images = images;
  if (samplers.length > 0) gltfDoc.samplers = samplers;
  if (textures.length > 0) gltfDoc.textures = textures;

  return JSON.stringify(gltfDoc, null, 2);
}
