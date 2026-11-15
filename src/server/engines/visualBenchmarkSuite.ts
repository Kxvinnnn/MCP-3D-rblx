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

export function getBenchmarkCaseById(caseId: string): BenchmarkCaseResult | null {
  const spec = CANONICAL_VISUAL_BENCHMARK_CASES.find((c) => c.id === caseId);
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
