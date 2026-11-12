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
globalThis.fetch = (async (_url: string) => {
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

  function ContextInspector() {
    contextValue = useForge();
    return React.createElement('div', { id: 'inspector' }, contextValue.activeAsset?.name || 'none');
  }

  const container = domWindow.document.createElement('div');
  const root = createRoot(container as unknown as Element);

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

  await act(async () => {
    root.unmount();
  });
});

test('5. Guardias de setActiveAsset: cambio a otro recurso, cambio a null y recarga de otra versión del mismo recurso con cambios pendientes', async () => {
  const { getAssetIdentityKey } = await import('../src/utils/canonicalHash.ts');

  const assetA = createSampleAsset('Turret');
  assetA.rojo_target_folder = 'src/shared/weapons';
  assetA.file_name = 'TurretWeapons.luau';

  const assetB = createSampleAsset('Turret');
  assetB.rojo_target_folder = 'src/shared/decorations';
  assetB.file_name = 'TurretDeco.luau';

  assert.notEqual(getAssetIdentityKey(assetA), getAssetIdentityKey(assetB));

  let contextValue: any = null;
  function TestInspector() {
    contextValue = useForge();
    return React.createElement('div', null, contextValue.activeAsset?.name);
  }

  const container = domWindow.document.createElement('div');
  const root = createRoot(container as unknown as Element);

  await act(async () => {
    root.render(React.createElement(ForgeProvider, null, React.createElement(TestInspector)));
  });

  await act(async () => {
    contextValue.setActiveAsset(assetA);
  });

  await act(async () => {
    contextValue.applyAssetChange(
      { ...contextValue.activeAsset, parts: [{ ...contextValue.activeAsset.parts[0], color: [0, 255, 0] }] },
      'Modificar color en asset A'
    );
  });

  assert.equal(contextValue.pendingChanges, true);

  // 5A. Intentar cambiar a null (cerrar modelo activo) mientras hay cambios pendientes
  await act(async () => {
    contextValue.setActiveAsset(null);
  });
  assert.equal(
    contextValue.showUnsavedModal,
    true,
    'setActiveAsset(null) con cambios pendientes debe abrir el modal y no borrar el modelo sin confirmación'
  );
  assert.ok(contextValue.activeAsset, 'El modelo activo debe seguir cargado hasta confirmar');

  await act(async () => {
    contextValue.cancelSwitch();
  });
  assert.equal(contextValue.showUnsavedModal, false);

  // 5B. Intentar cargar una versión distinta del MISMO recurso (misma identidad pero contenido distinto, ej. original sin editar)
  await act(async () => {
    contextValue.setActiveAsset(assetA);
  });
  assert.equal(
    contextValue.showUnsavedModal,
    true,
    'Cargar otra versión del mismo recurso con cambios pendientes debe abrir el modal y no sobrescribir silenciosamente'
  );
  assert.deepEqual(
    contextValue.activeAsset.parts[0].color,
    [0, 255, 0],
    'Los cambios locales se mantienen protegidos'
  );

  await act(async () => {
    contextValue.cancelSwitch();
  });

  // 5C. Intentar cambiar a otro recurso con el mismo nombre pero distinta ruta/identidad
  await act(async () => {
    contextValue.setActiveAsset(assetB);
  });
  assert.equal(contextValue.showUnsavedModal, true);

  await act(async () => {
    root.unmount();
  });
});

test('6. Recuperación de borradores locales (recoverDraft) y detección de conflicto cuando baseHash difiere del modelo guardado actual', async () => {
  let contextValue: any = null;
  function DraftInspector() {
    contextValue = useForge();
    return React.createElement('div', null, contextValue.activeAsset?.name);
  }

  // Caso 6A: Recuperación normal cuando baseHash coincide con la versión guardada
  const savedVersion = createSampleAsset('RecoveredDraft');
  const savedHash = computeAssetContentHash(savedVersion);

  const draftAsset = createSampleAsset('RecoveredDraft');
  draftAsset.parts[0].color = [99, 88, 77];

  domWindow.localStorage.setItem(
    'forge_active_draft',
    JSON.stringify({
      asset: draftAsset,
      timestamp: Date.now(),
      baseHash: savedHash,
      baseAsset: savedVersion,
    })
  );

  const container = domWindow.document.createElement('div');
  const root = createRoot(container as unknown as Element);

  await act(async () => {
    root.render(React.createElement(ForgeProvider, null, React.createElement(DraftInspector)));
  });

  assert.equal(contextValue.hasRecoverableDraft, true, 'Debe detectar el borrador en localStorage');

  await act(async () => {
    contextValue.recoverDraft();
  });

  assert.equal(contextValue.activeAsset.name, 'RecoveredDraft');
  assert.deepEqual(contextValue.activeAsset.parts[0].color, [99, 88, 77]);
  assert.equal(contextValue.pendingChanges, true, 'El borrador recuperado debe marcarse con cambios pendientes');
  assert.equal(contextValue.activeConflict, null, 'No debe haber conflicto cuando baseHash coincide');

  // Caso 6B: Si el modelo guardado cambió respecto al baseHash del borrador, recoverDraft() debe señalar conflicto
  const newerSavedVersion = createSampleAsset('RecoveredDraft');
  newerSavedVersion.parts[0].color = [10, 20, 30]; // Versión guardada más reciente en servidor/sesión

  await act(async () => {
    contextValue.setActiveAsset(newerSavedVersion, true);
  });

  // El borrador en localStorage tenía baseHash antiguo (savedHash) distinto al de newerSavedVersion
  domWindow.localStorage.setItem(
    'forge_active_draft',
    JSON.stringify({
      asset: draftAsset,
      timestamp: Date.now(),
      baseHash: savedHash, // Hash antiguo
      baseAsset: savedVersion,
    })
  );

  await act(async () => {
    contextValue.recoverDraft();
  });

  assert.ok(
    contextValue.activeConflict,
    'recoverDraft debe activar activeConflict cuando baseHash del borrador difiere de la versión guardada actual'
  );
  assert.equal(contextValue.currentSyncStatus.state, 'conflict');
  assert.deepEqual(contextValue.activeConflict.localAsset.parts[0].color, [99, 88, 77]);
  assert.deepEqual(contextValue.activeConflict.remoteAsset.parts[0].color, [10, 20, 30]);

  // Caso 6C: Si el borrador no tiene base verificable (no existe modelo guardado en sesión/librería ni baseAsset válido), NO debe aceptarse silenciosamente
  await act(async () => {
    await contextValue.resolveConflict('accept_remote');
    contextValue.setActiveAsset(null, true);
  });

  const orphanDraft = createSampleAsset('OrphanModelWithNoKnownBase');
  domWindow.localStorage.setItem(
    'forge_active_draft',
    JSON.stringify({
      asset: orphanDraft,
      timestamp: Date.now(),
      baseHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      // Sin baseAsset y sin versión guardada en assetLibrary
    })
  );

  await act(async () => {
    contextValue.recoverDraft();
  });

  assert.ok(
    contextValue.activeConflict,
    'recoverDraft DEBE señalar conflicto cuando la base del borrador no puede verificarse contra ningún modelo guardado'
  );
  assert.equal(contextValue.currentSyncStatus.state, 'conflict');

  await act(async () => {
    root.unmount();
  });
});

