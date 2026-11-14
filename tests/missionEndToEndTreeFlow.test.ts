import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createMainServerApp } from '../server.ts';
import { createForgeLocalBridgeApp } from '../forge-bridge/src/server.ts';
import {
  synthesizeSeededProcedural3DAsset,
} from '../src/server/engines/procedural3DGenerator.ts';
import {
  buildStrictLuauFromEditedParts,
} from '../src/server/engines/generation3DEngine.ts';
import {
  buildRbxmxFromPartsServer,
  buildGltfFromPartsServer,
  buildObjAndMtlFromPartsServer,
  computeDataModelSyncDiffServer,
} from '../src/server/engines/assetEngine.ts';
import { parseNaturalLanguageToTreeParams } from '../src/utils/treePromptParser.ts';
import { validateRobloxGeometry } from '../src/utils/robloxGeometryValidator.ts';
import { computeCanonicalAssetHash } from '../src/utils/canonicalHash.ts';
import {
  verifyStudioApplicationReceipt,
  reconcileReconstructedModelFromStudio,
} from '../src/utils/receiptVerification.ts';
import {
  exportAssetToRBXMX,
  exportAssetToGLTF,
  exportAssetToOBJWithMTL,
} from '../src/utils/roblox3DEngine.ts';
import {
  FORGE_TOKEN_STORAGE_KEY,
  getForgeAuthHeaders,
  getStoredForgeToken,
  setStoredForgeToken,
} from '../src/utils/forgeApiClient.ts';

const BENCHMARK_FANTASY_TREE_PROMPT =
  'Genera un árbol de fantasía de estilo low-poly, con tronco grueso ligeramente curvado, raíces visibles, ramas distribuidas de manera natural, copa amplia, follaje rojizo y variación de tamaño entre las agrupaciones de hojas.';

function listenOnEphemeralPort(
  app: ReturnType<typeof createMainServerApp>['app']
): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind ephemeral port'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
    server.on('error', reject);
  });
}

function getWorldBoundingBox(asset: any) {
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const part of asset.parts || []) {
    const verts: number[][] = part.meshData?.vertices || [];
    const [px = 0, py = 0, pz = 0] = part.position || [0, 0, 0];

    let lMinX = Infinity, lMaxX = -Infinity;
    let lMinY = Infinity, lMaxY = -Infinity;
    let lMinZ = Infinity, lMaxZ = -Infinity;

    for (const [vx, vy, vz] of verts) {
      if (vx < lMinX) lMinX = vx;
      if (vx > lMaxX) lMaxX = vx;
      if (vy < lMinY) lMinY = vy;
      if (vy > lMaxY) lMaxY = vy;
      if (vz < lMinZ) lMinZ = vz;
      if (vz > lMaxZ) lMaxZ = vz;

      const wx = px + vx;
      const wy = py + vy;
      const wz = pz + vz;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    }

    // Centering parity: each part's local meshData must be centered around (0,0,0)
    const cx = (lMinX + lMaxX) * 0.5;
    const cy = (lMinY + lMaxY) * 0.5;
    const cz = (lMinZ + lMaxZ) * 0.5;
    assert.ok(
      Math.abs(cx) < 1e-3 && Math.abs(cy) < 1e-3 && Math.abs(cz) < 1e-3,
      `Part '${part.name}' local vertices must be centered at (0,0,0), got center (${cx}, ${cy}, ${cz})`
    );
  }

  return { minX, maxX, minY, maxY, minZ, maxZ };
}

