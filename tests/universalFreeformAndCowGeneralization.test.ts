import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';

import { createMainServerApp } from '../server.ts';
import {
  EXTERNAL_3D_MODELS_COMPARISON_MATRIX,
  executeExternal3DGeneration,
  getExternal3DAdapterStatus,
} from '../src/server/engines/external3DModelAdapter.ts';
import {
  buildBaselineDirectorBlueprint,
  inferSpecializedObjectFamily,
} from '../src/server/engines/aiGenerationDirector.ts';
import {
  analyzeReferenceImageBase64,
  evaluateReferenceVsModelMetrics,
} from '../src/server/engines/imageReferenceProcessor.ts';
import {
  synthesizeSeededProcedural3DAsset,
  validateProcedural3DGeometry,
} from '../src/server/engines/procedural3DGenerator.ts';
import { computeBudgetAllocationProfile } from '../src/server/engines/specializedGeometryGenerators.ts';
import {
  evaluateSemanticVisualIdentity,
  generateReal3DMeshesFromPlan,
  interpretPromptSemantics,
  planGeometryAndComponents,
  renderMultiAngleSvgSnapshots,
} from '../src/server/engines/universalFreeform3DEngine.ts';
import { parseNaturalLanguageToTreeParams } from '../src/utils/treePromptParser.ts';
import { resolveColorRgb255 } from '../src/utils/colorUtils.ts';
import {
  FREEFORM_GENERALIZATION_BENCHMARK_CASES,
  MANDATORY_COW_ACCEPTANCE_PROMPT,
  compareModelVariationPair,
  evaluateAssetQualityMetrics,
  persistVisualBenchmarkArtifacts,
  runFreeformGeneralizationBenchmarkSuite,
} from '../src/server/engines/visualBenchmarkSuite.ts';
import {
  buildGltfFromPartsServer,
  buildObjAndMtlFromPartsServer,
  buildRbxmxFromPartsServer,
} from '../src/server/engines/worldAndModelEditorEngine.ts';

test('SECCIÓN 3 — Evaluación técnica de modelos open-source 3D (Hunyuan3D, TRELLIS, SF3D, TripoSR) y adaptador honesto', () => {
  assert.ok(EXTERNAL_3D_MODELS_COMPARISON_MATRIX.length >= 5);
  const ids = EXTERNAL_3D_MODELS_COMPARISON_MATRIX.map((m) => m.id);
  assert.ok(ids.includes('hunyuan3d_2'));
  assert.ok(ids.includes('trellis'));
  assert.ok(ids.includes('stable_fast_3d'));
  assert.ok(ids.includes('triposr'));

  for (const model of EXTERNAL_3D_MODELS_COMPARISON_MATRIX) {
    assert.equal(model.openSource, true);
    assert.ok(model.minVramGb >= 4);
    assert.ok(model.license.length > 0);
    assert.ok(model.robloxEditableMeshNotes.length > 10);
  }

  const status = getExternal3DAdapterStatus();
  assert.equal(typeof status.configured, 'boolean');
  assert.ok(status.reasonIfUnavailable.length > 10 || status.configured);
});

test('SECCIÓN 4 — Separación explícita de las 5 etapas de la arquitectura libre y prohibición de caer en chest_or_prop para animales', () => {
  const promptsToVerify = [
    { prompt: MANDATORY_COW_ACCEPTANCE_PROMPT, expectedFamily: 'quadruped_animal', expectedArchetype: 'bovine_cow' },
    { prompt: 'Un caballo salvaje galopando', expectedFamily: 'quadruped_animal', expectedArchetype: 'equine_horse' },
    { prompt: 'Un perro lobo guardián con cuatro patas y cola', expectedFamily: 'quadruped_animal', expectedArchetype: 'canine_dog' },
    { prompt: 'Un dragón rojo con dos alas gigantes, cuernos y cola', expectedFamily: 'winged_creature', expectedArchetype: 'winged_dragon' },
    { prompt: 'Una motocicleta deportiva con dos ruedas y motor V-Twin', expectedFamily: 'wheeled_vehicle', expectedArchetype: 'motorcycle' },
    { prompt: 'Una estatua humana clásica esculpida en mármol sobre pedestal', expectedFamily: 'biped_humanoid_or_statue', expectedArchetype: 'human_statue' },
  ];

  for (const item of promptsToVerify) {
    const inferred = inferSpecializedObjectFamily({ prompt: item.prompt });
    assert.notEqual(
      inferred.family,
      'chest_or_prop',
      `El prompt "${item.prompt}" NUNCA debe caer en chest_or_prop`
    );
    assert.equal(inferred.family, item.expectedFamily);

    // Etapa A: Interpretación semántica
    const sem = interpretPromptSemantics({ prompt: item.prompt });
    assert.equal(sem.archetype, item.expectedArchetype);
    assert.ok(sem.requiredSemanticFeatures.length >= 4);

    // Etapa B: Planificación de geometría y componentes
    const plan = planGeometryAndComponents(sem, 'seed-stage-b-test');
    assert.ok(plan.components.length >= 10, `El plan para ${item.expectedArchetype} debe tener >= 10 órganos/componentes`);
    assert.ok(plan.skeletonHierarchy.length >= 4);

    // Blueprint Director validación
    const bp = buildBaselineDirectorBlueprint({ prompt: item.prompt });
    assert.equal(bp.objectFamily, item.expectedFamily);
    assert.equal(bp.identity.species_or_subtype, item.expectedArchetype);
  }
});

