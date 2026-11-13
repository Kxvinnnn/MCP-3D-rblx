import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  CloudBridgeCoordinator,
  isPlaceholderSecretInProduction,
  verifyTokenConstantTime,
} from '../src/server/engines/bridgeCoordinatorEngine.ts';
import {
  FORGE_ASSET_CATEGORIES,
  synthesizeSeededProcedural3DAsset,
} from '../src/server/engines/procedural3DGenerator.ts';
import {
  buildGltfFromPartsServer,
  buildObjAndMtlFromPartsServer,
  buildRbxmxFromPartsServer,
  buildStrictLuauFromEditedParts,
  generatePBRSurfaceAppearanceLuau,
  getAssetFromLibraryServer,
  loadAssetsLibraryServer,
  parseRbxmxFromPartsServer,
  saveAssetsLibraryServer,
  upsertAssetInLibraryServer,
} from '../src/server/engines/worldAndModelEditorEngine.ts';
import { createMainServerApp } from '../server.ts';
import { computeCanonicalAssetHash } from '../src/utils/canonicalHash.ts';
import { validateRobloxGeometry } from '../src/utils/robloxGeometryValidator.ts';
import {
  verifyPersistedAssetContent,
  reconcileReconstructedModelFromStudio,
} from '../src/utils/receiptVerification.ts';

test('Fase 3 — Seguridad: CloudBridgeCoordinator exige HMAC válido, bloquea replay de nonce, valida timestamp y verifica firma en task-result', () => {
  const prevSecret = process.env.FORGE_BRIDGE_SHARED_SECRET;
  const prevEnv = process.env.NODE_ENV;
  const testSecret = 'sec_' + crypto.randomBytes(24).toString('hex');
  process.env.FORGE_BRIDGE_SHARED_SECRET = testSecret;

  try {
    const coordinator = new CloudBridgeCoordinator();
    const nowIso = new Date().toISOString();
    const nonce = crypto.randomUUID();

    // 1. Handshake sin firma HMAC debe ser rechazado aunque envíe el token en cabecera
    const noSigAttempt = coordinator.handleHandshake(
      {
        bridgeVersion: '1.0.0',
        protocolVersion: '1.0',
        timestamp: nowIso,
        nonce,
        signature: '',
      },
      testSecret
    );
    assert.equal(noSigAttempt.accepted, false);
    assert.match(String(noSigAttempt.error), /HMAC/i);

    // 2. Handshake con timestamp fuera de ventana (> 5 min) debe ser rechazado
    const expiredIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const expiredCanonical = `1.0.0|1.0|${expiredIso}|${nonce}`;
    const expiredSig = crypto
      .createHmac('sha256', testSecret)
      .update(expiredCanonical, 'utf-8')
      .digest('hex');
    const expiredAttempt = coordinator.handleHandshake(
      {
        bridgeVersion: '1.0.0',
        protocolVersion: '1.0',
        timestamp: expiredIso,
        nonce,
        signature: expiredSig,
      },
      testSecret
    );
    assert.equal(expiredAttempt.accepted, false);
    assert.match(String(expiredAttempt.error), /Timestamp/i);

    // 3. Handshake legítimo con HMAC válido es aceptado
    const validCanonical = `1.0.0|1.0|${nowIso}|${nonce}`;
    const validSig = crypto
      .createHmac('sha256', testSecret)
      .update(validCanonical, 'utf-8')
      .digest('hex');
    const validAttempt = coordinator.handleHandshake(
      {
        bridgeVersion: '1.0.0',
        protocolVersion: '1.0',
        timestamp: nowIso,
        nonce,
        signature: validSig,
      },
      testSecret
    );
    assert.equal(validAttempt.accepted, true);
    assert.ok(validAttempt.sessionId);
    assert.ok(validAttempt.sessionToken);

    // 4. Ataque de repetición (mismo nonce) es bloqueado
    const replayAttempt = coordinator.handleHandshake(
      {
        bridgeVersion: '1.0.0',
        protocolVersion: '1.0',
        timestamp: nowIso,
        nonce,
        signature: validSig,
      },
      testSecret
    );
    assert.equal(replayAttempt.accepted, false);
    assert.match(String(replayAttempt.error), /repetido/i);

    // 5. Encolar tarea y probar rechazo de task-result sin firma / con firma manipulada
    void coordinator.enqueueTask('studio.ping', {}, false);
    const hb = coordinator.handleHeartbeat({});
    assert.equal(hb.pendingTasks.length, 1);
    const taskEnv = hb.pendingTasks[0];

    const unsignedResult = {
      protocolVersion: '1.0',
      taskId: taskEnv.taskId,
      sessionId: validAttempt.sessionId!,
      correlationId: taskEnv.correlationId,
      status: 'completed' as const,
      result: { pong: true },
      error: null,
      executionTime: 12,
      timestamp: new Date().toISOString(),
    };
    assert.equal(coordinator.handleTaskResult(unsignedResult), false);

    // 6. task-result con firma HMAC legítima es aceptado
    const signedResult = {
      ...unsignedResult,
      signature: coordinator.computeTaskResultSignature(unsignedResult),
    };
    assert.equal(coordinator.handleTaskResult(signedResult), true);

    // 7. Rechazo de secretos de ejemplo en producción y comparación en tiempo constante
    process.env.NODE_ENV = 'production';
    assert.equal(isPlaceholderSecretInProduction('forge-local-dev-token-2026'), true);
    assert.equal(isPlaceholderSecretInProduction(testSecret), false);
    assert.equal(verifyTokenConstantTime(testSecret, testSecret), true);
    assert.equal(verifyTokenConstantTime(testSecret, 'otro-token'), false);
  } finally {
    if (prevSecret === undefined) delete process.env.FORGE_BRIDGE_SHARED_SECRET;
    else process.env.FORGE_BRIDGE_SHARED_SECRET = prevSecret;
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
  }
});