test('7. Detección y resolución real de conflictos local vs remoto (keep_local persiste al backend, accept_remote adopta remoto)', async () => {
  let contextValue: any = null;
  function ConflictInspector() {
    contextValue = useForge();
    return React.createElement('div', null, contextValue.activeAsset?.name);
  }

  const container = domWindow.document.createElement('div');
  const root = createRoot(container as unknown as Element);

  await act(async () => {
    root.render(React.createElement(ForgeProvider, null, React.createElement(ConflictInspector)));
  });

  const baseAsset = createSampleAsset('ConflictModel');
  await act(async () => {
    contextValue.setActiveAsset(baseAsset);
  });

  // 1. Modificación local (cambia color a verde)
  await act(async () => {
    contextValue.applyAssetChange(
      { ...contextValue.activeAsset, parts: [{ ...contextValue.activeAsset.parts[0], color: [0, 255, 0] }, contextValue.activeAsset.parts[1]] },
      'Edición local'
    );
  });
  assert.equal(contextValue.pendingChanges, true);

  // 2. Simular respuesta de Studio donde el modelo remoto cambió en Studio (color azul)
  const remoteAsset = JSON.parse(JSON.stringify(baseAsset));
  remoteAsset.parts[0].color = [0, 0, 255];

  let rebuildCalledWithAsset: any = null;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: any) => {
    if (url.includes('/api/v1/assets/pull-from-rojo')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, asset: remoteAsset }),
      };
    }
    if (url.includes('/api/v1/assets/rebuild-luau')) {
      const body = JSON.parse(init.body);
      rebuildCalledWithAsset = body.asset;
      return {
        ok: true,
        status: 200,
        json: async () => ({ asset: body.asset }),
      };
    }
    return origFetch(url);
  }) as any;

  // 3. Ejecutar pull: Debe detectar conflicto en lugar de sobrescribir silenciosamente
  await act(async () => {
    const result = await contextValue.pullFromStudio();
    assert.equal(result.success, false);
  });

  assert.equal(contextValue.currentSyncStatus.state, 'conflict', 'El estado de sincronización debe ser conflict');
  assert.ok(contextValue.activeConflict, 'activeConflict debe estar poblado con ambas versiones');

  // 4. Resolver conflicto eligiendo versión local: debe persistir/sincronizar en backend
  await act(async () => {
    const resolved = await contextValue.resolveConflict('keep_local');
    assert.equal(resolved, true, 'resolveConflict(keep_local) debe persistir con éxito');
  });

  assert.ok(rebuildCalledWithAsset, 'resolveConflict(keep_local) DEBE enviar la versión local al backend');
  assert.deepEqual(rebuildCalledWithAsset.parts[0].color, [0, 255, 0]);
  assert.equal(contextValue.activeConflict, null, 'Conflicto cerrado tras persistencia exitosa');
  assert.equal(contextValue.pendingChanges, false, 'Tras persistir la versión local, pendingChanges queda en false');

  globalThis.fetch = origFetch;

  await act(async () => {
    root.unmount();
  });
});