test('SECCIÓN 5 — PRUEBA OBLIGATORIA DE ACEPTACIÓN: Vaca Adulta Completa con Anatomía Bovina, 4 Patas Articuladas y Manchas Negras y Blancas', () => {
  const cowAsset = synthesizeSeededProcedural3DAsset({
    prompt: MANDATORY_COW_ACCEPTANCE_PROMPT,
    name: 'NightmareForgeBovineCow',
    category: 'Props',
    seed: 90101,
    target_poly_budget: 3400,
    generation_mode: 'hybrid',
  });

  // 1. Verificar motor y familia semántica
  assert.equal(cowAsset.director_blueprint.objectFamily, 'quadruped_animal');
  assert.equal(cowAsset.director_blueprint.identity.species_or_subtype, 'bovine_cow');
  assert.equal(cowAsset.engine_used, 'universal_freeform_3d_engine:bovine_cow');

  // 2. Verificar validación geométrica estricta y compatibilidad Roblox EditableMesh
  const geomValidation = validateProcedural3DGeometry(cowAsset.parts);
  assert.equal(geomValidation.valid, true, `Errores geométricos: ${geomValidation.errors.join(', ')}`);
  assert.equal(geomValidation.degenerateTriangles, 0);
  assert.equal(geomValidation.editableMeshCompliant, true);
  assert.ok(
    cowAsset.parts.length >= 28,
    `La vaca debe tener al menos 28 órganos/sub-mallas anatómicas reales (actual=${cowAsset.parts.length}), no 10 esferas y 4 cilindros`
  );
  assert.ok(
    geomValidation.totalVertices >= 1400,
    `La vaca debe tener malla orgánica densa (>= 1400 vértices, actual=${geomValidation.totalVertices})`
  );
  assert.ok(
    geomValidation.totalTriangles >= 2400,
    `La vaca debe tener >= 2400 triángulos reales (actual=${geomValidation.totalTriangles})`
  );

  // 3. Verificar presencia de cada órgano anatómico obligatorio solicitado en el prompt
  const partNames = cowAsset.parts.map((p: any) => String(p.name));
  const requiredPartNames = [
    'TorsoBody_Main',
    'Udder_Ventral',
    'Neck_Muscular',
    'Head_Cranium',
    'Snout_Muzzle',
    'Eye_Left',
    'Eye_Right',
    'Ear_Left',
    'Ear_Right',
    'Horn_Left',
    'Horn_Right',
    'UpperLeg_FrontLeft',
    'KneeHockJoint_FrontLeft',
    'LowerCannonLeg_FrontLeft',
    'Hoof_FrontLeft',
    'UpperLeg_FrontRight',
    'KneeHockJoint_FrontRight',
    'LowerCannonLeg_FrontRight',
    'Hoof_FrontRight',
    'UpperLeg_RearLeft',
    'KneeHockJoint_RearLeft',
    'LowerCannonLeg_RearLeft',
    'Hoof_RearLeft',
    'UpperLeg_RearRight',
    'KneeHockJoint_RearRight',
    'LowerCannonLeg_RearRight',
    'Hoof_RearRight',
    'Tail_Main',
    'Tail_SwitchTuft',
    'CoatSpotPatch_SaddleLeft',
    'CoatSpotPatch_FlankRight',
    'CoatSpotPatch_RumpLeft',
    'CoatSpotPatch_ShoulderRight',
  ];
  for (const reqName of requiredPartNames) {
    assert.ok(
      partNames.includes(reqName),
      `Falta el órgano anatómico obligatorio '${reqName}' en la vaca generada`
    );
  }

  // 4. Verificar colores y manchas negras y blancas + hocico rosado + cuernos marfil + pezuñas oscuras
  const toHex = (p: any): string => {
    if (typeof p.colorHex === 'string' && p.colorHex.startsWith('#')) return p.colorHex.toLowerCase();
    if (typeof p.color === 'string' && p.color.startsWith('#')) return p.color.toLowerCase();
    const rgb = Array.isArray(p.colorRgb255) ? p.colorRgb255 : Array.isArray(p.color) ? p.color : [128, 128, 128];
    return `#${rgb.map((c: number) => Math.round(c).toString(16).padStart(2, '0')).join('')}`.toLowerCase();
  };
  const colorsHex = new Set(cowAsset.parts.map(toHex));
  assert.ok(colorsHex.has('#f8fafc'), 'Debe incluir pelaje base blanco (#f8fafc)');
  assert.ok(colorsHex.has('#18181b'), 'Debe incluir manchas negras (#18181b)');
  assert.ok(colorsHex.has('#f4afab'), 'Debe incluir hocico y ubre rosados (#f4afab)');
  assert.ok(colorsHex.has('#d6c7b2'), 'Debe incluir cuernos color marfil/queratina (#d6c7b2)');
  assert.ok(colorsHex.has('#27272a'), 'Debe incluir pezuñas hendidas oscuras (#27272a)');

  // 5. Verificar Benchmark de Identidad Visual y Semántica 3D (Sección 7)
  const evalResult = evaluateSemanticVisualIdentity({
    prompt: MANDATORY_COW_ACCEPTANCE_PROMPT,
    parts: cowAsset.parts,
  });
  assert.equal(evalResult.passed, true, evalResult.diagnosticSummary);
  assert.ok(evalResult.overallScore >= 92, `Score semántico de la vaca debe ser >= 92 (actual=${evalResult.overallScore})`);
  assert.equal(evalResult.groundedAtYZero, true);
  assert.equal(evalResult.spatialChecks.hasFourQuadrantGroundSupport, true);
  assert.equal(evalResult.spatialChecks.hasCranialCaudalProfile, true);
  assert.equal(evalResult.spatialChecks.hasBilateralSymmetry, true);
  assert.equal(evalResult.spatialChecks.hasNonPrimitiveOrganicComplexity, true);
  assert.equal(evalResult.featureCoverage.missingFeatures.length, 0);

  // 6. Verificar capturas multi-ángulo (Frontal, Lateral, 3/4 Isométrica, Superior) y guardarlas como artefactos verificables
  const snapshots = renderMultiAngleSvgSnapshots({
    modelName: cowAsset.name,
    subjectLabel: 'Vaca Adulta Anatómica (Bos taurus)',
    parts: cowAsset.parts,
  });
  assert.ok(snapshots.frontSvg.includes('<polygon'));
  assert.ok(snapshots.sideSvg.includes('<polygon'));
  assert.ok(snapshots.isometricSvg.includes('<polygon'));
  assert.ok(snapshots.topSvg.includes('<polygon'));

  const outDir = path.resolve(process.cwd(), 'public/assets/benchmarks');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'cow_front.svg'), snapshots.frontSvg, 'utf-8');
  fs.writeFileSync(path.join(outDir, 'cow_side.svg'), snapshots.sideSvg, 'utf-8');
  fs.writeFileSync(path.join(outDir, 'cow_isometric.svg'), snapshots.isometricSvg, 'utf-8');
  fs.writeFileSync(path.join(outDir, 'cow_top.svg'), snapshots.topSvg, 'utf-8');

  // 7. Verificar exportación real a .luau, .rbxmx, .gltf y .obj
  assert.ok(cowAsset.luau_code.includes('CreateEditableMesh'));
  assert.ok(cowAsset.luau_code.includes('CreateMeshPartAsync'));
  const rbxmx = buildRbxmxFromPartsServer(cowAsset.name, cowAsset.parts);
  assert.ok(rbxmx.includes('<roblox') && rbxmx.includes('TorsoBody_Main'));
  const gltf = buildGltfFromPartsServer(cowAsset.name, cowAsset.parts);
  assert.ok(gltf.includes('"asset"') && gltf.includes('"meshes"'));
  const objOut = buildObjAndMtlFromPartsServer(cowAsset.name, cowAsset.parts);
  assert.ok(objOut.obj.includes('v ') && objOut.obj.includes('f '));
});

