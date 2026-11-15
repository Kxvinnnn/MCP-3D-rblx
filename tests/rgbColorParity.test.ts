import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DOMParser } from 'happy-dom';

if (typeof (globalThis as any).DOMParser === 'undefined') {
  (globalThis as any).DOMParser = DOMParser;
}

import {
  FORGE_COLOR_CONVENTION_VERSION,
  resolveColorRgb255,
  resolveRgbTuple,
  normalizeColorRgb255,
} from '../src/utils/colorUtils.ts';
import {
  buildStrictLuauFromEditedParts,
} from '../src/server/engines/generation3DEngine.ts';
import {
  buildRbxmxFromPartsServer,
  parseRbxmxFromPartsServer,
  buildObjAndMtlFromPartsServer,
  buildGltfFromPartsServer,
  computePartSyncHashes,
  normalizePartsWithSyncMetadata,
} from '../src/server/engines/assetEngine.ts';
import { synthesizeSeededProcedural3DAsset } from '../src/server/engines/procedural3DGenerator.ts';
import { generateEditableMeshLuauCode } from '../src/utils/3d/luauExporter.ts';
import {
  exportAssetToRBXMX,
  exportAssetToOBJWithMTL,
  exportAssetToGLTF,
} from '../src/utils/3d/formatExporters.ts';

function makeMinimalTrianglePart(overrides: Record<string, any> = {}) {
  const vertices: Array<[number, number, number]> = [
    [-1, -1, 0],
    [1, -1, 0],
    [0, 1, 0],
  ];
  const normals: Array<[number, number, number]> = [
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
  ];
  const uvs: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [0.5, 1],
  ];
  const faces: Array<[number, number, number]> = [[0, 1, 2]];
  return {
    partId: 'fpart_ColorParityPart',
    name: 'ColorParityPart',
    parentId: 'fnode_Root',
    parentName: 'Root',
    hierarchyPath: 'Root/ColorParityPart',
    shape: 'MeshPart' as const,
    size: [2, 2, 2],
    position: [0, 1, 0],
    rotation: [0, 0, 0],
    color: [148, 163, 184],
    material: 'Metal',
    roughness: 0.35,
    metalness: 0.6,
    transparency: 0,
    canCollide: true,
    anchored: true,
    collisionFidelity: 'Hull' as const,
    meshData: {
      vertices,
      normals,
      uvs,
      faces,
    },
    ...overrides,
  };
}

