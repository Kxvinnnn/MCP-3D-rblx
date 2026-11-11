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
        partId: 'part_base_fixed',
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
        partId: 'part_cannon_fixed',
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

test('1. computeAssetContentHash es determinista e incorpora coordenadas de vértices, caras y propiedades físicas', () => {
  const assetA = createSampleAsset('TurretA');
  const assetB = createSampleAsset('TurretA');

  const hashA1 = computeAssetContentHash(assetA);
  const hashA2 = computeAssetContentHash(assetB);
  assert.equal(hashA1, hashA2, 'Dos assets idénticos deben tener exactamente el mismo hash');

  // Prueba 1A: Malla con vértices internos: desplazar un vértice intermedio sin alterar la cantidad total
  const meshAsset: Forge3DAsset = {
    ...assetA,
    parts: [
      {
        ...assetA.parts[0],
        meshData: {
          vertices: [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.5, 1.0, 0.0],
          ],
          faces: [[0, 1, 2]],
        },
      },
    ],
  };

  const originalMeshHash = computeAssetContentHash(meshAsset);

  // Desplazar vértice intermedio [1.0, 0.0, 0.0] a [1.08, 0.0, 0.0] (mismo número de vértices y caras)
  const deformedMeshAsset: Forge3DAsset = JSON.parse(JSON.stringify(meshAsset));
  deformedMeshAsset.parts[0].meshData!.vertices[1][0] = 1.08;

  const deformedMeshHash = computeAssetContentHash(deformedMeshAsset);
  assert.notEqual(
    originalMeshHash,
    deformedMeshHash,
    'CRÍTICO: El hash debe detectar el desplazamiento de coordenadas de vértices aunque la cantidad de vértices sea idéntica'
  );

  // Prueba 1B: Modificar color de una pieza
  const recoloredAsset: Forge3DAsset = JSON.parse(JSON.stringify(assetA));
  recoloredAsset.parts[0].color = [255, 0, 0];
  assert.notEqual(computeAssetContentHash(recoloredAsset), hashA1, 'Modificar el color debe alterar el hash');

  // Prueba 1C: Modificar propiedad física anchored
  const unanchoredAsset: Forge3DAsset = JSON.parse(JSON.stringify(assetA));
  unanchoredAsset.parts[0].anchored = false;
  assert.notEqual(computeAssetContentHash(unanchoredAsset), hashA1, 'Modificar anchored debe alterar el hash');

  // Prueba 1D: Modificar canCollide
  const ghostAsset: Forge3DAsset = JSON.parse(JSON.stringify(assetA));
  ghostAsset.parts[0].canCollide = false;
  assert.notEqual(computeAssetContentHash(ghostAsset), hashA1, 'Modificar canCollide debe alterar el hash');

  // Prueba 1E: Modificar transparency
  const glassAsset: Forge3DAsset = JSON.parse(JSON.stringify(assetA));
  glassAsset.parts[0].transparency = 0.5;
  assert.notEqual(computeAssetContentHash(glassAsset), hashA1, 'Modificar transparency debe alterar el hash');
});