test('SECCIÓN 6 y 7 — PRUEBA DE GENERALIZACIÓN: 7 Prompts distintos sin modificar código entre pruebas (Caballo, Perro, Dragón, Motocicleta, Estatua Humana, Árbol Fantástico, Casa Medieval)', () => {
  const suiteReport = runFreeformGeneralizationBenchmarkSuite();
  assert.equal(suiteReport.totalCases, 8); // Vaca + 7 casos de generalización
  assert.equal(suiteReport.passedCases, 8);
  assert.equal(suiteReport.semanticPassCount, 8);
  assert.equal(suiteReport.allSemanticIdentityPassed, true);
  assert.equal(suiteReport.allCasesPassed, true);

  for (const bm of suiteReport.cases) {
    const semEval = bm.synthesis.visual_identity_evaluation;
    assert.ok(semEval, `El caso ${bm.id} debe incluir visual_identity_evaluation`);
    assert.equal(
      semEval.passed,
      true,
      `El caso ${bm.id} (${bm.title}) falló evaluación semántica: ${semEval.diagnosticSummary}`
    );
    assert.ok(
      semEval.overallScore >= 85,
      `El caso ${bm.id} debe tener score >= 85 (actual=${semEval.overallScore})`
    );
    assert.equal(bm.groundedAtZero, true, `El caso ${bm.id} debe descansar en Y=0`);
    assert.equal(bm.editableMeshCompliant, true, `El caso ${bm.id} debe cumplir EditableMesh`);
    assert.equal(bm.lodMetrics.monotonicReduction, true, `El caso ${bm.id} debe cumplir LOD0 > LOD1 >= LOD2`);
    assert.ok(bm.synthesis.engine_used && bm.synthesis.engine_used.length > 5);
    assert.ok(bm.synthesis.multi_angle_snapshots?.isometricSvg.includes('<polygon'));
  }

  assert.equal(FREEFORM_GENERALIZATION_BENCHMARK_CASES.length, 8);
});

test('SECCIÓN 8 — Aislamiento de forge-bridge en CI: aiGenerationDirector.ts no tiene importación runtime de @google/genai', () => {
  const directorPath = path.resolve(process.cwd(), 'src/server/engines/aiGenerationDirector.ts');
  const sourceCode = fs.readFileSync(directorPath, 'utf-8');
  const hasRuntimeImport = /^\s*import\s+\{[^}]*\bType\b[^}]*\}\s+from\s+['"]@google\/genai['"]/m.test(
    sourceCode
  );
  assert.equal(
    hasRuntimeImport,
    false,
    'aiGenerationDirector.ts NO debe importar valores en runtime desde @google/genai para no romper el job CI de forge-bridge'
  );
  assert.ok(
    /^\s*import\s+type\s+\{\s*GoogleGenAI\s*\}\s+from\s+['"]@google\/genai['"]/m.test(sourceCode),
    'aiGenerationDirector.ts debe usar únicamente `import type { GoogleGenAI }`'
  );
});

