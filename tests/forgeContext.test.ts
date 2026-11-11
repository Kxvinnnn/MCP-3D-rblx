import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';

// Initialize DOM environment for React Testing
const domWindow = new Window();
(globalThis as any).window = domWindow;
(globalThis as any).document = domWindow.document;
(globalThis as any).localStorage = domWindow.localStorage;
(globalThis as any).performance = domWindow.performance;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Mock fetch for headless React component lifecycle without HTTP server
globalThis.fetch = (async (url: string) => {
  return {
    ok: true,
    status: 200,
    json: async () => ({ assets: [] }),
  };
}) as any;

// Import context & utilities after DOM globals are initialized
import {
  ForgeProvider,
  useForge,
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
      color_map_asset_id: 'rbxassetid://123456',
      normal_map_asset_id: 'rbxassetid://123457',
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
        renderFidelity: 'Automatic',
        doubleSided: false,
        castShadow: true,
        hierarchyPath: 'Workspace/CyberTurret/Base',
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
        renderFidelity: 'Automatic',
        doubleSided: false,
        castShadow: true,
        hierarchyPath: 'Workspace/CyberTurret/Cannon',
      },
    ],
    luau_code: '-- sample\n',
  };
}

test('1. computeAssetContentHash es exhaustivo: detecta cambios en geometría, jerarquía, PBR y físicas', () => {
  const assetA = createSampleAsset('TurretA');
  const assetB = createSampleAsset('TurretA');

  const hashA = computeAssetContentHash(assetA);
  const hashB = computeAssetContentHash(assetB);
  assert.equal(hashA, hashB, 'Dos assets idénticos deben tener exactamente el mismo hash canónico');

  // 1A. Desplazamiento de vértice interno sin cambiar el número de vértices ni caras
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
          normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
          uvs: [[0, 0], [1, 0], [0.5, 1]],
        },
      },
    ],
  };
  const originalMeshHash = computeAssetContentHash(meshAsset);

  const deformedMesh: Forge3DAsset = JSON.parse(JSON.stringify(meshAsset));
  deformedMesh.parts[0].meshData!.vertices[1][0] = 1.05; // 0.05 studs shift
  assert.notEqual(computeAssetContentHash(deformedMesh), originalMeshHash, 'Desplazar vértice debe alterar el hash');

  // 1B. Modificar normales o UVs
  const alteredNormals: Forge3DAsset = JSON.parse(JSON.stringify(meshAsset));
  alteredNormals.parts[0].meshData!.normals![0] = [0.1, 0, 0.9];
  assert.notEqual(computeAssetContentHash(alteredNormals), originalMeshHash, 'Alterar normales debe cambiar el hash');

  // 1C. Jerarquía de partes (hierarchyPath, parentName)
  const alteredHierarchy: Forge3DAsset = JSON.parse(JSON.stringify(assetA));
  alteredHierarchy.parts[0].hierarchyPath = 'Workspace/CustomGroup/Base';
  assert.notEqual(computeAssetContentHash(alteredHierarchy), hashA, 'Modificar hierarchyPath debe cambiar el hash');

  // 1D. Metadatos PBR del modelo (color_map_asset_id, normal_map_asset_id)
  const alteredPbrId: Forge3DAsset = JSON.parse(JSON.stringify(assetA));
  alteredPbrId.pbr_profile.color_map_asset_id = 'rbxassetid://999999';
  assert.notEqual(computeAssetContentHash(alteredPbrId), hashA, 'Modificar color_map_asset_id debe cambiar el hash');

  // 1E. Propiedades de renderizado de Roblox (doubleSided, renderFidelity, castShadow)
  const alteredDoubleSided: Forge3DAsset = JSON.parse(JSON.stringify(assetA));
  alteredDoubleSided.parts[0].doubleSided = true;
  assert.notEqual(computeAssetContentHash(alteredDoubleSided), hashA, 'Modificar doubleSided debe cambiar el hash');

  // 1F. Propiedades físicas (anchored, canCollide, transparency, color)
  const alteredColor: Forge3DAsset = JSON.parse(JSON.stringify(assetA));
  alteredColor.parts[0].color = [255, 10, 10];
  assert.notEqual(computeAssetContentHash(alteredColor), hashA, 'Modificar color debe cambiar el hash');

  // 1G. Data URL de textura con el mismo tamaño pero contenido distinto
  const pbrPartAsset: Forge3DAsset = {
    ...assetA,
    parts: [
      {
        ...assetA.parts[0],
        pbrMaterial: {
          albedoDataUrl: 'data:image/png;base64,AAAA',
        },
      },
    ],
  };
  const hashPbr1 = computeAssetContentHash(pbrPartAsset);
  const pbrPartAsset2: Forge3DAsset = JSON.parse(JSON.stringify(pbrPartAsset));
  pbrPartAsset2.parts[0].pbrMaterial!.albedoDataUrl = 'data:image/png;base64,BBBB';
  assert.notEqual(computeAssetContentHash(pbrPartAsset2), hashPbr1, 'Modificar el contenido de Data URL debe alterar el hash');

  // 1H. Colores por vértice (vertexColors)
  const vColorMesh: Forge3DAsset = {
    ...meshAsset,
    parts: [
      {
        ...meshAsset.parts[0],
        meshData: {
          ...meshAsset.parts[0].meshData!,
          vertexColors: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        },
      },
    ],
  };
  assert.notEqual(computeAssetContentHash(vColorMesh), originalMeshHash, 'Añadir vertexColors debe alterar el hash');

  // 1I. Matriz de rotación (rotationMatrix)
  const rotMatAsset: Forge3DAsset = JSON.parse(JSON.stringify(assetA));
  rotMatAsset.parts[0].rotationMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  assert.notEqual(computeAssetContentHash(rotMatAsset), hashA, 'Añadir rotationMatrix debe alterar el hash');

  // 1J. Precisión decimal en 4º decimal (0.0001 vs 0.0002)
  const subMMShift: Forge3DAsset = JSON.parse(JSON.stringify(assetA));
  subMMShift.parts[0].position = [0.0001, 0.5, 0];
  assert.notEqual(computeAssetContentHash(subMMShift), hashA, 'Desplazamiento sub-milimétrico (0.0001) debe cambiar el hash');
});

