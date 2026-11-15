import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createMainServerApp } from '../server.ts';
import {
  synthesizeSeededProcedural3DAsset,
  validateProcedural3DGeometry,
} from '../src/server/engines/procedural3DGenerator.ts';
import {
  resolveRequestedGenerationMode,
  validateAndSanitizeDirectorBlueprint,
  buildBaselineDirectorBlueprint,
} from '../src/server/engines/aiGenerationDirector.ts';
import {
  analyzeReferenceImageBase64,
  createSyntheticSilhouettePngBase64,
  evaluateReferenceVsModelMetrics,
} from '../src/server/engines/imageReferenceProcessor.ts';
import {
  runVisualBenchmarkSuite,
  getBenchmarkCaseById,
  CANONICAL_VISUAL_BENCHMARK_CASES,
} from '../src/server/engines/visualBenchmarkSuite.ts';

const TEST_SECURITY_TOKEN = 'test-hybrid-3d-sec-token-99999';
const TEST_BRIDGE_SECRET = 'test-hybrid-3d-bridge-secret-99999';

async function withTestServer(
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const { app } = createMainServerApp({
    securityToken: TEST_SECURITY_TOKEN,
    bridgeSharedSecret: TEST_BRIDGE_SECRET,
    nodeEnv: 'test',
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('FASE 2 — Selección explícita de motores: la semilla NUNCA fuerza modo procedural cuando se elige AI, Hybrid o Image-to-3D', async () => {
  assert.equal(
    resolveRequestedGenerationMode({ generation_mode: 'ai', reference_image_base64: undefined }),
    'ai'
  );
  assert.equal(
    resolveRequestedGenerationMode({ generation_mode: 'hybrid', reference_image_base64: undefined }),
    'hybrid'
  );
  assert.equal(
    resolveRequestedGenerationMode({ generation_mode: 'image_to_3d', reference_image_base64: undefined }),
    'image_to_3d'
  );
  assert.equal(
    resolveRequestedGenerationMode({ generation_mode: 'procedural', reference_image_base64: undefined }),
    'procedural'
  );
  // Auto-detect image_to_3d when reference image is provided and mode is omitted
  const dummyPng = createSyntheticSilhouettePngBase64('vase');
  assert.equal(
    resolveRequestedGenerationMode({ generation_mode: undefined, reference_image_base64: dummyPng }),
    'image_to_3d'
  );

  await withTestServer(async (baseUrl) => {
    // 1. Requesting 'hybrid' with a seed and tree_params must preserve requested_mode='hybrid'
    // and report explicit visible fallback when GEMINI_API_KEY is not configured in test env
    const resHybrid = await fetch(`${baseUrl}/api/v1/generate-3d`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forge-Token': TEST_SECURITY_TOKEN,
      },
      body: JSON.stringify({
        prompt: 'Árbol fantástico de cristal con raíces bioluminiscentes',
        category: 'Trees & Vegetation',
        generation_mode: 'hybrid',
        seed: 77777,
        target_poly_budget: 2200,
        save_to_rojo: false,
        save_to_library: false,
      }),
    });
    assert.equal(resHybrid.status, 200);
    const hybridAsset: any = await resHybrid.json();
    assert.ok(hybridAsset.execution_report, 'Debe incluir execution_report');
    assert.equal(hybridAsset.execution_report.requested_mode, 'hybrid');
    assert.equal(hybridAsset.execution_report.seed, 77777);
    assert.equal(hybridAsset.execution_report.seed_preserved, true);
    if (!hybridAsset.execution_report.ai_provider_available) {
      assert.equal(hybridAsset.execution_report.executed_mode, 'hybrid_fallback_procedural');
      assert.equal(hybridAsset.execution_report.fallback_triggered, true);
      assert.ok(
        typeof hybridAsset.execution_report.fallback_reason === 'string' &&
          hybridAsset.execution_report.fallback_reason.length > 5
      );
    }

    // 2. Requesting 'ai' with strict_ai=true when GEMINI_API_KEY is absent must return 503 AI_PROVIDER_UNAVAILABLE
    if (!process.env.GEMINI_API_KEY) {
      const resStrictAi = await fetch(`${baseUrl}/api/v1/generate-3d`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forge-Token': TEST_SECURITY_TOKEN,
        },
        body: JSON.stringify({
          prompt: 'Torre medieval modular',
          category: 'Buildings & Structures',
          generation_mode: 'ai',
          strict_ai: true,
          seed: 4242,
          save_to_rojo: false,
          save_to_library: false,
        }),
      });
      assert.equal(resStrictAi.status, 503);
      const errBody: any = await resStrictAi.json();
      assert.equal(errBody.error_code, 'AI_PROVIDER_UNAVAILABLE');
      assert.equal(errBody.requested_mode, 'ai');
    }
  });
});