test('SECCIÓN 9A — Prompt "árbol azul" vence defaults UI y parámetros obsoletos cuando no están bloqueados manualmente', () => {
  const blueParsed = parseNaturalLanguageToTreeParams('Un árbol azul frondoso de roble');
  assert.equal(blueParsed.params.leafColor, '#2563eb');
  const iceParsed = parseNaturalLanguageToTreeParams('Un árbol de hielo celeste');
  assert.equal(iceParsed.params.leafColor, '#38bdf8');
  assert.equal(iceParsed.params.leafMaterial, 'Ice');

  // Caso 1: Estado anterior (hojas rojas, altura 22) + manually_edited_fields=[] -> el nuevo prompt azul DEBE ganar
  const overriddenAsset = synthesizeSeededProcedural3DAsset({
    prompt: 'Árbol con hojas azules brillantes',
    category: 'Trees & Vegetation',
    manually_edited_fields: [],
    tree_params: {
      height: 22,
      leafColor: '#b91c1c',
      trunkColor: '#6e482b',
    },
  });
  const canopyPart = overriddenAsset.parts.find((p: any) =>
    String(p.name).startsWith('CanopyCrown') || String(p.name).startsWith('FoliageCluster')
  );
  assert.ok(canopyPart, 'Debe existir parte de follaje');
  const canopyRgb = resolveColorRgb255(canopyPart.color);
  assert.ok(
    canopyRgb[2] > canopyRgb[0] && canopyRgb[2] > canopyRgb[1],
    `El follaje debe ser azul y no heredar rojo/verde stale (actual RGB=${JSON.stringify(canopyRgb)})`
  );

  // Caso 2: Todos los defaults UI enviados sin manually_edited_fields -> prompt azul gana sobre verde #34843d
  const defaultUiAsset = synthesizeSeededProcedural3DAsset({
    prompt: 'Árbol azul encantado',
    category: 'Trees & Vegetation',
    tree_params: {
      height: 14,
      width: 10,
      trunkThickness: 1.6,
      branchCount: 4,
      leafColor: '#34843d',
      trunkColor: '#6e482b',
    },
  });
  const defaultCanopy = defaultUiAsset.parts.find((p: any) =>
    String(p.name).startsWith('CanopyCrown')
  );
  const defaultRgb = resolveColorRgb255(defaultCanopy.color);
  assert.ok(
    defaultRgb[2] > defaultRgb[0] && defaultRgb[2] > defaultRgb[1],
    `Los defaults UI no deben tapar el azul del prompt (RGB=${JSON.stringify(defaultRgb)})`
  );

  // Caso 3: Edición manual explícita de leafColor -> la UI manual sí se respeta
  const manualOverrideAsset = synthesizeSeededProcedural3DAsset({
    prompt: 'Árbol azul encantado',
    category: 'Trees & Vegetation',
    manually_edited_fields: ['leafColor'],
    tree_params: {
      leafColor: '#ec4899',
    },
  });
  const pinkCanopy = manualOverrideAsset.parts.find((p: any) =>
    String(p.name).startsWith('CanopyCrown')
  );
  const pinkRgb = resolveColorRgb255(pinkCanopy.color);
  assert.ok(
    pinkRgb[0] > pinkRgb[1] && pinkRgb[0] > 180,
    `Una edición manual de leafColor debe preservarse (RGB=${JSON.stringify(pinkRgb)})`
  );
});

test('SECCIÓN 9B — Semillas automáticas no se repiten y semillas string se preservan vía HTTP /api/v1/generate-3d', async () => {
  const tmpRojo = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-rojo-9b-'));
  const { app } = createMainServerApp({
    securityToken: 'test-token-9b',
    bridgeSharedSecret: 'bridge-secret-9b',
    nodeEnv: 'test',
    rojoProjectPath: tmpRojo,
  });

  const server = await new Promise<http.Server>((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });

  try {
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    const headers = {
      'Content-Type': 'application/json',
      'x-forge-token': 'test-token-9b',
    };

    // Dos generaciones consecutivas con semilla placeholder/omitida deben ser distintas
    const res1 = await fetch(`${baseUrl}/api/v1/generate-3d`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: 'Árbol azul alto',
        category: 'Trees & Vegetation',
        generation_mode: 'procedural',
        seed: 'forge-tree-2026',
        manually_edited_fields: [],
        tree_params: { leafColor: '#34843d', height: 14 },
        save_to_rojo: false,
        save_to_library: false,
      }),
    });
    assert.equal(res1.status, 200);
    const asset1 = (await res1.json()) as any;

    const res2 = await fetch(`${baseUrl}/api/v1/generate-3d`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: 'Árbol azul alto',
        category: 'Trees & Vegetation',
        generation_mode: 'procedural',
        manually_edited_fields: [],
        tree_params: { leafColor: '#34843d', height: 14 },
        save_to_rojo: false,
        save_to_library: false,
      }),
    });
    assert.equal(res2.status, 200);
    const asset2 = (await res2.json()) as any;

    assert.notEqual(asset1.seed, asset2.seed, 'Las semillas automáticas deben variar entre creaciones');
    assert.notEqual(asset1.seed, '1337');
    assert.notEqual(asset2.seed, '1337');

    const canopy1 = asset1.parts.find((p: any) => String(p.name).startsWith('CanopyCrown'));
    const rgb1 = resolveColorRgb255(canopy1.color);
    assert.ok(rgb1[2] > rgb1[0] && rgb1[2] > rgb1[1], 'El árbol generado vía HTTP debe tener hojas azules');

    // Semilla string explícita debe conservarse exacta y ser reproducible
    const resFixedA = await fetch(`${baseUrl}/api/v1/generate-3d`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: 'Roble místico azul',
        category: 'Trees & Vegetation',
        generation_mode: 'procedural',
        seed: 'custom-oak-seed-2026',
        save_to_rojo: false,
        save_to_library: false,
      }),
    });
    const fixedA = (await resFixedA.json()) as any;
    const resFixedB = await fetch(`${baseUrl}/api/v1/generate-3d`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt: 'Roble místico azul',
        category: 'Trees & Vegetation',
        generation_mode: 'procedural',
        seed: 'custom-oak-seed-2026',
        save_to_rojo: false,
        save_to_library: false,
      }),
    });
    const fixedB = (await resFixedB.json()) as any;

    assert.equal(fixedA.execution_report.seed, 'custom-oak-seed-2026');
    assert.equal(fixedA.geometryHash, fixedB.geometryHash, 'Misma semilla string debe reproducir misma geometría');
  } finally {
    (server as any).closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmpRojo, { recursive: true, force: true });
  }
});