test('RGB Parity 1 — Convención inequívoca forge-color-v1 en TypeScript (normalizado [0..1] vs 8-bit vs explícito vs hex)', () => {
  assert.equal(FORGE_COLOR_CONVENTION_VERSION, 'forge-color-v1');

  const vectors: Array<{
    input: unknown;
    colorSpace?: unknown;
    expected: [number, number, number];
    label: string;
  }> = [
    { input: [0, 0, 0], expected: [0, 0, 0], label: 'black [0,0,0]' },
    { input: [0.5, 0.25, 0.75], expected: [128, 64, 191], label: 'fractional float' },
    { input: [0.5, 1, 0], expected: [128, 255, 0], label: 'mixed fraction + integer unit' },
    { input: [1, 0, 0], expected: [255, 0, 0], label: 'integer unit pure red [1,0,0]' },
    { input: [0, 1, 0], expected: [0, 255, 0], label: 'integer unit pure green [0,1,0]' },
    { input: [0, 0, 1], expected: [0, 0, 255], label: 'integer unit pure blue [0,0,1]' },
    { input: [1, 1, 0], expected: [255, 255, 0], label: 'integer unit yellow [1,1,0]' },
    { input: [1, 1, 1], expected: [255, 255, 255], label: 'integer unit pure white [1,1,1]' },
    { input: [1, 0, 0], colorSpace: 'rgb8', expected: [1, 0, 0], label: 'explicit 8-bit near-black [1,0,0]' },
    { input: [1, 1, 1], colorSpace: 'rgb8', expected: [1, 1, 1], label: 'explicit 8-bit near-black [1,1,1]' },
    { input: [1, 1, 1], colorSpace: false, expected: [1, 1, 1], label: 'explicit normalized=false [1,1,1]' },
    { input: [1, 0, 0], colorSpace: 'rgb01', expected: [255, 0, 0], label: 'explicit rgb01 [1,0,0]' },
    { input: [2, 1, 0], expected: [2, 1, 0], label: '8-bit above-unit [2,1,0]' },
    { input: [255, 0, 0], expected: [255, 0, 0], label: '8-bit red [255,0,0]' },
    { input: [148, 163, 184], expected: [148, 163, 184], label: '8-bit slate [148,163,184]' },
    { input: [-5, 310, 127.5], expected: [0, 255, 128], label: 'clamp + half-up rounding' },
    { input: '#ef4444', expected: [239, 68, 68], label: 'hex #RRGGBB' },
    { input: ' 22c55e ', expected: [34, 197, 94], label: 'hex RRGGBB without #' },
    { input: '#f0a', expected: [255, 0, 170], label: 'short hex #RGB' },
    { input: { r: 1, g: 1, b: 1, colorSpace: 'rgb8' }, expected: [1, 1, 1], label: 'object rgb8' },
    { input: { color: [1, 0, 0], normalized: true }, expected: [255, 0, 0], label: 'object normalized' },
  ];

  for (const v of vectors) {
    assert.deepEqual(
      resolveColorRgb255(v.input, [148, 163, 184], v.colorSpace),
      v.expected,
      `resolveColorRgb255 failed for ${v.label}`
    );
    assert.deepEqual(
      resolveRgbTuple(v.input, [148, 163, 184], v.colorSpace),
      v.expected,
      `resolveRgbTuple failed for ${v.label}`
    );
    assert.deepEqual(
      normalizeColorRgb255(v.input, [148, 163, 184], v.colorSpace),
      v.expected,
      `normalizeColorRgb255 failed for ${v.label}`
    );
  }

  // Fallback checks for null / empty / NaN / Infinity (never coerce null/"" to 0)
  assert.deepEqual(resolveColorRgb255([null, 1, 1], [148, 163, 184]), [148, 163, 184]);
  assert.deepEqual(resolveColorRgb255(['', 1, 1], [148, 163, 184]), [148, 163, 184]);
  assert.deepEqual(resolveColorRgb255([Number.NaN, 0, 0], [160, 170, 185]), [160, 170, 185]);
  assert.deepEqual(resolveColorRgb255([Number.POSITIVE_INFINITY, 0, 0], [160, 170, 185]), [160, 170, 185]);
});

