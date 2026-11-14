import * as THREE from 'three';
import type { PBRTextureSet } from './types.ts';

const _partPbrCache = new Map<string, PBRTextureSet>();

/**
 * Generates zero-404 procedural 4-channel PBR texture maps:
 * - Albedo (`ColorMap`)
 * - Normal (`NormalMap`)
 * - Roughness (`RoughnessMap`)
 * - Metalness (`MetalnessMap`)
 * - Packed glTF 2.0 MetallicRoughness (`metallicRoughnessDataUrl`, G = Roughness, B = Metalness)
 * Ensuring consistent preview across Forge (Three.js), Blender (glTF 2.0), and Roblox (`SurfaceAppearance`).
 */
export function generateProceduralPBRTextures(
  pattern: string,
  baseHex: string,
  accentHex: string,
  maxAnisotropy: number = 4,
  roughnessScalar: number = 0.28,
  metalnessScalar: number = 0.82
): PBRTextureSet {
  const cacheKey = `${pattern}|${baseHex}|${accentHex}|${roughnessScalar.toFixed(2)}|${metalnessScalar.toFixed(2)}`;
  const cached = _partPbrCache.get(cacheKey);
  if (cached) return cached;

  const size = 256;
  const baseRoughByte = Math.max(12, Math.min(245, Math.round(roughnessScalar * 255)));
  const baseMetalByte = Math.max(0, Math.min(255, Math.round(metalnessScalar * 255)));

  // 1. Albedo Canvas (ColorMap)
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const aCtx = albedoCanvas.getContext('2d')!;
  aCtx.fillStyle = baseHex || '#334155';
  aCtx.fillRect(0, 0, size, size);

  // 2. Normal Canvas (NormalMap: neutral tangent normal = rgb(128, 128, 255))
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = size;
  normalCanvas.height = size;
  const nCtx = normalCanvas.getContext('2d')!;
  nCtx.fillStyle = 'rgb(128, 128, 255)';
  nCtx.fillRect(0, 0, size, size);

  // 3. Roughness Canvas (RoughnessMap)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;
  rCtx.fillStyle = `rgb(${baseRoughByte}, ${baseRoughByte}, ${baseRoughByte})`;
  rCtx.fillRect(0, 0, size, size);

  // 4. Metalness Canvas (MetalnessMap)
  const metalCanvas = document.createElement('canvas');
  metalCanvas.width = size;
  metalCanvas.height = size;
  const mCtx = metalCanvas.getContext('2d')!;
  mCtx.fillStyle = `rgb(${baseMetalByte}, ${baseMetalByte}, ${baseMetalByte})`;
  mCtx.fillRect(0, 0, size, size);

  if (pattern === 'BrushedTitanium' || pattern === 'brushed_metal' || pattern === 'Metal') {
    for (let y = 0; y < size; y += 2) {
      const shade = 235 + Math.floor(Math.sin(y * 0.4) * 18);
      aCtx.fillStyle = `rgba(${shade}, ${shade}, 255, 0.05)`;
      aCtx.fillRect(0, y, size, 1);

      nCtx.fillStyle = y % 4 === 0 ? 'rgb(128, 136, 255)' : 'rgb(128, 120, 255)';
      nCtx.fillRect(0, y, size, 1);

      const mBand = Math.max(0, Math.min(255, baseMetalByte + (y % 4 === 0 ? 14 : -10)));
      mCtx.fillStyle = `rgb(${mBand}, ${mBand}, ${mBand})`;
      mCtx.fillRect(0, y, size, 1);
    }
    aCtx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    aCtx.lineWidth = 2;
    aCtx.strokeRect(8, 8, size - 16, size - 16);
    nCtx.strokeStyle = 'rgb(100, 100, 255)';
    nCtx.lineWidth = 3;
    nCtx.strokeRect(8, 8, size - 16, size - 16);
    mCtx.strokeStyle = 'rgb(40, 40, 40)';
    mCtx.lineWidth = 3;
    mCtx.strokeRect(8, 8, size - 16, size - 16);
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
        const rVal = (x + y) % 64 === 0 ? Math.max(15, baseRoughByte - 25) : Math.min(245, baseRoughByte + 30);
        const mVal = (x + y) % 64 === 0 ? Math.min(255, baseMetalByte + 20) : Math.max(15, baseMetalByte - 35);
        rCtx.fillStyle = `rgb(${rVal},${rVal},${rVal})`;
        rCtx.fillRect(x + 4, y + 4, step - 8, step - 8);
        mCtx.fillStyle = `rgb(${mVal},${mVal},${mVal})`;
        mCtx.fillRect(x + 4, y + 4, step - 8, step - 8);
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
      mCtx.fillStyle = i % 5 === 0 ? 'rgb(110, 110, 110)' : 'rgb(28, 28, 28)';
      mCtx.fillRect(rx, ry, rw, rw);
    }
  } else {
    aCtx.strokeStyle = accentHex || '#38bdf8';
    aCtx.lineWidth = 2;
    aCtx.strokeRect(12, 12, size - 24, size - 24);
    aCtx.beginPath();
    aCtx.moveTo(0, size / 2);
    aCtx.lineTo(size, size / 2);
    aCtx.stroke();
    mCtx.strokeStyle = 'rgb(245, 245, 245)';
    mCtx.lineWidth = 3;
    mCtx.strokeRect(12, 12, size - 24, size - 24);
  }

  // 5. Packed glTF 2.0 MetallicRoughness Canvas (R = Occlusion 255, G = Roughness, B = Metalness)
  const ormCanvas = document.createElement('canvas');
  ormCanvas.width = size;
  ormCanvas.height = size;
  const ormCtx = ormCanvas.getContext('2d')!;
  const rData = rCtx.getImageData(0, 0, size, size).data;
  const mData = mCtx.getImageData(0, 0, size, size).data;
  const ormImg = ormCtx.createImageData(size, size);
  for (let i = 0; i < rData.length; i += 4) {
    ormImg.data[i] = 255;
    ormImg.data[i + 1] = rData[i];
    ormImg.data[i + 2] = mData[i];
    ormImg.data[i + 3] = 255;
  }
  ormCtx.putImageData(ormImg, 0, 0);

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

  const metalnessMap = new THREE.CanvasTexture(metalCanvas);
  metalnessMap.colorSpace = THREE.NoColorSpace;
  metalnessMap.wrapS = THREE.RepeatWrapping;
  metalnessMap.wrapT = THREE.RepeatWrapping;
  metalnessMap.anisotropy = maxAnisotropy;

  const result: PBRTextureSet = {
    albedoMap,
    normalMap,
    roughnessMap,
    metalnessMap,
    albedoDataUrl: albedoCanvas.toDataURL('image/png'),
    normalDataUrl: normalCanvas.toDataURL('image/png'),
    roughnessDataUrl: roughCanvas.toDataURL('image/png'),
    metalnessDataUrl: metalCanvas.toDataURL('image/png'),
    metallicRoughnessDataUrl: ormCanvas.toDataURL('image/png'),
  };

  if (_partPbrCache.size > 24) {
    const firstKey = _partPbrCache.keys().next().value;
    if (firstKey) _partPbrCache.delete(firstKey);
  }
  _partPbrCache.set(cacheKey, result);
  return result;
}