test('SECCIÓN 9C — procedural3DGenerator invoca planGeometryAndComponents + generateReal3DMeshesFromPlan con arbitrary_components y vegetación', () => {
  // Planificación directa de vegetación en Motor Universal
  const treeInterp = interpretPromptSemantics({
    prompt: 'Árbol mágico bioluminiscente azul',
    category: 'Trees & Vegetation',
  });
  const treePlan = planGeometryAndComponents(treeInterp, 'tree-universal-1');
  const treeMeshes = generateReal3DMeshesFromPlan({
    modelName: 'UniversalTree',
    plan: treePlan,
    budget: computeBudgetAllocationProfile(1800, 'medium'),
  });
  assert.ok(treeMeshes.length >= 5, 'El planificador universal debe producir tronco, raíz, ramas y copa');

  // Grafo arbitrario de Director IA pasa completo a través de synthesizeSeededProcedural3DAsset
  const arbitraryAsset = synthesizeSeededProcedural3DAsset({
    prompt: 'Telescopio astronómico arcano flotante sobre trípode',
    name: 'ArcaneTelescope',
    category: 'Props',
    seed: 'telescope-graph-42',
    director_blueprint: {
      identity: {
        name: 'ArcaneTelescope',
        object_family: 'freeform_composite',
        category: 'Props',
        asset_type: 'Model3D',
        species_or_subtype: 'custom_graph',
      },
      arbitrary_components: [
        {
          name: 'TripodPedestal',
          role: 'pedestal_plinth',
          kernel: 'beveled_structural_frame',
          position: [0, 0.8, 0],
          size: [2.4, 1.6, 2.4],
          material: 'Metal',
          colorHex: '#475569',
        },
        {
          name: 'BrassOpticalTube',
          role: 'torso',
          kernel: 'spline_lofted_organ',
          position: [0, 2.5, 0],
          size: [1.4, 1.4, 4.2],
          material: 'Metal',
          colorHex: '#d97706',
          spineControlPoints: [
            { point: [0, 1.9, -1.6], radiusX: 0.45, radiusY: 0.45 },
            { point: [0, 2.5, 0], radiusX: 0.58, radiusY: 0.58 },
            { point: [0, 3.1, 1.6], radiusX: 0.72, radiusY: 0.72 },
          ],
        },
        {
          name: 'SapphireObjectiveLens',
          role: 'head_cranium',
          kernel: 'sculpted_icosphere_organ',
          position: [0, 3.1, 1.85],
          size: [1.3, 1.3, 0.5],
          material: 'Neon',
          colorHex: '#38bdf8',
        },
      ],
    },
  });

  assert.ok(
    String(arbitraryAsset.engine_used).startsWith('universal_freeform_3d_engine'),
    `Debe usar universal_freeform_3d_engine (actual=${arbitraryAsset.engine_used})`
  );
  const partNames = arbitraryAsset.parts.map((p: any) => p.name);
  assert.ok(partNames.includes('TripodPedestal'));
  assert.ok(partNames.includes('BrassOpticalTube'));
  assert.ok(partNames.includes('SapphireObjectiveLens'));
  const geomCheck = validateProcedural3DGeometry(arbitraryAsset.parts);
  assert.equal(geomCheck.valid, true, geomCheck.errors.join('; '));
});

test('SECCIÓN 9D — Adaptador 3D externo real vía HTTP (.obj Wavefront) con grounding en Y=0 y fallback cuando cae', async () => {
  const prevEndpoint = process.env.FORGE_EXTERNAL_3D_ENDPOINT;
  const prevModel = process.env.FORGE_EXTERNAL_3D_MODEL;
  const tmpRojo = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-rojo-9d-'));

  // Pirámide/prisma OBJ desplazado verticalmente (Y in [2, 6]) para comprobar centrado y aterrizaje en Y=0
  const mockObj = [
    '# External HUNYUAN3D test mesh',
    'v -1.0 2.0 -1.0',
    'v 1.0 2.0 -1.0',
    'v 1.0 2.0 1.0',
    'v -1.0 2.0 1.0',
    'v 0.0 6.0 0.0',
    'f 1 2 3',
    'f 1 3 4',
    'f 1 2 5',
    'f 2 3 5',
    'f 3 4 5',
    'f 4 1 5',
  ].join('\n');

  const extServer = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        model_used: 'hunyuan3d-2.0-mock',
        obj_text: mockObj,
      })
    );
  });

  await new Promise<void>((resolve, reject) => {
    extServer.listen(0, '127.0.0.1', () => resolve());
    extServer.on('error', reject);
  });

  const extAddr = extServer.address() as { port: number };
  process.env.FORGE_EXTERNAL_3D_ENDPOINT = `http://127.0.0.1:${extAddr.port}/generate`;
  process.env.FORGE_EXTERNAL_3D_MODEL = 'hunyuan3d_2';

  const { app } = createMainServerApp({
    securityToken: 'test-token-9d',
    bridgeSharedSecret: 'bridge-secret-9d',
    nodeEnv: 'test',
    rojoProjectPath: tmpRojo,
  });
  const mainServer = await new Promise<http.Server>((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });

  try {
    // 1. Directo vía executeExternal3DGeneration
    const directRes = await executeExternal3DGeneration({
      prompt: 'Monolito piramidal arcano',
      modelName: 'ArcanePyramid',
    });
    assert.equal(directRes.success, true, directRes.errorReason);
    assert.ok(directRes.parts && directRes.parts.length >= 1);
    const firstPart = directRes.parts[0]!;
    assert.ok(firstPart.meshData && firstPart.meshData.vertices.length > 0);
    const minDirectY = Math.min(
      ...firstPart.meshData.vertices.map(
        (v: number[]) => (firstPart.position[1] || 0) + v[1]
      )
    );
    assert.ok(Math.abs(minDirectY) < 0.02, `La malla externa debe descansar en Y=0 (minY=${minDirectY})`);

    // 2. Endpoint completo /api/v1/generate-3d usa adaptador externo en modo hybrid
    const mainAddr = mainServer.address() as { port: number };
    const httpRes = await fetch(`http://127.0.0.1:${mainAddr.port}/api/v1/generate-3d`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forge-token': 'test-token-9d',
      },
      body: JSON.stringify({
        prompt: 'Monolito piramidal arcano',
        category: 'Props',
        generation_mode: 'hybrid',
        save_to_rojo: false,
        save_to_library: false,
      }),
    });
    assert.equal(httpRes.status, 200);
    const extAsset = (await httpRes.json()) as any;
    assert.equal(extAsset.execution_report.executed_mode, 'external_3d_model');
    assert.ok(String(extAsset.engine_used).startsWith('external_3d_model:'));
    assert.equal(extAsset.poly_count, 6);

    // 3. Si el servidor externo se apaga, hace fallback honesto y sigue generando modelo local válido
    (extServer as any).closeAllConnections?.();
    await new Promise<void>((resolve) => extServer.close(() => resolve()));
    const fallbackRes = await fetch(`http://127.0.0.1:${mainAddr.port}/api/v1/generate-3d`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forge-token': 'test-token-9d',
      },
      body: JSON.stringify({
        prompt: 'Monolito piramidal arcano',
        category: 'Props',
        generation_mode: 'hybrid',
        save_to_rojo: false,
        save_to_library: false,
      }),
    });
    assert.equal(fallbackRes.status, 200);
    const fbAsset = (await fallbackRes.json()) as any;
    assert.equal(fbAsset.execution_report.fallback_triggered, true);
    assert.ok(fbAsset.parts.length >= 2);
  } finally {
    if (prevEndpoint === undefined) delete process.env.FORGE_EXTERNAL_3D_ENDPOINT;
    else process.env.FORGE_EXTERNAL_3D_ENDPOINT = prevEndpoint;
    if (prevModel === undefined) delete process.env.FORGE_EXTERNAL_3D_MODEL;
    else process.env.FORGE_EXTERNAL_3D_MODEL = prevModel;

    (mainServer as any).closeAllConnections?.();
    await new Promise<void>((resolve) => mainServer.close(() => resolve()));
    try {
      (extServer as any).closeAllConnections?.();
      extServer.close();
    } catch {
      // already closed
    }
    fs.rmSync(tmpRojo, { recursive: true, force: true });
  }
});