test('RGB Parity 2 — Exportadores cliente/servidor y computePartSyncHashes producen el mismo RGB para [1,0,0], [1,1,1] y #ef4444', () => {
  const redPartNorm = makeMinimalTrianglePart({ name: 'UnitRedPart', color: [1, 0, 0] });
  const redPart255 = makeMinimalTrianglePart({ name: 'UnitRedPart', color: [255, 0, 0] });
  const whitePartNorm = makeMinimalTrianglePart({ name: 'UnitWhitePart', color: [1, 1, 1] });
  const whitePart255 = makeMinimalTrianglePart({ name: 'UnitWhitePart', color: [255, 255, 255] });
  const darkPartRgb8 = makeMinimalTrianglePart({ name: 'DarkRgb8Part', color: [1, 1, 1], colorSpace: 'rgb8' });

  // materialHash & combinedHash must match identically between [1,0,0] and [255,0,0], and between [1,1,1] and [255,255,255]
  assert.equal(computePartSyncHashes(redPartNorm, 0).materialHash, computePartSyncHashes(redPart255, 0).materialHash);
  assert.equal(computePartSyncHashes(redPartNorm, 0).combinedHash, computePartSyncHashes(redPart255, 0).combinedHash);
  assert.equal(computePartSyncHashes(whitePartNorm, 0).materialHash, computePartSyncHashes(whitePart255, 0).materialHash);
  assert.equal(computePartSyncHashes(whitePartNorm, 0).combinedHash, computePartSyncHashes(whitePart255, 0).combinedHash);

  // Explicit rgb8 dark [1,1,1] must NOT collide with white [255,255,255], and must roundtrip through normalizePartsWithSyncMetadata
  const normalizedDark = normalizePartsWithSyncMetadata([darkPartRgb8], 'ParityModel');
  assert.deepEqual(normalizedDark[0].color, [1, 1, 1]);
  assert.equal(normalizedDark[0].colorSpace, 'rgb8');
  assert.equal(
    computePartSyncHashes(normalizedDark[0], 0).materialHash,
    computePartSyncHashes(darkPartRgb8, 0).materialHash
  );
  assert.notEqual(
    computePartSyncHashes(normalizedDark[0], 0).materialHash,
    computePartSyncHashes(whitePart255, 0).materialHash
  );

  // Server & Client Luau exporters must emit Color3.fromRGB(255, 0, 0) and Color3.fromRGB(255, 255, 255), plus Color3.fromRGB(1, 1, 1) when colorSpace='rgb8'
  const serverLuau = buildStrictLuauFromEditedParts('ParityTest', [redPartNorm, whitePartNorm, darkPartRgb8], 'Hull');
  assert.match(serverLuau, /Color3\.fromRGB\(255, 0, 0\)/);
  assert.match(serverLuau, /Color3\.fromRGB\(255, 255, 255\)/);
  assert.match(serverLuau, /Color3\.fromRGB\(1, 1, 1\)/);

  const clientLuau = generateEditableMeshLuauCode('ParityTest', [redPartNorm, whitePartNorm, darkPartRgb8] as any);
  assert.match(clientLuau, /Color3\.fromRGB\(255, 0, 0\)/);
  assert.match(clientLuau, /Color3\.fromRGB\(255, 255, 255\)/);
  assert.match(clientLuau, /Color3\.fromRGB\(1, 1, 1\)/);

  // RBXMX export + parse roundtrip preserves unit red/white and explicit rgb8 dark
  const asset = {
    name: 'ParityModel',
    category: 'Props',
    asset_type: 'Model3D' as const,
    poly_count: 3,
    collision_fidelity: 'Hull' as const,
    rojo_target_folder: 'src/shared/Assets3D',
    file_name: 'ParityModel.luau',
    description: 'RGB parity model',
    pbr_profile: {
      albedo_hex: '#ff0000',
      roughness: 0.35,
      metalness: 0.6,
      emissive_hex: '#000000',
      roblox_material: 'Metal',
      pattern: 'solid',
    },
    parts: [redPartNorm, whitePartNorm, darkPartRgb8],
    luau_code: serverLuau,
  };

  const serverRbxmx = buildRbxmxFromPartsServer('ParityModel', asset.parts, 'Hull');
  const parsedServerRbxmx = parseRbxmxFromPartsServer(serverRbxmx, 'ParityModel');
  assert.deepEqual(parsedServerRbxmx.parts[0].color, [255, 0, 0]);
  assert.deepEqual(parsedServerRbxmx.parts[1].color, [255, 255, 255]);
  assert.deepEqual(parsedServerRbxmx.parts[2].color, [1, 1, 1]);
  assert.equal(parsedServerRbxmx.parts[2].colorSpace, 'rgb8');

  const clientRbxmx = exportAssetToRBXMX(asset as any);
  assert.doesNotMatch(clientRbxmx, /NaN/);

  const { mtl: serverMtl } = buildObjAndMtlFromPartsServer('ParityModel', asset.parts);
  const { mtl: clientMtl } = exportAssetToOBJWithMTL(asset as any);
  assert.match(serverMtl, /Kd 1\.0000 0\.0000 0\.0000/);
  assert.match(clientMtl, /Kd 1\.0000 0\.0000 0\.0000/);

  const serverGltf = JSON.parse(buildGltfFromPartsServer('ParityModel', asset.parts));
  const clientGltf = JSON.parse(exportAssetToGLTF(asset as any));
  assert.deepEqual(serverGltf.materials[0].pbrMetallicRoughness.baseColorFactor.slice(0, 3), [1, 0, 0]);
  assert.deepEqual(clientGltf.materials[0].pbrMetallicRoughness.baseColorFactor.slice(0, 3), [1, 0, 0]);
  assert.deepEqual(serverGltf.materials[1].pbrMetallicRoughness.baseColorFactor.slice(0, 3), [1, 1, 1]);
  assert.deepEqual(clientGltf.materials[1].pbrMetallicRoughness.baseColorFactor.slice(0, 3), [1, 1, 1]);
});

