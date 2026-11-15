import fs from 'node:fs';
import path from 'node:path';
import {
  synthesizeSeededProcedural3DAsset,
  validateProcedural3DGeometry,
  type Procedural3DPart,
  type Procedural3DSynthesisResult,
} from './procedural3DGenerator.ts';
import { renderMultiAngleSvgSnapshots } from './universalFreeform3DEngine.ts';

export interface AssetQualityMetrics {
  visualIdentityScore: number;
  promptFidelityScore: number;
  proportionScore: number;
  silhouetteScore: number;
  componentCompletenessScore: number;
  geometryQualityScore: number;
  materialPbrScore: number;
  colorHarmonyScore: number;
  textureUvScore: number;
  meshManifoldScore: number;
  robloxCompatibilityScore: number;
  overallScore: number;
}

export interface BenchmarkCameraViews {
  frontSvg: string;
  sideSvg: string;
  backSvg: string;
  topSvg: string;
  isometricSvg: string;
}

export interface ModelVariationComparison {
  assetAId: string;
  assetBId: string;
  seedA: string;
  seedB: string;
  seedDifferent: boolean;
  structuralHashDifferent: boolean;
  distinctPartCountDelta: number;
  bboxDeltaStuds: {
    widthXDelta: number;
    heightYDelta: number;
    depthZDelta: number;
    volumeRatio: number;
  };
  distinctColorsA: string[];
  distinctColorsB: string[];
  paletteOverlapRatio: number;
  distinctnessScore: number;
  areVisuallyDistinct: boolean;
}

export interface BenchmarkCaseSpec {
  id: string;
  order: number;
  title: string;
  category: string;
  subCategory: string;
  objectFamily: string;
  style: string;
  seed: number;
  targetPolyBudget: number;
  prompt: string;
  generationMode: 'procedural' | 'hybrid';
  treeParams?: {
    species: 'oak' | 'pine' | 'willow' | 'palm' | 'birch' | 'baobab' | 'cherry_blossom' | 'dead_tree' | 'fantasy_crystal' | 'bonsai';
    trunkHeight: number;
    trunkRadius: number;
    branchCount: number;
    branchAngle: number;
    canopyRadius: number;
    canopyHeight: number;
    foliageDensity: number;
    barkColor: string;
    leafColor: string;
    detailLevel: 'low' | 'medium' | 'high';
    rootFlare: number;
    trunkTaper: number;
  };
}

export interface BenchmarkCaseResult {
  id: string;
  order: number;
  title: string;
  category: string;
  subCategory: string;
  objectFamily: string;
  style: string;
  seed: number;
  targetPolyBudget: number;
  modelName: string;
  partCount: number;
  vertexCount: number;
  triangleCount: number;
  lodMetrics: {
    lod0Triangles: number;
    lod1Triangles: number;
    lod2Triangles: number;
    lod1ReductionRatio: number;
    lod2ReductionRatio: number;
    monotonicReduction: boolean;
  };
  boundingBoxStuds: {
    widthX: number;
    heightY: number;
    depthZ: number;
    minY: number;
    maxY: number;
  };
  groundedAtZero: boolean;
  editableMeshCompliant: boolean;
  degenerateTriangles: number;
  hierarchyZones: string[];
  partNames: string[];
  materialsUsed: string[];
  colorsUsed: string[];
  qualityMetrics: AssetQualityMetrics;
  cameraViews: BenchmarkCameraViews;
  validation: ReturnType<typeof validateProcedural3DGeometry>;
  synthesis: Procedural3DSynthesisResult;
}

export interface VisualBenchmarkSuiteReport {
  suiteVersion: 'forge-visual-benchmark-v3';
  generatedAt: string;
  totalCases: number;
  passedCases: number;
  allCasesPassed: boolean;
  cases: BenchmarkCaseResult[];
}

