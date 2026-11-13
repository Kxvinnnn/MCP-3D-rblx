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
  TreeProceduralParams,
} from '../src/server/engines/procedural3DGenerator.ts';
import { parseNaturalLanguageToTreeParams } from '../src/utils/treePromptParser.ts';
import { validateRobloxGeometry } from '../src/utils/robloxGeometryValidator.ts';
import { computeCanonicalAssetHash } from '../src/utils/canonicalHash.ts';
import {
  reconcileReconstructedModelFromStudio,
  verifyPersistedAssetContent,
} from '../src/utils/receiptVerification.ts';
import {
  exportAssetToGLTF,
  exportAssetToOBJWithMTL,
  exportAssetToRBXMX,
  generateEditableMeshLuauCode,
  resolveRgbTuple,
} from '../src/utils/roblox3DEngine.ts';

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

function measureTreeGeometryMetrics(asset: any) {
  let totalVertices = 0;
  let totalTriangles = 0;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const parts = Array.isArray(asset?.parts) ? asset.parts : [];
  assert.ok(parts.length > 0, `Asset '${asset?.name}' must contain parts`);

  for (const part of parts) {
    const mesh = part.meshData || part.baseMeshData;
    assert.ok(mesh, `Part '${part.name}' must include meshData`);
    const verts: number[][] = Array.isArray(mesh.vertices) ? mesh.vertices : [];
    const normals: number[][] = Array.isArray(mesh.normals) ? mesh.normals : [];
    const uvs: number[][] = Array.isArray(mesh.uvs) ? mesh.uvs : [];
    const faces: number[][] = Array.isArray(mesh.faces) ? mesh.faces : [];

    assert.ok(verts.length >= 4 && verts.length <= 20000, `Part '${part.name}' vertex count ${verts.length} out of [4..20000]`);
    assert.ok(faces.length >= 4 && faces.length <= 20000, `Part '${part.name}' face count ${faces.length} out of [4..20000]`);
    assert.equal(normals.length, verts.length, `Part '${part.name}' normals length mismatch`);
    assert.equal(uvs.length, verts.length, `Part '${part.name}' uvs length mismatch`);

    const px = Number(part.position?.[0] ?? 0);
    const py = Number(part.position?.[1] ?? 0);
    const pz = Number(part.position?.[2] ?? 0);

    for (let i = 0; i < verts.length; i++) {
      const [vx, vy, vz] = verts[i];
      assert.ok(Number.isFinite(vx) && Number.isFinite(vy) && Number.isFinite(vz), 'Vertex must be finite');
      const wx = px + vx;
      const wy = py + vy;
      const wz = pz + vz;
      if (wx < minX) minX = wx;
      if (wy < minY) minY = wy;
      if (wz < minZ) minZ = wz;
      if (wx > maxX) maxX = wx;
      if (wy > maxY) maxY = wy;
      if (wz > maxZ) maxZ = wz;

      const [nx, ny, nz] = normals[i];
      const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
      assert.ok(Math.abs(nLen - 1) < 1e-2, `Normal must be unit length in ${part.name} (got ${nLen})`);

      const [u, v] = uvs[i];
      assert.ok(Number.isFinite(u) && Number.isFinite(v), 'UV must be finite');
      assert.ok(u >= -1e-5 && u <= 1 + 1e-5 && v >= -1e-5 && v <= 1 + 1e-5, `UV out of [0,1] in ${part.name}: (${u},${v})`);
    }

    for (const face of faces) {
      assert.ok(face.length >= 3, 'Face must have >= 3 indices');
      for (const idx of face) {
        assert.ok(Number.isInteger(idx) && idx >= 0 && idx < verts.length, `Face index ${idx} out of bounds`);
      }
      const a = verts[face[0]];
      const b = verts[face[1]];
      const c = verts[face[2]];
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const abz = b[2] - a[2];
      const acx = c[0] - a[0];
      const acy = c[1] - a[1];
      const acz = c[2] - a[2];
      const cx = aby * acz - abz * acy;
      const cy = abz * acx - abx * acz;
      const cz = abx * acy - aby * acx;
      const area = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
      assert.ok(area > 1e-10, `Degenerate triangle detected in ${part.name} (area=${area})`);
    }

    totalVertices += verts.length;
    totalTriangles += faces.length;
  }

  return {
    partCount: parts.length,
    totalVertices,
    totalTriangles,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    depth: maxZ - minZ,
  };
}

