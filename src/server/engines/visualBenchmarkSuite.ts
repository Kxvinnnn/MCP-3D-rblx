import {
  synthesizeSeededProcedural3DAsset,
  validateProcedural3DGeometry,
  type Procedural3DPart,
  type Procedural3DSynthesisResult,
} from './procedural3DGenerator.ts';

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