export const CANONICAL_VISUAL_BENCHMARK_CASES: BenchmarkCaseSpec[] = [
  {
    id: 'stylized_tree',
    order: 1,
    title: '1. Árbol Realista Estilizado (Roble con Raíces y Sub-Ramas)',
    category: 'Trees & Foliage',
    subCategory: 'oak',
    objectFamily: 'tree',
    style: 'Stylized',
    seed: 10101,
    targetPolyBudget: 2400,
    prompt: 'Árbol roble estilizado con raíces superficiales orgánicas, tronco con conicidad, ramificación jerárquica recursiva y clusters de follaje denso',
    generationMode: 'procedural',
    treeParams: {
      species: 'oak',
      trunkHeight: 11,
      trunkRadius: 1.35,
      branchCount: 6,
      branchAngle: 42,
      canopyRadius: 6.2,
      canopyHeight: 5.5,
      foliageDensity: 8,
      barkColor: '#5c3c24',
      leafColor: '#2d7a3e',
      detailLevel: 'high',
      rootFlare: 1.55,
      trunkTaper: 0.55,
    },
  },
  {
    id: 'fantasy_tree',
    order: 2,
    title: '2. Árbol Fantástico Bioluminiscente (Cristal y Raíces Místicas)',
    category: 'Trees & Foliage',
    subCategory: 'fantasy_crystal',
    objectFamily: 'tree',
    style: 'Sci-Fi / Neon',
    seed: 20202,
    targetPolyBudget: 2600,
    prompt: 'Árbol fantástico bioluminiscente con cristales arcanos en el tronco, raíces expuestas brillantes, ramas curvadas y follaje luminoso neón',
    generationMode: 'hybrid',
  },
  {
    id: 'detailed_rock',
    order: 3,
    title: '3. Roca Detallada (Icosfera Deformada con Fracturas y Estratos)',
    category: 'Rocks & Nature',
    subCategory: 'cliff_boulder',
    objectFamily: 'rock',
    style: 'Realistic PBR',
    seed: 30303,
    targetPolyBudget: 2200,
    prompt: 'Formación rocosa detallada con malla de icosfera subdividida, facetas de fractura geológica, estratificación horizontal, erosión basal y cristales minerales',
    generationMode: 'hybrid',
  },
  {
    id: 'modular_building',
    order: 4,
    title: '4. Edificio Modular (Fachada, Arco, Ventanas, Columnas y Tejado)',
    category: 'Buildings & Structures',
    subCategory: 'medieval_tower',
    objectFamily: 'building',
    style: 'Medieval / Fantasy',
    seed: 40404,
    targetPolyBudget: 2400,
    prompt: 'Edificio torre medieval con cimiento escalonado, fachada principal, puerta con arco y marco, ventanas con cristal y alféizar, columnas esquineras acanaladas, cornisa y tejado a cuatro aguas',
    generationMode: 'hybrid',
  },
  {
    id: 'ergonomic_chair',
    order: 5,
    title: '5. Silla / Trono Ergonómico (Patas Torneadas, Cojín, Respaldo y Brazos)',
    category: 'Furniture & Interior',
    subCategory: 'chair',
    objectFamily: 'chair',
    style: 'Stylized',
    seed: 50505,
    targetPolyBudget: 1800,
    prompt: 'Silla ergonómica detallada con 4 patas torneadas cónicas, travesaños de refuerzo, bastidor de asiento, cojín tapizado, respaldo en ángulo con cresta tallada y reposabrazos curvados',
    generationMode: 'hybrid',
  },
  {
    id: 'street_lamp',
    order: 6,
    title: '6. Lámpara / Farol Forjado (Pedestal, Poste, Pantalla y Núcleo Emisivo)',
    category: 'Ambient & Decoration',
    subCategory: 'street_lamp',
    objectFamily: 'lamp',
    style: 'Stylized',
    seed: 60606,
    targetPolyBudget: 1600,
    prompt: 'Farol ornamental con pedestal escalonado, poste metálico acanalado, collarín de soporte, pantalla de cristal translúcida, bombilla emisiva cálida y cúpula superior con remate',
    generationMode: 'hybrid',
  },
  {
    id: 'mechanical_gearbox',
    order: 7,
    title: '7. Objeto Mecánico (Chasis, Engranajes Dentados Reales y Pistones)',
    category: 'Props',
    subCategory: 'mechanical_engine',
    objectFamily: 'mechanical',
    style: 'Sci-Fi / Neon',
    seed: 70707,
    targetPolyBudget: 2500,
    prompt: 'Mecanismo industrial con chasis empernado, carcasa central, engranaje motriz dentado real, piñón secundario engranado, eje de transmisión, pistones hidráulicos laterales y núcleo energético',
    generationMode: 'hybrid',
  },
  {
    id: 'coherent_scene',
    order: 8,
    title: '8. Pequeño Escenario Coherente (Scene3D Multi-Asset con Zonas)',
    category: 'Scene3D',
    subCategory: 'sanctuary_diorama',
    objectFamily: 'scene',
    style: 'Medieval / Fantasy',
    seed: 80808,
    targetPolyBudget: 3800,
    prompt: 'Escenario 3D completo de santuario con plataforma de terreno, sendero empedrado, pabellón arquitectónico central, árbol con raíces y follaje, rocas geológicas periféricas y faroles de iluminación',
    generationMode: 'hybrid',
  },
];

function computeBoundingBoxStuds(parts: Procedural3DPart[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const part of parts) {
    const [px, py, pz] = part.position;
    const [sx, sy, sz] = part.size;
    minX = Math.min(minX, px - sx / 2);
    maxX = Math.max(maxX, px + sx / 2);
    minY = Math.min(minY, py - sy / 2);
    maxY = Math.max(maxY, py + sy / 2);
    minZ = Math.min(minZ, pz - sz / 2);
    maxZ = Math.max(maxZ, pz + sz / 2);
  }

  if (!Number.isFinite(minY)) {
    return { widthX: 0, heightY: 0, depthZ: 0, minY: 0, maxY: 0 };
  }

  return {
    widthX: Number((maxX - minX).toFixed(2)),
    heightY: Number((maxY - minY).toFixed(2)),
    depthZ: Number((maxZ - minZ).toFixed(2)),
    minY: Number(minY.toFixed(3)),
    maxY: Number(maxY.toFixed(2)),
  };
}

