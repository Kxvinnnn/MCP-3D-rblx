/**
 * @module aiGenerationDirector
 * @description
 * FASE 2 & FASE 4 — Selección Explícita de Motores + IA como Director de Generación.
 *
 * Responsabilidades:
 * 1. Resolver el modo de ejecución (`procedural`, `ai`, `hybrid`, `image_to_3d`) de forma
 *    explícita y honesta. Una semilla (`seed`) sirve para reproducibilidad, NUNCA para forzar
 *    silenciosamente el motor procedural cuando el usuario eligió IA, Híbrido o Imagen-a-3D.
 * 2. Definir el esquema estructurado `AiDirectorBlueprint` (identidad, estilo visual,
 *    silueta principal, proporciones, componentes, jerarquía, materiales, texturas,
 *    nivel de detalle, presupuesto poligonal, requisitos de exportación y restricciones Roblox).
 * 3. Validar y sanear el plan antes de construir la geometría.
 * 4. Si el proveedor IA no está disponible cuando se solicita `ai` o `hybrid`, devolver error
 *    explícito o un reporte de fallback explícito y visible (`fallback_triggered: true`),
 *    jamás simular que la IA se ejecutó cuando no lo hizo.
 */

import type { GoogleGenAI } from '@google/genai';
import type { ReferenceImageAnalysis } from './imageReferenceProcessor.ts';
import {
  interpretPromptSemantics,
  planGeometryAndComponents,
} from './universalFreeform3DEngine.ts';

const SchemaType = {
  OBJECT: 'OBJECT',
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  INTEGER: 'INTEGER',
  BOOLEAN: 'BOOLEAN',
  ARRAY: 'ARRAY',
} as const;

export type GenerationExecutionMode = 'procedural' | 'ai' | 'hybrid' | 'image_to_3d';

export type SpecializedObjectFamily =
  | 'quadruped_animal'
  | 'winged_creature'
  | 'biped_humanoid_or_statue'
  | 'wheeled_vehicle'
  | 'tree'
  | 'rock'
  | 'building'
  | 'chair'
  | 'table'
  | 'lamp'
  | 'mechanical'
  | 'chest_or_prop'
  | 'scene'
  | 'image_lathe'
  | 'freeform_composite';

export type TreeSpeciesArchetype = 'oak' | 'pine' | 'willow' | 'dead' | 'fantasy' | 'bonsai';

export interface PlannedComponentSpec {
  id: string;
  name: string;
  role: 'foundation' | 'trunk_or_core' | 'branch_or_frame' | 'crown_or_roof' | 'detail_or_accent' | 'lighting';
  parent_path: string;
  relative_height_range: [number, number];
  width_ratio: number;
  material: string;
  color_hex: string;
  lod_priority: 'critical_silhouette' | 'secondary_structure' | 'fine_detail';
}

export interface AiDirectorBlueprint {
  schema_version: 'forge-director-v3';
  blueprintVersion: 'forge-director-v3';
  objectFamily: SpecializedObjectFamily;
  targetPolyBudget: number;
  proportions: {
    widthStuds: number;
    heightStuds: number;
    depthStuds: number;
    symmetry: string;
  };
  materialPalette: {
    primaryHex: string;
    secondaryHex: string;
    accentHex: string;
  };
  subPartsPlan: PlannedComponentSpec[];
  identity: {
    name: string;
    object_family: SpecializedObjectFamily;
    category: string;
    asset_type: 'Model3D' | 'Scene3D';
    species_or_subtype: string;
  };
  visual_style: 'stylized_realism' | 'low_poly' | 'fantasy' | 'medieval' | 'sci_fi' | 'industrial' | 'organic';
  primary_silhouette:
    | 'quadruped_articulated_anatomy'
    | 'winged_reptilian_anatomy'
    | 'biped_sculpted_anatomy'
    | 'tandem_wheeled_chassis'
    | 'freeform_synthesized_graph'
    | 'spherical_crown'
    | 'conical_tiered'
    | 'weeping_canopy'
    | 'gnarled_deadwood'
    | 'faceted_outcrop'
    | 'modular_tower_facade'
    | 'ergonomic_seating'
    | 'pedestal_luminaire'
    | 'rotary_gearbox'
    | 'multi_asset_scene'
    | 'lathe_revolved_profile';
  proportions_studs: {
    width: number;
    height: number;
    depth: number;
  };
  components: PlannedComponentSpec[];
  hierarchy_plan: string[];
  materials_and_textures: {
    primary_material: string;
    secondary_material: string;
    accent_material: string;
    primary_hex: string;
    secondary_hex: string;
    accent_hex: string;
    roughness: number;
    metalness: number;
    pbr_pattern: string;
  };
  detail_level: 'low' | 'medium' | 'high' | 'ultra';
  target_poly_budget: number;
  export_requirements: {
    formats: Array<'rbxmx' | 'luau' | 'gltf' | 'glb' | 'obj'>;
    include_lods: boolean;
    include_pbr_surface_appearance: boolean;
  };
  roblox_constraints: {
    grounded_at_y0: boolean;
    max_vertices_per_part: number;
    max_triangles_per_part: number;
    collision_fidelity: 'Hull' | 'Box' | 'PreciseConvexDecomposition';
  };
}

export interface BlueprintValidationResult {
  valid: boolean;
  warnings: string[];
  blueprint: AiDirectorBlueprint;
  blueprintVersion: 'forge-director-v3';
  objectFamily: SpecializedObjectFamily;
  targetPolyBudget: number;
  proportions: {
    widthStuds: number;
    heightStuds: number;
    depthStuds: number;
    symmetry: string;
  };
  materialPalette: {
    primaryHex: string;
    secondaryHex: string;
    accentHex: string;
  };
  subPartsPlan: PlannedComponentSpec[];
}