test('FASE 3 & 6 — Motores geométricos especializados, presupuesto de polígonos real (target_poly_budget) y niveles de detalle (detailLevel)', () => {
  // 1. Verify target_poly_budget & detailLevel scale real triangle counts significantly for Trees
  const lowBudgetTree = synthesizeSeededProcedural3DAsset({
    prompt: 'Roble antiguo con raíces y ramas',
    category: 'Trees & Vegetation',
    seed: 9001,
    target_poly_budget: 750,
    tree_params: {
      seed: 9001,
      detailLevel: 'low',
      branchCount: 4,
      foliageCount: 4,
    },
  });
  const highBudgetTree = synthesizeSeededProcedural3DAsset({
    prompt: 'Roble antiguo con raíces y ramas',
    category: 'Trees & Vegetation',
    seed: 9001,
    target_poly_budget: 3400,
    tree_params: {
      seed: 9001,
      detailLevel: 'high',
      branchCount: 6,
      foliageCount: 6,
    },
  });

  assert.ok(
    highBudgetTree.poly_count > lowBudgetTree.poly_count * 1.45,
    `High budget tree (${highBudgetTree.poly_count} tris) debe superar ampliamente a low budget tree (${lowBudgetTree.poly_count} tris)`
  );
  // Check recursive branching & surface roots in trees
  const treePartNames: string[] = highBudgetTree.parts.map((p: any) => String(p.name));
  assert.ok(treePartNames.some((n: string) => n === 'RootFlare'));
  assert.ok(treePartNames.some((n: string) => n.startsWith('SurfaceRoot_')));
  assert.ok(treePartNames.some((n: string) => n === 'MainTrunk'));
  assert.ok(treePartNames.some((n: string) => n.startsWith('Branch_')));
  assert.ok(treePartNames.some((n: string) => n.startsWith('SubBranch_')));
  assert.ok(treePartNames.some((n: string) => n === 'CanopyCrown_Main'));
  assert.ok(treePartNames.some((n: string) => n.startsWith('FoliageCluster_')));

  // 2. Verify target_poly_budget scales non-tree categories (e.g. Deformed Icosphere Rocks)
  const lowRock = synthesizeSeededProcedural3DAsset({
    prompt: 'Roca geológica fracturada con estratos',
    category: 'Rocks & Nature',
    seed: 31337,
    target_poly_budget: 650,
  });
  const highRock = synthesizeSeededProcedural3DAsset({
    prompt: 'Roca geológica fracturada con estratos',
    category: 'Rocks & Nature',
    seed: 31337,
    target_poly_budget: 3200,
  });
  assert.ok(
    highRock.poly_count > lowRock.poly_count * 1.4,
    `High budget rock (${highRock.poly_count} tris) debe tener significativamente más triángulos que low budget rock (${lowRock.poly_count} tris)`
  );
  assert.ok(lowRock.parts.length >= 6, 'La formación rocosa debe tener al menos 6 sub-partes geológicas');

  // 3. Verify specialized Building, Chair, Lamp, Mechanical, and Scene3D structures
  const building = synthesizeSeededProcedural3DAsset({
    prompt: 'Edificio torre medieval con puerta en arco, ventanas, columnas y tejado',
    category: 'Buildings & Structures',
    seed: 4444,
    target_poly_budget: 2400,
  });
  const bNames: string[] = building.parts.map((p: any) => String(p.name));
  assert.ok(bNames.includes('SteppedStoneFoundation'));
  assert.ok(bNames.includes('ArchedDoorFrame'));
  assert.ok(bNames.includes('TimberDoorLeaf'));
  assert.ok(bNames.some((n: string) => n.startsWith('FramedWindow_')));
  assert.ok(bNames.some((n: string) => n.startsWith('CornerColumn_')));
  assert.ok(bNames.includes('PitchedRoofCrown'));

  const chair = synthesizeSeededProcedural3DAsset({
    prompt: 'Silla trono ergonómica con respaldo tallado y reposabrazos',
    category: 'Furniture & Interior',
    seed: 5555,
    target_poly_budget: 1800,
  });
  const cNames: string[] = chair.parts.map((p: any) => String(p.name));
  assert.ok(cNames.includes('ChairLeg_FrontLeft'));
  assert.ok(cNames.includes('UpholsteredSeatCushion'));
  assert.ok(cNames.includes('ErgonomicBackrestPanel'));
  assert.ok(cNames.includes('CurvedArmrest_Left'));

  const mech = synthesizeSeededProcedural3DAsset({
    prompt: 'Motor mecánico industrial con engranajes dentados y pistones hidráulicos',
    category: 'Props',
    seed: 7777,
    target_poly_budget: 2400,
  });
  const mNames: string[] = mech.parts.map((p: any) => String(p.name));
  assert.ok(mNames.includes('PrimaryDriveGear'));
  assert.ok(mNames.includes('SecondaryPinionGear'));
  assert.ok(mNames.includes('HydraulicPiston_Left'));

  const scene = synthesizeSeededProcedural3DAsset({
    prompt: 'Escenario santuario con terreno, pabellón, árbol, rocas y faroles',
    category: 'Scene3D',
    asset_type: 'Scene3D',
    seed: 8888,
    target_poly_budget: 3600,
  });
  assert.equal(scene.asset_type, 'Scene3D');
  const sceneParents = new Set(scene.parts.map((p: any) => String(p.parentPath || p.parent)));
  assert.ok(sceneParents.has('Root/Zone_Terrain'));
  assert.ok(sceneParents.has('Root/Zone_FocalStructure'));
  assert.ok(sceneParents.has('Root/Zone_Vegetation'));
  assert.ok(sceneParents.has('Root/Zone_Rocks'));
  assert.ok(sceneParents.has('Root/Zone_Lighting'));
});