test('2. calculateAssetMetrics distingue entre geometría real y estimada, y calcula quads y N-gons', () => {
  // Caso A: Primitivas Roblox puras
  const primitiveAsset = createSampleAsset('TestPrimitives');
  const primMetrics = calculateAssetMetrics(primitiveAsset);

  assert.equal(primMetrics.hasEstimatedGeometry, true, 'Debe marcar hasEstimatedGeometry=true para primitivas');
  assert.equal(primMetrics.realVertices, 0, 'No hay vértices reales en primitivas');
  assert.equal(primMetrics.estimatedVertices, 56, 'Block (8) + Cylinder (48) = 56');
  assert.equal(primMetrics.estimatedTriangles, 104, 'Block (12) + Cylinder (92) = 104');
  assert.equal(primMetrics.vertices, 56);
  assert.equal(primMetrics.triangles, 104);

  // Caso B: Malla real con quads (caras de 4 vértices) y pentágonos (caras de 5 vértices)
  const quadMeshAsset: Forge3DAsset = {
    ...primitiveAsset,
    parts: [
      {
        ...primitiveAsset.parts[0],
        meshData: {
          vertices: [
            [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], // quad 1 (4 vértices -> 2 triángulos)
            [2, 0, 0], [3, 0, 0], [3.5, 0.5, 0], [3, 1, 0], [2, 1, 0], // pentágono (5 vértices -> 3 triángulos)
          ],
          faces: [
            [0, 1, 2, 3], // Quad: 4 - 2 = 2 triángulos
            [4, 5, 6, 7, 8], // Pentágono: 5 - 2 = 3 triángulos
          ],
        },
      },
    ],
  };

  const quadMetrics = calculateAssetMetrics(quadMeshAsset);
  assert.equal(quadMetrics.hasEstimatedGeometry, false, 'Malla explícita no debe ser estimada');
  assert.equal(quadMetrics.realVertices, 9, 'Debe registrar 9 vértices reales');
  assert.equal(quadMetrics.realTriangles, 5, '1 Quad (2 tris) + 1 Pentágono (3 tris) = 5 triángulos reales');
  assert.equal(quadMetrics.triangles, 5);
});

test('3. ensureStablePartIds garantiza persistencia real ante reordenamiento y renombrado', () => {
  const parts: MeshPart3DSpec[] = [
    {
      partId: 'alpha_uuid_001',
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
      partId: 'beta_uuid_002',
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

  // Caso 3A: Reordenamiento del array de piezas
  const reorderedParts = [parts[1], parts[0]];
  const stabilizedReordered = ensureStablePartIds(reorderedParts, 'StarFighter');

  assert.equal(
    stabilizedReordered[0].partId,
    'beta_uuid_002',
    'La pieza RightWing debe mantener su ID original incluso si pasa al índice 0'
  );
  assert.equal(
    stabilizedReordered[1].partId,
    'alpha_uuid_001',
    'La pieza LeftWing debe mantener su ID original incluso si pasa al índice 1'
  );

  // Caso 3B: Renombrado de una pieza con ID existente
  const renamedParts: MeshPart3DSpec[] = [
    {
      ...parts[0],
      name: 'ReinforcedLeftWing',
    },
  ];
  const stabilizedRenamed = ensureStablePartIds(renamedParts, 'StarFighter');
  assert.equal(
    stabilizedRenamed[0].partId,
    'alpha_uuid_001',
    'Renombrar una pieza debe preservar estrictamente su partId'
  );

  // Caso 3C: Pieza nueva sin ID asignado
  const unassignedPart: MeshPart3DSpec[] = [
    {
      name: 'Cockpit',
      shape: 'Block',
      size: [1, 1, 1],
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      color: [0, 0, 0],
      material: 'Plastic',
      roughness: 0.5,
      metalness: 0,
      transparency: 0,
      canCollide: true,
      anchored: false,
      collisionFidelity: 'Box',
    },
  ];
  const assigned = ensureStablePartIds(unassignedPart, 'Ship');
  assert.ok(assigned[0].partId && assigned[0].partId.length > 5, 'Debe generar un ID persistente no vacío');
});

test('4. findMatchingPart no selecciona piezas arbitrarias si la pieza fue eliminada', () => {
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
      name: 'Window',
      hierarchyPath: 'Workspace/Castle/Window',
      shape: 'Block',
      size: [1, 1, 1],
      position: [5, 2, 0],
      rotation: [0, 0, 0],
      color: [200, 200, 200],
      material: 'Glass',
      roughness: 0.1,
      metalness: 0,
      transparency: 0.6,
      canCollide: false,
      anchored: true,
      collisionFidelity: 'Box',
    },
  ];

  // Caso 4A: Coincidencia exacta por partId
  const matchA = findMatchingPart(parts, { partId: 'id_beta', name: 'AlteredName' } as any);
  assert.equal(matchA?.partId, 'id_beta');

  // Caso 4B: Pieza eliminada que ya no existe en el array
  const deletedTarget: MeshPart3DSpec = {
    partId: 'id_deleted_turret',
    name: 'DeletedTurret',
    hierarchyPath: 'Workspace/Castle/DeletedTurret',
    shape: 'Block',
    size: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    color: [0, 0, 0],
    material: 'Wood',
    roughness: 0.5,
    metalness: 0,
    transparency: 0,
    canCollide: true,
    anchored: true,
    collisionFidelity: 'Box',
  };

  const matchDeleted = findMatchingPart(parts, deletedTarget);
  assert.equal(
    matchDeleted,
    null,
    'CRÍTICO: Si la pieza seleccionada fue eliminada, findMatchingPart debe devolver null, NO seleccionar arbitrariamente parts[0]'
  );

  // Caso 4C: Target nulo devuelve null
  assert.equal(findMatchingPart(parts, null), null);
});