test('RGB Parity 3 — Plugin Luau ForgeAIStudioPlugin.server.luau implementa convención unificada sin heurística fraccionaria', () => {
  const pluginPath = path.resolve('backend/roblox_plugin/ForgeAIStudioPlugin.server.luau');
  const pluginSrc = fs.readFileSync(pluginPath, 'utf-8');

  assert.match(pluginSrc, /local function resolveRgbTupleLuau\(colorRaw: any, fallback: \{ number \}\?, explicitColorSpace: any\?\)/);
  assert.match(pluginSrc, /local isNormalizedUnitRange = r >= 0 and g >= 0 and b >= 0 and r <= 1 and g <= 1 and b <= 1/);
  assert.doesNotMatch(
    pluginSrc,
    /\(math\.floor\(r\) ~= r\)\s*or\s*\(math\.floor\(g\) ~= g\)\s*or\s*\(math\.floor\(b\) ~= b\)/,
    'Broken integer-exclusion heuristic must NOT exist in resolveRgbTupleLuau'
  );
  assert.match(pluginSrc, /partSpec\.colorSpace or partSpec\.colorFormat/);
  assert.match(pluginSrc, /colorSpace = "rgb8"/);
  assert.match(pluginSrc, /RGB normalized \[1,0,0\] parity mismatch/);
  assert.match(pluginSrc, /RGB normalized \[0,1,0\] parity mismatch/);
  assert.match(pluginSrc, /RGB normalized \[0,0,1\] parity mismatch/);
  assert.match(pluginSrc, /RGB black \[0,0,0\] parity mismatch/);
  assert.match(pluginSrc, /RGB normalized \[1,1,1\] parity mismatch/);
  assert.match(pluginSrc, /RGB 8-bit \[255,255,255\] parity mismatch/);
});

test('RGB Parity 4 — procedural3DGenerator normaliza colores de árboles procedurales con colorSpace=rgb8 y vertexColors finitos [0..1]', () => {
  const tree = synthesizeSeededProcedural3DAsset({
    name: 'CrimsonParityTree',
    category: 'Trees & Vegetation',
    seed: 'rgb-parity-tree-2026',
    tree_params: {
      trunkColor: '#5c4033',
      leafColor: '#f00',
      colorVariation: 0,
      branchCount: 3,
      foliageCount: 2,
      detailLevel: 'low',
    },
  });

  const canopy = tree.parts.find((p: any) => p.name === 'CanopyCrown_Main');
  const trunk = tree.parts.find((p: any) => p.name === 'MainTrunk');
  assert.ok(canopy, 'CanopyCrown_Main must exist');
  assert.ok(trunk, 'MainTrunk must exist');

  // Short hex #f00 must normalize to [255, 0, 0] with canonical colorSpace='rgb8'
  assert.deepEqual(canopy.color, [255, 0, 0]);
  assert.equal(canopy.colorSpace, 'rgb8');
  assert.deepEqual(trunk.color, [92, 64, 51]);
  assert.equal(trunk.colorSpace, 'rgb8');

  // vertexColors stay normalized [0..1] finite and generated Luau emits Color3.fromRGB(255, 0, 0)
  for (const vc of canopy.meshData.vertexColors) {
    assert.ok(vc[0] >= 0.9 && vc[0] <= 1.0);
    assert.equal(vc[1], 0);
    assert.equal(vc[2], 0);
  }
  assert.match(tree.luau_code, /Color3\.fromRGB\(255, 0, 0\)/);
  assert.match(tree.luau_code, /Color3\.fromRGB\(92, 64, 51\)/);
});