test('Fase 3 — NLP Tree Prompt Parser convierte descripción en español/inglés a parámetros estructurados', () => {
  const prompt =
    'Genera un árbol de fantasía con tronco grueso, copa amplia, hojas rojizas y estilo low-poly';
  const parsed = parseNaturalLanguageToTreeParams(prompt);

  assert.equal(parsed.isTreePrompt, true);
  assert.ok(parsed.detectedKeywords.includes('thick_trunk'));
  assert.ok(parsed.detectedKeywords.includes('wide_canopy'));
  assert.ok(parsed.detectedKeywords.includes('red_foliage'));
  assert.ok(parsed.detectedKeywords.includes('low_poly'));
  assert.ok((parsed.params.trunkThickness ?? 0) >= 2.5);
  assert.ok((parsed.params.canopySize ?? 0) >= 1.3);
  assert.equal(parsed.params.leafColor, '#b91c1c');
  assert.equal(parsed.params.detailLevel, 'low');

  // Asegurar integración automática en synthesizeSeededProcedural3DAsset cuando no se pasa tree_params
  const synthesized = synthesizeSeededProcedural3DAsset({
    name: 'FantasyLowPolyTree',
    category: 'Trees & Vegetation',
    prompt,
    seed: 'nlp-auto-tree-2026',
  });
  const metrics = measureTreeGeometryMetrics(synthesized);
  assert.ok(metrics.totalTriangles > 0);
  const geo = validateRobloxGeometry(synthesized as any);
  assert.equal(geo.isValid, true, geo.errors.join('; '));
});

