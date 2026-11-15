import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  EXTERNAL_3D_MODELS_COMPARISON_MATRIX,
  getExternal3DAdapterStatus,
} from '../src/server/engines/external3DModelAdapter.ts';
import {
  buildBaselineDirectorBlueprint,
  inferSpecializedObjectFamily,
} from '../src/server/engines/aiGenerationDirector.ts';
import {
  synthesizeSeededProcedural3DAsset,
  validateProcedural3DGeometry,
} from '../src/server/engines/procedural3DGenerator.ts';
import {
  evaluateSemanticVisualIdentity,
  interpretPromptSemantics,
  planGeometryAndComponents,
  renderMultiAngleSvgSnapshots,
} from '../src/server/engines/universalFreeform3DEngine.ts';
import {
  FREEFORM_GENERALIZATION_BENCHMARK_CASES,
  MANDATORY_COW_ACCEPTANCE_PROMPT,
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