test('Mission E2E 1 — Parser NLP extrae todos los rasgos del prompt benchmark de árbol de fantasía', () => {
  const parsed = parseNaturalLanguageToTreeParams(BENCHMARK_FANTASY_TREE_PROMPT);

  assert.equal(parsed.isTreePrompt, true);
  assert.ok(parsed.detectedKeywords.includes('low_poly'));
  assert.ok(parsed.detectedKeywords.includes('thick_trunk'));
  assert.ok(parsed.detectedKeywords.includes('slightly_curved_trunk'));
  assert.ok(parsed.detectedKeywords.includes('visible_roots'));
  assert.ok(parsed.detectedKeywords.includes('natural_branches'));
  assert.ok(parsed.detectedKeywords.includes('wide_canopy'));
  assert.ok(parsed.detectedKeywords.includes('red_foliage'));
  assert.ok(parsed.detectedKeywords.includes('varied_clusters'));

  assert.equal(parsed.params.detailLevel, 'low');
  assert.ok((parsed.params.trunkThickness ?? 0) >= 2.4);
  assert.ok((parsed.params.trunkCurvature ?? 0) >= 0.2);
  assert.equal(parsed.params.rootFlareScale, 1.5);
  assert.equal(parsed.params.branchDistribution, 'tiered');
  assert.ok((parsed.params.canopySize ?? 0) >= 1.3);
  assert.equal(parsed.params.leafColor, '#b91c1c');
  assert.equal(parsed.params.leafDistribution, 'clustered');
  assert.ok((parsed.params.leafVariation ?? 0) >= 0.6);
  assert.ok((parsed.params.foliageCount ?? 0) >= 5);
});

test('Mission E2E 2 — Árbol benchmark en 3 niveles de complejidad (low/medium/high): geometría <20k, raíces, curvatura, follaje rojizo y variación de racimos', () => {
  const parsed = parseNaturalLanguageToTreeParams(BENCHMARK_FANTASY_TREE_PROMPT);

  for (const level of ['low', 'medium', 'high'] as const) {
    const asset = synthesizeSeededProcedural3DAsset({
      name: `BenchmarkFantasyTree_${level}`,
      category: 'Trees & Vegetation',
      prompt: BENCHMARK_FANTASY_TREE_PROMPT,
      seed: 'fantasy-tree-benchmark-2026',
      tree_params: {
        ...parsed.params,
        detailLevel: level,
        seed: 'fantasy-tree-benchmark-2026',
      },
    });

    const validation = validateRobloxGeometry(asset as any);
    assert.equal(validation.isValid, true, `Level '${level}' invalid: ${validation.errors.join('; ')}`);

    // Verify per-part vertex/face bounds, AABB centering, and zero degenerate faces
    for (const part of asset.parts) {
      const mesh = part.meshData;
      assert.ok(mesh.vertices.length >= 4 && mesh.vertices.length <= 20000);
      assert.ok(mesh.faces.length >= 4 && mesh.faces.length <= 20000);
    }

    const bbox = getWorldBoundingBox(asset);
    assert.ok(Math.abs(bbox.minY) < 1e-2, `Level '${level}' must rest on Y=0, got minY=${bbox.minY}`);

    const rootFlare = asset.parts.find((p: any) => p.name === 'RootFlare');
    const mainTrunk = asset.parts.find((p: any) => p.name === 'MainTrunk');
    const clusters = asset.parts.filter((p: any) => String(p.name).startsWith('FoliageCluster_'));
    const branches = asset.parts.filter((p: any) => String(p.name).startsWith('Branch_'));

    assert.ok(rootFlare, `Level '${level}' must include RootFlare`);
    assert.ok(mainTrunk, `Level '${level}' must include MainTrunk`);
    assert.ok(branches.length >= 4, `Level '${level}' should include natural branches`);
    assert.ok(clusters.length >= 4, `Level '${level}' should include varied foliage clusters`);

    // RootFlare must be noticeably wider than MainTrunk bottom
    assert.ok(
      rootFlare.size[0] > mainTrunk.size[0] * 1.15,
      `RootFlare width (${rootFlare.size[0]}) must flare beyond MainTrunk (${mainTrunk.size[0]})`
    );

    // Curved MainTrunk must visibly deflect horizontally compared to an uncurved (0) trunk
    const uncurved = synthesizeSeededProcedural3DAsset({
      name: `UncurvedRef_${level}`,
      category: 'Trees & Vegetation',
      seed: 'fantasy-tree-benchmark-2026',
      tree_params: {
        ...parsed.params,
        trunkCurvature: 0,
        detailLevel: level,
        seed: 'fantasy-tree-benchmark-2026',
      },
    });
    const uncurvedTrunk = uncurved.parts.find((p: any) => p.name === 'MainTrunk');
    assert.ok(uncurvedTrunk);
    assert.ok(
      mainTrunk.size[0] > uncurvedTrunk.size[0] + 0.12,
      `Curved MainTrunk X span (${mainTrunk.size[0]}) must exceed uncurved trunk (${uncurvedTrunk.size[0]})`
    );

    // Reddish foliage check (R > G and R > B)
    for (const cluster of clusters) {
      const [r, g, b] = cluster.color;
      assert.ok(r > g + 35 && r > b + 35, `Expected reddish foliage on ${cluster.name}, got [${r},${g},${b}]`);
    }

    // Meaningful size variation across foliage clusters
    const volumes = clusters.map((c: any) => c.size[0] * c.size[1] * c.size[2]);
    const ratio = Math.max(...volumes) / Math.max(1e-6, Math.min(...volumes));
    assert.ok(ratio >= 1.35, `Expected varied cluster volumes (ratio >= 1.35), got ${ratio.toFixed(2)}`);
  }

  // Cross-seed variation & determinism
  const seedA = synthesizeSeededProcedural3DAsset({
    name: 'SeedDeterminismCheck',
    category: 'Trees & Vegetation',
    prompt: BENCHMARK_FANTASY_TREE_PROMPT,
    seed: 'seed-alpha',
  });
  const seedARepeat = synthesizeSeededProcedural3DAsset({
    name: 'SeedDeterminismCheck',
    category: 'Trees & Vegetation',
    prompt: BENCHMARK_FANTASY_TREE_PROMPT,
    seed: 'seed-alpha',
  });
  const seedB = synthesizeSeededProcedural3DAsset({
    name: 'SeedDeterminismCheck',
    category: 'Trees & Vegetation',
    prompt: BENCHMARK_FANTASY_TREE_PROMPT,
    seed: 'seed-beta',
  });

  assert.equal(computeCanonicalAssetHash(seedA as any), computeCanonicalAssetHash(seedARepeat as any));
  assert.notEqual(computeCanonicalAssetHash(seedA as any), computeCanonicalAssetHash(seedB as any));
});