test('8. Verificación exhaustiva de persistencia (verifyPersistedAssetContent) y recibo verificable de Roblox Studio en pushToStudio', async () => {
  const { verifyPersistedAssetContent, verifyStudioApplicationReceipt } = await import('../src/context/ForgeContext.tsx');

  // 8.1 Prueba unitaria directa de verifyPersistedAssetContent: rechaza piezas extra inexplicables
  const reqAsset = createSampleAsset('SplitCheckModel');
  const withUnexpectedExtra: Forge3DAsset = JSON.parse(JSON.stringify(reqAsset));
  withUnexpectedExtra.parts.push({
    ...reqAsset.parts[0],
    partId: 'part_unexpected_injected',
    name: 'InjectedExtraPart',
  });
  const extraCheck = verifyPersistedAssetContent(reqAsset, withUnexpectedExtra);
  assert.equal(
    extraCheck.valid,
    false,
    'verifyPersistedAssetContent debe rechazar piezas adicionales cuando ninguna pieza original superaba el límite de subdivisión'
  );

  // 8.2 Prueba unitaria de subdivisión legítima (_Sub1, _Sub2) cuando una pieza supera >9500 caras
  const largeFaces: number[][] = [];
  for (let i = 0; i < 9600; i++) {
    largeFaces.push([0, 1, 2]);
  }
  const oversizedAsset: Forge3DAsset = {
    ...createSampleAsset('OversizedMeshAsset'),
    parts: [
      {
        ...reqAsset.parts[0],
        partId: 'hull_heavy',
        name: 'HeavyHull',
        meshData: {
          vertices: [
            [0, 0, 0],
            [2, 0, 0],
            [0, 2, 0],
          ],
          faces: largeFaces,
        },
      },
    ],
  };
  const legitimateSplitAsset: Forge3DAsset = {
    ...oversizedAsset,
    parts: [
      {
        ...oversizedAsset.parts[0],
        partId: 'hull_heavy_Sub1',
        name: 'HeavyHull_Sub1',
        meshData: {
          vertices: [
            [0, 0, 0],
            [2, 0, 0],
            [0, 2, 0],
          ],
          faces: largeFaces.slice(0, 5000),
        },
      },
      {
        ...oversizedAsset.parts[0],
        partId: 'hull_heavy_Sub2',
        name: 'HeavyHull_Sub2',
        meshData: {
          vertices: [
            [0, 0, 0],
            [2, 0, 0],
            [0, 2, 0],
          ],
          faces: largeFaces.slice(5000),
        },
      },
    ],
  };
  const splitCheck = verifyPersistedAssetContent(oversizedAsset, legitimateSplitAsset);
  assert.equal(
    splitCheck.valid,
    true,
    `verifyPersistedAssetContent debe aceptar subdivisiones _SubN legítimas que conservan el conteo exacto de caras (${splitCheck.reason || 'ok'})`
  );

  // 8.3 Integración en ForgeContext
  let contextValue: any = null;
  function SyncInspector() {
    contextValue = useForge();
    return React.createElement('div', null, contextValue.activeAsset?.name);
  }

  const container = domWindow.document.createElement('div');
  const root = createRoot(container as unknown as Element);

  await act(async () => {
    root.render(React.createElement(ForgeProvider, null, React.createElement(SyncInspector)));
  });

  const model = createSampleAsset('VerifiedTank');
  await act(async () => {
    contextValue.setActiveAsset(model);
  });

  await act(async () => {
    contextValue.applyAssetChange(
      {
        ...contextValue.activeAsset,
        parts: [
          { ...contextValue.activeAsset.parts[0], color: [200, 100, 50] },
          contextValue.activeAsset.parts[1],
        ],
      },
      'Cambiar color para prueba de guardado'
    );
  });
  assert.equal(contextValue.pendingChanges, true);

  const origFetch = globalThis.fetch;

  // 8A. Si el servidor devuelve un modelo cuyo contenido no coincide con el enviado, saveAssetToDisk debe rechazarlo y conservar pendingChanges = true
  globalThis.fetch = (async (url: string, init?: any) => {
    if (url.includes('/api/v1/assets/rebuild-luau')) {
      const sent = JSON.parse(init.body).asset;
      const corrupted = JSON.parse(JSON.stringify(sent));
      corrupted.parts[0].color = [0, 0, 0]; // Servidor alteró el color indebidamente
      return {
        ok: true,
        status: 200,
        json: async () => ({ asset: corrupted }),
      };
    }
    return origFetch(url);
  }) as any;

  await act(async () => {
    const saved = await contextValue.saveAssetToDisk(true);
    assert.equal(saved, false, 'saveAssetToDisk debe retornar false si el servidor devuelve contenido alterado');
  });
  assert.equal(
    contextValue.pendingChanges,
    true,
    'pendingChanges debe mantenerse en true cuando la verificación del modelo devuelto falla'
  );

  // 8B. En pushToStudio, si la tarea queda en cola (queued) en el puente, NO debe marcarse como aplicada ni limpiar prematuramente pendingChanges
  globalThis.fetch = (async (url: string, init?: any) => {
    if (url.includes('/api/v1/assets/rebuild-luau')) {
      const sent = JSON.parse(init.body).asset;
      return {
        ok: true,
        status: 200,
        json: async () => ({ asset: sent }),
      };
    }
    if (url.includes('/api/v1/bridge/enqueue')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ taskId: 'task-queued-1', status: 'queued' }),
      };
    }
    return origFetch(url);
  }) as any;

  await act(async () => {
    const pushRes = await contextValue.pushToStudio();
    assert.equal(pushRes.success, false);
    assert.equal(pushRes.appliedInStudio, false);
  });
  assert.equal(contextValue.currentSyncStatus.state, 'awaiting_studio');
  assert.equal(
    contextValue.pendingChanges,
    true,
    'pushToStudio NO debe limpiar pendingChanges cuando la operación apenas quedó en cola y no fue confirmada por Studio'
  );

  // 8C. Si Studio reporta completed pero SIN recibo verificable (sin appliedPartCount ni modelHash), pushToStudio debe rechazarlo
  globalThis.fetch = (async (url: string, init?: any) => {
    if (url.includes('/api/v1/assets/rebuild-luau')) {
      const sent = JSON.parse(init.body).asset;
      return {
        ok: true,
        status: 200,
        json: async () => ({ asset: sent }),
      };
    }
    if (url.includes('/api/v1/bridge/enqueue')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          taskId: 'task-unverified-receipt',
          status: 'completed',
          result: { status: 'ok', details: 'Missing partCount and modelHash' },
        }),
      };
    }
    return origFetch(url);
  }) as any;

  await act(async () => {
    const pushRes = await contextValue.pushToStudio();
    assert.equal(pushRes.success, false, 'Debe rechazar respuestas completed que carezcan de recibo verificable');
    assert.equal(pushRes.appliedInStudio, false);
  });
  assert.equal(contextValue.currentSyncStatus.state, 'error');
  assert.equal(contextValue.pendingChanges, true);

  // 8D. Cuando Studio confirma completed CON recibo verificable (operationId, appliedPartCount y modelHash exactos), actualiza el baseline y limpia pendingChanges
  globalThis.fetch = (async (url: string, init?: any) => {
    if (url.includes('/api/v1/assets/rebuild-luau')) {
      const sent = JSON.parse(init.body).asset;
      return {
        ok: true,
        status: 200,
        json: async () => ({ asset: sent }),
      };
    }
    if (url.includes('/api/v1/bridge/enqueue')) {
      const enqueueBody = JSON.parse(init.body);
      const payload = enqueueBody.payload;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          taskId: 'task-completed-verified',
          status: 'completed',
          result: {
            taskId: 'task-completed-verified',
            operationId: 'task-completed-verified',
            status: 'completed',
            verified: true,
            modelName: payload.name,
            expectedPartCount: payload.parts.length,
            actualPartCount: payload.parts.length,
            expectedModelHash: payload.model_hash,
            appliedModelHash: payload.model_hash,
            verifiedGeometryPartIds: payload.parts.map((p: any) => p.partId),
            failedPartIds: [],
            pendingDeletionPartIds: [],
          },
        }),
      };
    }
    return origFetch(url);
  }) as any;

  await act(async () => {
    const pushRes = await contextValue.pushToStudio();
    assert.equal(pushRes.success, true);
    assert.equal(pushRes.appliedInStudio, true);
  });
  assert.equal(contextValue.currentSyncStatus.state, 'applied_successfully');
  assert.equal(
    contextValue.pendingChanges,
    false,
    'pushToStudio limpia pendingChanges únicamente tras verificar el recibo completo de Roblox Studio'
  );

  // Verificar directamente verifyStudioApplicationReceipt ante discrepancia de modelHash
  const mismatchCheck = verifyStudioApplicationReceipt(
    {
      taskId: 'task-1',
      status: 'completed',
      result: {
        status: 'ok',
        operationId: 'task-1',
        appliedPartCount: contextValue.activeAsset.parts.length,
        modelHash: 'bad_hash_0000',
      },
    },
    'task-1',
    contextValue.activeAsset,
    computeAssetContentHash(contextValue.activeAsset)
  );
  assert.equal(mismatchCheck.valid, false);

  globalThis.fetch = origFetch;

  await act(async () => {
    root.unmount();
  });
});

