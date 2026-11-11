import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAssetContentHash,
  calculateAssetMetrics,
  ensureStablePartIds,
  findMatchingPart,
} from '../src/context/ForgeContext.tsx';
import { Forge3DAsset, MeshPart3DSpec } from '../src/utils/roblox3DEngine.ts';

function createSampleAsset(name = 'CyberTurret'): Forge3DAsset {
  return {
    name,
    category: 'Weapons',
    asset_type: 'Model3D',
    poly_count: 24,
    collision_fidelity: 'Hull',
    rojo_target_folder: 'src/shared/assets/models',
    file_name: `${name}.luau`,
    description: 'Sample asset for unit testing',
    pbr_profile: {
      pattern: 'HexPlate',
      albedo_hex: '#06b6d4',
      emissive_hex: '#38bdf8',
      roughness: 0.25,
      metalness: 0.85,
      roblox_material: 'Metal',
    },
    parts: [
      {
        name: 'Base',
        shape: 'Block',
        size: [4, 1, 4],
        position: [0, 0.5, 0],
        rotation: [0, 0, 0],
        color: [6, 182, 212],
        material: 'Metal',
        roughness: 0.25,
        metalness: 0.85,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Hull',
      },
      {
        name: 'Cannon',
        shape: 'Cylinder',
        size: [1, 5, 1],
        position: [0, 2.5, 0],
        rotation: [90, 0, 0],
        color: [56, 189, 248],
        material: 'Metal',
        roughness: 0.2,
        metalness: 0.9,
        transparency: 0,
        canCollide: true,
        anchored: false,
        collisionFidelity: 'Hull',
      },
    ],
    luau_code: '-- sample\n',
  };
}

test('1. computeAssetContentHash es determinista y sensible a cambios', () => {
  const assetA = createSampleAsset('TurretA');
  const assetB = createSampleAsset('TurretA');

  const hashA1 = computeAssetContentHash(assetA);
  const hashA2 = computeAssetContentHash(assetB);
  assert.equal(hashA1, hashA2, 'Dos assets idénticos deben tener exactamente el mismo hash');

  // Modificar posición de una pieza
  const modifiedAsset = JSON.parse(JSON.stringify(assetA)) as Forge3DAsset;
  modifiedAsset.parts[0].position = [1.5, 0.5, 0];
  const hashMod = computeAssetContentHash(modifiedAsset);

  assert.notEqual(hashA1, hashMod, 'Modificar la posición de una pieza debe alterar el hash');
});

test('2. calculateAssetMetrics diferencia vértices, caras y triángulos reales', () => {
  const asset = createSampleAsset('TestMetrics');
  const metrics = calculateAssetMetrics(asset);

  // Block (8 verts, 12 tris) + Cylinder (48 verts, 92 tris) = 56 verts, 104 tris
  assert.equal(metrics.partsCount, 2);
  assert.equal(metrics.vertices, 56, 'Debe calcular la suma de vértices de las formas primitivas');
  assert.equal(metrics.triangles, 104, 'Debe calcular la suma de triángulos reales');

  // Malla con datos explícitos meshData
  const meshAsset: Forge3DAsset = {
    ...asset,
    parts: [
      {
        ...asset.parts[0],
        meshData: {
          vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
          faces: [[0, 1, 2]],
        },
      },
    ],
  };

  const meshMetrics = calculateAssetMetrics(meshAsset);
  assert.equal(meshMetrics.vertices, 3);
  assert.equal(meshMetrics.triangles, 1);
});

