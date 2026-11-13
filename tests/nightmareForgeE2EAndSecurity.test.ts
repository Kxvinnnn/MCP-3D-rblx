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
  getAssetFromLibraryServer,
  parseRbxmxFromPartsServer,
  upsertAssetInLibraryServer,
} from '../src/server/engines/worldAndModelEditorEngine.ts';
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