test('Fase 3 — Matriz de los 7 tipos de árbol 3D: validación geométrica, grounding Y=0, LODs monotónicos y determinismo por semilla', () => {
  const presets: Array<{ id: string; tree_params: TreeProceduralParams }> = [
    {
      id: 'small_tree',
      tree_params: {
        seed: 'preset-small-01',
        height: 7.5,
        width: 5.5,
        trunkThickness: 0.9,
        branchCount: 3,
        canopyShape: 'spherical',
        leafDistribution: 'balanced',
        detailLevel: 'medium',
      },
    },
    {
      id: 'tall_tree',
      tree_params: {
        seed: 'preset-tall-02',
        height: 26,
        width: 9,
        trunkThickness: 1.9,
        branchCount: 6,
        canopyShape: 'conical',
        branchDistribution: 'whorled',
        leafDistribution: 'balanced',
        detailLevel: 'medium',
      },
    },
    {
      id: 'lush_tree',
      tree_params: {
        seed: 'preset-lush-03',
        height: 16,
        width: 15,
        trunkThickness: 2.2,
        branchCount: 8,
        canopyShape: 'spherical',
        leafDistribution: 'dense',
        foliageDensity: 1.45,
        foliageCount: 8,
        canopySize: 1.35,
        detailLevel: 'high',
      },
    },
    {
      id: 'dry_tree',
      tree_params: {
        seed: 'preset-dry-04',
        height: 15,
        width: 8,
        trunkThickness: 1.6,
        branchCount: 7,
        canopyShape: 'layered',
        leafDistribution: 'sparse',
        foliageCount: 0,
        foliageDensity: 0.25,
        canopySize: 0.45,
        trunkMaterial: 'WoodPlanks',
        detailLevel: 'medium',
      },
    },
    {
      id: 'stylized_tree',
      tree_params: {
        seed: 'preset-stylized-05',
        height: 13,
        width: 11,
        trunkThickness: 2.0,
        branchCount: 4,
        canopyShape: 'layered',
        branchDistribution: 'tiered',
        leafDistribution: 'clustered',
        trunkColor: '#4a3531',
        leafColor: '#f472b6',
        colorVariation: 0.3,
        detailLevel: 'low',
      },
    },
    {
      id: 'irregular_tree',
      tree_params: {
        seed: 'preset-irregular-06',
        height: 17,
        width: 12,
        trunkThickness: 2.1,
        trunkLean: 14,
        trunkCurvature: 0.65,
        branchCount: 6,
        canopyShape: 'weeping',
        leafDistribution: 'clustered',
        variation: 0.65,
        leafVariation: 0.6,
        colorVariation: 0.4,
        detailLevel: 'medium',
      },
    },
    {
      id: 'multi_lod_tree',
      tree_params: {
        seed: 'preset-multilod-07',
        height: 18,
        width: 11,
        trunkThickness: 1.8,
        branchCount: 5,
        canopyShape: 'spherical',
        leafDistribution: 'dense',
        detailLevel: 'high',
        lodLevel: 0,
      },
    },
  ];

  for (const preset of presets) {
    const assetA = synthesizeSeededProcedural3DAsset({
      name: `Tree_${preset.id}`,
      category: 'Trees & Vegetation',
      seed: preset.tree_params.seed,
      tree_params: preset.tree_params,
    });
    const assetB = synthesizeSeededProcedural3DAsset({
      name: `Tree_${preset.id}`,
      category: 'Trees & Vegetation',
      seed: preset.tree_params.seed,
      tree_params: preset.tree_params,
    });

    // Determinismo exacto con misma semilla
    assert.equal(
      computeCanonicalAssetHash(assetA as any),
      computeCanonicalAssetHash(assetB as any),
      `Preset ${preset.id} must be deterministic by seed`
    );

    const validation = validateRobloxGeometry(assetA as any);
    assert.equal(
      validation.isValid,
      true,
      `Preset ${preset.id} failed geometry validation: ${validation.errors.join('; ')}`
    );

    const metrics = measureTreeGeometryMetrics(assetA);
    assert.ok(metrics.minY >= -0.25 && metrics.minY <= 0.5, `Preset ${preset.id} minY should rest at ground (got ${metrics.minY})`);
    assert.ok(metrics.height >= 4, `Preset ${preset.id} height too small (${metrics.height})`);
  }

  // Verificar monotonicidad LOD0 >= LOD1 >= LOD2 y presencia de lodLevels embebidos
  const lod0 = synthesizeSeededProcedural3DAsset({
    name: 'MultiLodCheck',
    category: 'Trees & Vegetation',
    seed: 'preset-multilod-07',
    tree_params: { ...presets[6].tree_params, lodLevel: 0 },
  });
  const lod1 = synthesizeSeededProcedural3DAsset({
    name: 'MultiLodCheck',
    category: 'Trees & Vegetation',
    seed: 'preset-multilod-07',
    tree_params: { ...presets[6].tree_params, lodLevel: 1 },
  });
  const lod2 = synthesizeSeededProcedural3DAsset({
    name: 'MultiLodCheck',
    category: 'Trees & Vegetation',
    seed: 'preset-multilod-07',
    tree_params: { ...presets[6].tree_params, lodLevel: 2 },
  });

  const m0 = measureTreeGeometryMetrics(lod0);
  const m1 = measureTreeGeometryMetrics(lod1);
  const m2 = measureTreeGeometryMetrics(lod2);
  assert.ok(m0.totalTriangles >= m1.totalTriangles, `Expected LOD0 (${m0.totalTriangles}) >= LOD1 (${m1.totalTriangles})`);
  assert.ok(m1.totalTriangles >= m2.totalTriangles, `Expected LOD1 (${m1.totalTriangles}) >= LOD2 (${m2.totalTriangles})`);
  assert.ok(m0.totalTriangles > m2.totalTriangles, `Expected LOD0 (${m0.totalTriangles}) > LOD2 (${m2.totalTriangles}) reduction`);
  assert.ok(Array.isArray(lod0.parts[0].meshData?.lodLevels) && lod0.parts[0].meshData.lodLevels.length >= 2);
});