test('2. calculateAssetMetrics valida índices y rechaza triángulos degenerados o de área cero', () => {
  // Caso 2A: Malla con un triángulo válido no degenerado
  const validMesh: Forge3DAsset = {
    ...createSampleAsset('ValidMesh'),
    parts: [
      {
        ...createSampleAsset().parts[0],
        meshData: {
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
          ],
          faces: [[0, 1, 2]],
        },
      },
    ],
  };
  const validMetrics = calculateAssetMetrics(validMesh);
  assert.equal(validMetrics.realTriangles, 1, 'Triángulo con área no nula debe contarse como 1');
  assert.equal(validMetrics.hasEstimatedGeometry, false);

  // Caso 2B: Malla con cara degenerada de área cero (vértices colineales [0,0,0], [1,0,0], [2,0,0])
  const zeroAreaMesh: Forge3DAsset = {
    ...createSampleAsset('ZeroAreaMesh'),
    parts: [
      {
        ...createSampleAsset().parts[0],
        meshData: {
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [2, 0, 0], // Colineal: producto cruz nulo, área cero
          ],
          faces: [[0, 1, 2]],
        },
      },
    ],
  };
  const zeroAreaMetrics = calculateAssetMetrics(zeroAreaMesh);
  assert.equal(zeroAreaMetrics.realTriangles, 0, 'Caras con área geométrica nula (colineales) no deben sumar triángulos');

  // Caso 2C: Malla con índices fuera de límites (índice 999 cuando sólo hay 3 vértices)
  const outOfBoundsMesh: Forge3DAsset = {
    ...createSampleAsset('OutOfBoundsMesh'),
    parts: [
      {
        ...createSampleAsset().parts[0],
        meshData: {
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
          ],
          faces: [[0, 1, 999]], // Índice inválido
        },
      },
    ],
  };
  const oobMetrics = calculateAssetMetrics(outOfBoundsMesh);
  assert.equal(oobMetrics.realTriangles, 0, 'Caras con índices fuera de límites deben ser rechazadas');

  // Caso 2D: Polígonos de 4 (quad) y 5 vértices (pentágono)
  const polygonMesh: Forge3DAsset = {
    ...createSampleAsset('PolygonMesh'),
    parts: [
      {
        ...createSampleAsset().parts[0],
        meshData: {
          vertices: [
            [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], // Quad (4 verts -> 2 tris)
            [2, 0, 0], [3, 0, 0], [3.5, 0.5, 0], [3, 1, 0], [2, 1, 0], // Pentágono (5 verts -> 3 tris)
          ],
          faces: [
            [0, 1, 2, 3],
            [4, 5, 6, 7, 8],
          ],
        },
      },
    ],
  };
  const polyMetrics = calculateAssetMetrics(polygonMesh);
  assert.equal(polyMetrics.realTriangles, 5, '1 Quad (2 tris) + 1 Pentágono (3 tris) = 5 triángulos reales');
});