export interface EngineExecutionReport {
  requested_mode: GenerationExecutionMode;
  executed_mode:
    | 'procedural'
    | 'ai'
    | 'hybrid'
    | 'image_to_3d'
    | 'hybrid_fallback_procedural'
    | 'ai_fallback_procedural';
  ai_provider_available: boolean;
  ai_provider_used: boolean;
  image_reference_processed?: boolean;
  reference_image_analyzed?: boolean;
  fallback_triggered: boolean;
  fallback_reason: string | null;
  seed_used?: string;
  seed?: string | number;
  seed_preserved?: boolean;
  poly_budget_requested?: number;
  poly_budget_achieved?: number;
  detail_level?: 'low' | 'medium' | 'high' | 'ultra';
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function sanitizeHex(hex: string | undefined, fallback: string): string {
  const s = String(hex || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s.toLowerCase()}`;
  return fallback;
}

const VALID_ROBLOX_MATERIALS = new Set([
  'Plastic',
  'SmoothPlastic',
  'Neon',
  'Wood',
  'WoodPlanks',
  'Marble',
  'Granite',
  'Brick',
  'Cobblestone',
  'Concrete',
  'CorrodedMetal',
  'DiamondPlate',
  'Foil',
  'Grass',
  'Ice',
  'Slate',
  'Sand',
  'Fabric',
  'Glass',
  'ForceField',
  'Metal',
  'Ground',
  'Limestone',
  'Basalt',
  'Rock',
  'LeafyGrass',
]);

function sanitizeRobloxMaterial(mat: string | undefined, fallback: string): string {
  const clean = String(mat || '').trim();
  return VALID_ROBLOX_MATERIALS.has(clean) ? clean : fallback;
}

/**
 * Resolves the requested generation mode explicitly without letting `seed` or `tree_params`
 * hijack `ai`, `hybrid`, or `image_to_3d` requests into `procedural`.
 */
export function resolveRequestedGenerationMode(params: {
  generation_mode?: string;
  reference_image_base64?: string;
}): GenerationExecutionMode {
  const rawMode = String(params.generation_mode || '').trim().toLowerCase();
  const hasRefImage = Boolean(
    typeof params.reference_image_base64 === 'string' && params.reference_image_base64.trim().length > 16
  );

  if (rawMode === 'image_to_3d' || rawMode === 'image-to-3d' || rawMode === 'image') {
    return 'image_to_3d';
  }
  if (rawMode === 'hybrid' || rawMode === 'hibrido' || rawMode === 'híbrido') {
    return 'hybrid';
  }
  if (rawMode === 'ai' || rawMode === 'ia') {
    return hasRefImage ? 'image_to_3d' : 'ai';
  }
  if (rawMode === 'procedural') {
    return hasRefImage ? 'image_to_3d' : 'procedural';
  }

  if (hasRefImage) {
    return 'image_to_3d';
  }
  return 'procedural';
}

/**
 * Detects the specialized 3D object family from prompt, category, asset_type, and optional image analysis.
 */
export function inferSpecializedObjectFamily(params: {
  prompt?: string;
  category?: string;
  asset_type?: string;
  referenceAnalysis?: ReferenceImageAnalysis | null;
}): {
  family: SpecializedObjectFamily;
  treeSpecies: TreeSpeciesArchetype;
  subtype?: string;
} {
  const text = `${params.prompt || ''} ${params.category || ''}`.toLowerCase();
  const cat = String(params.category || '').toLowerCase();

  // Check explicit scene first
  if (
    params.asset_type === 'Scene3D' ||
    /\b(escenario|escena|scene|diorama|santuario\s+completo|aldea|plaza|campamento|ruinas\s+con)\b/i.test(text)
  ) {
    return { family: 'scene', treeSpecies: 'oak', subtype: 'scene' };
  }

  // 1. Winged Mythic Creatures (Dragons, Wyverns, Griffins)
  if (/\b(drag[oó]n|dragon|wyvern|drake|guiverno|criatura\s+alada|winged\s+beast|grifo|griffin)\b/i.test(text)) {
    return { family: 'winged_creature', treeSpecies: 'oak', subtype: 'winged_dragon' };
  }

  // 2. Quadruped Animals (Cows, Horses, Dogs, Wolves, Cats, Deer, Bears, Sheep, Goats, etc.)
  if (
    /\b(vaca|vacas|cow|cows|bovino|bovina|bovine|toro|bull|becerro|calf|holstein|caballo|caballos|horse|stallion|mare|yegua|potro|pony|equino|corcel|perro|perros|dog|hound|lobo|wolf|cachorro|puppy|canino|canine|husky|pastor\s+alem[aá]n|zorro|fox|gato|cat|le[oó]n|lion|tigre|tiger|pantera|panther|ciervo|venado|deer|stag|oso|bear|cerdo|pig|oveja|sheep|cabra|goat|animal|cuadr[uú]pedo|quadruped)\b/i.test(
      text
    )
  ) {
    const sem = interpretPromptSemantics({ prompt: text, category: params.category });
    return { family: 'quadruped_animal', treeSpecies: 'oak', subtype: sem.archetype };
  }

  // 3. Wheeled Vehicles & Motorcycles (Motorcycles, Bikes, Cars, Trucks)
  if (
    /\b(motocicleta|moto|motorcycle|motorbike|chopper|scooter|bicicleta|bike|coche|auto|car|veh[ií]culo|vehicle|camioneta|truck)\b/i.test(
      text
    )
  ) {
    const sem = interpretPromptSemantics({ prompt: text, category: params.category });
    return { family: 'wheeled_vehicle', treeSpecies: 'oak', subtype: sem.archetype };
  }

  // 4. Biped Humanoids & Human Statues
  if (
    /\b(estatua|statue|escultura|sculpture|humano|humana|human|persona|person|guerrero|warrior|caballero|knight|mago|mage|personaje|character|avatar|monumento)\b/i.test(
      text
    )
  ) {
    const sem = interpretPromptSemantics({ prompt: text, category: params.category });
    return { family: 'biped_humanoid_or_statue', treeSpecies: 'oak', subtype: sem.archetype };
  }

  // 5. Check specific furniture/prop/mechanical families in prompt before generic category fallback
  if (/\b(silla|chair|trono|throne|butaca|asiento|stool|taburete|banco)\b/i.test(text)) {
    return { family: 'chair', treeSpecies: 'oak', subtype: 'chair' };
  }
  if (/\b(l[aá]mpara|lamp|farol|lantern|linterna|antorcha|candil|street\s*light|luminaria|baliza)\b/i.test(text)) {
    return { family: 'lamp', treeSpecies: 'oak', subtype: 'lamp' };
  }
  if (
    /\b(mec[aá]nic[oa]|mechanical|engranaje|gear|gearbox|m[aá]quina|machine|turbina|turbine|generador|generator|motor|pist[oó]n|robot|aut[oó]mata|torreta|turret)\b/i.test(
      text
    )
  ) {
    return { family: 'mechanical', treeSpecies: 'oak', subtype: 'mechanical' };
  }
  if (/\b(mesa|table|escritorio|desk|mostrador|workbench|banquete)\b/i.test(text)) {
    return { family: 'table', treeSpecies: 'oak', subtype: 'table' };
  }

  // 6. Trees & Vegetation
  if (
    cat.includes('tree') ||
    cat.includes('vegeta') ||
    /\b(tree|árbol|arbol|roble|oak|pino|pine|sauce|willow|bons[aá]i|cerezo|sakura|abeto|spruce|cipr[eé]s|bosque)\b/i.test(
      text
    )
  ) {
    let species: TreeSpeciesArchetype = 'oak';
    if (/\b(seco|muerto|dead|dry|marchito|leafless|sin\s+hojas|calcinado)\b/i.test(text)) {
      species = 'dead';
    } else if (
      /\b(fantas[ií]a|fantasy|m[aá]gico|magic|bioluminisc|cristal|crystal|alien|m[ií]stico|ne[oó]n|corrupt)\b/i.test(
        text
      )
    ) {
      species = 'fantasy';
    } else if (/\b(pino|pine|abeto|spruce|c[oó]nico|conical|cipr[eé]s|evergreen|alpino)\b/i.test(text)) {
      species = 'pine';
    } else if (/\b(sauce|willow|llor[oó]n|weeping|colgante)\b/i.test(text)) {
      species = 'willow';
    } else if (/\b(bons[aá]i|pagoda|capas|escalonado)\b/i.test(text)) {
      species = 'bonsai';
    }
    return { family: 'tree', treeSpecies: species, subtype: species };
  }

  // 7. Buildings & Structures (checked before Rocks so "casa con cimiento de piedra" resolves to building)
  if (
    cat.includes('building') ||
    cat.includes('structure') ||
    /\b(edificio|building|torre|tower|casa|house|castillo|castle|templo|temple|fortaleza|caba[ñn]a|fachada|muralla|arco|pabell[oó]n|keep|bunker)\b/i.test(
      text
    )
  ) {
    return { family: 'building', treeSpecies: 'oak', subtype: 'building' };
  }

  // 8. Rocks & Nature
  if (
    cat.includes('rock') ||
    cat.includes('nature') ||
    /\b(roca|rock|piedra|stone|pe[ñn]asco|boulder|acantilado|cliff|estalagmita|menhir|meteorito|basalto|granito)\b/i.test(
      text
    )
  ) {
    return { family: 'rock', treeSpecies: 'oak', subtype: 'rock' };
  }

  // 9. Explicit Chest / Crate / Coffer
  if (/\b(cofre|chest|ba[uú]l|crate|caja|relicario|tesoro)\b/i.test(text)) {
    return { family: 'chest_or_prop', treeSpecies: 'oak', subtype: 'chest' };
  }

  // Category-level fallbacks for Furniture, Ambient, Scene Elements
  if (cat.includes('furniture') || cat.includes('interior')) {
    return { family: 'chair', treeSpecies: 'oak', subtype: 'chair' };
  }
  if (cat.includes('ambient') || cat.includes('decoration')) {
    return { family: 'lamp', treeSpecies: 'oak', subtype: 'lamp' };
  }
  if (cat.includes('scene')) {
    return { family: 'scene', treeSpecies: 'oak', subtype: 'scene' };
  }

  if (params.referenceAnalysis) {
    return { family: 'image_lathe', treeSpecies: 'oak', subtype: 'image_lathe' };
  }

  if (params.prompt && params.prompt.trim().length > 0 && !/\b(props|prop)\b/i.test(params.prompt.trim())) {
    return { family: 'freeform_composite', treeSpecies: 'oak', subtype: 'freeform_synthesized_object' };
  }

  return { family: 'chest_or_prop', treeSpecies: 'oak', subtype: 'chest' };
}

/**
 * Builds a deterministic baseline `AiDirectorBlueprint` from the user's request and optional
 * 2D reference image analysis.
 */
export function buildBaselineDirectorBlueprint(params: {
  prompt?: string;
  name?: string;
  category?: string;
  asset_type?: 'Model3D' | 'Scene3D';
  detail_level?: 'low' | 'medium' | 'high' | 'ultra';
  target_poly_budget?: number;
  collision_fidelity?: 'Hull' | 'Box' | 'PreciseConvexDecomposition';
  tree_params?: Record<string, any>;
  referenceAnalysis?: ReferenceImageAnalysis | null;
}): AiDirectorBlueprint {
  const { family, treeSpecies } = inferSpecializedObjectFamily({
    prompt: params.prompt,
    category: params.category,
    asset_type: params.asset_type,
    referenceAnalysis: params.referenceAnalysis,
  });

  const rawDetail = params.detail_level || params.tree_params?.detailLevel || 'medium';
  const detailLevel: 'low' | 'medium' | 'high' | 'ultra' =
    rawDetail === 'low' || rawDetail === 'high' || rawDetail === 'ultra' ? rawDetail : 'medium';
  const defaultBudgetByDetail: Record<'low' | 'medium' | 'high' | 'ultra', number> = {
    low: 1200,
    medium: 2800,
    high: 6500,
    ultra: 11500,
  };
  const requestedBudget = Number(params.target_poly_budget);
  const targetPolyBudget = clamp(
    Number.isFinite(requestedBudget) && requestedBudget > 100
      ? requestedBudget
      : defaultBudgetByDetail[detailLevel] || 2800,
    240,
    36000
  );

  const rawPrompt = String(params.prompt || '').trim();
  const cleanName =
    String(params.name || '')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .slice(0, 30) ||
    rawPrompt
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('')
      .slice(0, 28) ||
    `Forge${family.charAt(0).toUpperCase() + family.slice(1)}3D`;

  const tp = params.tree_params || {};
  const ref = params.referenceAnalysis;

  let width = 8;
  let height = 10;
  let depth = 8;
  let primaryMat = 'SmoothPlastic';
  let secondaryMat = 'Wood';
  let accentMat = 'Metal';
  let primaryHex = '#475569';
  let secondaryHex = '#64748b';
  let accentHex = '#38bdf8';
  let silhouette: AiDirectorBlueprint['primary_silhouette'] = 'faceted_outcrop';
  let hierarchyPlan = ['Root', 'Root/Base', 'Root/Body', 'Root/Details'];
  const components: PlannedComponentSpec[] = [];

  if (family === 'tree') {
    height = clamp(Number(tp.height ?? 16), 5, 42);
    width = clamp(Number(tp.width ?? height * 0.78), 4, 34);
    depth = width;
    primaryMat = sanitizeRobloxMaterial(tp.trunkMaterial, 'Wood');
    secondaryMat = sanitizeRobloxMaterial(tp.leafMaterial, treeSpecies === 'fantasy' ? 'Neon' : 'Grass');
    accentMat = treeSpecies === 'fantasy' ? 'Glass' : 'WoodPlanks';
    primaryHex = sanitizeHex(tp.trunkColor, treeSpecies === 'fantasy' ? '#3b2d4a' : '#5c3d28');
    secondaryHex = sanitizeHex(
      tp.leafColor,
      treeSpecies === 'fantasy'
        ? '#a855f7'
        : treeSpecies === 'pine'
          ? '#1e5631'
          : treeSpecies === 'willow'
            ? '#3a8754'
            : '#2d7a46'
    );
    accentHex = treeSpecies === 'fantasy' ? '#22d3ee' : '#4a3222';
    silhouette =
      treeSpecies === 'pine'
        ? 'conical_tiered'
        : treeSpecies === 'willow'
          ? 'weeping_canopy'
          : treeSpecies === 'dead'
            ? 'gnarled_deadwood'
            : 'spherical_crown';
    hierarchyPlan = [
      'Root',
      'Root/Roots',
      'Root/Trunk',
      'Root/Branches/Primary',
      'Root/Branches/Secondary',
      'Root/Canopy',
    ];
    components.push(
      {
        id: 'comp_roots',
        name: 'RootFlareAndButtresses',
        role: 'foundation',
        parent_path: 'Root/Roots',
        relative_height_range: [0, 0.14],
        width_ratio: 0.35,
        material: primaryMat,
        color_hex: primaryHex,
        lod_priority: 'critical_silhouette',
      },
      {
        id: 'comp_trunk',
        name: 'MainIrregularTrunk',
        role: 'trunk_or_core',
        parent_path: 'Root/Trunk',
        relative_height_range: [0.05, 0.65],
        width_ratio: 0.18,
        material: primaryMat,
        color_hex: primaryHex,
        lod_priority: 'critical_silhouette',
      },
      {
        id: 'comp_branches',
        name: 'HierarchicalBranchNetwork',
        role: 'branch_or_frame',
        parent_path: 'Root/Branches/Primary',
        relative_height_range: [0.38, 0.86],
        width_ratio: 0.72,
        material: primaryMat,
        color_hex: primaryHex,
        lod_priority: 'secondary_structure',
      },
      {
        id: 'comp_canopy',
        name: 'OrganicCanopyClusters',
        role: 'crown_or_roof',
        parent_path: 'Root/Canopy',
        relative_height_range: [0.5, 1.0],
        width_ratio: 1.0,
        material: secondaryMat,
        color_hex: secondaryHex,
        lod_priority: 'critical_silhouette',
      }
    );
  } else if (family === 'rock') {
    height = 7.5;
    width = 9.5;
    depth = 8.5;
    primaryMat = 'Slate';
    secondaryMat = 'Basalt';
    accentMat = 'Neon';
    primaryHex = '#525b66';
    secondaryHex = '#3b424c';
    accentHex = '#38bdf8';
    silhouette = 'faceted_outcrop';
    hierarchyPlan = ['Root', 'Root/PrimaryMass', 'Root/StratifiedSlabs', 'Root/FractureClusters'];
    components.push(
      {
        id: 'comp_rock_core',
        name: 'PrimaryStratifiedBoulder',
        role: 'trunk_or_core',
        parent_path: 'Root/PrimaryMass',
        relative_height_range: [0, 1.0],
        width_ratio: 0.75,
        material: primaryMat,
        color_hex: primaryHex,
        lod_priority: 'critical_silhouette',
      },
      {
        id: 'comp_rock_slabs',
        name: 'FracturedCliffSlabs',
        role: 'branch_or_frame',
        parent_path: 'Root/StratifiedSlabs',
        relative_height_range: [0, 0.78],
        width_ratio: 1.0,
        material: secondaryMat,
        color_hex: secondaryHex,
        lod_priority: 'secondary_structure',
      },
      {
        id: 'comp_rock_talus',
        name: 'ErodedTalusBoulders',
        role: 'foundation',
        parent_path: 'Root/FractureClusters',
        relative_height_range: [0, 0.45],
        width_ratio: 0.9,
        material: secondaryMat,
        color_hex: secondaryHex,
        lod_priority: 'secondary_structure',
      },
      {
        id: 'comp_rock_spires',
        name: 'MineralRidgeAccents',
        role: 'detail_or_accent',
        parent_path: 'Root/FractureClusters',
        relative_height_range: [0.25, 0.85],
        width_ratio: 0.55,
        material: accentMat,
        color_hex: accentHex,
        lod_priority: 'fine_detail',
      }
    );
  } else if (family === 'building') {
    height = 16;
    width = 11;
    depth = 11;
    primaryMat = 'Cobblestone';
    secondaryMat = 'Brick';
    accentMat = 'Slate';
    primaryHex = '#64748b';
    secondaryHex = '#94a3b8';
    accentHex = '#b45309';
    silhouette = 'modular_tower_facade';
    hierarchyPlan = [
      'Root',
      'Root/Foundation',
      'Root/Facades',
      'Root/Openings',
      'Root/Columns',
      'Root/RoofAssembly',
    ];
    components.push(
      {
        id: 'comp_bldg_foundation',
        name: 'SteppedStonePlinth',
        role: 'foundation',
        parent_path: 'Root/Foundation',
        relative_height_range: [0, 0.12],
        width_ratio: 1.0,
        material: primaryMat,
        color_hex: primaryHex,
        lod_priority: 'critical_silhouette',
      },
      {
        id: 'comp_bldg_walls',
        name: 'ModularFacadeWalls',
        role: 'trunk_or_core',
        parent_path: 'Root/Facades',
        relative_height_range: [0.12, 0.74],
        width_ratio: 0.88,
        material: secondaryMat,
        color_hex: secondaryHex,
        lod_priority: 'critical_silhouette',
      },
      {
        id: 'comp_bldg_openings',
        name: 'DoorwayAndFramedWindows',
        role: 'detail_or_accent',
        parent_path: 'Root/Openings',
        relative_height_range: [0.12, 0.68],
        width_ratio: 0.9,
        material: 'Wood',
        color_hex: accentHex,
        lod_priority: 'secondary_structure',
      },
      {
        id: 'comp_bldg_roof',
        name: 'PitchedGableRoofWithCornice',
        role: 'crown_or_roof',
        parent_path: 'Root/RoofAssembly',
        relative_height_range: [0.72, 1.0],
        width_ratio: 1.02,
        material: accentMat,
        color_hex: '#334155',
        lod_priority: 'critical_silhouette',
      }
    );
  } else if (family === 'chair') {
    height = 5.4;
    width = 3.2;
    depth = 3.2;
    primaryMat = 'Wood';
    secondaryMat = 'Fabric';
    accentMat = 'Metal';
    primaryHex = '#6e472b';
    secondaryHex = '#991b1b';
    accentHex = '#d97706';
    silhouette = 'ergonomic_seating';
    hierarchyPlan = ['Root', 'Root/LegsAndStretchers', 'Root/SeatAssembly', 'Root/Backrest', 'Root/Armrests'];
    components.push(
      {
        id: 'comp_chair_legs',
        name: 'FourTaperedLegsAndStretchers',
        role: 'foundation',
        parent_path: 'Root/LegsAndStretchers',
        relative_height_range: [0, 0.44],
        width_ratio: 0.92,
        material: primaryMat,
        color_hex: primaryHex,
        lod_priority: 'critical_silhouette',
      },
      {
        id: 'comp_chair_seat',
        name: 'ContouredSeatAndCushion',
        role: 'trunk_or_core',
        parent_path: 'Root/SeatAssembly',
        relative_height_range: [0.42, 0.52],
        width_ratio: 1.0,
        material: secondaryMat,
        color_hex: secondaryHex,
        lod_priority: 'critical_silhouette',
      },
      {
        id: 'comp_chair_backrest',
        name: 'AngledBackrestAndCrest',
        role: 'crown_or_roof',
        parent_path: 'Root/Backrest',
        relative_height_range: [0.5, 1.0],
        width_ratio: 0.94,
        material: primaryMat,
        color_hex: primaryHex,
        lod_priority: 'critical_silhouette',
      },
      {
        id: 'comp_chair_armrests',
        name: 'CurvedLateralArmrests',
        role: 'branch_or_frame',
        parent_path: 'Root/Armrests',
        relative_height_range: [0.52, 0.72],
        width_ratio: 1.0,
        material: primaryMat,
        color_hex: primaryHex,
        lod_priority: 'secondary_structure',
      }
    );
  } else if (family === 'lamp') {
    height = 8.5;
    width = 3.2;
    depth = 3.2;
    primaryMat = 'Metal';
    secondaryMat = 'Glass';
    accentMat = 'Neon';
    primaryHex = '#1e293b';
    secondaryHex = '#fef08a';
    accentHex = '#f59e0b';
    silhouette = 'pedestal_luminaire';
    hierarchyPlan = ['Root', 'Root/PedestalBase', 'Root/FlutedPost', 'Root/LanternCage', 'Root/LuminaireCore'];
    components.push(
      {
        id: 'comp_lamp_base',
        name: 'SteppedLatheBase',
        role: 'foundation',
        parent_path: 'Root/PedestalBase',
        relative_height_range: [0, 0.18],
        width_ratio: 0.85,
        material: primaryMat,
        color_hex: primaryHex,
        lod_priority: 'critical_silhouette',
      },
      {
        id: 'comp_lamp_stem',
        name: 'FlutedColumnPost',
        role: 'trunk_or_core',
        parent_path: 'Root/FlutedPost',
        relative_height_range: [0.16, 0.72],
        width_ratio: 0.25,
        material: primaryMat,
        color_hex: primaryHex,
        lod_priority: 'critical_silhouette',
      },
      {
        id: 'comp_lamp_cage',
        name: 'TranslucentGlassLanternCage',
        role: 'branch_or_frame',
        parent_path: 'Root/LanternCage',
        relative_height_range: [0.68, 0.92],
        width_ratio: 0.82,
        material: secondaryMat,
        color_hex: secondaryHex,
        lod_priority: 'secondary_structure',
      },
      {
        id: 'comp_lamp_shade',
        name: 'LanternShadeAndBulb',
        role: 'lighting',
        parent_path: 'Root/LuminaireCore',
        relative_height_range: [0.7, 1.0],
        width_ratio: 1.0,
        material: accentMat,
        color_hex: accentHex,
        lod_priority: 'critical_silhouette',
      }
    );
  } else if (family === 'mechanical') {
    height = 6.8;
    width = 7.4;
    depth = 5.6;
    primaryMat = 'Metal';
    secondaryMat = 'DiamondPlate';
    accentMat = 'Neon';
    primaryHex = '#334155';
    secondaryHex = '#d97706';
    accentHex = '#06b6d4';
    silhouette = 'rotary_gearbox';
    hierarchyPlan = ['Root', 'Root/Chassis', 'Root/GearTrain', 'Root/Hydraulics', 'Root/EnergyCore'];
    components.push(
      {
        id: 'comp_mech_chassis',
        name: 'HeavyBoltedChassis',
        role: 'foundation',
        parent_path: 'Root/Chassis',
        relative_height_range: [0, 0.35],
        width_ratio: 1.0,
        material: secondaryMat,
        color_hex: primaryHex,
        lod_priority: 'critical_silhouette',
      },
      {
        id: 'comp_mech_gears',
        name: 'MeshedInvoluteGearTrain',
        role: 'trunk_or_core',
        parent_path: 'Root/GearTrain',
        relative_height_range: [0.28, 0.88],
        width_ratio: 0.88,
        material: primaryMat,
        color_hex: secondaryHex,
        lod_priority: 'critical_silhouette',
      },
      {
        id: 'comp_mech_pistons',
        name: 'DualHydraulicPistons',
        role: 'branch_or_frame',
        parent_path: 'Root/Hydraulics',
        relative_height_range: [0.22, 0.92],
        width_ratio: 0.95,
        material: primaryMat,
        color_hex: '#94a3b8',
        lod_priority: 'secondary_structure',
      },
      {
        id: 'comp_mech_core',
        name: 'ReactorEnergyCore',
        role: 'lighting',
        parent_path: 'Root/EnergyCore',
        relative_height_range: [0.7, 1.0],
        width_ratio: 0.45,
        material: accentMat,
        color_hex: accentHex,
        lod_priority: 'critical_silhouette',
      }
    );
  } else if (family === 'scene') {
    height = 16;
    width = 24;
    depth = 24;
    primaryMat = 'Cobblestone';
    secondaryMat = 'Wood';
    accentMat = 'Neon';
    primaryHex = '#475569';
    secondaryHex = '#2d6a4f';
    accentHex = '#f59e0b';
    silhouette = 'multi_asset_scene';
    hierarchyPlan = [
      'Root',
      'Root/Zone_Terrain',
      'Root/Zone_FocalStructure',
      'Root/Zone_Vegetation',
      'Root/Zone_Rocks',
      'Root/Zone_Lighting',
    ];
    components.push(
      {
        id: 'comp_scene_terrain',
        name: 'GroundedPlazaTerrain',
        role: 'foundation',
        parent_path: 'Root/Zone_Terrain',
        relative_height_range: [0, 0.08],
        width_ratio: 1.0,
        material: 'Slate',
        color_hex: '#334155',
        lod_priority: 'critical_silhouette',
      },
      {
        id: 'comp_scene_focal',
        name: 'CentralSanctuaryArch',
        role: 'trunk_or_core',
        parent_path: 'Root/Zone_FocalStructure',
        relative_height_range: [0.08, 0.82],
        width_ratio: 0.42,
        material: 'Cobblestone',
        color_hex: '#64748b',
        lod_priority: 'critical_silhouette',
      },
      {
        id: 'comp_scene_veg',
        name: 'GuardianTreeAsset',
        role: 'crown_or_roof',
        parent_path: 'Root/Zone_Vegetation',
        relative_height_range: [0.08, 1.0],
        width_ratio: 0.45,
        material: 'Grass',
        color_hex: '#2d6a4f',
        lod_priority: 'critical_silhouette',
      },
      {
        id: 'comp_scene_lights',
        name: 'PerimeterLanternBeacons',
        role: 'lighting',
        parent_path: 'Root/Zone_Lighting',
        relative_height_range: [0.08, 0.45],
        width_ratio: 0.85,
        material: 'Neon',
        color_hex: '#f59e0b',
        lod_priority: 'secondary_structure',
      }
    );
  } else if (
    family === 'quadruped_animal' ||
    family === 'winged_creature' ||
    family === 'wheeled_vehicle' ||
    family === 'biped_humanoid_or_statue' ||
    family === 'freeform_composite'
  ) {
    const sem = interpretPromptSemantics({
      prompt: rawPrompt,
      category: params.category,
      name: params.name,
    });
    const freeformPlan = planGeometryAndComponents(sem, cleanName);
    width = sem.proportionsStuds.widthX;
    height = sem.proportionsStuds.heightY;
    depth = sem.proportionsStuds.lengthZ;
    primaryHex = sem.palette.primaryHex;
    secondaryHex = sem.palette.secondaryHex;
    accentHex = sem.palette.accentHex;
    primaryMat =
      family === 'wheeled_vehicle'
        ? 'Metal'
        : family === 'biped_humanoid_or_statue' && sem.archetype === 'human_statue'
          ? 'Marble'
          : family === 'winged_creature'
            ? 'Slate'
            : 'SmoothPlastic';
    secondaryMat =
      family === 'wheeled_vehicle'
        ? 'Slate'
        : family === 'biped_humanoid_or_statue'
          ? 'Cobblestone'
          : 'SmoothPlastic';
    accentMat = family === 'wheeled_vehicle' || family === 'winged_creature' ? 'Neon' : 'SmoothPlastic';
    silhouette =
      family === 'quadruped_animal'
        ? 'quadruped_articulated_anatomy'
        : family === 'winged_creature'
          ? 'winged_reptilian_anatomy'
          : family === 'biped_humanoid_or_statue'
            ? 'biped_sculpted_anatomy'
            : family === 'wheeled_vehicle'
              ? 'tandem_wheeled_chassis'
              : 'freeform_synthesized_graph';
    hierarchyPlan = freeformPlan.skeletonHierarchy;
    for (const c of freeformPlan.components) {
      components.push({
        id: c.id,
        name: c.name,
        role:
          c.semanticRole === 'torso' || c.semanticRole === 'fuel_tank_or_body'
            ? 'trunk_or_core'
            : c.semanticRole === 'hoof_or_paw' || c.semanticRole === 'wheel_tire' || c.semanticRole === 'pedestal_plinth'
              ? 'foundation'
              : c.semanticRole === 'head_cranium' || c.semanticRole === 'wing_membrane'
                ? 'crown_or_roof'
                : c.semanticRole === 'headlight_or_lamp' || c.semanticRole === 'eye'
                  ? 'lighting'
                  : 'branch_or_frame',
        parent_path: c.hierarchyPath,
        relative_height_range: [0, 1],
        width_ratio: Number((c.size[0] / Math.max(1, width)).toFixed(2)),
        material: c.material,
        color_hex: c.colorHex,
        lod_priority:
          c.semanticRole === 'coat_spot_patch' || c.semanticRole === 'eye'
            ? 'fine_detail'
            : 'critical_silhouette',
      });
    }
  } else {
    height = 4.8;
    width = 6.2;
    depth = 4.4;
    primaryMat = 'Wood';
    secondaryMat = 'Metal';
    accentMat = 'Neon';
    primaryHex = '#6e472b';
    secondaryHex = '#475569';
    accentHex = '#f59e0b';
    silhouette = 'faceted_outcrop';
    hierarchyPlan = ['Root', 'Root/BaseChest', 'Root/ArchedLid', 'Root/IronBands', 'Root/LockCore'];
  }

  // Override proportions and colors if a real 2D reference image analysis is present
  if (ref) {
    height = clamp(height, 6, 24);
    width = clamp(Number((height * ref.aspectRatioWidthToHeight).toFixed(2)), 2.5, 28);
    depth = width;
    primaryHex = ref.dominantPaletteHex.bottomHex;
    secondaryHex = ref.dominantPaletteHex.midHex;
    accentHex = ref.dominantPaletteHex.topHex;
    if (family === 'image_lathe') {
      silhouette = 'lathe_revolved_profile';
      hierarchyPlan = ['Root', 'Root/LatheBase', 'Root/LatheBody', 'Root/LatheCrown', 'Root/LatheAccents'];
    }
  }

  const finalW = Number(width.toFixed(2));
  const finalH = Number(height.toFixed(2));
  const finalD = Number(depth.toFixed(2));
  const inferredSubtype =
    family === 'tree'
      ? treeSpecies
      : family === 'quadruped_animal' ||
          family === 'winged_creature' ||
          family === 'wheeled_vehicle' ||
          family === 'biped_humanoid_or_statue' ||
          family === 'freeform_composite'
        ? interpretPromptSemantics({ prompt: rawPrompt, category: params.category, name: params.name }).archetype
        : family;

  return {
    schema_version: 'forge-director-v3',
    blueprintVersion: 'forge-director-v3',
    objectFamily: family,
    targetPolyBudget,
    proportions: {
      widthStuds: finalW,
      heightStuds: finalH,
      depthStuds: finalD,
      symmetry: family === 'lamp' || family === 'tree' ? 'radial' : 'bilateral',
    },
    materialPalette: {
      primaryHex,
      secondaryHex,
      accentHex,
    },
    subPartsPlan: components,
    identity: {
      name: cleanName,
      object_family: family,
      category: params.category || 'Props',
      asset_type: family === 'scene' ? 'Scene3D' : params.asset_type || 'Model3D',
      species_or_subtype: inferredSubtype,
    },
    visual_style: treeSpecies === 'fantasy' ? 'fantasy' : detailLevel === 'low' ? 'low_poly' : 'stylized_realism',
    primary_silhouette: silhouette,
    proportions_studs: {
      width: finalW,
      height: finalH,
      depth: finalD,
    },
    components,
    hierarchy_plan: hierarchyPlan,
    materials_and_textures: {
      primary_material: primaryMat,
      secondary_material: secondaryMat,
      accent_material: accentMat,
      primary_hex: primaryHex,
      secondary_hex: secondaryHex,
      accent_hex: accentHex,
      roughness: family === 'mechanical' || family === 'lamp' || family === 'wheeled_vehicle' ? 0.35 : 0.78,
      metalness: family === 'mechanical' || family === 'lamp' || family === 'wheeled_vehicle' ? 0.72 : 0.08,
      pbr_pattern:
        family === 'mechanical' || family === 'wheeled_vehicle'
          ? 'BrushedTitanium'
          : family === 'quadruped_animal' && inferredSubtype === 'bovine_cow'
            ? 'PiebaldBovineCoat'
            : 'OrganicGrain',
    },
    detail_level: detailLevel,
    target_poly_budget: targetPolyBudget,
    export_requirements: {
      formats: ['rbxmx', 'luau', 'gltf', 'glb', 'obj'],
      include_lods: true,
      include_pbr_surface_appearance: true,
    },
    roblox_constraints: {
      grounded_at_y0: true,
      max_vertices_per_part: 9000,
      max_triangles_per_part: 9500,
      collision_fidelity: params.collision_fidelity || 'Hull',
    },
  };
}

/**
 * Validates and sanitizes an AI Director Blueprint before geometry construction (FASE 4).
 */
export function validateAndSanitizeDirectorBlueprint(
  candidate: Partial<AiDirectorBlueprint> | Record<string, any> | null | undefined,
  fallbackOrParams: Parameters<typeof buildBaselineDirectorBlueprint>[0] | AiDirectorBlueprint
): BlueprintValidationResult {
  const base: AiDirectorBlueprint =
    fallbackOrParams && (fallbackOrParams as AiDirectorBlueprint).schema_version === 'forge-director-v3'
      ? (fallbackOrParams as AiDirectorBlueprint)
      : buildBaselineDirectorBlueprint(fallbackOrParams as Parameters<typeof buildBaselineDirectorBlueprint>[0]);
  const warnings: string[] = [];

  if (!candidate || typeof candidate !== 'object') {
    warnings.push('No se recibió plan externo; utilizando blueprint determinista validado.');
    return {
      valid: true,
      warnings,
      blueprint: base,
      blueprintVersion: 'forge-director-v3',
      objectFamily: base.objectFamily,
      targetPolyBudget: base.targetPolyBudget,
      proportions: base.proportions,
      materialPalette: base.materialPalette,
      subPartsPlan: base.subPartsPlan,
    };
  }

  const candAny = candidate as Record<string, any>;
  const rawProps = candAny.proportions_studs || candAny.proportions || {};
  let width = Number(rawProps.width ?? rawProps.widthStuds ?? base.proportions_studs.width);
  let height = Number(rawProps.height ?? rawProps.heightStuds ?? base.proportions_studs.height);
  let depth = Number(rawProps.depth ?? rawProps.depthStuds ?? base.proportions_studs.depth);

  if (!Number.isFinite(width) || width < 0.8 || width > 120) {
    warnings.push(`Proporción width (${width}) fuera de rango; ajustada.`);
    width = clamp(Number.isFinite(width) ? width : base.proportions_studs.width, 0.8, 120);
  }
  if (!Number.isFinite(height) || height < 0.8 || height > 120) {
    warnings.push(`Proporción height (${height}) fuera de rango; ajustada.`);
    height = clamp(Number.isFinite(height) ? height : base.proportions_studs.height, 0.8, 120);
  }
  if (!Number.isFinite(depth) || depth < 0.8 || depth > 120) {
    warnings.push(`Proporción depth (${depth}) fuera de rango; ajustada.`);
    depth = clamp(Number.isFinite(depth) ? depth : base.proportions_studs.depth, 0.8, 120);
  }

  const rawMats = candAny.materials_and_textures || candAny.materialPalette || {};
  const resolvedFamily: SpecializedObjectFamily =
    (candAny.objectFamily as SpecializedObjectFamily) ||
    (candAny.identity?.object_family as SpecializedObjectFamily) ||
    base.identity.object_family;

  const resolvedBudget = clamp(
    Number(candAny.target_poly_budget ?? candAny.targetPolyBudget ?? base.target_poly_budget),
    240,
    9000
  );

  const primaryHex = sanitizeHex(
    rawMats.primary_hex ?? rawMats.primaryHex,
    base.materials_and_textures.primary_hex
  );
  const secondaryHex = sanitizeHex(
    rawMats.secondary_hex ?? rawMats.secondaryHex,
    base.materials_and_textures.secondary_hex
  );
  const accentHex = sanitizeHex(
    rawMats.accent_hex ?? rawMats.accentHex,
    base.materials_and_textures.accent_hex
  );

  const candidateComponents = Array.isArray(candAny.components)
    ? candAny.components
    : Array.isArray(candAny.subPartsPlan)
    ? candAny.subPartsPlan
    : [];
  const finalComponents = candidateComponents.length >= 2 ? candidateComponents : base.components;

  const finalW = Number(width.toFixed(2));
  const finalH = Number(height.toFixed(2));
  const finalD = Number(depth.toFixed(2));
  const symmetry = String(rawProps.symmetry || base.proportions.symmetry || 'bilateral');

  const mergedBlueprint: AiDirectorBlueprint = {
    ...base,
    schema_version: 'forge-director-v3',
    blueprintVersion: 'forge-director-v3',
    objectFamily: resolvedFamily,
    targetPolyBudget: resolvedBudget,
    proportions: {
      widthStuds: finalW,
      heightStuds: finalH,
      depthStuds: finalD,
      symmetry,
    },
    materialPalette: {
      primaryHex,
      secondaryHex,
      accentHex,
    },
    subPartsPlan: finalComponents,
    identity: {
      ...base.identity,
      ...(candAny.identity || {}),
      object_family: resolvedFamily,
      name:
        String(candAny.identity?.name || base.identity.name)
          .replace(/[^a-zA-Z0-9_]/g, '')
          .slice(0, 30) || base.identity.name,
    },
    proportions_studs: {
      width: finalW,
      height: finalH,
      depth: finalD,
    },
    materials_and_textures: {
      primary_material: sanitizeRobloxMaterial(
        rawMats.primary_material,
        base.materials_and_textures.primary_material
      ),
      secondary_material: sanitizeRobloxMaterial(
        rawMats.secondary_material,
        base.materials_and_textures.secondary_material
      ),
      accent_material: sanitizeRobloxMaterial(
        rawMats.accent_material,
        base.materials_and_textures.accent_material
      ),
      primary_hex: primaryHex,
      secondary_hex: secondaryHex,
      accent_hex: accentHex,
      roughness: clamp(Number(rawMats.roughness ?? base.materials_and_textures.roughness), 0.04, 1),
      metalness: clamp(Number(rawMats.metalness ?? base.materials_and_textures.metalness), 0, 1),
      pbr_pattern: String(rawMats.pbr_pattern || base.materials_and_textures.pbr_pattern),
    },
    target_poly_budget: resolvedBudget,
    components: finalComponents,
    hierarchy_plan:
      Array.isArray(candAny.hierarchy_plan) && candAny.hierarchy_plan.length >= 2
        ? candAny.hierarchy_plan
        : base.hierarchy_plan,
  };

  return {
    valid: true,
    warnings,
    blueprint: mergedBlueprint,
    blueprintVersion: 'forge-director-v3',
    objectFamily: mergedBlueprint.objectFamily,
    targetPolyBudget: mergedBlueprint.targetPolyBudget,
    proportions: mergedBlueprint.proportions,
    materialPalette: mergedBlueprint.materialPalette,
    subPartsPlan: mergedBlueprint.subPartsPlan,
  };
}

/**
 * Calls the configured Gemini provider (`@google/genai`) to generate a structured
 * `AiDirectorBlueprint` from the user prompt and optional 2D reference image.
 */
export async function requestGeminiDirectorBlueprint(params: {
  ai?: GoogleGenAI | null;
  aiClient?: GoogleGenAI | null;
  modelName?: string;
  prompt: string;
  category?: string;
  subCategory?: string;
  style?: string;
  seed?: string | number;
  asset_type?: 'Model3D' | 'Scene3D';
  detail_level?: 'low' | 'medium' | 'high' | 'ultra';
  target_poly_budget?: number;
  targetPolyBudget?: number;
  collision_fidelity?: 'Hull' | 'Box' | 'PreciseConvexDecomposition';
  reference_image_base64?: string;
  referenceImageBase64?: string;
  reference_image_mime_type?: string;
  referenceImageMimeType?: string;
  referenceAnalysis?: ReferenceImageAnalysis | null;
}): Promise<{
  blueprint: AiDirectorBlueprint;
  warnings: string[];
  modelUsed: string;
  usedAiProvider: boolean;
  fallbackReason: string | null;
}> {
  const client = params.aiClient ?? params.ai ?? null;
  const effectiveBudget = params.targetPolyBudget ?? params.target_poly_budget ?? 2500;
  const effectiveRefB64 = params.referenceImageBase64 ?? params.reference_image_base64;
  const effectiveRefMime = params.referenceImageMimeType ?? params.reference_image_mime_type ?? 'image/png';

  const baseline = buildBaselineDirectorBlueprint({
    prompt: `${params.prompt || ''} ${params.subCategory || ''} ${params.style || ''}`.trim(),
    category: params.category,
    asset_type: params.asset_type,
    detail_level: params.detail_level,
    target_poly_budget: effectiveBudget,
    collision_fidelity: params.collision_fidelity,
    referenceAnalysis: params.referenceAnalysis,
  });

  if (!client) {
    return {
      blueprint: baseline,
      warnings: ['GEMINI_API_KEY no configurada en el servidor; utilizando blueprint geométrico especializado.'],
      modelUsed: 'local_deterministic_director',
      usedAiProvider: false,
      fallbackReason: 'GEMINI_API_KEY no configurada en el servidor',
    };
  }

  const modelToUse = params.modelName || 'gemini-4-hydrogen';

  const schema = {
    type: SchemaType.OBJECT,
    properties: {
      name: { type: SchemaType.STRING },
      object_family: {
        type: SchemaType.STRING,
        description:
          'quadruped_animal | winged_creature | biped_humanoid_or_statue | wheeled_vehicle | tree | rock | building | chair | table | lamp | mechanical | chest_or_prop | scene | image_lathe | freeform_composite',
      },
      species_or_subtype: {
        type: SchemaType.STRING,
        description:
          'bovine_cow | equine_horse | canine_dog | winged_dragon | motorcycle | human_statue | oak | pine | willow | dead | fantasy | bonsai | tower | lantern | gearbox | throne',
      },
      width_studs: { type: SchemaType.NUMBER },
      height_studs: { type: SchemaType.NUMBER },
      depth_studs: { type: SchemaType.NUMBER },
      primary_material: { type: SchemaType.STRING },
      secondary_material: { type: SchemaType.STRING },
      accent_material: { type: SchemaType.STRING },
      primary_hex: { type: SchemaType.STRING },
      secondary_hex: { type: SchemaType.STRING },
      accent_hex: { type: SchemaType.STRING },
      roughness: { type: SchemaType.NUMBER },
      metalness: { type: SchemaType.NUMBER },
    },
    required: [
      'name',
      'object_family',
      'width_studs',
      'height_studs',
      'depth_studs',
      'primary_material',
      'secondary_material',
      'primary_hex',
      'secondary_hex',
    ],
  };

  try {
    const contents: any[] = [];
    if (effectiveRefB64) {
      let rawB64 = effectiveRefB64.trim();
      let mimeType = effectiveRefMime;
      if (rawB64.includes(',')) {
        const [hdr, data] = rawB64.split(',', 2);
        rawB64 = data;
        if (hdr.includes('jpeg') || hdr.includes('jpg')) mimeType = 'image/jpeg';
        else if (hdr.includes('webp')) mimeType = 'image/webp';
      }
      contents.push({ inlineData: { mimeType, data: rawB64 } });
    }
    contents.push({
      text: `Actúa como el Director de Generación 3D de Nightmare Forge para Roblox Studio.
Analiza la solicitud y devuelve el plan estructurado JSON (proporciones en Studs, familia geométrica, subtipo anatómico/estructural, materiales Roblox y paleta hexadecimal #RRGGBB):
Prompt: ${params.prompt}
Categoría: ${params.category || 'Props'}
Tipo: ${params.asset_type || 'Model3D'}
Presupuesto poligonal objetivo: ${baseline.target_poly_budget} triángulos.`,
    });

    const resp = await client.models.generateContent({
      model: modelToUse,
      contents: contents.length === 1 ? contents[0].text : { parts: contents },
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema as any,
      },
    });

    const rawJson = JSON.parse(resp.text || '{}');
    const validated = validateAndSanitizeDirectorBlueprint(
      {
        identity: {
          ...baseline.identity,
          name: rawJson.name || baseline.identity.name,
          object_family: (rawJson.object_family as SpecializedObjectFamily) || baseline.identity.object_family,
          species_or_subtype: rawJson.species_or_subtype || baseline.identity.species_or_subtype,
        },
        proportions_studs: {
          width: Number(rawJson.width_studs ?? baseline.proportions_studs.width),
          height: Number(rawJson.height_studs ?? baseline.proportions_studs.height),
          depth: Number(rawJson.depth_studs ?? baseline.proportions_studs.depth),
        },
        materials_and_textures: {
          ...baseline.materials_and_textures,
          primary_material: rawJson.primary_material || baseline.materials_and_textures.primary_material,
          secondary_material: rawJson.secondary_material || baseline.materials_and_textures.secondary_material,
          accent_material: rawJson.accent_material || baseline.materials_and_textures.accent_material,
          primary_hex: rawJson.primary_hex || baseline.materials_and_textures.primary_hex,
          secondary_hex: rawJson.secondary_hex || baseline.materials_and_textures.secondary_hex,
          accent_hex: rawJson.accent_hex || baseline.materials_and_textures.accent_hex,
          roughness: Number(rawJson.roughness ?? baseline.materials_and_textures.roughness),
          metalness: Number(rawJson.metalness ?? baseline.materials_and_textures.metalness),
        },
      },
      baseline
    );

    return {
      blueprint: validated.blueprint,
      warnings: validated.warnings,
      modelUsed: modelToUse,
      usedAiProvider: true,
      fallbackReason: null,
    };
  } catch (err: any) {
    const errMsg = err?.message || 'Error en llamada al proveedor IA';
    return {
      blueprint: baseline,
      warnings: [`Fallo en proveedor IA (${errMsg}); usando blueprint determinista validado.`],
      modelUsed: 'local_deterministic_director',
      usedAiProvider: false,
      fallbackReason: errMsg,
    };
  }
}