test('Fase 5 & 7 — Exportadores cliente con colores hex (#RRGGBB) y Luau EditableMesh/Plugin endurecidos', () => {
  assert.deepEqual(resolveRgbTuple('#b91c1c'), [185, 28, 28]);
  assert.deepEqual(resolveRgbTuple([0.5, 1, 0]), [128, 255, 0]);

  const asset = synthesizeSeededProcedural3DAsset({
    name: 'ClientExportFantasyTree',
    category: 'Trees & Vegetation',
    prompt: 'Árbol estilizado con hojas rojizas low-poly',
    seed: 'client-export-hex-2026',
  });
  // Forzar un color hex explícito para validar robustez en todos los exportadores cliente
  const hexAsset = {
    ...asset,
    parts: asset.parts.map((p: any, idx: number) => ({
      ...p,
      color: idx === 0 ? '#5c4033' : '#b91c1c',
    })),
  };

  const rbxmx = exportAssetToRBXMX(hexAsset as any);
  assert.match(rbxmx, /<roblox/);
  assert.doesNotMatch(rbxmx, /NaN/);
  assert.doesNotMatch(rbxmx, /rbxassetid:\/\/\d+/);

  const gltf = JSON.parse(exportAssetToGLTF(hexAsset as any));
  assert.equal(gltf.asset.version, '2.0');
  assert.equal(gltf.meshes.length, hexAsset.parts.length);

  const { obj, mtl } = exportAssetToOBJWithMTL(hexAsset as any);
  assert.match(obj, /^mtllib ClientExportFantasyTree\.mtl/m);
  assert.match(mtl, /newmtl /);
  assert.doesNotMatch(mtl, /NaN/);

  const luau = generateEditableMeshLuauCode(String((asset as any).name || 'ClientExportFantasyTree'), hexAsset.parts as any);
  assert.match(luau, /^--!strict/);
  assert.match(luau, /> 20000/);
  assert.match(luau, /SetFaceNormals/);
  assert.match(luau, /GetTriangles/);
  assert.doesNotMatch(luau, /rbxassetid:\/\/\d+/);

  // Verificar plugin Luau v2.3.0 coherente y límite 20k
  const pluginPath = path.resolve(process.cwd(), 'backend/roblox_plugin/ForgeAIStudioPlugin.server.luau');
  const pluginSrc = fs.readFileSync(pluginPath, 'utf-8');
  assert.ok(pluginSrc.includes('#vertices > 20000 or #faces > 20000'), 'Plugin Luau must guard 20k vertices/faces limit');
  assert.equal(pluginSrc.includes('pluginVersion = "2.2.0"'), false, 'Plugin Luau must not have stale 2.2.0 pluginVersion');
  assert.ok(pluginSrc.includes('pluginVersion = "2.3.0"'));
});