test('Fase 6 — Generación Procedural en las 8 Categorías Oficiales y Determinismo por Semilla (Seed)', () => {
  for (const category of FORGE_ASSET_CATEGORIES) {
    const assetA = synthesizeSeededProcedural3DAsset({
      category,
      prompt: `Test asset for ${category}`,
      seed: `seed-${category}-alpha`,
    });
    const assetB = synthesizeSeededProcedural3DAsset({
      category,
      prompt: `Test asset for ${category}`,
      seed: `seed-${category}-alpha`,
    });
    const assetDifferent = synthesizeSeededProcedural3DAsset({
      category,
      prompt: `Test asset for ${category}`,
      seed: `seed-${category}-beta`,
    });

    assert.equal(assetA.category, category);
    assert.ok(Array.isArray(assetA.parts) && assetA.parts.length >= 4);

    // Verificar determinismo exacto: misma semilla = mismo hash canónico SHA-256
    const hashA = computeCanonicalAssetHash(assetA as any);
    const hashB = computeCanonicalAssetHash(assetB as any);
    const hashDiff = computeCanonicalAssetHash(assetDifferent as any);

    assert.equal(
      hashA,
      hashB,
      `La categoría ${category} debe ser 100% determinista para la misma semilla`
    );
    assert.notEqual(
      hashA,
      hashDiff,
      `Semillas distintas en ${category} deben producir geometría distinta`
    );

    // Verificar validación geométrica de Roblox
    const validation = validateRobloxGeometry(assetA as any);
    assert.equal(
      validation.isValid,
      true,
      `Geometría inválida en categoría ${category}: ${validation.errors.join(', ')}`
    );
  }
});