test('9. Ciclo E2E completo: Crear modelo -> Asignar IDs persistentes -> Editar (añadir, modificar, eliminar piezas) -> Guardar -> Recuperar -> Sincronizar incrementalmente con Studio', async () => {
  let contextValue: any = null;
  function E2EInspector() {
    contextValue = useForge();
    return React.createElement('div', null, contextValue.activeAsset?.name);
  }

  const container = domWindow.document.createElement('div');
  const root = createRoot(container as unknown as Element);

  await act(async () => {
    root.render(React.createElement(ForgeProvider, null, React.createElement(E2EInspector)));
  });

  // Paso 1: Crear un modelo cuyas piezas inicialmente no tienen partId
  const rawCreatedModel: Forge3DAsset = {
    ...createSampleAsset('MechWalkerE2E'),
    parts: [
      {
        ...createSampleAsset().parts[0],
        partId: undefined,
        name: 'Chassis',
        hierarchyPath: 'Workspace/MechWalkerE2E/Chassis',
      },
      {
        ...createSampleAsset().parts[1],
        partId: undefined,
        name: 'LeftCannon',
        hierarchyPath: 'Workspace/MechWalkerE2E/LeftCannon',
      },
    ],
  };

  const origFetch = globalThis.fetch;
  let lastBridgePayload: any = null;

  globalThis.fetch = (async (url: string, init?: any) => {
    if (url.includes('/api/v1/assets/rebuild-luau')) {
      const sent = JSON.parse(init.body).asset;
      return {
        ok: true,
        status: 200,
        json: async () => ({ asset: sent }),
      };
    }
    if (url.includes('/api/v1/bridge/enqueue')) {
      const body = JSON.parse(init.body);
      lastBridgePayload = body.payload;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          taskId: 'task-e2e-sync-1',
          status: 'completed',
          result: {
            taskId: 'task-e2e-sync-1',
            operationId: 'task-e2e-sync-1',
            status: 'completed',
            verified: true,
            modelName: body.payload.name,
            expectedPartCount: body.payload.parts.length,
            actualPartCount: body.payload.parts.length,
            expectedModelHash: body.payload.model_hash,
            appliedModelHash: body.payload.model_hash,
            verifiedGeometryPartIds: body.payload.parts.map((p: any) => p.partId),
            failedPartIds: [],
            pendingDeletionPartIds: [],
          },
        }),
      };
    }
    return origFetch(url);
  }) as any;

  // Cargar modelo inicial: debe generar y persistir partIds deterministas automáticamente
  await act(async () => {
    contextValue.setActiveAsset(rawCreatedModel);
  });

  const chassisId = contextValue.activeAsset.parts[0].partId;
  const leftCannonId = contextValue.activeAsset.parts[1].partId;
  assert.ok(chassisId && chassisId.startsWith('pid_'), 'Chassis debe recibir un partId persistente');
  assert.ok(leftCannonId && leftCannonId.startsWith('pid_'), 'LeftCannon debe recibir un partId persistente');
  assert.notEqual(chassisId, leftCannonId);

  // Paso 2: Guardar el modelo base en disco
  await act(async () => {
    const saved = await contextValue.saveAssetToDisk(true);
    assert.equal(saved, true);
  });
  assert.equal(contextValue.pendingChanges, false);

  // Paso 3: Editar el modelo (Modificar Chassis, Eliminar LeftCannon, Añadir RightMissilePod)
  const editedModel: Forge3DAsset = {
    ...contextValue.activeAsset,
    parts: [
      {
        ...contextValue.activeAsset.parts[0], // Chassis modificado en color y posición
        color: [255, 128, 0],
        position: [0, 1.5, 0],
      },
      // LeftCannon eliminado
      {
        partId: 'part_missile_pod_new',
        name: 'RightMissilePod',
        shape: 'Block',
        size: [2, 2, 3],
        position: [3, 3, 0],
        rotation: [0, 0, 0],
        color: [40, 40, 40],
        material: 'Metal',
        roughness: 0.3,
        metalness: 0.85,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Box',
        hierarchyPath: 'Workspace/MechWalkerE2E/RightMissilePod',
      },
    ],
  };

  await act(async () => {
    contextValue.applyAssetChange(editedModel, 'Modificar Chassis, eliminar LeftCannon y añadir RightMissilePod');
  });
  assert.equal(contextValue.pendingChanges, true);

  // Paso 4: Sincronizar con Roblox Studio y verificar el diff incremental enviado + recibo confirmado
  await act(async () => {
    const pushRes = await contextValue.pushToStudio();
    assert.equal(pushRes.success, true);
    assert.equal(pushRes.appliedInStudio, true);
  });

  assert.ok(lastBridgePayload, 'El puente debe haber recibido el payload de sincronización');
  assert.ok(lastBridgePayload.incremental_diff, 'El payload debe incluir incremental_diff');
  assert.equal(lastBridgePayload.incremental_diff.added.length, 1, 'Debe reportar 1 pieza añadida (RightMissilePod)');
  assert.equal(lastBridgePayload.incremental_diff.added[0].partId, 'part_missile_pod_new');
  assert.equal(lastBridgePayload.incremental_diff.removed.length, 1, 'Debe reportar 1 pieza eliminada (LeftCannon)');
  assert.equal(lastBridgePayload.incremental_diff.removed[0].partId, leftCannonId);
  assert.equal(lastBridgePayload.incremental_diff.modified.length, 1, 'Debe reportar 1 pieza modificada (Chassis)');
  assert.equal(lastBridgePayload.incremental_diff.modified[0].partId, chassisId);

  assert.equal(contextValue.currentSyncStatus.state, 'applied_successfully');
  assert.equal(contextValue.pendingChanges, false);

  globalThis.fetch = origFetch;

  await act(async () => {
    root.unmount();
  });
});