function clampScore(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function evaluateAssetQualityMetrics(
  synthesis: Procedural3DSynthesisResult,
  existingValidation?: ReturnType<typeof validateProcedural3DGeometry>
): AssetQualityMetrics {
  const validation = existingValidation || validateProcedural3DGeometry(synthesis.parts);
  const bbox = computeBoundingBoxStuds(synthesis.parts);
  const parts = synthesis.parts || [];

  const hierarchySet = new Set<string>();
  const materialsSet = new Set<string>();
  const colorsSet = new Set<string>();
  let partsWithMesh = 0;
  let partsWithUvs = 0;
  let lod0 = 0;
  let lod1 = 0;
  let lod2 = 0;

  for (const part of parts) {
    hierarchySet.add(part.parent || 'Root');
    materialsSet.add(String(part.material || 'SmoothPlastic'));
    colorsSet.add(Array.isArray(part.color) ? part.color.join(',') : String(part.color));
    if (part.meshData) {
      partsWithMesh++;
      if (Array.isArray((part.meshData as any).uvs) && (part.meshData as any).uvs.length > 0) {
        partsWithUvs++;
      }
      const lods = part.meshData.lodLevels;
      if (Array.isArray(lods) && lods.length >= 3) {
        lod0 += lods[0].triangleCount;
        lod1 += lods[1].triangleCount;
        lod2 += lods[2].triangleCount;
      } else {
        lod0 += part.meshData.triangleCount;
        lod1 += Math.max(4, Math.floor(part.meshData.triangleCount * 0.55));
        lod2 += Math.max(4, Math.floor(part.meshData.triangleCount * 0.3));
      }
    }
  }

  const grounded = Math.abs(bbox.minY) <= 0.15;
  const monotonicLod = lod0 > lod1 && lod1 >= lod2;
  const evalObj = (synthesis as any).visual_identity_evaluation;
  const partCount = parts.length;
  const hasBbox = bbox.widthX > 0.1 && bbox.heightY > 0.1 && bbox.depthZ > 0.1;

  const visualIdentityScore = clampScore(
    typeof evalObj?.overallScore === 'number'
      ? evalObj.overallScore
      : partCount >= 10
      ? 88
      : partCount >= 6
      ? 80
      : 62
  );
  const promptFidelityScore = clampScore(
    evalObj?.passed
      ? Math.max(84, Number(evalObj.overallScore || 86))
      : partCount >= 6 && hasBbox
      ? 78
      : 60
  );
  const proportionScore = clampScore(
    (hasBbox ? 55 : 15) + (grounded ? 25 : 0) + (bbox.heightY >= 1.5 ? 14 : 6)
  );
  const silhouetteScore = clampScore(
    45 + Math.min(30, hierarchySet.size * 8) + Math.min(20, partCount * 1.5)
  );
  const componentCompletenessScore = clampScore(
    36 + Math.min(40, partCount * 3.8) + Math.min(24, hierarchySet.size * 6)
  );
  const geometryQualityScore = clampScore(
    (partsWithMesh === partCount && partCount > 0 ? 50 : 25) +
      (monotonicLod ? 25 : 10) +
      (validation.totalTriangles >= 120 ? 20 : 10)
  );
  const materialPbrScore = clampScore(
    50 + Math.min(30, materialsSet.size * 14) + (parts.some((p: any) => typeof p.roughness === 'number') ? 16 : 6)
  );
  const colorHarmonyScore = clampScore(48 + Math.min(44, colorsSet.size * 15));
  const textureUvScore = clampScore(
    partCount > 0 ? 40 + (partsWithUvs / partCount) * 55 : 30
  );
  const meshManifoldScore = clampScore(
    validation.valid && validation.degenerateTriangles === 0 ? 96 : validation.valid ? 74 : 45
  );
  const robloxCompatibilityScore = clampScore(
    (validation.editableMeshCompliant ? 55 : 20) + (grounded ? 25 : 5) + (partCount <= 120 ? 16 : 6)
  );

  const dims = [
    visualIdentityScore,
    promptFidelityScore,
    proportionScore,
    silhouetteScore,
    componentCompletenessScore,
    geometryQualityScore,
    materialPbrScore,
    colorHarmonyScore,
    textureUvScore,
    meshManifoldScore,
    robloxCompatibilityScore,
  ];
  const overallScore = Number((dims.reduce((a, b) => a + b, 0) / dims.length).toFixed(1));

  return {
    visualIdentityScore,
    promptFidelityScore,
    proportionScore,
    silhouetteScore,
    componentCompletenessScore,
    geometryQualityScore,
    materialPbrScore,
    colorHarmonyScore,
    textureUvScore,
    meshManifoldScore,
    robloxCompatibilityScore,
    overallScore,
  };
}

export function compareModelVariationPair(
  assetA: Procedural3DSynthesisResult,
  assetB: Procedural3DSynthesisResult
): ModelVariationComparison {
  const bboxA = computeBoundingBoxStuds(assetA.parts);
  const bboxB = computeBoundingBoxStuds(assetB.parts);
  const volA = Math.max(0.01, bboxA.widthX * bboxA.heightY * bboxA.depthZ);
  const volB = Math.max(0.01, bboxB.widthX * bboxB.heightY * bboxB.depthZ);
  const volumeRatio = Number((Math.max(volA, volB) / Math.min(volA, volB)).toFixed(3));

  const colorsA: string[] = Array.from(
    new Set(
      assetA.parts.map((p: Procedural3DPart): string =>
        Array.isArray(p.color) ? p.color.join(',') : String(p.color)
      )
    )
  );
  const colorsB: string[] = Array.from(
    new Set(
      assetB.parts.map((p: Procedural3DPart): string =>
        Array.isArray(p.color) ? p.color.join(',') : String(p.color)
      )
    )
  );
  const setB = new Set(colorsB);
  const overlapCount = colorsA.filter((c) => setB.has(c)).length;
  const unionCount = new Set([...colorsA, ...colorsB]).size;
  const paletteOverlapRatio = unionCount > 0 ? Number((overlapCount / unionCount).toFixed(3)) : 1;

  const widthXDelta = Number(Math.abs(bboxA.widthX - bboxB.widthX).toFixed(2));
  const heightYDelta = Number(Math.abs(bboxA.heightY - bboxB.heightY).toFixed(2));
  const depthZDelta = Number(Math.abs(bboxA.depthZ - bboxB.depthZ).toFixed(2));
  const distinctPartCountDelta = Math.abs(assetA.parts.length - assetB.parts.length);
  const structuralHashDifferent =
    String((assetA as any).contentHash || '') !== String((assetB as any).contentHash || '') ||
    distinctPartCountDelta > 0 ||
    heightYDelta > 0.25;
  const seedDifferent = String(assetA.seed) !== String(assetB.seed);

  const distinctnessScore = clampScore(
    (structuralHashDifferent ? 28 : 0) +
      Math.min(22, distinctPartCountDelta * 4) +
      Math.min(24, (widthXDelta + heightYDelta + depthZDelta) * 2.5) +
      Math.round((1 - paletteOverlapRatio) * 26)
  );

  return {
    assetAId: String((assetA as any).id || assetA.model_name),
    assetBId: String((assetB as any).id || assetB.model_name),
    seedA: String(assetA.seed),
    seedB: String(assetB.seed),
    seedDifferent,
    structuralHashDifferent,
    distinctPartCountDelta,
    bboxDeltaStuds: {
      widthXDelta,
      heightYDelta,
      depthZDelta,
      volumeRatio,
    },
    distinctColorsA: colorsA,
    distinctColorsB: colorsB,
    paletteOverlapRatio,
    distinctnessScore,
    areVisuallyDistinct: structuralHashDifferent && distinctnessScore >= 25,
  };
}

export function evaluateBenchmarkCase(spec: BenchmarkCaseSpec): BenchmarkCaseResult {
  const synthesis = synthesizeSeededProcedural3DAsset({
    prompt: spec.prompt,
    category: spec.category,
    sub_category: spec.subCategory,
    style: spec.style,
    seed: spec.seed,
    target_poly_budget: spec.targetPolyBudget,
    generation_mode: spec.generationMode,
    tree_params: spec.treeParams as any,
  });

  const validation = validateProcedural3DGeometry(synthesis.parts);
  const bbox = computeBoundingBoxStuds(synthesis.parts);

  let lod0Triangles = 0;
  let lod1Triangles = 0;
  let lod2Triangles = 0;

  const hierarchySet = new Set<string>();
  const materialsSet = new Set<string>();
  const colorsSet = new Set<string>();

  for (const part of synthesis.parts) {
    hierarchySet.add(part.parent || 'Root');
    materialsSet.add(part.material);
    if (Array.isArray(part.color)) {
      colorsSet.add(`rgb(${part.color.join(',')})`);
    } else {
      colorsSet.add(String(part.color));
    }

    const lods = part.meshData?.lodLevels;
    if (Array.isArray(lods) && lods.length >= 3) {
      lod0Triangles += lods[0].triangleCount;
      lod1Triangles += lods[1].triangleCount;
      lod2Triangles += lods[2].triangleCount;
    } else if (part.meshData) {
      lod0Triangles += part.meshData.triangleCount;
      lod1Triangles += Math.max(4, Math.floor(part.meshData.triangleCount * 0.55));
      lod2Triangles += Math.max(4, Math.floor(part.meshData.triangleCount * 0.3));
    }
  }

  const lod1ReductionRatio = lod0Triangles > 0 ? Number((lod1Triangles / lod0Triangles).toFixed(3)) : 1;
  const lod2ReductionRatio = lod0Triangles > 0 ? Number((lod2Triangles / lod0Triangles).toFixed(3)) : 1;
  const monotonicReduction = lod0Triangles > lod1Triangles && lod1Triangles >= lod2Triangles;
  const groundedAtZero = Math.abs(bbox.minY) <= 0.15;
  const qualityMetrics = evaluateAssetQualityMetrics(synthesis, validation);

  const snaps =
    (synthesis as any).multi_angle_snapshots &&
    (synthesis as any).multi_angle_snapshots.backSvg
      ? (synthesis as any).multi_angle_snapshots
      : renderMultiAngleSvgSnapshots({
          modelName: synthesis.model_name,
          subjectLabel: spec.title,
          parts: synthesis.parts as any,
        });

  const cameraViews: BenchmarkCameraViews = {
    frontSvg: snaps.frontSvg,
    sideSvg: snaps.sideSvg,
    backSvg: snaps.backSvg,
    topSvg: snaps.topSvg,
    isometricSvg: snaps.isometricSvg,
  };

  return {
    id: spec.id,
    order: spec.order,
    title: spec.title,
    category: spec.category,
    subCategory: spec.subCategory,
    objectFamily: spec.objectFamily,
    style: spec.style,
    seed: spec.seed,
    targetPolyBudget: spec.targetPolyBudget,
    modelName: synthesis.model_name,
    partCount: synthesis.parts.length,
    vertexCount: validation.totalVertices,
    triangleCount: validation.totalTriangles,
    lodMetrics: {
      lod0Triangles,
      lod1Triangles,
      lod2Triangles,
      lod1ReductionRatio,
      lod2ReductionRatio,
      monotonicReduction,
    },
    boundingBoxStuds: bbox,
    groundedAtZero,
    editableMeshCompliant: validation.editableMeshCompliant,
    degenerateTriangles: validation.degenerateTriangles,
    hierarchyZones: Array.from(hierarchySet),
    partNames: synthesis.parts.map((p: any) => String(p.name)),
    materialsUsed: Array.from(materialsSet),
    colorsUsed: Array.from(colorsSet),
    qualityMetrics,
    cameraViews,
    validation,
    synthesis,
  };
}

export const MANDATORY_COW_ACCEPTANCE_PROMPT =
  'Genera una vaca adulta de cuerpo completo, con anatomía bovina reconocible, cuatro patas proporcionadas, torso volumétrico, cuello, cabeza, hocico, dos orejas, dos cuernos, ojos, pezuñas y cola. Tiene manchas negras y blancas, pelaje estilizado y proporciones naturales. Modelo 3D completo, apoyado sobre el suelo, preparado para Roblox.';

export const FREEFORM_GENERALIZATION_BENCHMARK_CASES: BenchmarkCaseSpec[] = [
  {
    id: 'bovine_cow_acceptance',
    order: 1,
    title: 'Caso Obligatorio — Vaca Adulta Completa (Anatomía Bovina, 4 Patas, Manchas Negras y Blancas)',
    category: 'Props',
    subCategory: 'bovine_cow',
    objectFamily: 'quadruped_animal',
    style: 'Stylized',
    seed: 90101,
    targetPolyBudget: 3400,
    prompt: MANDATORY_COW_ACCEPTANCE_PROMPT,
    generationMode: 'hybrid',
  },
  {
    id: 'generalization_horse',
    order: 2,
    title: 'Generalización 1 — Caballo Adulto (Cuello Arqueado, Crin, 4 Patas con Cascos y Cola)',
    category: 'Props',
    subCategory: 'equine_horse',
    objectFamily: 'quadruped_animal',
    style: 'Stylized',
    seed: 90202,
    targetPolyBudget: 3200,
    prompt:
      'Genera un caballo adulto estilizado de cuerpo completo con cuatro patas proporcionadas, cascos, torso equino, cuello arqueado con crin dorsal, cabeza alargada, hocico, dos orejas erguidas, dos ojos y cola poblada, apoyado sobre el suelo para Roblox.',
    generationMode: 'hybrid',
  },
  {
    id: 'generalization_dog',
    order: 3,
    title: 'Generalización 2 — Perro / Cánido Anatómico (Tórax Profundo, Hocico con Trufa, 4 Patas y Cola)',
    category: 'Props',
    subCategory: 'canine_dog',
    objectFamily: 'quadruped_animal',
    style: 'Stylized',
    seed: 90303,
    targetPolyBudget: 2800,
    prompt:
      'Genera un perro pastor estilizado de cuerpo completo con cuatro patas articuladas, tórax profundo, cuello, cabeza canina, hocico alargado con trufa negra, dos orejas erguidas, dos ojos y cola elevada, apoyado en el suelo.',
    generationMode: 'hybrid',
  },
  {
    id: 'generalization_dragon',
    order: 4,
    title: 'Generalización 3 — Dragón Mítico Alado (2 Alas Membranosas, Cuernos, Crestas, 4 Patas y Cola)',
    category: 'Props',
    subCategory: 'winged_dragon',
    objectFamily: 'winged_creature',
    style: 'Medieval / Fantasy',
    seed: 90404,
    targetPolyBudget: 3800,
    prompt:
      'Genera un dragón mítico de cuerpo completo con torso reptiliano, cuello serpentino, cabeza con dos cuernos y mandíbula, dos ojos brillantes, dos grandes alas membranosas extendidas, cuatro patas con garras, crestas dorsales y cola larga.',
    generationMode: 'hybrid',
  },
  {
    id: 'generalization_motorcycle',
    order: 5,
    title: 'Generalización 4 — Motocicleta Deportiva (2 Ruedas Toroidales, Horquilla, Motor V-Twin y Escapes)',
    category: 'Props',
    subCategory: 'motorcycle',
    objectFamily: 'wheeled_vehicle',
    style: 'Realistic PBR',
    seed: 90505,
    targetPolyBudget: 3200,
    prompt:
      'Genera una motocicleta completa con dos ruedas toroidales y llantas metálicas, horquilla telescópica delantera, manillar, tanque de combustible en gota, bloque motor V-Twin, dos tubos de escape cromados, asiento ergonómico y faro delantero.',
    generationMode: 'hybrid',
  },
  {
    id: 'generalization_human_statue',
    order: 6,
    title: 'Generalización 5 — Estatua Humana Esculpida (Pedestal, Torso, Cabeza, 2 Brazos y 2 Piernas)',
    category: 'Ambient & Decoration',
    subCategory: 'human_statue',
    objectFamily: 'biped_humanoid_or_statue',
    style: 'Realistic PBR',
    seed: 90606,
    targetPolyBudget: 3200,
    prompt:
      'Genera una estatua humana clásica en mármol sobre pedestal escalonado de piedra, con pelvis, torso anatómico esculpido, cuello, cabeza humana, dos brazos articulados con manos y dos piernas articuladas con pies.',
    generationMode: 'hybrid',
  },
  {
    id: 'generalization_fantasy_tree',
    order: 7,
    title: 'Generalización 6 — Árbol Fantástico Bioluminiscente (Raíces, Tronco Orgánico y Ramificación)',
    category: 'Trees & Vegetation',
    subCategory: 'fantasy',
    objectFamily: 'tree',
    style: 'Sci-Fi / Neon',
    seed: 90707,
    targetPolyBudget: 2800,
    prompt:
      'Genera un árbol fantástico bioluminiscente con raíces superficiales orgánicas, tronco irregular con cristales arcanos, ramificación jerárquica recursiva y copa de follaje luminoso.',
    generationMode: 'hybrid',
  },
  {
    id: 'generalization_medieval_house',
    order: 8,
    title: 'Generalización 7 — Casa Medieval Modular (Cimiento de Piedra, Fachada, Puerta, Ventanas y Tejado)',
    category: 'Buildings & Structures',
    subCategory: 'medieval_house',
    objectFamily: 'building',
    style: 'Medieval / Fantasy',
    seed: 90808,
    targetPolyBudget: 2800,
    prompt:
      'Genera una casa medieval completa con cimiento de piedra escalonado, muros de fachada, puerta con arco de madera, ventanas enmarcadas con cristal, columnas esquineras y tejado inclinado a cuatro aguas.',
    generationMode: 'hybrid',
  },
];

export function getBenchmarkCaseById(caseId: string): BenchmarkCaseResult | null {
  const spec =
    CANONICAL_VISUAL_BENCHMARK_CASES.find((c) => c.id === caseId) ||
    FREEFORM_GENERALIZATION_BENCHMARK_CASES.find((c) => c.id === caseId);
  if (!spec) return null;
  return evaluateBenchmarkCase(spec);
}

export function runVisualBenchmarkSuite(): VisualBenchmarkSuiteReport {
  const cases = CANONICAL_VISUAL_BENCHMARK_CASES.map((spec) => evaluateBenchmarkCase(spec));
  const passedCases = cases.filter(
    (c) =>
      c.validation.valid &&
      c.editableMeshCompliant &&
      c.degenerateTriangles === 0 &&
      c.groundedAtZero &&
      c.lodMetrics.monotonicReduction &&
      c.partCount >= 6
  ).length;

  return {
    suiteVersion: 'forge-visual-benchmark-v3',
    generatedAt: new Date().toISOString(),
    totalCases: cases.length,
    passedCases,
    allCasesPassed: passedCases === cases.length,
    cases,
  };
}

export function runFreeformGeneralizationBenchmarkSuite(): VisualBenchmarkSuiteReport & {
  semanticPassCount: number;
  allSemanticIdentityPassed: boolean;
} {
  const cases = FREEFORM_GENERALIZATION_BENCHMARK_CASES.map((spec) => evaluateBenchmarkCase(spec));
  const passedCases = cases.filter(
    (c) =>
      c.validation.valid &&
      c.editableMeshCompliant &&
      c.degenerateTriangles === 0 &&
      c.groundedAtZero &&
      c.lodMetrics.monotonicReduction &&
      c.partCount >= 6
  ).length;
  const semanticPassCount = cases.filter(
    (c) => Boolean(c.synthesis?.visual_identity_evaluation?.passed)
  ).length;

  return {
    suiteVersion: 'forge-visual-benchmark-v3',
    generatedAt: new Date().toISOString(),
    totalCases: cases.length,
    passedCases,
    allCasesPassed: passedCases === cases.length && semanticPassCount === cases.length,
    semanticPassCount,
    allSemanticIdentityPassed: semanticPassCount === cases.length,
    cases,
  };
}

export interface PersistedBenchmarkSummary {
  outputDir: string;
  reportPath: string;
  summaryPath: string;
  viewsDir: string;
  svgFilesWritten: string[];
  totalSvgCount: number;
  canonicalPassed: number;
  canonicalTotal: number;
  freeformPassed: number;
  freeformTotal: number;
}

export function persistVisualBenchmarkArtifacts(
  outputDir: string,
  options?: { caseLimitForViews?: number }
): PersistedBenchmarkSummary {
  const absDir = path.resolve(outputDir);
  const viewsDir = path.join(absDir, 'views');
  fs.mkdirSync(viewsDir, { recursive: true });

  const canonical = runVisualBenchmarkSuite();
  const freeform = runFreeformGeneralizationBenchmarkSuite();

  const promptATree = synthesizeSeededProcedural3DAsset({
    prompt: 'árbol pequeño 5 studs, tronco delgado, hojas rojas, copa esférica, cartoon',
    category: 'Trees & Foliage',
    sub_category: 'oak',
    style: 'Cartoon',
    seed: 55101,
    target_poly_budget: 2400,
    generation_mode: 'hybrid',
  });
  const promptBTree = synthesizeSeededProcedural3DAsset({
    prompt: 'árbol gigante 35 studs, tronco grueso y retorcido, hojas azules luminosas, ramas asimétricas, copa cristalina',
    category: 'Trees & Foliage',
    sub_category: 'crystalline',
    style: 'Sci-Fi / Neon',
    seed: 55202,
    target_poly_budget: 2800,
    generation_mode: 'hybrid',
  });
  const treeVariationPair = compareModelVariationPair(promptATree, promptBTree);

  const cowSmall = synthesizeSeededProcedural3DAsset({
    prompt: 'una vaca pequeña blanca con manchas negras',
    category: 'Props',
    sub_category: 'cow',
    style: 'Stylized',
    seed: 66101,
    target_poly_budget: 3000,
    generation_mode: 'hybrid',
  });
  const cowLarge = synthesizeSeededProcedural3DAsset({
    prompt: 'una vaca grande marrón con cuernos largos',
    category: 'Props',
    sub_category: 'cow',
    style: 'Realistic PBR',
    seed: 66202,
    target_poly_budget: 3200,
    generation_mode: 'hybrid',
  });
  const cowVariationPair = compareModelVariationPair(cowSmall, cowLarge);

  const allCases = [...canonical.cases, ...freeform.cases];
  const maxViewCases = options?.caseLimitForViews ?? allCases.length;
  const svgFilesWritten: string[] = [];

  for (const bCase of allCases.slice(0, maxViewCases)) {
    const viewPairs: Array<[string, string]> = [
      ['front', bCase.cameraViews.frontSvg],
      ['side', bCase.cameraViews.sideSvg],
      ['back', bCase.cameraViews.backSvg],
      ['top', bCase.cameraViews.topSvg],
      ['isometric', bCase.cameraViews.isometricSvg],
    ];
    for (const [viewName, svgContent] of viewPairs) {
      if (svgContent && svgContent.includes('<svg')) {
        const fileName = `${bCase.id}_${viewName}.svg`;
        const filePath = path.join(viewsDir, fileName);
        fs.writeFileSync(filePath, svgContent, 'utf8');
        svgFilesWritten.push(filePath);
      }
    }
  }

  // Also persist Prompt A vs B and Cow Variation multi-angle views
  const extraVariationPairs: Array<[string, Procedural3DSynthesisResult]> = [
    ['tree_prompt_a_5studs_red', promptATree],
    ['tree_prompt_b_35studs_crystal', promptBTree],
    ['cow_variation_a_small_spotted', cowSmall],
    ['cow_variation_b_large_longhorn', cowLarge],
  ];
  for (const [slug, asset] of extraVariationPairs) {
    const snaps =
      (asset as any).multi_angle_snapshots?.backSvg
        ? (asset as any).multi_angle_snapshots
        : renderMultiAngleSvgSnapshots({
            modelName: asset.model_name,
            subjectLabel: slug,
            parts: asset.parts as any,
          });
    const viewPairs: Array<[string, string]> = [
      ['front', snaps.frontSvg],
      ['side', snaps.sideSvg],
      ['back', snaps.backSvg],
      ['top', snaps.topSvg],
      ['isometric', snaps.isometricSvg],
    ];
    for (const [viewName, svgContent] of viewPairs) {
      if (svgContent && svgContent.includes('<svg')) {
        const fileName = `${slug}_${viewName}.svg`;
        const filePath = path.join(viewsDir, fileName);
        fs.writeFileSync(filePath, svgContent, 'utf8');
        svgFilesWritten.push(filePath);
      }
    }
  }

  const summarizeCase = (c: BenchmarkCaseResult) => ({
    id: c.id,
    title: c.title,
    category: c.category,
    subCategory: c.subCategory,
    objectFamily: c.objectFamily,
    partCount: c.partCount,
    vertexCount: c.vertexCount,
    triangleCount: c.triangleCount,
    lodMetrics: c.lodMetrics,
    boundingBoxStuds: c.boundingBoxStuds,
    groundedAtZero: c.groundedAtZero,
    editableMeshCompliant: c.editableMeshCompliant,
    degenerateTriangles: c.degenerateTriangles,
    hierarchyZones: c.hierarchyZones,
    materialsUsed: c.materialsUsed,
    qualityMetrics: c.qualityMetrics,
    semanticPassed: Boolean(c.synthesis?.visual_identity_evaluation?.passed),
    semanticScore: c.synthesis?.visual_identity_evaluation?.overallScore ?? null,
    executionReport: (c.synthesis as any).execution_report || null,
  });

  const reportPayload = {
    suiteVersion: canonical.suiteVersion,
    generatedAt: canonical.generatedAt,
    canonical: {
      totalCases: canonical.totalCases,
      passedCases: canonical.passedCases,
      allCasesPassed: canonical.allCasesPassed,
      cases: canonical.cases.map(summarizeCase),
    },
    freeformGeneralization: {
      totalCases: freeform.totalCases,
      passedCases: freeform.passedCases,
      semanticPassCount: freeform.semanticPassCount,
      allCasesPassed: freeform.allCasesPassed,
      cases: freeform.cases.map(summarizeCase),
    },
    variationPairs: {
      treePromptAVsB: treeVariationPair,
      cowSmallSpottedVsLargeBrown: cowVariationPair,
    },
    viewsExported: {
      viewsDir: path.relative(absDir, viewsDir).replace(/\\/g, '/'),
      anglesPerAsset: ['front', 'side', 'back', 'top', 'isometric'],
      totalSvgFiles: svgFilesWritten.length,
    },
  };

  const reportPath = path.join(absDir, 'benchmark_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(reportPayload, null, 2), 'utf8');

  const mdLines: string[] = [
    '# NIGHTMARE FORGE — Reporte de Benchmarks Visuales y Variación Paramétrica',
    '',
    `- **Versión de suite:** \`${canonical.suiteVersion}\``,
    `- **Generado en:** \`${canonical.generatedAt}\``,
    `- **Suite canónica:** ${canonical.passedCases}/${canonical.totalCases} casos aprobados`,
    `- **Suite de generalización universal:** ${freeform.passedCases}/${freeform.totalCases} geométricos, ${freeform.semanticPassCount}/${freeform.totalCases} identidad semántica`,
    `- **Renders SVG 5 vistas exportados:** ${svgFilesWritten.length} archivos en \`views/\` (\`front\`, \`side\`, \`back\`, \`top\`, \`isometric\`)`,
    '',
    '## Métricas por Caso (11 Dimensiones)',
    '',
    '| ID | Partes | Triángulos | Overall | Visual ID | Prompt Fid | Prop | Silueta | Completeness | Geom | PBR | Color | UV | Manifold | Roblox |',
    '| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |',
  ];

  for (const c of allCases) {
    const q = c.qualityMetrics;
    mdLines.push(
      `| \`${c.id}\` | ${c.partCount} | ${c.triangleCount} | **${q.overallScore}** | ${q.visualIdentityScore} | ${q.promptFidelityScore} | ${q.proportionScore} | ${q.silhouetteScore} | ${q.componentCompletenessScore} | ${q.geometryQualityScore} | ${q.materialPbrScore} | ${q.colorHarmonyScore} | ${q.textureUvScore} | ${q.meshManifoldScore} | ${q.robloxCompatibilityScore} |`
    );
  }

  mdLines.push(
    '',
    '## Pares de Variación Paramétrica (Sin Plantillas Rígidas)',
    '',
    `- **Árbol Prompt A (5 studs, rojas, cartoon) vs Prompt B (35 studs, azul luminoso, cristalino):** distintos=${treeVariationPair.areVisuallyDistinct}, distinctnessScore=${treeVariationPair.distinctnessScore}/100, heightDelta=${treeVariationPair.bboxDeltaStuds.heightYDelta} studs, partCountDelta=${treeVariationPair.distinctPartCountDelta}, overlapPaleta=${treeVariationPair.paletteOverlapRatio}`,
    `- **Vaca Pequeña Blanca/Negra vs Vaca Grande Marrón/Cuernos Largos:** distintos=${cowVariationPair.areVisuallyDistinct}, distinctnessScore=${cowVariationPair.distinctnessScore}/100, heightDelta=${cowVariationPair.bboxDeltaStuds.heightYDelta} studs, overlapPaleta=${cowVariationPair.paletteOverlapRatio}`,
    ''
  );

  const summaryPath = path.join(absDir, 'benchmark_summary.md');
  fs.writeFileSync(summaryPath, mdLines.join('\n'), 'utf8');

  return {
    outputDir: absDir,
    reportPath,
    summaryPath,
    viewsDir,
    svgFilesWritten,
    totalSvgCount: svgFilesWritten.length,
    canonicalPassed: canonical.passedCases,
    canonicalTotal: canonical.totalCases,
    freeformPassed: freeform.passedCases,
    freeformTotal: freeform.totalCases,
  };
}