test('5. Historial, Deshacer y Rehacer limpian y reactivan pendingChanges según el hash baseline', () => {
  const asset0 = createSampleAsset('InitialModel');
  const baselineHash = computeAssetContentHash(asset0);

  // Simulación del motor de estados de ForgeContext
  let currentAsset = JSON.parse(JSON.stringify(asset0)) as Forge3DAsset;
  const undoStack: Forge3DAsset[] = [];
  const redoStack: Forge3DAsset[] = [];

  const checkPendingChanges = (asset: Forge3DAsset) => {
    return computeAssetContentHash(asset) !== baselineHash;
  };

  assert.equal(checkPendingChanges(currentAsset), false, 'Inicialmente no hay cambios pendientes');

  // Operación 1: Modificar posición de la base
  undoStack.unshift(JSON.parse(JSON.stringify(currentAsset)));
  currentAsset.parts[0].position = [2, 0.5, 0];
  redoStack.length = 0;

  assert.equal(checkPendingChanges(currentAsset), true, 'Tras la operación 1, pendingChanges debe ser true');

  // Operación 2: Modificar color del cañón
  undoStack.unshift(JSON.parse(JSON.stringify(currentAsset)));
  currentAsset.parts[1].color = [255, 0, 0];
  redoStack.length = 0;

  assert.equal(checkPendingChanges(currentAsset), true, 'Tras la operación 2, pendingChanges sigue siendo true');

  // Deshacer Operación 2 (volver a Op 1)
  const prev1 = undoStack.shift()!;
  redoStack.unshift(JSON.parse(JSON.stringify(currentAsset)));
  currentAsset = prev1;

  assert.deepEqual(currentAsset.parts[1].color, [56, 189, 248], 'El color debe volver al original');
  assert.equal(checkPendingChanges(currentAsset), true, 'Aún queda la operación 1, pendingChanges sigue en true');

  // Deshacer Operación 1 (volver a estado base Inicial)
  const prev0 = undoStack.shift()!;
  redoStack.unshift(JSON.parse(JSON.stringify(currentAsset)));
  currentAsset = prev0;

  assert.deepEqual(currentAsset.parts[0].position, [0, 0.5, 0], 'La posición debe volver a [0, 0.5, 0]');
  assert.equal(
    checkPendingChanges(currentAsset),
    false,
    'CRÍTICO: Al deshacer hasta el baseline guardado, pendingChanges debe volver a false limpiamente'
  );

  // Rehacer Operación 1
  const next1 = redoStack.shift()!;
  undoStack.unshift(JSON.parse(JSON.stringify(currentAsset)));
  currentAsset = next1;

  assert.deepEqual(currentAsset.parts[0].position, [2, 0.5, 0]);
  assert.equal(checkPendingChanges(currentAsset), true, 'Al rehacer, pendingChanges vuelve a true');
});