test('FASE 4 — IA como Director de Generación: validación y saneamiento estricto del blueprint antes de construir geometría', () => {
  const fallback = buildBaselineDirectorBlueprint({
    prompt: 'Farol mágico de hierro forjado',
    category: 'Ambient & Decoration',
    target_poly_budget: 1800,
  });

  const sanitized = validateAndSanitizeDirectorBlueprint(
    {
      objectFamily: 'lamp',
      style: 'Stylized',
      targetPolyBudget: 999999, // out-of-range -> clamped to 9000
      proportions: {
        widthStuds: -5, // invalid -> clamped
        heightStuds: 12.5,
        depthStuds: 4.2,
        symmetry: 'radial',
      },
      materialPalette: {
        primaryHex: 'not-a-color', // invalid -> fallback hex
        secondaryHex: '#38bdf8',
      },
      subPartsPlan: [], // empty -> populated from baseline
    },
    fallback
  );

  assert.equal(sanitized.blueprintVersion, 'forge-director-v3');
  assert.equal(sanitized.objectFamily, 'lamp');
  assert.equal(sanitized.targetPolyBudget, 9000);
  assert.ok(sanitized.proportions.widthStuds >= 0.8);
  assert.equal(sanitized.proportions.heightStuds, 12.5);
  assert.equal(sanitized.materialPalette.secondaryHex, '#38bdf8');
  assert.ok(sanitized.subPartsPlan.length >= 4);
});

test('FASE 5 — Procesamiento real de imagen de referencia (Image-to-3D): extracción de silueta 2D, proporciones, paleta RGB y reconstrucción 3D coherente', () => {
  // Create two distinct real PNG silhouettes: a tall narrow crimson tower vs a wide emerald tree
  const towerPngB64 = createSyntheticSilhouettePngBase64('tower', 64, 64, [220, 38, 38]);
  const treePngB64 = createSyntheticSilhouettePngBase64('tree', 64, 64, [16, 185, 129]);

  const towerAnalysis = analyzeReferenceImageBase64(towerPngB64);
  const treeAnalysis = analyzeReferenceImageBase64(treePngB64);

  assert.equal(towerAnalysis.valid, true);
  assert.equal(towerAnalysis.format, 'png');
  assert.equal(towerAnalysis.width, 64);
  assert.equal(towerAnalysis.height, 64);

  assert.equal(treeAnalysis.valid, true);
  assert.equal(treeAnalysis.format, 'png');

  // Tower top slices are narrower than tree top canopy slices
  const towerTopAvg =
    towerAnalysis.verticalWidthProfile.slice(10, 14).reduce((a, b) => a + b, 0) / 4;
  const treeTopAvg =
    treeAnalysis.verticalWidthProfile.slice(10, 14).reduce((a, b) => a + b, 0) / 4;
  assert.ok(
    treeTopAvg > towerTopAvg * 1.25,
    `El perfil superior del árbol (${treeTopAvg}) debe ser más ancho que el de la torre (${towerTopAvg})`
  );

  // Synthesize 3D models from each reference image in image_to_3d mode
  const tower3D = synthesizeSeededProcedural3DAsset({
    prompt: 'Modelo 3D reconstruido desde silueta de torre',
    category: 'Props',
    generation_mode: 'image_to_3d',
    seed: 101,
    target_poly_budget: 2000,
    reference_image_base64: towerPngB64,
  });

  const tree3D = synthesizeSeededProcedural3DAsset({
    prompt: 'Modelo 3D reconstruido desde silueta de árbol',
    category: 'Props',
    generation_mode: 'image_to_3d',
    seed: 101,
    target_poly_budget: 2000,
    reference_image_base64: treePngB64,
  });

  assert.ok(tower3D.reference_image_analysis);
  assert.ok(tower3D.reference_comparison_metrics);
  assert.ok(
    tower3D.reference_comparison_metrics!.silhouetteMatchIoU >= 0.55,
    `IoU de silueta de torre (${tower3D.reference_comparison_metrics!.silhouetteMatchIoU}) debe ser >= 0.55`
  );
  assert.ok(
    tree3D.reference_comparison_metrics!.silhouetteMatchIoU >= 0.55,
    `IoU de silueta de árbol (${tree3D.reference_comparison_metrics!.silhouetteMatchIoU}) debe ser >= 0.55`
  );

  const compCheck = evaluateReferenceVsModelMetrics(towerAnalysis, tower3D.parts);
  assert.ok(compCheck.silhouetteMatchIoU >= 0.55);
});