test('Fase 7 — Caso de Uso Completo E2E (16 Pasos): Generar un Árbol 3D para Roblox, editar parámetros, validar, exportar (.luau/.rbxmx/.gltf/.obj), sincronizar con Studio y guardar en biblioteca', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-tree-e2e-'));
  const libPath = path.join(tmpDir, 'assets_library.json');
  fs.writeFileSync(libPath, '[]', 'utf-8');

  try {
    // Pasos 1 a 4: Generar árbol 3D con parámetros iniciales
    const treeV1 = synthesizeSeededProcedural3DAsset({
      name: 'AncientOakTree',
      category: 'Trees & Vegetation',
      prompt: 'Árbol roble ancestral para Roblox',
      seed: 'oak-seed-2026',
      tree_params: {
        seed: 'oak-seed-2026',
        height: 16,
        trunkThickness: 1.8,
        branchCount: 5,
        canopyShape: 'spherical',
        leafDistribution: 'dense',
        trunkMaterial: 'Wood',
        leafMaterial: 'Grass',
        variation: 0.25,
      },
    });

    assert.equal(treeV1.name, 'AncientOakTree');
    assert.equal(treeV1.category, 'Trees & Vegetation');
    // RootFlare + MainTrunk + 5 Branches + CanopyCrown_Main + 5 FoliageClusters = 13 piezas
    assert.equal(treeV1.parts.length, 13);

    // Verificar jerarquía de árbol (Root, Root/Branches, Root/Canopy)
    const parentPaths = new Set(treeV1.parts.map((p: any) => p.parentPath));
    assert.ok(parentPaths.has('Root'));
    assert.ok(parentPaths.has('Root/Branches'));
    assert.ok(parentPaths.has('Root/Canopy'));

    // Pasos 5 a 8: Modificar parámetros (altura y copa cónica) y validar geometría EditableMesh
    const treeV2 = synthesizeSeededProcedural3DAsset({
      name: 'AncientOakTree',
      category: 'Trees & Vegetation',
      prompt: 'Árbol roble ancestral modificado',
      seed: 'oak-seed-2026',
      tree_params: {
        seed: 'oak-seed-2026',
        height: 22,
        trunkThickness: 2.2,
        branchCount: 6,
        canopyShape: 'conical',
        leafDistribution: 'balanced',
        trunkMaterial: 'Wood',
        leafMaterial: 'Grass',
        variation: 0.25,
      },
    });

    const v1Hash = computeCanonicalAssetHash(treeV1 as any);
    const v2Hash = computeCanonicalAssetHash(treeV2 as any);
    assert.notEqual(v1Hash, v2Hash);

    const geomValidation = validateRobloxGeometry(treeV2 as any);
    assert.equal(geomValidation.isValid, true);
    assert.equal(geomValidation.errors.length, 0);

    // Pasos 9 a 12: Exportar el Árbol 3D a .luau, .rbxmx, .gltf y .obj/.mtl
    const luauExport = buildStrictLuauFromEditedParts(treeV2.name, treeV2.parts, 'Hull');
    assert.match(luauExport, /^--!strict/);
    assert.match(luauExport, /CreateEditableMesh/);
    assert.match(luauExport, /CreateMeshPartAsync/);

    const rbxmxExport = buildRbxmxFromPartsServer(treeV2.name, treeV2.parts, treeV2.pbr_profile);
    assert.match(rbxmxExport, /<roblox[^>]*version="4">/);
    assert.match(rbxmxExport, /ForgeMeshGeometryJSON/);
    const roundtripParts = parseRbxmxFromPartsServer(rbxmxExport);
    assert.equal(roundtripParts.parts.length, treeV2.parts.length);

    const gltfExport = JSON.parse(
      buildGltfFromPartsServer(treeV2.name, treeV2.parts, treeV2.pbr_profile)
    );
    assert.equal(gltfExport.asset.version, '2.0');
    assert.equal(gltfExport.meshes.length, treeV2.parts.length);

    const objMtlExport = buildObjAndMtlFromPartsServer(
      treeV2.name,
      treeV2.parts
    );
    assert.match(objMtlExport.obj, /o MainTrunk/);
    assert.match(objMtlExport.obj, /o CanopyCrown_Main/);
    assert.match(objMtlExport.mtl, /newmtl /);

    // Pasos 13 a 15: Reconciliar reconstrucción de Roblox Studio y verificar persistencia
    const reconciliation = reconcileReconstructedModelFromStudio(treeV2 as any, {
      modelName: treeV2.name,
      appliedModelHash: v2Hash,
      parts: treeV2.parts,
      verifiedGeometryPartIds: treeV2.parts.map((p: any) => p.partId),
      failedPartIds: [],
      errors: [],
    });
    assert.equal(reconciliation.status, 'completed');
    assert.equal(reconciliation.discrepancies.length, 0);

    // Paso 16: Guardar en biblioteca persistente, verificar contenido y reutilizar el Árbol 3D
    const savedRecord = upsertAssetInLibraryServer(libPath, treeV2);
    assert.equal(savedRecord.name, 'AncientOakTree');
    const persistedVerification = verifyPersistedAssetContent(treeV2 as any, savedRecord as any);
    assert.equal(persistedVerification.valid, true, persistedVerification.reason);

    const reloadedRecord = getAssetFromLibraryServer(libPath, savedRecord.id);
    assert.ok(reloadedRecord);
    assert.equal(reloadedRecord.parts.length, treeV2.parts.length);
    const reloadedVerification = verifyPersistedAssetContent(treeV2 as any, reloadedRecord as any);
    assert.equal(reloadedVerification.valid, true, reloadedVerification.reason);
    assert.equal(
      computeCanonicalAssetHash(reloadedRecord as any),
      computeCanonicalAssetHash(savedRecord as any)
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Etapa 4 — Identificadores reales: assets procedurales nunca fabrican rbxassetid:// falsos y separan forgeAssetId/geometryHash/contentHash de robloxAssetId', () => {
  for (const category of FORGE_ASSET_CATEGORIES) {
    const asset = synthesizeSeededProcedural3DAsset({
      category,
      prompt: `Identifier audit ${category}`,
      seed: `id-audit-${category}`,
    });

    assert.ok(String(asset.forgeAssetId || '').startsWith('asset-proc-'));
    assert.equal(asset.id, asset.forgeAssetId);
    assert.equal(asset.sourceAssetId, asset.forgeAssetId);
    assert.equal(asset.robloxAssetId, null);
    assert.equal(asset.assetUri, null);
    assert.equal(asset.geometrySource, 'EditableMeshBuffers');
    assert.match(String(asset.geometryHash), /^[a-f0-9]{64}$/);
    assert.match(String(asset.contentHash), /^[a-f0-9]{64}$/);
    assert.doesNotMatch(String(asset.luau_code), /rbxassetid:\/\/\d+/);
    assert.match(String(asset.luau_code), /PublishedMeshId = ""/);
    assert.match(String(asset.luau_code), /PublishedAssetId = ""/);

    for (const part of asset.parts) {
      assert.equal(part.meshId, '');
      assert.equal(part.assetId, '');
      assert.equal(part.robloxAssetId, null);
      assert.equal(part.assetUri, null);
      assert.equal(part.geometrySource, 'EditableMeshBuffers');
      assert.equal(part.meshData?.meshId, '');
      assert.equal(part.meshData?.assetId, '');
      assert.equal(part.meshData?.robloxAssetId, null);
      assert.equal(part.meshData?.geometrySource, 'EditableMeshBuffers');
      assert.match(String(part.meshData?.geometryHash), /^[a-f0-9]{64}$/);
    }

    // Round-trip JSON + .RBXMX export must not invent rbxassetid:// either
    const jsonRoundTrip = JSON.parse(JSON.stringify(asset));
    assert.equal(
      computeCanonicalAssetHash(jsonRoundTrip),
      computeCanonicalAssetHash(asset as any)
    );
    const rbxmx = buildRbxmxFromPartsServer(asset.name, asset.parts, asset.pbr_profile);
    assert.doesNotMatch(rbxmx, /rbxassetid:\/\/\d+/);
    assert.match(rbxmx, /<Content name="MeshId"><null><\/null><\/Content>/);
  }
});

test('Etapa 6 — LODs cerrados reales en las 8 categorías y sensibilidad completa a todos los parámetros del Árbol 3D', () => {
  // 1. Validar que cada parte de cada categoría tiene LOD 0, LOD 1 y LOD 2 independientes y geométricamente válidos
  for (const category of FORGE_ASSET_CATEGORIES) {
    const asset = synthesizeSeededProcedural3DAsset({
      category,
      prompt: `LOD validation for ${category}`,
      seed: `lod-seed-${category}`,
    });

    for (const part of asset.parts) {
      const lods = (part.meshData as any)?.lodLevels;
      assert.ok(Array.isArray(lods) && lods.length === 3, `${category}/${part.name} must have 3 LODs`);
      assert.ok(lods[2].triangleCount <= lods[1].triangleCount);
      assert.ok(lods[1].triangleCount <= lods[0].triangleCount);

      for (const lod of lods) {
        assert.ok(Array.isArray(lod.vertices) && lod.vertices.length >= 4);
        assert.ok(Array.isArray(lod.normals) && lod.normals.length === lod.vertices.length);
        assert.ok(Array.isArray(lod.uvs) && lod.uvs.length === lod.vertices.length);
        assert.ok(Array.isArray(lod.faces) && lod.faces.length >= 8);

        const lodAsset = {
          ...asset,
          parts: [
            {
              ...part,
              meshData: {
                vertices: lod.vertices,
                normals: lod.normals,
                uvs: lod.uvs,
                faces: lod.faces,
              },
            },
          ],
        };
        const lodReport = validateRobloxGeometry(lodAsset as any);
        assert.equal(
          lodReport.isValid,
          true,
          `LOD ${lod.level} inválido en ${category}/${part.name}: ${lodReport.errors.join('; ')}`
        );
      }
    }
  }

  // 2. Validar sensibilidad determinista a CADA parámetro individual del generador de árboles
  const baseParams = {
    seed: 'tree-param-matrix-2026',
    height: 15,
    trunkThickness: 1.6,
    branchCount: 4,
    branchLength: 4.5,
    branchDistribution: 'tiered' as const,
    canopyShape: 'spherical' as const,
    canopySize: 1.0,
    leafDistribution: 'balanced' as const,
    foliageCount: 4,
    trunkMaterial: 'Wood',
    leafMaterial: 'Grass',
    variation: 0.25,
    leafVariation: 0.25,
  };

  const baseTree = synthesizeSeededProcedural3DAsset({
    name: 'MatrixOak',
    category: 'Trees & Vegetation',
    seed: baseParams.seed,
    tree_params: baseParams,
  });
  const baseHash = computeCanonicalAssetHash(baseTree as any);

  const singleParamMutations: Array<[string, Record<string, any>]> = [
    ['height', { height: 24 }],
    ['trunkThickness', { trunkThickness: 2.8 }],
    ['branchCount', { branchCount: 7 }],
    ['branchLength', { branchLength: 8.0 }],
    ['branchDistribution', { branchDistribution: 'alternating' }],
    ['canopyShape', { canopyShape: 'conical' }],
    ['canopySize', { canopySize: 1.6 }],
    ['leafDistribution', { leafDistribution: 'dense' }],
    ['foliageCount', { foliageCount: 9 }],
    ['trunkMaterial', { trunkMaterial: 'Slate' }],
    ['leafMaterial', { leafMaterial: 'Fabric' }],
    ['variation', { variation: 0.65 }],
    ['leafVariation', { leafVariation: 0.7 }],
    ['seed', { seed: 'tree-param-matrix-alt' }],
  ];

  for (const [paramName, patch] of singleParamMutations) {
    const mutatedTree = synthesizeSeededProcedural3DAsset({
      name: 'MatrixOak',
      category: 'Trees & Vegetation',
      seed: patch.seed ?? baseParams.seed,
      tree_params: { ...baseParams, ...patch },
    });
    const mutatedHash = computeCanonicalAssetHash(mutatedTree as any);
    assert.notEqual(
      mutatedHash,
      baseHash,
      `El parámetro '${paramName}' debe alterar determinísticamente el árbol generado`
    );
    const valReport = validateRobloxGeometry(mutatedTree as any);
    assert.equal(
      valReport.isValid,
      true,
      `Árbol mutado con '${paramName}' inválido: ${valReport.errors.join('; ')}`
    );
  }
});

test('Etapa 7 — Pipeline HTTP + Exportación (.luau/.rbxmx/.gltf/.obj/.mtl + PBR honesto) + Bridge firmado + Persistencia en biblioteca', async () => {
  const tmpRojo = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-etapa7-'));
  const token = 'etapa7_' + crypto.randomBytes(16).toString('hex');
  const secret = 'etapa7_sec_' + crypto.randomBytes(16).toString('hex');

  const runtime = createMainServerApp({
    securityToken: token,
    bridgeSharedSecret: secret,
    rojoProjectPath: tmpRojo,
    nodeEnv: 'test',
  });

  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Generar árbol completo por HTTP API autenticada con todos los parámetros de Etapa 6
    const genRes = await fetch(`${baseUrl}/api/v1/generate-3d`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forge-Token': token,
      },
      body: JSON.stringify({
        name: 'CypressMilestoneTree',
        category: 'Trees & Vegetation',
        prompt: 'Ciprés procedural estilizado',
        generation_mode: 'procedural',
        seed: 'cypress-etapa7-seed',
        branchLength: 5.5,
        branchDistribution: 'whorled',
        canopyShape: 'conical',
        canopySize: 1.2,
        leafDistribution: 'dense',
        foliageCount: 6,
        variation: 0.2,
        leafVariation: 0.35,
        save_to_rojo: true,
        save_to_library: true,
      }),
    });
    assert.equal(genRes.status, 200);
    const generated: any = await genRes.json();
    assert.equal(generated.name, 'CypressMilestoneTree');
    assert.equal(generated.robloxAssetId, null);
    assert.equal(generated.parts.length, 1 + 1 + 4 + 1 + 6); // RootFlare + MainTrunk + 4 Branches + CanopyCrown + 6 FoliageClusters
    assert.ok(generated.saved_path && fs.existsSync(generated.saved_path));

    // 2. Validar geometría, exportar multi-formato y verificar PBR honesto sin IDs falsos
    const geomCheck = validateRobloxGeometry(generated);
    assert.equal(geomCheck.isValid, true);

    const luau = buildStrictLuauFromEditedParts(generated.name, generated.parts, 'Hull');
    assert.match(luau, /^--!strict/);
    assert.doesNotMatch(luau, /rbxassetid:\/\/\d+/);

    const rbxmx = buildRbxmxFromPartsServer(generated.name, generated.parts, generated.pbr_profile);
    assert.doesNotMatch(rbxmx, /rbxassetid:\/\/\d+/);
    const reparsed = parseRbxmxFromPartsServer(rbxmx, generated.name, 'Hull');
    assert.equal(reparsed.parts.length, generated.parts.length);

    const gltf = JSON.parse(buildGltfFromPartsServer(generated.name, generated.parts));
    assert.equal(gltf.asset.version, '2.0');
    assert.equal(gltf.meshes.length, generated.parts.length);
    assert.ok(gltf.buffers?.[0]?.byteLength > 0);

    const { obj, mtl } = buildObjAndMtlFromPartsServer(generated.name, generated.parts);
    assert.match(obj, /o CanopyCrown_Main/);
    assert.match(mtl, /newmtl Mat_/);

    const pbrLuau = generatePBRSurfaceAppearanceLuau(
      'CypressBarkPBR',
      'src/shared/PBRMaterials',
      0.82,
      0.04,
      '#5c4033'
    );
    assert.match(pbrLuau, /Publication State: local_saved, Published Channels: 0\/4/);
    assert.match(pbrLuau, /PBR_HasPublishedCloudIds", false/);
    assert.doesNotMatch(pbrLuau, /rbxassetid:\/\/[1-9]\d*/);

    // 3. Re-consultar biblioteca persistida desde el servidor y verificar integridad completa
    const libRes = await fetch(`${baseUrl}/api/v1/assets`, {
      headers: { 'X-Forge-Token': token },
    });
    assert.equal(libRes.status, 200);
    const libJson: any = await libRes.json();
    const persisted = (libJson.assets || []).find((a: any) => a.id === generated.id);
    assert.ok(persisted);
    const verifyPersisted = verifyPersistedAssetContent(generated, persisted);
    assert.equal(verifyPersisted.valid, true, verifyPersisted.reason);

    // 4. Bridge HTTP firmado: handshake -> enqueue studio.reconstruct_model -> heartbeat -> task-ack -> task-result -> reconciliación
    const hsTs = new Date().toISOString();
    const hsNonce = crypto.randomUUID();
    const hsSig = crypto
      .createHmac('sha256', secret)
      .update(`1.0.0|1.0|${hsTs}|${hsNonce}`, 'utf-8')
      .digest('hex');
    const hsRes = await fetch(`${baseUrl}/api/v1/bridge/auth/handshake`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forge-Token': secret,
      },
      body: JSON.stringify({
        bridgeVersion: '1.0.0',
        protocolVersion: '1.0',
        timestamp: hsTs,
        nonce: hsNonce,
        signature: hsSig,
      }),
    });
    assert.equal(hsRes.status, 200);
    const hsJson: any = await hsRes.json();
    assert.equal(hsJson.accepted, true);
    assert.ok(hsJson.sessionToken);

    const enqPromise = fetch(`${baseUrl}/api/v1/bridge/enqueue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forge-Token': token,
      },
      body: JSON.stringify({
        operation: 'studio.reconstruct_model',
        payload: {
          assetId: generated.id,
          name: generated.name,
          parts: generated.parts,
        },
        wait_for_completion: true,
        timeout_ms: 5000,
      }),
    });

    // Esperar breve tick a que la tarea quede en cola y recogerla mediante heartbeat
    await new Promise((r) => setTimeout(r, 30));
    const hbRes = await fetch(`${baseUrl}/api/v1/bridge/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hsJson.sessionToken}`,
        'X-Bridge-Session': hsJson.sessionId,
      },
      body: JSON.stringify({
        bridgeVersion: '1.0.0',
        rojoStatus: { connected: true, rojoServePort: 34872, rojoServerListening: true, syncedFilesCount: 1 },
      }),
    });
    assert.equal(hbRes.status, 200);
    const hbJson: any = await hbRes.json();
    assert.equal(hbJson.pendingTasks.length, 1);
    const queuedTask = hbJson.pendingTasks[0];
    assert.equal(queuedTask.operation, 'studio.reconstruct_model');
    assert.ok(queuedTask.signature);

    const ackRes = await fetch(`${baseUrl}/api/v1/bridge/task-ack`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hsJson.sessionToken}`,
        'X-Bridge-Session': hsJson.sessionId,
      },
      body: JSON.stringify({ taskId: queuedTask.taskId }),
    });
    assert.equal(ackRes.status, 200);
    assert.equal(((await ackRes.json()) as any).acked, true);

    const reconstructedHash = computeCanonicalAssetHash(generated);
    const taskResultPayload: any = {
      protocolVersion: '1.0',
      taskId: queuedTask.taskId,
      sessionId: hsJson.sessionId,
      correlationId: queuedTask.correlationId,
      status: 'completed',
      result: {
        status: 'completed',
        modelName: generated.name,
        appliedModelHash: reconstructedHash,
        verifiedGeometryPartIds: generated.parts.map((p: any) => p.partId),
        failedPartIds: [],
        parts: generated.parts,
      },
      error: null,
      executionTime: 18,
      timestamp: new Date().toISOString(),
    };
    taskResultPayload.signature = runtime.coordinator.computeTaskResultSignature(taskResultPayload);

    const trRes = await fetch(`${baseUrl}/api/v1/bridge/task-result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hsJson.sessionToken}`,
        'X-Bridge-Session': hsJson.sessionId,
      },
      body: JSON.stringify(taskResultPayload),
    });
    assert.equal(trRes.status, 200);
    assert.equal(((await trRes.json()) as any).accepted, true);

    const enqJson: any = await enqPromise;
    assert.equal(enqJson.status, 200);
    const completedTask: any = await enqJson.json();
    assert.equal(completedTask.status, 'completed');

    const reconciliation = reconcileReconstructedModelFromStudio(generated, completedTask.result);
    assert.equal(reconciliation.valid, true, reconciliation.discrepancies.join('; '));
    assert.equal(reconciliation.status, 'completed');
    assert.equal(reconciliation.verified, true);
    assert.equal(reconciliation.domainComparison.hashMatches, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpRojo, { recursive: true, force: true });
  }
});