test('10. Fase 2, 3 & 5 — Recibo estructurado StudioApplicationReceipt: aplicación parcial, contenedor fallback no verificado y ciclo de confirmación/cancelación destructiva', async () => {
  const { verifyStudioApplicationReceipt } = await import('../src/context/ForgeContext.tsx');
  const asset = createSampleAsset('StructuredReceiptModel');
  const expectedHash = computeAssetContentHash(asset);

  // 10A. Regla B/C: Si failedPartIds contiene una pieza o verifiedGeometryPartIds no incluye todas las piezas (ej. fallback container), el recibo NUNCA es completed
  const fallbackReceiptCheck = verifyStudioApplicationReceipt(
    {
      taskId: 'task-fallback-1',
      status: 'completed',
      result: {
        operationId: 'task-fallback-1',
        taskId: 'task-fallback-1',
        status: 'completed',
        verified: true,
        modelName: asset.name,
        expectedModelHash: expectedHash,
        appliedModelHash: expectedHash,
        expectedPartCount: 2,
        actualPartCount: 2,
        verifiedGeometryPartIds: ['part_base_fixed'], // Falta 'part_cannon_fixed' (quedó como UnverifiedFallbackContainer)
        failedPartIds: [],
        pendingDeletionPartIds: [],
      },
    },
    'task-fallback-1',
    asset,
    expectedHash
  );
  assert.equal(fallbackReceiptCheck.valid, false);
  assert.equal(
    fallbackReceiptCheck.status,
    'partially_applied',
    'Un contenedor fallback sin geometría verificada debe clasificarse como partially_applied y jamás como completed'
  );

  // 10B. Ciclo completo en ForgeContext: awaiting_confirmation -> cancelación (partially_applied) -> confirmación (completed)
  let contextValue: any = null;
  function DestructiveSyncInspector() {
    contextValue = useForge();
    return React.createElement('div', null, contextValue.activeAsset?.name);
  }

  const container = domWindow.document.createElement('div');
  const root = createRoot(container as unknown as Element);

  await act(async () => {
    root.render(React.createElement(ForgeProvider, null, React.createElement(DestructiveSyncInspector)));
  });

  await act(async () => {
    contextValue.setActiveAsset(asset);
  });

  // Eliminar una pieza localmente ('part_cannon_fixed')
  const assetAfterDelete: Forge3DAsset = {
    ...contextValue.activeAsset,
    parts: [contextValue.activeAsset.parts[0]],
  };
  await act(async () => {
    contextValue.applyAssetChange(assetAfterDelete, 'Eliminar cañón');
  });
  assert.equal(contextValue.pendingChanges, true);

  const origFetch = globalThis.fetch;
  let mockTaskEndpointResponse: any = null;
  let nextEnqueueTaskId = 'task-destructive-del-99';

  globalThis.fetch = (async (url: string, init?: any) => {
    if (url.includes('/api/v1/assets/rebuild-luau')) {
      const sent = JSON.parse(init.body).asset;
      return {
        ok: true,
        status: 200,
        json: async () => ({ asset: sent }),
      };
    }
    if (url.includes('/api/v1/bridge/enqueue')) {
      const body = JSON.parse(init.body);
      const currentTaskId = nextEnqueueTaskId;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          taskId: currentTaskId,
          status: 'awaiting_studio_confirmation',
          result: {
            operationId: currentTaskId,
            taskId: currentTaskId,
            status: 'awaiting_confirmation',
            verified: false,
            modelName: body.payload.name,
            expectedModelHash: body.payload.model_hash,
            appliedModelHash: 'pending_readback_hash',
            expectedPartCount: 1,
            actualPartCount: 2,
            addedPartIds: [],
            updatedPartIds: [],
            removedPartIds: [],
            pendingDeletionPartIds: ['part_cannon_fixed'],
            failedPartIds: [],
            verifiedGeometryPartIds: ['part_base_fixed'],
            warnings: ['Eliminación destructiva pendiente de confirmación en Roblox Studio'],
            errors: [],
          },
        }),
      };
    }
    if (url.includes('/api/v1/bridge/task/')) {
      return {
        ok: true,
        status: 200,
        json: async () => mockTaskEndpointResponse,
      };
    }
    return origFetch(url);
  }) as any;

  // Paso 1: pushToStudio recibe awaiting_confirmation -> estado awaiting_studio y pendingChanges permanece true
  await act(async () => {
    const pushRes = await contextValue.pushToStudio();
    assert.equal(pushRes.success, false);
    assert.equal(pushRes.appliedInStudio, false);
    assert.equal(pushRes.taskId, 'task-destructive-del-99');
  });
  assert.equal(contextValue.currentSyncStatus.state, 'awaiting_studio');
  assert.equal(
    contextValue.pendingChanges,
    true,
    'Mientras haya eliminaciones destructivas pendientes en Studio, pendingChanges NO debe limpiarse'
  );

  // Paso 2: Usuario CANCELA la eliminación en Roblox Studio -> el recibo pasa a partially_applied
  mockTaskEndpointResponse = {
    taskId: 'task-destructive-del-99',
    status: 'partially_applied',
    result: {
      operationId: 'task-destructive-del-99',
      taskId: 'task-destructive-del-99',
      status: 'partially_applied',
      verified: false,
      modelName: assetAfterDelete.name,
      expectedModelHash: computeAssetContentHash(assetAfterDelete),
      appliedModelHash: expectedHash, // En Studio siguen las 2 piezas originales
      expectedPartCount: 1,
      actualPartCount: 2,
      addedPartIds: [],
      updatedPartIds: [],
      removedPartIds: [],
      pendingDeletionPartIds: [],
      failedPartIds: ['part_cannon_fixed'],
      verifiedGeometryPartIds: ['part_base_fixed'],
      warnings: [],
      errors: ['Eliminación destructiva cancelada por el usuario en Roblox Studio.'],
    },
  };

  await act(async () => {
    const recCancel = await contextValue.reconcileStudioTaskReceipt('task-destructive-del-99');
    assert.equal(recCancel.success, false);
    assert.equal(recCancel.status, 'partially_applied');
  });
  assert.equal(contextValue.currentSyncStatus.state, 'applied_partially');
  assert.equal(
    contextValue.pendingChanges,
    true,
    'Si el usuario cancela la eliminación en Studio, pendingChanges debe seguir en true reflejando la divergencia'
  );

  // Paso 2B: Intentar reconciliar de nuevo la tarea ya cancelada ('task-destructive-del-99') debe ser RECHAZADO
  const finalHashAfterDelete = computeAssetContentHash(contextValue.activeAsset);
  mockTaskEndpointResponse = {
    taskId: 'task-destructive-del-99',
    status: 'completed',
    result: {
      operationId: 'task-destructive-del-99',
      taskId: 'task-destructive-del-99',
      status: 'completed',
      verified: true,
      modelName: assetAfterDelete.name,
      expectedModelHash: finalHashAfterDelete,
      appliedModelHash: finalHashAfterDelete,
      expectedPartCount: 1,
      actualPartCount: 1,
      addedPartIds: [],
      updatedPartIds: [],
      removedPartIds: ['part_cannon_fixed'],
      pendingDeletionPartIds: [],
      failedPartIds: [],
      verifiedGeometryPartIds: ['part_base_fixed'],
      warnings: [],
      errors: [],
    },
  };

  await act(async () => {
    const recReplay = await contextValue.reconcileStudioTaskReceipt('task-destructive-del-99');
    assert.equal(recReplay.success, false, 'No debe aceptar confirmar una tarea que ya fue cancelada/resuelta previamente');
  });

  // Paso 3: Nuevo intento pushToStudio ('task-destructive-del-100') -> Usuario CONFIRMA la eliminación en Roblox Studio -> completed
  nextEnqueueTaskId = 'task-destructive-del-100';
  await act(async () => {
    const pushRes2 = await contextValue.pushToStudio();
    assert.equal(pushRes2.taskId, 'task-destructive-del-100');
  });

  mockTaskEndpointResponse = {
    taskId: 'task-destructive-del-100',
    status: 'completed',
    result: {
      operationId: 'task-destructive-del-100',
      taskId: 'task-destructive-del-100',
      status: 'completed',
      verified: true,
      modelName: assetAfterDelete.name,
      expectedModelHash: finalHashAfterDelete,
      appliedModelHash: finalHashAfterDelete,
      expectedPartCount: 1,
      actualPartCount: 1,
      addedPartIds: [],
      updatedPartIds: [],
      removedPartIds: ['part_cannon_fixed'],
      pendingDeletionPartIds: [],
      failedPartIds: [],
      verifiedGeometryPartIds: ['part_base_fixed'],
      warnings: [],
      errors: [],
    },
  };

  await act(async () => {
    const recConfirm = await contextValue.reconcileStudioTaskReceipt('task-destructive-del-100');
    assert.equal(recConfirm.success, true);
    assert.equal(recConfirm.status, 'completed');
  });
  assert.equal(contextValue.currentSyncStatus.state, 'applied_successfully');
  assert.equal(
    contextValue.pendingChanges,
    false,
    'Tras confirmar y verificar la eliminación en Studio, pendingChanges se limpia a false'
  );

  globalThis.fetch = origFetch;
  await act(async () => {
    root.unmount();
  });
});