test('Mission E2E 3 — Todos los exportadores (Luau, RBXMX, GLTF, OBJ/MTL) manejan colores hex y producen artefactos sin NaN ni rbxassetid inventados', () => {
  const asset = synthesizeSeededProcedural3DAsset({
    name: 'BenchmarkFantasyTreeExport',
    category: 'Trees & Vegetation',
    prompt: BENCHMARK_FANTASY_TREE_PROMPT,
    seed: 'export-check-2026',
  });

  // Inject hex color on one foliage part to verify server & client exporters handle #RRGGBB safely
  const hexMutatedParts = asset.parts.map((part: any, i: number) =>
    i === asset.parts.length - 1 ? { ...part, color: '#ef4444' } : part
  );
  const mutatedAsset: any = { ...asset, parts: hexMutatedParts };
  const modelName = String(mutatedAsset.name || 'BenchmarkFantasyTreeExport');

  const serverLuau = buildStrictLuauFromEditedParts(modelName, hexMutatedParts, 'Hull');
  assert.match(serverLuau, /^--!strict/);
  assert.match(serverLuau, /Color3\.fromRGB\(239, 68, 68\)/);
  assert.doesNotMatch(serverLuau, /NaN/);
  assert.doesNotMatch(serverLuau, /rbxassetid:\/\/\d+/);

  const serverRbxmx = buildRbxmxFromPartsServer(modelName, hexMutatedParts, 'Hull', 'Trees & Vegetation', serverLuau);
  assert.match(serverRbxmx, /<roblox/);
  assert.doesNotMatch(serverRbxmx, /NaN/);
  assert.doesNotMatch(serverRbxmx, /rbxassetid:\/\/\d+/);

  const serverGltf = JSON.parse(buildGltfFromPartsServer(modelName, hexMutatedParts));
  assert.equal(serverGltf.asset.version, '2.0');
  assert.equal(serverGltf.meshes.length, hexMutatedParts.length);

  const serverObjMtl = buildObjAndMtlFromPartsServer(modelName, hexMutatedParts);
  assert.match(serverObjMtl.obj, /^mtllib BenchmarkFantasyTreeExport\.mtl/m);
  assert.match(serverObjMtl.mtl, /0\.9373 0\.2667 0\.2667/);
  assert.doesNotMatch(serverObjMtl.obj, /NaN/);

  // Client exporters parity
  const clientRbxmx = exportAssetToRBXMX(mutatedAsset as any);
  const clientGltf = JSON.parse(exportAssetToGLTF(mutatedAsset as any));
  const clientObjMtl = exportAssetToOBJWithMTL(mutatedAsset as any);
  assert.match(clientRbxmx, /<roblox/);
  assert.equal(clientGltf.meshes.length, hexMutatedParts.length);
  assert.doesNotMatch(clientObjMtl.mtl, /NaN/);
});