test('3. ensureStablePartIds y findMatchingPart aseguran persistencia y no seleccionan piezas arbitrarias', () => {
  const parts: MeshPart3DSpec[] = [
    {
      partId: 'id_alpha_left',
      name: 'LeftThrust',
      shape: 'Block',
      size: [1, 2, 1],
      position: [-2, 0, 0],
      rotation: [0, 0, 0],
      color: [100, 100, 100],
      material: 'Metal',
      roughness: 0.3,
      metalness: 0.8,
      transparency: 0,
      canCollide: true,
      anchored: true,
      collisionFidelity: 'Box',
    },
    {
      partId: 'id_beta_right',
      name: 'RightThrust',
      shape: 'Block',
      size: [1, 2, 1],
      position: [2, 0, 0],
      rotation: [0, 0, 0],
      color: [100, 100, 100],
      material: 'Metal',
      roughness: 0.3,
      metalness: 0.8,
      transparency: 0,
      canCollide: true,
      anchored: true,
      collisionFidelity: 'Box',
    },
  ];

  // Invertir orden del array
  const reversed = [parts[1], parts[0]];
  const stabilized = ensureStablePartIds(reversed, 'Spaceship');
  assert.equal(stabilized[0].partId, 'id_beta_right', 'RightThrust conserva su ID');
  assert.equal(stabilized[1].partId, 'id_alpha_left', 'LeftThrust conserva su ID');

  // Búsqueda de pieza eliminada
  const deletedTarget: MeshPart3DSpec = {
    ...parts[0],
    partId: 'id_deleted_cockpit',
    name: 'Cockpit',
  };
  const matchResult = findMatchingPart(parts, deletedTarget);
  assert.equal(matchResult, null, 'Pieza eliminada debe devolver null, nunca la primera pieza arbitrariamente');
});

test('4. EJECUCIÓN REAL DE REACT FORGECONTEXT: prueba de estado, confirmSwitchDiscard y reversión real al snapshot', async () => {
  let contextValue: any = null;

  // Componente consumidor para extraer la instancia del contexto React en vivo
  function ContextInspector() {
    contextValue = useForge();
    return React.createElement('div', { id: 'inspector' }, contextValue.activeAsset?.name || 'none');
  }

  const container = domWindow.document.createElement('div');
  const root = createRoot(container as unknown as Element);

  // Montar ForgeProvider y el consumidor
  await act(async () => {
    root.render(
      React.createElement(
        ForgeProvider,
        null,
        React.createElement(ContextInspector)
      )
    );
  });

  assert.ok(contextValue, 'El hook useForge debe inicializarse correctamente en React');

  const baselineAsset = createSampleAsset('TankHero');

  // 1. Cargar asset inicial en el contexto
  await act(async () => {
    contextValue.setActiveAsset(baselineAsset);
  });

  assert.equal(contextValue.activeAsset.name, 'TankHero');
  assert.equal(contextValue.pendingChanges, false, 'Al cargar el asset inicial, pendingChanges debe ser false');

  const initialPartColor = contextValue.activeAsset.parts[0].color;
  assert.deepEqual(initialPartColor, [6, 182, 212]);

  // 2. Modificar el modelo aplicando una operación (cambiar color a rojo)
  const modifiedAsset: Forge3DAsset = {
    ...contextValue.activeAsset,
    parts: contextValue.activeAsset.parts.map((p: any, idx: number) =>
      idx === 0 ? { ...p, color: [255, 0, 0] } : p
    ),
  };

  await act(async () => {
    contextValue.applyAssetChange(modifiedAsset, 'Modificar color de base a rojo');
  });

  assert.equal(contextValue.pendingChanges, true, 'Tras la modificación en memoria, pendingChanges debe ser true');
  assert.deepEqual(contextValue.activeAsset.parts[0].color, [255, 0, 0]);

  // 3. Probar Deshacer (undo)
  await act(async () => {
    contextValue.undo();
  });

  assert.deepEqual(
    contextValue.activeAsset.parts[0].color,
    [6, 182, 212],
    'Undo debe restaurar el color al baseline'
  );
  assert.equal(
    contextValue.pendingChanges,
    false,
    'Undo hasta el baseline debe regresar pendingChanges a false en React'
  );

  // 4. Probar Rehacer (redo)
  await act(async () => {
    contextValue.redo();
  });

  assert.deepEqual(contextValue.activeAsset.parts[0].color, [255, 0, 0], 'Redo debe restaurar la modificación');
  assert.equal(contextValue.pendingChanges, true, 'Al rehacer, pendingChanges vuelve a true');

  // 5. CRÍTICO: confirmSwitchDiscard() debe revertir realmente el modelo en memoria al snapshot persistido
  await act(async () => {
    contextValue.confirmSwitchDiscard();
  });

  assert.equal(
    contextValue.pendingChanges,
    false,
    'confirmSwitchDiscard debe limpiar pendingChanges a false'
  );
  assert.deepEqual(
    contextValue.activeAsset.parts[0].color,
    [6, 182, 212],
    'CRÍTICO: confirmSwitchDiscard debe restaurar el modelo en memoria a su snapshot guardado original'
  );

  // Limpiar árbol de React
  await act(async () => {
    root.unmount();
  });
});