test('Fase 8 — Flujo End-to-End Real (13 pasos): Árbol 3D -> Validación -> Paquete 5 archivos en disco -> Cloud & Local Bridge -> Studio Reconstruction Receipt', async () => {
  const token = `tok_${crypto.randomBytes(16).toString('hex')}`;
  const bridgeSecret = `brg_${crypto.randomBytes(24).toString('hex')}`;
  const pluginToken = `plg_${crypto.randomBytes(16).toString('hex')}`;

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-mission-e2e-'));
  const tmpRojo = path.join(tmpRoot, 'rojo_workspace');
  fs.mkdirSync(path.join(tmpRojo, 'src/shared/Assets3D'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpRojo, 'default.project.json'),
    JSON.stringify({ name: 'MissionTreeTest', tree: { $className: 'DataModel' } }),
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

    // Esperar a que Bridge complete handshake HMAC contra Cloud
    let connected = false;
    for (let i = 0; i < 40; i++) {
      if (bridgeRuntime.cloudClient.getStatus().connected) {
        connected = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 35));
    }
    assert.equal(connected, true, 'Bridge debe autenticarse con Cloud via HMAC');

    // Paso 1-3: Generar árbol configurable por prompt + parámetros explícitos via /api/v1/generate-3d
    const genRes = await fetch(`${cloudBound.baseUrl}/api/v1/generate-3d`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forge-Token': token,
      },
      body: JSON.stringify({
        name: 'MissionFantasyOakTree',
        category: 'Trees & Vegetation',
        prompt: 'Genera un árbol de fantasía con tronco grueso, copa amplia, hojas rojizas y estilo low-poly',
        generation_mode: 'procedural',
        seed: 'mission-e2e-oak-2026',
        height: 18,
        width: 14,
        trunkThickness: 2.6,
        branchCount: 5,
        canopyShape: 'spherical',
        leafDistribution: 'dense',
        foliageDensity: 1.35,
        lodLevel: 0,
        save_to_rojo: true,
        save_to_library: true,
      }),
    });
    assert.equal(genRes.status, 200);
    const generated: any = await genRes.json();
    assert.equal(generated.name, 'MissionFantasyOakTree');
    assert.equal(generated.robloxAssetId, null);
    assert.ok(Array.isArray(generated.parts) && generated.parts.length >= 6);

    // Paso 4: Validar geometría e invariantes del árbol
    const geoValidation = validateRobloxGeometry(generated);
    assert.equal(geoValidation.isValid, true, geoValidation.errors.join('; '));
    const treeMetrics = measureTreeGeometryMetrics(generated);
    assert.ok(treeMetrics.totalVertices > 50 && treeMetrics.totalTriangles > 50);

    // Paso 5-6: Exportar paquete completo (.luau, .rbxmx, .gltf, .obj, .mtl) a disco y biblioteca
    const exportRes = await fetch(`${cloudBound.baseUrl}/api/v1/assets/export-roblox-package`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forge-Token': token,
      },
      body: JSON.stringify({
        asset: generated,
        save_to_rojo: true,
        save_to_library: true,
      }),
    });
    assert.equal(exportRes.status, 200);
    const exportJson: any = await exportRes.json();
    assert.equal(exportJson.success, true);

    const expectedDir = path.join(tmpRojo, 'src/shared/Assets3D');
    const diskFiles = {
      luau: path.join(expectedDir, 'MissionFantasyOakTree.luau'),
      rbxmx: path.join(expectedDir, 'MissionFantasyOakTree.rbxmx'),
      gltf: path.join(expectedDir, 'MissionFantasyOakTree.gltf'),
      obj: path.join(expectedDir, 'MissionFantasyOakTree.obj'),
      mtl: path.join(expectedDir, 'MissionFantasyOakTree.mtl'),
    };

    for (const [ext, filePath] of Object.entries(diskFiles)) {
      assert.equal(fs.existsSync(filePath), true, `Exported .${ext} missing at ${filePath}`);
      assert.ok(fs.statSync(filePath).size > 20, `Exported .${ext} unexpectedly tiny`);
    }

    const diskLuau = fs.readFileSync(diskFiles.luau, 'utf-8');
    assert.match(diskLuau, /^--!strict/);
    assert.match(diskLuau, /> 20000/);
    assert.doesNotMatch(diskLuau, /rbxassetid:\/\/\d+/);

    const diskRbxmx = fs.readFileSync(diskFiles.rbxmx, 'utf-8');
    assert.match(diskRbxmx, /<roblox/);
    assert.doesNotMatch(diskRbxmx, /rbxassetid:\/\/\d+/);

    const diskGltf = JSON.parse(fs.readFileSync(diskFiles.gltf, 'utf-8'));
    assert.equal(diskGltf.asset.version, '2.0');
    assert.equal(diskGltf.meshes.length, generated.parts.length);

    const diskObj = fs.readFileSync(diskFiles.obj, 'utf-8');
    const diskMtl = fs.readFileSync(diskFiles.mtl, 'utf-8');
    assert.match(diskObj, /^o /m);
    assert.match(diskMtl, /^newmtl /m);

    // Paso 7: Plugin Studio envía heartbeat inicial al Local Bridge
    const plgHbRes = await fetch(`${bridgeBaseUrl}/local/plugin/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Token': pluginToken,
      },
      body: JSON.stringify({
        pluginVersion: '2.3.0',
        placeName: 'MissionTestPlace',
        selectedModelName: '',
        selectedPartCount: 0,
      }),
    });
    assert.equal(plgHbRes.status, 200);
    const plgHbJson: any = await plgHbRes.json();
    assert.equal(plgHbJson.cloudConnected, true);

    // Paso 8: Cloud encola reconstrucción real del árbol hacia Bridge -> Plugin
    const enqPromise = fetch(`${cloudBound.baseUrl}/api/v1/bridge/enqueue`, {
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
        timeout_ms: 5500,
      }),
    });

    // Paso 9: Plugin simulado (en ausencia de Studio GUI en Linux) hace polling en /local/plugin/poll
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
    assert.ok(polledTask, 'Studio plugin should receive studio.reconstruct_model task via /local/plugin/poll');
    assert.equal(polledTask.operation, 'studio.reconstruct_model');

    // Paso 10: Plugin devuelve recibo de reconstrucción EditableMesh verificada al Bridge
    const expectedHash = computeCanonicalAssetHash(generated);
    const submitRes = await fetch(`${bridgeBaseUrl}/local/plugin/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Plugin-Token': pluginToken,
      },
      body: JSON.stringify({
        taskId: polledTask.taskId,
        status: 'completed',
        result: {
          status: 'completed',
          modelName: generated.name,
          appliedModelHash: expectedHash,
          verifiedGeometryPartIds: generated.parts.map((p: any) => p.partId),
          failedPartIds: [],
          parts: generated.parts,
        },
      }),
    });
    assert.equal(submitRes.status, 200);
    const submitJson: any = await submitRes.json();
    assert.equal(submitJson.accepted, true);

    // Paso 11: Cloud recibe y reconcilia el resultado completo firmado
    const enqRes = await enqPromise;
    assert.equal(enqRes.status, 200);
    const completedTask: any = await enqRes.json();
    assert.equal(completedTask.status, 'completed');

    const reconciliation = reconcileReconstructedModelFromStudio(generated, completedTask.result);
    assert.equal(reconciliation.valid, true, reconciliation.discrepancies.join('; '));
    assert.equal(reconciliation.status, 'completed');
    assert.equal(reconciliation.verified, true);
    assert.equal(reconciliation.domainComparison.hashMatches, true);

    // Paso 12-13: Reconsultar biblioteca desde disco y verificar integridad post-roundtrip
    const libRes = await fetch(`${cloudBound.baseUrl}/api/v1/assets`, {
      headers: { 'X-Forge-Token': token },
    });
    assert.equal(libRes.status, 200);
    const libJson: any = await libRes.json();
    const persisted = (libJson.assets || []).find((a: any) => a.name === generated.name);
    assert.ok(persisted, 'Persisted tree asset should exist in library');
    const persistVerify = verifyPersistedAssetContent(generated, persisted);
    assert.equal(persistVerify.valid, true, persistVerify.reason);
  } finally {
    if (bridgeRuntime) {
      await bridgeRuntime.stop();
    }
    await new Promise<void>((resolve) => cloudBound.server.close(() => resolve()));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