test('FASE 7 — Suite de 8 Benchmarks Visuales Canónicos y endpoints HTTP de verificación', async () => {
  const suiteReport = runVisualBenchmarkSuite();
  assert.equal(suiteReport.suiteVersion, 'forge-visual-benchmark-v3');
  assert.equal(suiteReport.totalCases, 8);
  assert.equal(suiteReport.cases.length, 8);

  for (const bm of suiteReport.cases) {
    assert.equal(bm.validation.valid, true, `Benchmark ${bm.id} debe tener geometría válida`);
    assert.equal(
      bm.editableMeshCompliant,
      true,
      `Benchmark ${bm.id} debe cumplir límites EditableMesh`
    );
    assert.equal(bm.degenerateTriangles, 0, `Benchmark ${bm.id} no debe tener triángulos degenerados`);
    assert.equal(bm.groundedAtZero, true, `Benchmark ${bm.id} debe estar apoyado en Y=0 (minY=${bm.boundingBoxStuds.minY})`);
    assert.equal(
      bm.lodMetrics.monotonicReduction,
      true,
      `Benchmark ${bm.id} debe tener reducción monotónica LOD0 (${bm.lodMetrics.lod0Triangles}) > LOD1 (${bm.lodMetrics.lod1Triangles}) >= LOD2 (${bm.lodMetrics.lod2Triangles})`
    );
    assert.ok(bm.partCount >= 6, `Benchmark ${bm.id} debe tener al menos 6 sub-partes articuladas`);
    assert.ok(bm.triangleCount >= 400, `Benchmark ${bm.id} debe tener geometría rica (>= 400 tris, actual=${bm.triangleCount})`);
  }

  assert.equal(suiteReport.allCasesPassed, true, 'Los 8 casos de benchmark deben aprobar al 100%');

  await withTestServer(async (baseUrl) => {
    const resSuite = await fetch(`${baseUrl}/api/v1/benchmarks/visual-suite`, {
      headers: { 'X-Forge-Token': TEST_SECURITY_TOKEN },
    });
    assert.equal(resSuite.status, 200);
    const jsonSuite: any = await resSuite.json();
    assert.equal(jsonSuite.totalCases, 8);
    assert.equal(jsonSuite.allCasesPassed, true);

    const resCase = await fetch(`${baseUrl}/api/v1/benchmarks/generate-case`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forge-Token': TEST_SECURITY_TOKEN,
      },
      body: JSON.stringify({
        case_id: 'mechanical_gearbox',
        save_to_rojo: false,
        save_to_library: false,
      }),
    });
    assert.equal(resCase.status, 200);
    const jsonCase: any = await resCase.json();
    assert.equal(jsonCase.benchmark.id, 'mechanical_gearbox');
    assert.ok(Array.isArray(jsonCase.asset.parts) && jsonCase.asset.parts.length >= 6);
    assert.ok(
      validateProcedural3DGeometry(jsonCase.asset.parts).valid,
      'El asset devuelto por /api/v1/benchmarks/generate-case debe ser geométricamente válido'
    );
  });

  // Verify getBenchmarkCaseById for all 8 IDs
  for (const spec of CANONICAL_VISUAL_BENCHMARK_CASES) {
    const found = getBenchmarkCaseById(spec.id);
    assert.ok(found, `Debe existir el caso ${spec.id}`);
  }
});