test('11. Fase 7 — Verificación exhaustiva de persistencia (verifyPersistedAssetContent): identidad, jerarquía, normales/UVs y preservación exacta de triángulos 3D en subdivisiones _SubN', async () => {
  const { verifyPersistedAssetContent } = await import('../src/context/ForgeContext.tsx');

  const baseReq: Forge3DAsset = {
    ...createSampleAsset('PersistenceAuditAsset'),
    id: 'asset_uid_100',
    asset_id: 'rblx_asset_900',
    parts: [
      {
        ...createSampleAsset().parts[0],
        partId: 'part_hull_main',
        parentId: 'root_group',
        parentName: 'MainGroup',
        hierarchyPath: 'Workspace/PersistenceAuditAsset/MainGroup/Base',
        meshData: {
          vertices: [
            [0, 0, 0],
            [2, 0, 0],
            [0, 2, 0],
          ],
          faces: [[0, 1, 2]],
          normals: [
            [0, 0, 1],
            [0, 0, 1],
            [0, 0, 1],
          ],
          uvs: [
            [0, 0],
            [1, 0],
            [0, 1],
          ],
        },
      },
    ],
  };

  // 11A. Alterar id o asset_id debe fallar
  const badIdPersisted: Forge3DAsset = JSON.parse(JSON.stringify(baseReq));
  badIdPersisted.id = 'corrupted_uid_999';
  assert.equal(verifyPersistedAssetContent(baseReq, badIdPersisted).valid, false);

  // 11B. Alterar hierarchyPath o parentId debe fallar
  const badHierarchyPersisted: Forge3DAsset = JSON.parse(JSON.stringify(baseReq));
  badHierarchyPersisted.parts[0].parentId = 'wrong_parent';
  assert.equal(verifyPersistedAssetContent(baseReq, badHierarchyPersisted).valid, false);

  // 11C. Alterar normales o UVs debe fallar
  const badNormalsPersisted: Forge3DAsset = JSON.parse(JSON.stringify(baseReq));
  badNormalsPersisted.parts[0].meshData!.normals![0] = [0, 1, 0];
  assert.equal(verifyPersistedAssetContent(baseReq, badNormalsPersisted).valid, false);

  const badUvsPersisted: Forge3DAsset = JSON.parse(JSON.stringify(baseReq));
  badUvsPersisted.parts[0].meshData!.uvs![1] = [0.25, 0.75];
  assert.equal(verifyPersistedAssetContent(baseReq, badUvsPersisted).valid, false);

  // 11D. Subdivisión _SubN con igual número de caras pero coordenadas de triángulo alteradas DEBE fallar
  const manyFaces: number[][] = [];
  for (let i = 0; i < 9505; i++) {
    manyFaces.push([0, 1, 2]);
  }
  const oversizedOrig: Forge3DAsset = {
    ...baseReq,
    parts: [
      {
        ...baseReq.parts[0],
        meshData: {
          vertices: [
            [0, 0, 0],
            [2, 0, 0],
            [0, 2, 0],
          ],
          faces: manyFaces,
        },
      },
    ],
  };

  const corruptedSplitGeometry: Forge3DAsset = {
    ...oversizedOrig,
    parts: [
      {
        ...oversizedOrig.parts[0],
        partId: 'part_hull_main_Sub1',
        name: 'Base_Sub1',
        meshData: {
          vertices: [
            [0, 0, 0],
            [2, 0, 0],
            [0, 2, 0],
          ],
          faces: manyFaces.slice(0, 5000),
        },
      },
      {
        ...oversizedOrig.parts[0],
        partId: 'part_hull_main_Sub2',
        name: 'Base_Sub2',
        meshData: {
          vertices: [
            [0, 0, 0],
            [99, 0, 0], // Coordenada de vértice corrompida en Sub2 aunque la cantidad de caras coincida
            [0, 2, 0],
          ],
          faces: manyFaces.slice(5000),
        },
      },
    ],
  };

  const corruptedSplitResult = verifyPersistedAssetContent(oversizedOrig, corruptedSplitGeometry);
  assert.equal(
    corruptedSplitResult.valid,
    false,
    'verifyPersistedAssetContent debe rechazar una subdivisión _SubN si se alteran las coordenadas 3D de un triángulo aunque coincida el total de caras'
  );
});

test('12. Fase 2 — Endurecimiento estricto de verifyStudioApplicationReceipt: rechazo de campos ausentes, IDs contradictorios, IDs duplicados y piezas sin partId explícito', async () => {
  const { verifyStudioApplicationReceipt } = await import('../src/context/ForgeContext.tsx');
  const asset = createSampleAsset('StrictReceiptModel');
  const expectedHash = computeAssetContentHash(asset);

  const buildValidReceipt = () => ({
    taskId: 'task-strict-01',
    status: 'completed',
    result: {
      taskId: 'task-strict-01',
      operationId: 'task-strict-01',
      status: 'completed',
      verified: true,
      modelName: asset.name,
      expectedPartCount: 2,
      actualPartCount: 2,
      expectedModelHash: expectedHash,
      appliedModelHash: expectedHash,
      verifiedGeometryPartIds: ['part_base_fixed', 'part_cannon_fixed'] as string[],
      failedPartIds: [] as string[],
      pendingDeletionPartIds: [] as string[],
    },
  });

  // 12A. Recibo completo y consistente -> valid = true
  const validRes = verifyStudioApplicationReceipt(buildValidReceipt(), 'task-strict-01', asset, expectedHash);
  assert.equal(validRes.valid, true);
  assert.equal(validRes.status, 'completed');

  // 12B. Contradicción entre taskResult.taskId y result.taskId -> rechazado
  const mismatchTaskIdReceipt = buildValidReceipt();
  mismatchTaskIdReceipt.result.taskId = 'other-task-999';
  const mismatchTaskIdRes = verifyStudioApplicationReceipt(mismatchTaskIdReceipt, 'task-strict-01', asset, expectedHash);
  assert.equal(mismatchTaskIdRes.valid, false);
  assert.match(String(mismatchTaskIdRes.reason || ''), /Contradicción de taskId/i);

  // 12C. Contradicción entre operationId y expectedTaskId -> rechazado
  const mismatchOpReceipt = buildValidReceipt();
  mismatchOpReceipt.result.operationId = 'wrong-op-id';
  const mismatchOpRes = verifyStudioApplicationReceipt(mismatchOpReceipt, 'task-strict-01', asset, expectedHash);
  assert.equal(mismatchOpRes.valid, false);
  assert.match(String(mismatchOpRes.reason || ''), /operationId/i);

  // 12D. Falta expectedPartCount o expectedModelHash (sin fallback a legacy fields) -> rechazado
  const missingExpectedCount = buildValidReceipt();
  delete (missingExpectedCount.result as any).expectedPartCount;
  assert.equal(verifyStudioApplicationReceipt(missingExpectedCount, 'task-strict-01', asset, expectedHash).valid, false);

  const missingExpectedHash = buildValidReceipt();
  delete (missingExpectedHash.result as any).expectedModelHash;
  assert.equal(verifyStudioApplicationReceipt(missingExpectedHash, 'task-strict-01', asset, expectedHash).valid, false);

  // 12E. IDs duplicados en verifiedGeometryPartIds -> rechazado
  const dupVerifiedReceipt = buildValidReceipt();
  dupVerifiedReceipt.result.verifiedGeometryPartIds = ['part_base_fixed', 'part_base_fixed', 'part_cannon_fixed'];
  const dupVerifiedRes = verifyStudioApplicationReceipt(dupVerifiedReceipt, 'task-strict-01', asset, expectedHash);
  assert.equal(dupVerifiedRes.valid, false);
  assert.match(String(dupVerifiedRes.reason || ''), /duplicado/i);

  // 12F. Contradicción: misma pieza en verifiedGeometryPartIds y failedPartIds -> rechazado
  const contradictoryPartReceipt = buildValidReceipt();
  contradictoryPartReceipt.result.failedPartIds = ['part_base_fixed'];
  const contradictoryPartRes = verifyStudioApplicationReceipt(contradictoryPartReceipt, 'task-strict-01', asset, expectedHash);
  assert.equal(contradictoryPartRes.valid, false);
  assert.match(String(contradictoryPartRes.reason || ''), /simultáneamente en verifiedGeometryPartIds y failedPartIds/i);

  // 12G. Política de partId: si el modelo esperado tiene una pieza sin partId explícito -> rechazado
  const assetMissingPartId: Forge3DAsset = {
    ...asset,
    parts: [
      { ...asset.parts[0], partId: '' },
      asset.parts[1],
    ],
  };
  const missingPartIdRes = verifyStudioApplicationReceipt(buildValidReceipt(), 'task-strict-01', assetMissingPartId, expectedHash);
  assert.equal(missingPartIdRes.valid, false);
  assert.match(String(missingPartIdRes.reason || ''), /carece de partId explícito/i);
});