test('3. ensureStablePartIds genera identificadores estables sin alterar los existentes', () => {
  const parts: MeshPart3DSpec[] = [
    {
      name: 'LeftWing',
      shape: 'Block',
      size: [2, 1, 5],
      position: [-3, 1, 0],
      rotation: [0, 0, 0],
      color: [100, 100, 100],
      material: 'Plastic',
      roughness: 0.5,
      metalness: 0,
      transparency: 0,
      canCollide: true,
      anchored: false,
      collisionFidelity: 'Box',
    },
    {
      partId: 'custom_fixed_id_999',
      name: 'RightWing',
      shape: 'Block',
      size: [2, 1, 5],
      position: [3, 1, 0],
      rotation: [0, 0, 0],
      color: [100, 100, 100],
      material: 'Plastic',
      roughness: 0.5,
      metalness: 0,
      transparency: 0,
      canCollide: true,
      anchored: false,
      collisionFidelity: 'Box',
    },
  ];

  const stabilized = ensureStablePartIds(parts, 'StarFighter');
  assert.equal(stabilized[0].partId, 'StarFighter_LeftWing_1');
  assert.equal(stabilized[1].partId, 'custom_fixed_id_999', 'No debe sobrescribir IDs existentes');
});

test('4. findMatchingPart prioriza partId, luego hierarchyPath, luego nombre', () => {
  const parts: MeshPart3DSpec[] = [
    {
      partId: 'id_alpha',
      name: 'Door',
      hierarchyPath: 'Workspace/Castle/Door',
      shape: 'Block',
      size: [1, 2, 1],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      color: [0, 0, 0],
      material: 'Wood',
      roughness: 0.7,
      metalness: 0,
      transparency: 0,
      canCollide: true,
      anchored: true,
      collisionFidelity: 'Box',
    },
    {
      partId: 'id_beta',
      name: 'Door', // Mismo nombre pero diferente ID y jerarquía
      hierarchyPath: 'Workspace/Tavern/Door',
      shape: 'Block',
      size: [1, 2, 1],
      position: [10, 0, 0],
      rotation: [0, 0, 0],
      color: [0, 0, 0],
      material: 'Wood',
      roughness: 0.7,
      metalness: 0,
      transparency: 0,
      canCollide: true,
      anchored: true,
      collisionFidelity: 'Box',
    },
  ];

  // Match por ID
  const matchedById = findMatchingPart(parts, { partId: 'id_beta', name: 'Other' } as any);
  assert.equal(matchedById?.hierarchyPath, 'Workspace/Tavern/Door');

  // Match por jerarquía cuando no hay ID
  const matchedByPath = findMatchingPart(parts, { hierarchyPath: 'Workspace/Castle/Door' } as any);
  assert.equal(matchedByPath?.partId, 'id_alpha');
});

test('5. Historial, Deshacer y Rehacer mantienen snapshots inmutables', () => {
  const asset0 = createSampleAsset('Initial');
  const undoStack: Forge3DAsset[] = [];
  const redoStack: Forge3DAsset[] = [];

  // Snapshot 1
  undoStack.push(JSON.parse(JSON.stringify(asset0)));

  // Operación 1: modificar tamaño
  const asset1: Forge3DAsset = {
    ...asset0,
    parts: asset0.parts.map((p) => (p.name === 'Base' ? { ...p, size: [6, 1, 6] } : p)),
  };

  // Snapshot 2
  undoStack.push(JSON.parse(JSON.stringify(asset1)));

  // Operación 2: modificar color
  const asset2: Forge3DAsset = {
    ...asset1,
    parts: asset1.parts.map((p) => (p.name === 'Cannon' ? { ...p, color: [255, 0, 0] } : p)),
  };

  // Deshacer Operación 2
  const prevSnapshot = undoStack.pop()!;
  redoStack.push(JSON.parse(JSON.stringify(asset2)));

  assert.deepEqual(prevSnapshot.parts[0].size, [6, 1, 6]);
  assert.deepEqual(prevSnapshot.parts[1].color, [56, 189, 248], 'El color debe volver al original');

  // Rehacer
  const redoSnapshot = redoStack.pop()!;
  assert.deepEqual(redoSnapshot.parts[1].color, [255, 0, 0], 'El color debe volver al modificado');
});