test('Etapa 8 — Biblioteca de assets: escritura atómica ante fallos y recuperación segura ante JSON corrupto', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-lib-atomic-'));
  const libPath = path.join(tmpDir, 'assets_library.json');

  try {
    const validAsset = synthesizeSeededProcedural3DAsset({
      name: 'AtomicVaultAsset',
      category: 'Props',
      seed: 'atomic-vault-01',
    });
    upsertAssetInLibraryServer(libPath, validAsset);
    const savedRaw = fs.readFileSync(libPath, 'utf-8');
    assert.equal(loadAssetsLibraryServer(libPath).length, 1);

    // Simular fallo durante saveAssetsLibraryServer antes de rename
    assert.throws(
      () =>
        saveAssetsLibraryServer(libPath, [{ id: 'broken' }], {
          beforeRenameHook: () => {
            throw new Error('Disk quota exceeded');
          },
        }),
      /Fallo atómico al guardar biblioteca/i
    );

    // El archivo válido anterior permanece intacto y sin temporales residuales
    assert.equal(fs.readFileSync(libPath, 'utf-8'), savedRaw);
    assert.equal(
      fs.readdirSync(tmpDir).filter((f) => f.endsWith('.tmp')).length,
      0
    );

    // Tolerancia ante JSON corrupto
    const corruptLibPath = path.join(tmpDir, 'corrupt_library.json');
    fs.writeFileSync(corruptLibPath, '[{ broken json', 'utf-8');
    assert.deepEqual(loadAssetsLibraryServer(corruptLibPath), []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});