test('13. Fase 3 — Múltiples confirmaciones destructivas simultáneas en ForgeContext: confirmar primera, cancelar segunda, rechazar confirmación posterior de segunda y rechazar respuesta de otra tarea', async () => {
  let contextValue: any = null;
  function MultiConfirmInspector() {
    contextValue = useForge();
    return React.createElement('div', null, contextValue.activeAsset?.name);
  }

  const container = domWindow.document.createElement('div');
  const root = createRoot(container as unknown as Element);

  await act(async () => {
    root.render(React.createElement(ForgeProvider, null, React.createElement(MultiConfirmInspector)));
  });

  const initialAsset: Forge3DAsset = {
    ...createSampleAsset('MultiDeleteTank'),
    parts: [
      { ...createSampleAsset().parts[0], partId: 'part_1', name: 'Hull' },
      { ...createSampleAsset().parts[1], partId: 'part_2', name: 'LeftTrack' },
      { ...createSampleAsset().parts[1], partId: 'part_3', name: 'RightTrack', position: [2, 1, 0] },
    ],
  };

  await act(async () => {
    contextValue.setActiveAsset(initialAsset);
  });

  const origFetch = globalThis.fetch;
  let nextEnqueueTaskId = 'task-multi-del-1';
  const taskResponses: Record<string, any> = {};

  globalThis.fetch = (async (url: string, init?: any) => {
    if (url.includes('/api/v1/assets/rebuild-luau')) {
      const sent = JSON.parse(init.body).asset;
      return {
        ok: true,
        status: 200,
        json: async () => ({ asset: sent }),
      };
    }
    if (url.includes('/api/v1/bridge/enqueue')) {
      const body = JSON.parse(init.body);
      const tId = nextEnqueueTaskId;
      const removedIds = (body.payload.incremental_diff?.removed || []).map((r: any) => r.partId);
      const keptIds = body.payload.parts.map((p: any) => p.partId);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          taskId: tId,
          status: 'awaiting_studio_confirmation',
          result: {
            taskId: tId,
            operationId: tId,
            status: 'awaiting_confirmation',
            verified: false,
            modelName: body.payload.name,
            expectedPartCount: keptIds.length,
            actualPartCount: keptIds.length + removedIds.length,
            expectedModelHash: body.payload.model_hash,
            appliedModelHash: 'hash_pending_studio',
            verifiedGeometryPartIds: keptIds,
            failedPartIds: [],
            pendingDeletionPartIds: removedIds,
          },
        }),
      };
    }
    if (url.includes('/api/v1/bridge/task/')) {
      const taskIdParam = decodeURIComponent(url.split('/api/v1/bridge/task/')[1]);
      return {
        ok: true,
        status: 200,
        json: async () => taskResponses[taskIdParam],
      };
    }
    return origFetch(url);
  }) as any;

  // Operación 1: Eliminar part_3 -> genera task-multi-del-1 en espera
  const assetOp1: Forge3DAsset = {
    ...contextValue.activeAsset,
    parts: contextValue.activeAsset.parts.slice(0, 2),
  };
  await act(async () => {
    contextValue.applyAssetChange(assetOp1, 'Eliminar RightTrack');
  });
  nextEnqueueTaskId = 'task-multi-del-1';
  await act(async () => {
    const res1 = await contextValue.pushToStudio();
    assert.equal(res1.taskId, 'task-multi-del-1');
  });
  const hashOp1 = computeAssetContentHash(contextValue.activeAsset);

  // Operación 2: Eliminar part_2 -> genera task-multi-del-2 en espera simultáneamente
  const assetOp2: Forge3DAsset = {
    ...contextValue.activeAsset,
    parts: contextValue.activeAsset.parts.slice(0, 1),
  };
  await act(async () => {
    contextValue.applyAssetChange(assetOp2, 'Eliminar LeftTrack');
  });
  nextEnqueueTaskId = 'task-multi-del-2';
  await act(async () => {
    const res2 = await contextValue.pushToStudio();
    assert.equal(res2.taskId, 'task-multi-del-2');
  });
  const hashOp2 = computeAssetContentHash(contextValue.activeAsset);

  // 13A. Confirmar la primera tarea ('task-multi-del-1')
  taskResponses['task-multi-del-1'] = {
    taskId: 'task-multi-del-1',
    status: 'completed',
    result: {
      taskId: 'task-multi-del-1',
      operationId: 'task-multi-del-1',
      status: 'completed',
      verified: true,
      modelName: initialAsset.name,
      expectedPartCount: 2,
      actualPartCount: 2,
      expectedModelHash: hashOp1,
      appliedModelHash: hashOp1,
      verifiedGeometryPartIds: ['part_1', 'part_2'],
      failedPartIds: [],
      pendingDeletionPartIds: [],
      removedPartIds: ['part_3'],
    },
  };
  await act(async () => {
    const rec1 = await contextValue.reconcileStudioTaskReceipt('task-multi-del-1');
    assert.equal(rec1.success, true, 'Debe aceptar la confirmación de la primera tarea pendiente');
    assert.equal(rec1.status, 'completed');
  });
  assert.equal(
    contextValue.pendingChanges,
    true,
    'Como todavía queda task-multi-del-2 pendiente, pendingChanges debe continuar en true'
  );

  // 13B. Respuesta duplicada para 'task-multi-del-1' -> debe ser rechazada
  await act(async () => {
    const rec1Dup = await contextValue.reconcileStudioTaskReceipt('task-multi-del-1');
    assert.equal(rec1Dup.success, false, 'Debe rechazar una respuesta duplicada para una tarea ya resuelta');
  });

  // 13C. Cancelar la segunda tarea ('task-multi-del-2')
  taskResponses['task-multi-del-2'] = {
    taskId: 'task-multi-del-2',
    status: 'partially_applied',
    result: {
      taskId: 'task-multi-del-2',
      operationId: 'task-multi-del-2',
      status: 'partially_applied',
      verified: false,
      modelName: initialAsset.name,
      expectedPartCount: 1,
      actualPartCount: 2,
      expectedModelHash: hashOp2,
      appliedModelHash: hashOp1,
      verifiedGeometryPartIds: ['part_1'],
      failedPartIds: ['part_2'],
      pendingDeletionPartIds: [],
      removedPartIds: [],
      errors: ['Eliminación cancelada por el usuario'],
    },
  };
  await act(async () => {
    const rec2Cancel = await contextValue.reconcileStudioTaskReceipt('task-multi-del-2');
    assert.equal(rec2Cancel.success, false);
    assert.equal(rec2Cancel.status, 'partially_applied');
  });

  // 13D. Intentar confirmar la segunda tarea ('task-multi-del-2') después de haberla cancelado -> debe ser rechazado
  taskResponses['task-multi-del-2'] = {
    taskId: 'task-multi-del-2',
    status: 'completed',
    result: {
      taskId: 'task-multi-del-2',
      operationId: 'task-multi-del-2',
      status: 'completed',
      verified: true,
      modelName: initialAsset.name,
      expectedPartCount: 1,
      actualPartCount: 1,
      expectedModelHash: hashOp2,
      appliedModelHash: hashOp2,
      verifiedGeometryPartIds: ['part_1'],
      failedPartIds: [],
      pendingDeletionPartIds: [],
      removedPartIds: ['part_2'],
    },
  };
  await act(async () => {
    const rec2AfterCancel = await contextValue.reconcileStudioTaskReceipt('task-multi-del-2');
    assert.equal(
      rec2AfterCancel.success,
      false,
      'No debe permitir confirmar una segunda operación que ya fue cancelada previamente'
    );
  });

  // 13E. Respuesta perteneciente a otra tarea inexistente ('task-foreign-999') -> rechazada
  await act(async () => {
    const recForeign = await contextValue.reconcileStudioTaskReceipt('task-foreign-999');
    assert.equal(recForeign.success, false);
  });

  globalThis.fetch = origFetch;
  await act(async () => {
    root.unmount();
  });
});