test('SECCIÓN 10 — Misión Integral: Provenance, Prompt A vs B, 7 Especies, 23 Objetos Obligatorios, Variaciones ES/EN, 5 Vistas, Image-to-3D y Persistencia de Benchmarks', () => {
  // 1. Provenance y Precedencia: manual_ui > preset > prompt_nlp > ai_director > image_reference > default
  const treeProvenanceAsset = synthesizeSeededProcedural3DAsset({
    prompt: 'árbol alto de 24 studs con hojas azules',
    category: 'Trees & Vegetation',
    seed: 'prov-check-01',
    preset_params: { height: 18, trunkThickness: 1.5 },
    tree_params: { height: 9 },
    manually_edited_fields: ['height'],
  });
  assert.ok(
    treeProvenanceAsset.parameter_provenance &&
      typeof treeProvenanceAsset.parameter_provenance === 'object'
  );
  const provRecord = treeProvenanceAsset.parameter_provenance as Record<
    string,
    { value: any; source: string }
  >;
  assert.equal(provRecord.height?.source, 'manual_ui');
  assert.equal(provRecord.leafColor?.source, 'prompt_nlp');
  assert.equal(provRecord.trunkThickness?.source, 'preset');
  assert.equal(treeProvenanceAsset.tree_params.height, 9);
  assert.equal(treeProvenanceAsset.tree_params.trunkThickness, 1.5);
  assert.ok(typeof treeProvenanceAsset.latency_ms === 'number' && treeProvenanceAsset.latency_ms >= 0);
  assert.ok(Array.isArray(treeProvenanceAsset.warnings) && treeProvenanceAsset.warnings.length >= 1);

  // 2. Prompt A vs Prompt B de Árboles (diferencia estructural, altura, grosor, color y materiales)
  const promptATree = synthesizeSeededProcedural3DAsset({
    prompt: 'árbol pequeño 5 studs, tronco delgado, hojas rojas, copa esférica, cartoon',
    category: 'Trees & Foliage',
    seed: 'tree-prompt-a',
    generation_mode: 'hybrid',
  });
  const promptBTree = synthesizeSeededProcedural3DAsset({
    prompt: 'árbol gigante 35 studs, tronco grueso y retorcido, hojas azules luminosas, ramas asimétricas, copa cristalina',
    category: 'Trees & Foliage',
    seed: 'tree-prompt-b',
    generation_mode: 'hybrid',
  });
  const treeComp = compareModelVariationPair(promptATree as any, promptBTree as any);
  assert.equal(treeComp.areVisuallyDistinct, true);
  assert.ok(treeComp.bboxDeltaStuds.heightYDelta > 15, `Prompt A vs B height delta=${treeComp.bboxDeltaStuds.heightYDelta}`);
  assert.ok(
    promptATree.parts.some((p: any) => p.material === 'SmoothPlastic'),
    'Prompt A cartoon debe usar SmoothPlastic'
  );
  assert.ok(
    promptBTree.parts.some((p: any) => p.material === 'Neon' || p.material === 'Ice' || p.material === 'Glass'),
    'Prompt B cristalino luminoso debe usar Neon/Ice/Glass'
  );

  // 3. Diferenciación real de las 7 especies de árbol
  const speciesExpectations: Array<{ species: any; prompt: string; expectedPartPattern: RegExp; expectZeroCanopy?: boolean }> = [
    { species: 'oak', prompt: 'roble frondoso clásico', expectedPartPattern: /Canopy|Foliage/i },
    { species: 'pine', prompt: 'pino conífero alto', expectedPartPattern: /PineTier/i },
    { species: 'willow', prompt: 'sauce llorón colgante', expectedPartPattern: /WillowFrond/i },
    { species: 'bonsai', prompt: 'bonsái japonés en maceta', expectedPartPattern: /BonsaiCeramicPot/i },
    { species: 'dead', prompt: 'árbol seco muerto sin hojas', expectedPartPattern: /DeadSnagSpire|BareTwig/i, expectZeroCanopy: true },
    { species: 'fantasy', prompt: 'árbol fantástico mágico brillante', expectedPartPattern: /ArcaneCrystal/i },
    { species: 'crystalline', prompt: 'árbol cristalino de hielo', expectedPartPattern: /CrystalCrownShard/i },
  ];

  for (const sp of speciesExpectations) {
    const spAsset = synthesizeSeededProcedural3DAsset({
      prompt: sp.prompt,
      category: 'Trees & Vegetation',
      seed: `species-${sp.species}`,
      tree_params: { species: sp.species, height: 14 },
    });
    const spNames: string[] = spAsset.parts.map((p: any) => String(p.name));
    assert.ok(
      spNames.some((n: string) => sp.expectedPartPattern.test(n)),
      `Especie '${sp.species}' debe generar piezas acordes (${spNames.join(', ')})`
    );
    if (sp.expectZeroCanopy) {
      assert.equal(
        spNames.some((n: string) => /Leaf|Foliage|CanopyCluster/i.test(n)),
        false,
        'Árbol seco no debe generar follaje verde'
      );
    }
    assert.equal(validateProcedural3DGeometry(spAsset.parts).valid, true);
  }

  // 4. Generalización sobre los 23 objetos obligatorios (FASE 5)
  const mandatory23Prompts: Array<{ id: string; prompt: string; category: string; mustMatchPart?: RegExp }> = [
    // Vegetación (6)
    { id: 'veg_oak', prompt: 'roble estilizado con raíces y copa amplia', category: 'Trees & Vegetation' },
    { id: 'veg_pine', prompt: 'pino alto de montaña', category: 'Trees & Vegetation' },
    { id: 'veg_willow', prompt: 'sauce llorón de ribera', category: 'Trees & Vegetation' },
    { id: 'veg_bonsai', prompt: 'bonsái ornamental en maceta de cerámica', category: 'Trees & Vegetation', mustMatchPart: /BonsaiCeramicPot/i },
    { id: 'veg_dead', prompt: 'árbol seco retorcido del pantano', category: 'Trees & Vegetation', mustMatchPart: /DeadSnagSpire|BareTwig/i },
    { id: 'veg_fantasy', prompt: 'árbol fantástico bioluminiscente con cristales', category: 'Trees & Vegetation' },
    // Animales (5)
    { id: 'ani_cow', prompt: 'una vaca lechera blanca con manchas negras, cuernos y pezuñas', category: 'Props', mustMatchPart: /Horn_Left/i },
    { id: 'ani_horse', prompt: 'un caballo castaño con crin, cuatro patas y cascos', category: 'Props', mustMatchPart: /Mane/i },
    { id: 'ani_dog', prompt: 'un perro pastor con hocico, orejas y cola', category: 'Props', mustMatchPart: /Snout/i },
    { id: 'ani_bird', prompt: 'un pájaro águila con alas extendidas, pico y garras', category: 'Props', mustMatchPart: /WingFeather|Beak/i },
    { id: 'ani_dragon', prompt: 'un dragón rojo alado con cuernos y cola larga', category: 'Props', mustMatchPart: /WingMembrane/i },
    // Vehículos (3)
    { id: 'veh_moto', prompt: 'una motocicleta deportiva con dos ruedas y motor', category: 'Props', mustMatchPart: /WheelTire_Front/i },
    { id: 'veh_car', prompt: 'un automóvil deportivo con cuatro ruedas, parabrisas y faros', category: 'Props', mustMatchPart: /WheelTire_FrontLeft/i },
    { id: 'veh_spaceship', prompt: 'una nave espacial futurista con cabina, alas delta y propulsores', category: 'Props', mustMatchPart: /Thruster|Fuselage/i },
    // Arquitectura (4)
    { id: 'arch_house', prompt: 'una casa medieval con tejado inclinado y puerta de madera', category: 'Buildings & Structures', mustMatchPart: /SteppedStoneFoundation/i },
    { id: 'arch_castle', prompt: 'un castillo medieval fortificado con torre central y almenas', category: 'Buildings & Structures', mustMatchPart: /CentralKeep_Tower/i },
    { id: 'arch_futuristic', prompt: 'un edificio futurista con costillas neón y antena orbital', category: 'Buildings & Structures', mustMatchPart: /OrbitalSpire_Antenna/i },
    { id: 'arch_tower', prompt: 'una torre fantástica de mago con aguja y cristales flotantes', category: 'Buildings & Structures', mustMatchPart: /FloatingRuneCrystal/i },
    // Objetos y props (5)
    { id: 'obj_sword', prompt: 'una espada épica medieval con hoja de acero, guarda y empuñadura', category: 'Props', mustMatchPart: /SwordBlade/i },
    { id: 'obj_statue', prompt: 'una estatua humana clásica esculpida sobre pedestal', category: 'Props', mustMatchPart: /Torso/i },
    { id: 'obj_lamp', prompt: 'una lámpara ornamental antigua con farol brillante', category: 'Props', mustMatchPart: /Lamp|Lantern|Bulb|Shade|Post/i },
    { id: 'obj_chest', prompt: 'un cofre del tesoro de madera con herrajes metálicos', category: 'Props' },
    { id: 'obj_machine', prompt: 'una máquina mecánica industrial con engranajes y pistones', category: 'Props' },
  ];

  assert.equal(mandatory23Prompts.length, 23);
  for (const item of mandatory23Prompts) {
    const asset = synthesizeSeededProcedural3DAsset({
      prompt: item.prompt,
      category: item.category,
      seed: `m23-${item.id}`,
      target_poly_budget: 2800,
      generation_mode: 'hybrid',
    });
    const val = validateProcedural3DGeometry(asset.parts);
    assert.equal(val.valid, true, `Objeto obligatorio '${item.id}' falló validación: ${val.errors.join('; ')}`);
    assert.equal(val.editableMeshCompliant, true, `Objeto '${item.id}' excede EditableMesh`);
    assert.equal(val.degenerateTriangles, 0, `Objeto '${item.id}' tiene triángulos degenerados`);
    if (item.mustMatchPart) {
      const names: string[] = asset.parts.map((p: any) => String(p.name));
      assert.ok(
        names.some((n: string) => item.mustMatchPart!.test(n)),
        `Objeto '${item.id}' esperaba pieza ${item.mustMatchPart} pero obtuvo: ${names.join(', ')}`
      );
    }
    const snaps = asset.multi_angle_snapshots;
    assert.ok(snaps?.frontSvg && snaps?.sideSvg && snaps?.backSvg && snaps?.topSvg && snaps?.isometricSvg);
  }

  // 5. Variaciones ES e EN de vaca (pequeña blanca con manchas vs grande marrón con cuernos largos)
  const cowPairs: Array<[string, string, string]> = [
    ['ES', 'una vaca pequeña blanca con manchas negras', 'una vaca grande marrón con cuernos largos'],
    ['EN', 'a small white cow with black spots', 'a large brown cow with long horns'],
  ];
  for (const [lang, pSmall, pLarge] of cowPairs) {
    const smallCow = synthesizeSeededProcedural3DAsset({
      prompt: pSmall,
      category: 'Props',
      seed: `cow-${lang}-small`,
      generation_mode: 'hybrid',
    });
    const largeCow = synthesizeSeededProcedural3DAsset({
      prompt: pLarge,
      category: 'Props',
      seed: `cow-${lang}-large`,
      generation_mode: 'hybrid',
    });
    const cowDiff = compareModelVariationPair(smallCow as any, largeCow as any);
    assert.equal(cowDiff.areVisuallyDistinct, true, `Par de vacas (${lang}) debe diferir visualmente`);
    assert.ok(
      cowDiff.bboxDeltaStuds.heightYDelta > 1.0,
      `Vaca pequeña vs grande (${lang}) debe cambiar altura (delta=${cowDiff.bboxDeltaStuds.heightYDelta})`
    );
    const smallHorn = smallCow.parts.find((p: any) => p.name === 'Horn_Left');
    const largeHorn = largeCow.parts.find((p: any) => p.name === 'Horn_Left');
    assert.ok(smallHorn && largeHorn && largeHorn.size[1] > smallHorn.size[1], `Cuernos largos (${lang}) deben crecer`);
  }

  // 6. Repetición y semilla (determinista con seed explícito vs distinta sin seed)
  const det1 = synthesizeSeededProcedural3DAsset({ prompt: 'roble rojo 12 studs', category: 'Trees & Vegetation', seed: 'fixed-777' });
  const det2 = synthesizeSeededProcedural3DAsset({ prompt: 'roble rojo 12 studs', category: 'Trees & Vegetation', seed: 'fixed-777' });
  assert.equal(det1.contentHash, det2.contentHash);

  const auto1 = synthesizeSeededProcedural3DAsset({ prompt: 'roble verde', category: 'Trees & Vegetation' });
  const auto2 = synthesizeSeededProcedural3DAsset({ prompt: 'roble verde', category: 'Trees & Vegetation' });
  assert.notEqual(auto1.seed, auto2.seed);

  // 7. Métricas de 11 dimensiones + 5 vistas
  const qMetrics = evaluateAssetQualityMetrics(promptBTree as any);
  assert.ok(
    qMetrics.visualIdentityScore >= 0 &&
      qMetrics.promptFidelityScore >= 0 &&
      qMetrics.proportionScore >= 0 &&
      qMetrics.silhouetteScore >= 0 &&
      qMetrics.componentCompletenessScore >= 0 &&
      qMetrics.geometryQualityScore >= 0 &&
      qMetrics.materialPbrScore >= 0 &&
      qMetrics.colorHarmonyScore >= 0 &&
      qMetrics.textureUvScore >= 0 &&
      qMetrics.meshManifoldScore >= 0 &&
      qMetrics.robloxCompatibilityScore >= 0 &&
      qMetrics.overallScore > 65
  );

  // 8. Image-to-3D mejorado: depthProfile16, estimatedSymmetryScore, volumetricConfidence y volumetricMatchScore
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const makeChunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const w = 24;
  const h = 24;
  const rawScanlines = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const rowOff = y * (1 + w * 4);
    rawScanlines[rowOff] = 0; // filter None
    for (let x = 0; x < w; x++) {
      const idx = rowOff + 1 + x * 4;
      const inside = x >= 6 && x <= 17 && y >= 4 && y <= 20;
      rawScanlines[idx] = inside ? Math.min(255, 90 + Math.abs(12 - x) * 18) : 255;
      rawScanlines[idx + 1] = inside ? 120 : 255;
      rawScanlines[idx + 2] = inside ? 60 : 255;
      rawScanlines[idx + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const pngBuf = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', zlib.deflateSync(rawScanlines)),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
  const refAnalysis = analyzeReferenceImageBase64(`data:image/png;base64,${pngBuf.toString('base64')}`);
  assert.equal(refAnalysis.validImageDecoded, true);
  assert.equal(refAnalysis.depthProfile16.length, 16);
  assert.ok(refAnalysis.estimatedSymmetryScore > 0.7);
  assert.ok(refAnalysis.volumetricConfidence > 0.3);

  const imgAsset = synthesizeSeededProcedural3DAsset({
    prompt: 'jarrón ceremonial reconstruido desde imagen',
    category: 'Props',
    seed: 'img-depth-check',
    reference_image_base64: `data:image/png;base64,${pngBuf.toString('base64')}`,
  });
  assert.ok(imgAsset.reference_comparison_metrics?.volumetricMatchScore > 0.3);
  assert.equal(imgAsset.reference_comparison_metrics?.depthProfileModel16?.length, 16);
  const directComp = evaluateReferenceVsModelMetrics(refAnalysis, imgAsset.parts as any);
  assert.ok((directComp.volumetricMatchScore ?? 0) > 0.3);

  // 9. Persistencia real de reportes + 5 vistas SVG en docs/benchmarks/
  const bmOutDir = path.resolve(process.cwd(), 'docs/benchmarks');
  const persisted = persistVisualBenchmarkArtifacts(bmOutDir);
  assert.equal(fs.existsSync(persisted.reportPath), true);
  assert.equal(fs.existsSync(persisted.summaryPath), true);
  assert.ok(persisted.totalSvgCount >= 50, `Deben escribirse al menos 50 SVGs de 5 vistas (actual=${persisted.totalSvgCount})`);
  assert.equal(fs.existsSync(path.join(persisted.viewsDir, 'bovine_cow_acceptance_back.svg')), true);
  assert.equal(fs.existsSync(path.join(persisted.viewsDir, 'tree_prompt_a_5studs_red_isometric.svg')), true);
  assert.equal(fs.existsSync(path.join(persisted.viewsDir, 'tree_prompt_b_35studs_crystal_front.svg')), true);
});