test('Mission E2E 4 — forgeApiClient inyecta X-Forge-Token y Authorization desde localStorage sin hardcodear secretos', () => {
  const storage = new Map<string, string>();
  const prevWindow = (globalThis as any).window;
  (globalThis as any).window = {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    },
  };

  try {
    assert.equal(getStoredForgeToken(), '');
    assert.deepEqual(getForgeAuthHeaders({ 'Content-Type': 'application/json' }), {
      'Content-Type': 'application/json',
    });

    setStoredForgeToken('tok_mission_secure_123');
    assert.equal(storage.get(FORGE_TOKEN_STORAGE_KEY), 'tok_mission_secure_123');
    assert.equal(getStoredForgeToken(), 'tok_mission_secure_123');

    const headers = getForgeAuthHeaders({ 'X-Custom': 'yes' });
    assert.equal(headers['X-Forge-Token'], 'tok_mission_secure_123');
    assert.equal(headers['Authorization'], 'Bearer tok_mission_secure_123');
    assert.equal(headers['X-Custom'], 'yes');

    setStoredForgeToken('');
    assert.equal(getStoredForgeToken(), '');
  } finally {
    if (prevWindow === undefined) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = prevWindow;
    }
  }
});

test('Mission E2E 5 — Flujo autenticado completo: rechazo 401 sin token -> generación árbol benchmark -> Bridge -> Recibo estricto -> edición color hex + tamaño -> SyncDiff', async () => {
  const token = `tok_${crypto.randomBytes(16).toString('hex')}`;
  const bridgeSecret = `brg_${crypto.randomBytes(24).toString('hex')}`;
  const pluginToken = `plg_${crypto.randomBytes(16).toString('hex')}`;

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-mission-e2e-full-'));
  const tmpRojo = path.join(tmpRoot, 'rojo_workspace');
  fs.mkdirSync(path.join(tmpRojo, 'src/shared/Assets3D'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRojo, 'default.project.json'),
    JSON.stringify({ name: 'MissionTreePlace', tree: { $className: 'DataModel' } }),
    'utf-8'
  );
  const bridgeStateFile = path.join(tmpRoot, 'bridge_state.json');

  const cloudRuntime = createMainServerApp({
    nodeEnv: 'production',
    securityToken: token,
    bridgeSharedSecret: bridgeSecret,
    rojoProjectPath: tmpRojo,
  });
  const cloudBound = await listenOnEphemeralPort(cloudRuntime.app);

  let bridgeRuntime: ReturnType<typeof createForgeLocalBridgeApp> | null = null;
  try {
    // Verify Cloud rejects unauthenticated access to protected GET & POST routes with 401
    const unauthStatusRes = await fetch(`${cloudBound.baseUrl}/api/v1/bridge/status`);
    assert.equal(unauthStatusRes.status, 401);
    const unauthGenRes = await fetch(`${cloudBound.baseUrl}/api/v1/generate-3d`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test', category: 'Trees & Vegetation' }),
    });
    assert.equal(unauthGenRes.status, 401);

    bridgeRuntime = createForgeLocalBridgeApp({
      port: 0,
      cloudUrl: cloudBound.baseUrl,
      sharedSecret: bridgeSecret,
      pluginLocalToken: pluginToken,
      rojoProjectPath: tmpRojo,
      heartbeatIntervalMs: 40,
      taskTimeoutMs: 6000,
      autoConnectCloud: true,
      stateFilePath: bridgeStateFile,
    });
    const bridgeSrv = await bridgeRuntime.start();
    const bridgeAddr = bridgeSrv.address();
    assert.ok(bridgeAddr && typeof bridgeAddr !== 'string');
    const bridgeBaseUrl = `http://127.0.0.1:${bridgeAddr.port}`;

    // Verify Bridge rejects wrong plugin token with 401
    const badPluginRes = await fetch(`${bridgeBaseUrl}/local/plugin/poll`, {
      headers: { 'X-Plugin-Token': 'wrong-token' },
    });
    assert.equal(badPluginRes.status, 401);

    // Wait for Bridge HMAC auth to Cloud
    let connected = false;
    for (let i = 0; i < 40; i++) {
      if (bridgeRuntime.cloudClient.getStatus().connected) {
        connected = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 35));
    }
    assert.equal(connected, true);

    // Generate benchmark tree via authenticated REST API
    const genRes = await fetch(`${cloudBound.baseUrl}/api/v1/generate-3d`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forge-Token': token,
      },
      body: JSON.stringify({
        name: 'FantasyLowPolyTree',
        category: 'Trees & Vegetation',
        prompt: BENCHMARK_FANTASY_TREE_PROMPT,
        generation_mode: 'procedural',
        seed: 'fantasy-e2e-2026',
        save_to_rojo: true,
        save_to_library: true,
      }),
    });
    assert.equal(genRes.status, 200);
    const treeAsset: any = await genRes.json();
    assert.equal(treeAsset.name, 'FantasyLowPolyTree');
    assert.ok(Array.isArray(treeAsset.parts) && treeAsset.parts.length >= 8);

    // Enqueue reconstruction task
    const expectedHash = computeCanonicalAssetHash(treeAsset);
    const enqPromise = fetch(`${cloudBound.baseUrl}/api/v1/bridge/enqueue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forge-Token': token,
      },
      body: JSON.stringify({
        operation: 'studio.reconstruct_model',
        payload: {
          assetId: treeAsset.id,
          name: treeAsset.name,
          parts: treeAsset.parts,
        },
        wait_for_completion: true,
        timeout_ms: 5500,
      }),
    });

    let polledTask: any = null;
    for (let i = 0; i < 40; i++) {
      const pollRes = await fetch(`${bridgeBaseUrl}/local/plugin/poll`, {
        headers: { 'X-Plugin-Token': pluginToken },
      });
      assert.equal(pollRes.status, 200);
      const pollJson: any = await pollRes.json();
      if (Array.isArray(pollJson.pendingTasks) && pollJson.pendingTasks.length > 0) {
        polledTask = pollJson.pendingTasks[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 35));
    }
    assert.ok(polledTask);

    // Submit strict Studio application + reconstruction receipt
    const partIds = treeAsset.parts.map((p: any) => p.partId);
    const resultRes = await fetch(`${bridgeBaseUrl}/local/plugin/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Token': pluginToken,
      },
      body: JSON.stringify({
        taskId: polledTask.taskId,
        status: 'completed',
        result: {
          taskId: polledTask.taskId,
          operationId: polledTask.taskId,
          status: 'completed',
          verified: true,
          modelName: treeAsset.name,
          expectedModelHash: expectedHash,
          appliedModelHash: expectedHash,
          expectedPartCount: treeAsset.parts.length,
          actualPartCount: treeAsset.parts.length,
          addedPartIds: partIds,
          updatedPartIds: [],
          removedPartIds: [],
          verifiedGeometryPartIds: partIds,
          failedPartIds: [],
          pendingDeletionPartIds: [],
          parts: treeAsset.parts,
        },
      }),
    });
    assert.equal(resultRes.status, 200);

    const enqRes = await enqPromise;
    assert.equal(enqRes.status, 200);
    const completedEnvelope: any = await enqRes.json();

    const receiptCheck = verifyStudioApplicationReceipt(
      completedEnvelope,
      completedEnvelope.taskId,
      treeAsset,
      expectedHash
    );
    assert.equal(receiptCheck.valid, true, receiptCheck.reason);
    assert.equal(receiptCheck.status, 'completed');

    const reconCheck = reconcileReconstructedModelFromStudio(treeAsset, completedEnvelope.result);
    assert.equal(reconCheck.valid, true, reconCheck.discrepancies.join('; '));

    // Mutate tree color + part size, test sync-diff detection & Luau rebuild without NaN
    const editedParts = treeAsset.parts.map((part: any) =>
      String(part.name).startsWith('FoliageCluster_')
        ? {
            ...part,
            color: '#ef4444',
            size: [part.size[0] * 1.15, part.size[1] * 1.15, part.size[2] * 1.15],
          }
        : part
    );
    const editedAsset = { ...treeAsset, parts: editedParts };
    const editedHash = computeCanonicalAssetHash(editedAsset);
    assert.notEqual(editedHash, expectedHash);

    const rebuildRes = await fetch(`${cloudBound.baseUrl}/api/v1/assets/rebuild-luau`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forge-Token': token,
      },
      body: JSON.stringify({
        asset: editedAsset,
        save_to_rojo: true,
        save_to_library: true,
      }),
    });
    assert.equal(rebuildRes.status, 200);
    const rebuildJson: any = await rebuildRes.json();
    assert.match(String(rebuildJson.asset?.luau_code || ''), /Color3\.fromRGB\(239, 68, 68\)/);
    assert.doesNotMatch(String(rebuildJson.asset?.luau_code || ''), /NaN/);

    const diffReport = computeDataModelSyncDiffServer(editedAsset, treeAsset.parts);
    assert.equal(diffReport.inSync, false);
    assert.ok(diffReport.modified_parts.length > 0);
    assert.ok(diffReport.modifiedMaterial.length > 0);
  } finally {
    if (bridgeRuntime) {
      await bridgeRuntime.stop();
    }
    await new Promise<void>((resolve) => cloudBound.server.close(() => resolve()));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('Mission E2E 6 — Plugin Luau ForgeAIStudioPlugin.server.luau incluye puerto 3000, resolveRgbTupleLuau y paneles URL/Token', () => {
  const pluginPath = path.resolve(process.cwd(), 'backend/roblox_plugin/ForgeAIStudioPlugin.server.luau');
  const pluginSrc = fs.readFileSync(pluginPath, 'utf-8');

  assert.ok(pluginSrc.includes('http://127.0.0.1:3000'));
  assert.ok(pluginSrc.includes('http://127.0.0.1:48720'));
  assert.ok(pluginSrc.includes('resolveRgbTupleLuau'));
  assert.ok(pluginSrc.includes('backendUrlBox'));
  assert.ok(pluginSrc.includes('bridgeUrlBox'));
  assert.ok(pluginSrc.includes('btnSaveConfig'));
  assert.ok(pluginSrc.includes('Bridge rechazó token'));
  assert.ok(pluginSrc.includes('"401"') && pluginSrc.includes('"403"'));
  assert.ok(pluginSrc.includes('#vertices > 20000 or #faces > 20000'));
});