test('14. Fase 5 — Reconstrucción real de modelos desde Roblox Studio (reconcileReconstructedModelFromStudio): comparación de los 9 dominios y diferenciación entre reconstrucción completa, parcial y fallida', async () => {
  const { reconcileReconstructedModelFromStudio } = await import('../src/context/ForgeContext.tsx');

  const originalAsset: Forge3DAsset = {
    ...createSampleAsset('ReconstructedCyberDrone'),
    parts: [
      {
        partId: 'part_core_01',
        name: 'CoreBody',
        shape: 'MeshPart',
        size: [4, 2, 4],
        position: [0, 5, 0],
        rotation: [0, 45, 0],
        color: [80, 160, 250],
        material: 'Neon',
        roughness: 0.25,
        metalness: 0.75,
        transparency: 0.1,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'PreciseConvexDecomposition',
        parentId: 'group_root',
        parentName: 'DroneGroup',
        hierarchyPath: 'Workspace/ReconstructedCyberDrone/DroneGroup/CoreBody',
        meshData: {
          vertices: [
            [0, 0, 0],
            [2, 0, 0],
            [0, 2, 0],
          ],
          faces: [[0, 1, 2]],
          normals: [
            [0, 0, 1],
            [0, 0, 1],
            [0, 0, 1],
          ],
          uvs: [
            [0, 0],
            [1, 0],
            [0, 1],
          ],
        },
      },
      {
        partId: 'part_rotor_02',
        name: 'LeftRotor',
        shape: 'Cylinder',
        size: [2, 0.5, 2],
        position: [-3, 6, 0],
        rotation: [0, 0, 0],
        color: [40, 40, 40],
        material: 'Metal',
        roughness: 0.4,
        metalness: 0.9,
        transparency: 0,
        canCollide: false,
        anchored: true,
        collisionFidelity: 'Box',
        parentId: 'group_root',
        parentName: 'DroneGroup',
        hierarchyPath: 'Workspace/ReconstructedCyberDrone/DroneGroup/LeftRotor',
      },
    ],
  };
  const expectedHash = computeAssetContentHash(originalAsset);

  // 14A. Reconstrucción COMPLETA (los 9 dominios coinciden: identidad, geometría, normales, UVs, materiales, transformaciones, jerarquía, propiedades y hash)
  const completeResponse = {
    taskId: 'task-recon-complete',
    status: 'completed',
    result: {
      taskId: 'task-recon-complete',
      operationId: 'task-recon-complete',
      status: 'completed',
      verified: true,
      modelName: originalAsset.name,
      expectedPartCount: 2,
      actualPartCount: 2,
      expectedModelHash: expectedHash,
      appliedModelHash: expectedHash,
      verifiedGeometryPartIds: ['part_core_01', 'part_rotor_02'],
      failedPartIds: [],
      pendingDeletionPartIds: [],
      parts: JSON.parse(JSON.stringify(originalAsset.parts)),
    },
  };

  const fullRecon = reconcileReconstructedModelFromStudio(originalAsset, completeResponse);
  assert.equal(fullRecon.valid, true, `Debe validar reconstrucción completa. Discrepancias: ${fullRecon.discrepancies.join('; ')}`);
  assert.equal(fullRecon.status, 'completed');
  assert.equal(fullRecon.reconstructedAsset?.parts.length, 2);

  // 14B. Reconstrucción PARCIAL (una pieza reconstruida con normales o jerarquía alteradas, o una pieza en failedPartIds)
  const partialResponse = JSON.parse(JSON.stringify(completeResponse));
  partialResponse.result.parts[0].meshData.normals[0] = [0, 1, 0]; // Normal alterada
  partialResponse.result.parts[1].hierarchyPath = 'Workspace/WrongHierarchy/LeftRotor'; // Jerarquía alterada

  const partialRecon = reconcileReconstructedModelFromStudio(originalAsset, partialResponse);
  assert.equal(partialRecon.valid, false);
  assert.equal(
    partialRecon.status,
    'partially_applied',
    'Si se reconstruyeron piezas pero hay discrepancias de normales o jerarquía, debe reportarse como partially_applied'
  );
  assert.ok(partialRecon.discrepancies.some((d) => d.includes('Normales')));
  assert.ok(partialRecon.discrepancies.some((d) => d.includes('Jerarquía')));

  // 14C. Reconstrucción FALLIDA (ninguna pieza reconstruida o modelo vacío)
  const failedResponse = {
    taskId: 'task-recon-failed',
    status: 'failed',
    result: {
      taskId: 'task-recon-failed',
      operationId: 'task-recon-failed',
      status: 'failed',
      verified: false,
      modelName: originalAsset.name,
      expectedPartCount: 2,
      actualPartCount: 0,
      expectedModelHash: expectedHash,
      appliedModelHash: '',
      verifiedGeometryPartIds: [],
      failedPartIds: ['part_core_01', 'part_rotor_02'],
      pendingDeletionPartIds: [],
      parts: [],
    },
  };

  const failedRecon = reconcileReconstructedModelFromStudio(originalAsset, failedResponse);
  assert.equal(failedRecon.valid, false);
  assert.equal(failedRecon.status, 'failed');
  assert.equal(failedRecon.reconstructedAsset, null);
});



