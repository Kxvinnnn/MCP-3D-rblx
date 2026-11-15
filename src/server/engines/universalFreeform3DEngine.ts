/**
 * @module universalFreeform3DEngine
 * @description
 * MISIÓN CRÍTICA — Arquitectura de Generación 3D Libre y Universal para NIGHTMARE FORGE.
 *
 * Permite generar objetos 3D arbitrarios a partir de instrucciones en lenguaje natural
 * sin depender de plantillas rígidas ni caer por defecto en `chest_or_prop`.
 *
 * Separa explícitamente las 5 etapas obligatorias de la arquitectura (Sección 4):
 * - Etapa A (`interpretPromptSemantics`): Interpretación semántica de la petición (taxonomía,
 *   anatomía/estructura, locomoción, simetría, proporciones, paleta y rasgos obligatorios).
 * - Etapa B (`planGeometryAndComponents`): Planificación de esqueleto/jerarquía 3D y grafo
 *   de órganos/componentes articulados.
 * - Etapa C (`generateReal3DMeshesFromPlan`): Síntesis de mallas 3D reales mediante kernels
 *   geométricos avanzados (Spline-Lofting anatómico 3D, Parches Conformales sobre superficie
 *   para manchas de pelaje, Ruedas Toroidales con radios, Membranas Alares curvadas, etc.).
 * - Etapa D (`applyMaterialsAndProceduralTextures`): Generación de materiales, patrón de pelaje/superficie
 *   y atributos PBR compatibles con Roblox Studio.
 * - Etapa E (`optimizeAndAdaptForRoblox`): Optimización poligonal, niveles LOD0/LOD1/LOD2,
 *   asentamiento exacto en `Y = 0` y cumplimiento de límites de `Roblox EditableMesh`.
 *
 * Incluye además (Sección 7):
 * - `evaluateSemanticVisualIdentity`: Benchmark de fidelidad semántica y espacial 3D que verifica
 *   la distribución real de vértices en 3D (apoyo en 4 cuadrantes para cuadrúpedos, perfil longitudinal
 *   cráneo-caudal, simetría bilateral, complejidad orgánica no primitiva y cobertura de rasgos).
 * - `renderMultiAngleSvgSnapshots`: Renderizador determinista de capturas 2D multi-ángulo
 *   (`front`, `side`, `isometric`, `top`) proyectando y sombreando directamente los triángulos 3D.
 */

import type { AiDirectorBlueprint } from './aiGenerationDirector.ts';
import {
  type BudgetAllocationProfile,
  type LodLevelDescriptor,
  type LodMeshBuffer,
  type SpecializedMeshData,
  type SpecializedPartSpec,
  createDeterministicRng,
  hexToRgb255Tuple,
  jitterHexColor,
} from './specializedGeometryGenerators.ts';

export type UniversalTaxonomyClass =
  | 'quadruped_animal'
  | 'winged_creature'
  | 'biped_humanoid_or_statue'
  | 'wheeled_vehicle'
  | 'vegetation_or_tree'
  | 'architecture_or_building'
  | 'furniture_or_prop'
  | 'mechanical_assembly'
  | 'freeform_composite';

export type UniversalArchetypeId =
  | 'bovine_cow'
  | 'equine_horse'
  | 'canine_dog'
  | 'feline_creature'
  | 'cervine_stag'
  | 'winged_dragon'
  | 'human_statue'
  | 'stylized_humanoid'
  | 'motorcycle'
  | 'wheeled_car_or_truck'
  | 'fantasy_tree'
  | 'medieval_house'
  | 'freeform_synthesized_object';

export interface SemanticObjectInterpretation {
  rawPrompt: string;
  taxonomy: UniversalTaxonomyClass;
  archetype: UniversalArchetypeId;
  subjectLabel: string;
  isOrganicCreature: boolean;
  locomotionMode:
    | 'quadruped_4_limbs'
    | 'winged_quadruped'
    | 'biped_2_legs'
    | 'two_wheels_tandem'
    | 'four_wheels'
    | 'grounded_static';
  symmetry: 'bilateral' | 'radial' | 'asymmetric';
  coatOrSurfacePattern:
    | 'piebald_black_white_spots'
    | 'equine_coat_and_mane'
    | 'canine_fur_coat'
    | 'reptilian_scales_and_ridges'
    | 'metallic_chassis_and_tires'
    | 'sculpted_stone_statue'
    | 'organic_bark_and_foliage'
    | 'architectural_masonry_timber'
    | 'stylized_composite_surface';
  proportionsStuds: {
    widthX: number;
    heightY: number;
    lengthZ: number;
  };
  palette: {
    primaryHex: string;
    secondaryHex: string;
    accentHex: string;
    detailHex: string;
    eyeHex: string;
    hoofOrTireHex: string;
    muzzleOrTrimHex: string;
  };
  requiredSemanticFeatures: string[];
}

export type OrganKernelType =
  | 'spline_lofted_organ'
  | 'conformal_spot_patch'
  | 'toroidal_wheel'
  | 'cambered_wing_membrane'
  | 'sculpted_icosphere_organ'
  | 'beveled_structural_frame';

export interface SpineControlPoint {
  /** Posición relativa o absoluta [x, y, z] a lo largo de la espina del órgano */
  point: [number, number, number];
  /** Radio horizontal X en ese corte */
  radiusX: number;
  /** Radio vertical Y (o espesor) en ese corte */
  radiusY: number;
  /** Factor de abombamiento dorsal (>1 ensancha arriba, <1 ensancha abajo como panza) */
  dorsalVentralBias?: number;
}

export interface PlannedOrganComponent {
  id: string;
  name: string;
  semanticRole:
    | 'torso'
    | 'chest_brisket'
    | 'pelvis_rump'
    | 'neck'
    | 'head_cranium'
    | 'snout_muzzle'
    | 'jaw_or_mouth'
    | 'ear'
    | 'horn_or_antler'
    | 'eye'
    | 'udder'
    | 'limb_upper'
    | 'limb_joint'
    | 'limb_lower'
    | 'hoof_or_paw'
    | 'tail'
    | 'tail_tuft'
    | 'coat_spot_patch'
    | 'mane_or_crest'
    | 'wing_membrane'
    | 'dorsal_spine'
    | 'wheel_tire'
    | 'wheel_rim'
    | 'chassis_frame'
    | 'fuel_tank_or_body'
    | 'engine_block'
    | 'exhaust_pipe'
    | 'handlebar_or_fork'
    | 'seat_saddle'
    | 'headlight_or_lamp'
    | 'pedestal_plinth'
    | 'arm_upper'
    | 'arm_forearm'
    | 'hand'
    | 'structural_module';
  hierarchyPath: string;
  kernel: OrganKernelType;
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number, number];
  material: string;
  colorHex: string;
  roughness: number;
  metalness: number;
  reflectance?: number;
  transparency?: number;
  canCollide: boolean;
  spineControlPoints?: SpineControlPoint[];
  spotPatchParams?: {
    uCenter: number;
    thetaCenter: number;
    uSpan: number;
    thetaSpan: number;
    normalOffset: number;
  };
  wheelParams?: {
    tubeRadiusRatio: number;
    spokeCount: number;
    isRimOnly?: boolean;
  };
  wingParams?: {
    side: -1 | 1;
    camberDepth: number;
    fingerCount: number;
  };
}

export interface FreeformGeometryPlan {
  interpretation: SemanticObjectInterpretation;
  skeletonHierarchy: string[];
  components: PlannedOrganComponent[];
  torsoReferenceSpine?: SpineControlPoint[];
  torsoWorldCenter?: [number, number, number];
}

export interface MultiAngleSnapshots {
  frontSvgDataUri: string;
  sideSvgDataUri: string;
  isometricSvgDataUri: string;
  topSvgDataUri: string;
  frontSvg: string;
  sideSvg: string;
  isometricSvg: string;
  topSvg: string;
}

export interface SemanticVisualIdentityEvaluation {
  passed: boolean;
  overallScore: number;
  taxonomyVerified: UniversalTaxonomyClass;
  archetypeVerified: UniversalArchetypeId;
  totalParts: number;
  totalVertices: number;
  totalTriangles: number;
  avgVerticesPerPart: number;
  groundedAtYZero: boolean;
  minYStuds: number;
  boundingBoxStuds: {
    widthX: number;
    heightY: number;
    lengthZ: number;
  };
  spatialChecks: {
    hasFourQuadrantGroundSupport: boolean;
    hasCranialCaudalProfile: boolean;
    hasBilateralSymmetry: boolean;
    hasNonPrimitiveOrganicComplexity: boolean;
    hasDistinctColorMaterials: boolean;
  };
  featureCoverage: {
    requestedFeatures: string[];
    satisfiedFeatures: string[];
    missingFeatures: string[];
    coverageRatio: number;
  };
  diagnosticSummary: string;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * ============================================================================
 * ETAPA A: INTERPRETACIÓN SEMÁNTICA DE LA PETICIÓN (`interpretPromptSemantics`)
 * ============================================================================
 */
export function interpretPromptSemantics(params: {
  prompt?: string;
  category?: string;
  name?: string;
  blueprint?: Partial<AiDirectorBlueprint>;
}): SemanticObjectInterpretation {
  const rawPrompt = String(params.prompt || params.name || params.category || 'Objeto 3D').trim();
  const text = `${rawPrompt} ${params.category || ''} ${params.name || ''}`.toLowerCase();

  // 1. Detectar Vacas / Bovinos (`bovine_cow`)
  if (/\b(vaca|vacas|cow|cows|bovino|bovina|bovine|toro|bull|becerro|calf|holstein|res)\b/i.test(text)) {
    const hasBlackWhiteSpots =
      /\b(manchas|manchada|spots|spotted|blanca\s+y\s+negra|negras\s+y\s+blancas|holstein|piebald|pinta)\b/i.test(
        text
      ) || !/\b(marron|marrón|brown|parda)\b/i.test(text);

    return {
      rawPrompt,
      taxonomy: 'quadruped_animal',
      archetype: 'bovine_cow',
      subjectLabel: 'Vaca Adulta Anatómica (Bos taurus)',
      isOrganicCreature: true,
      locomotionMode: 'quadruped_4_limbs',
      symmetry: 'bilateral',
      coatOrSurfacePattern: hasBlackWhiteSpots ? 'piebald_black_white_spots' : 'equine_coat_and_mane',
      proportionsStuds: {
        widthX: 4.4,
        heightY: 6.4,
        lengthZ: 10.6,
      },
      palette: {
        primaryHex: hasBlackWhiteSpots ? '#f8fafc' : '#8b5a2b',
        secondaryHex: hasBlackWhiteSpots ? '#18181b' : '#4a2e14',
        accentHex: '#f4afab', // hocico y ubre rosados naturales
        detailHex: '#d6c7b2', // cuernos queratina marfil
        eyeHex: '#111827',
        hoofOrTireHex: '#27272a', // pezuñas hendidas oscuras
        muzzleOrTrimHex: '#f4afab',
      },
      requiredSemanticFeatures: [
        'torso_volumetrico',
        'cuatro_patas_articuladas',
        'cuello_muscular',
        'cabeza_bovina',
        'hocico_diferenciado',
        'dos_orejas_laterales',
        'dos_cuernos_curvos',
        'dos_ojos',
        'pezunas_hendidas',
        'cola_con_borla',
        'ubre_ventral',
        'manchas_negras_y_blancas',
      ],
    };
  }

  // 2. Detectar Caballos / Equinos (`equine_horse`)
  if (/\b(caballo|caballos|horse|stallion|mare|yegua|potro|pony|equino|corcel|unicornio|unicorn)\b/i.test(text)) {
    return {
      rawPrompt,
      taxonomy: 'quadruped_animal',
      archetype: 'equine_horse',
      subjectLabel: 'Caballo Adulto Estilizado (Equus caballus)',
      isOrganicCreature: true,
      locomotionMode: 'quadruped_4_limbs',
      symmetry: 'bilateral',
      coatOrSurfacePattern: 'equine_coat_and_mane',
      proportionsStuds: {
        widthX: 3.6,
        heightY: 7.8,
        lengthZ: 10.8,
      },
      palette: {
        primaryHex: '#7c4728',
        secondaryHex: '#27170e',
        accentHex: '#e2e8f0',
        detailHex: '#3f2718',
        eyeHex: '#111827',
        hoofOrTireHex: '#1c1917',
        muzzleOrTrimHex: '#4b3121',
      },
      requiredSemanticFeatures: [
        'torso_volumetrico',
        'cuatro_patas_articuladas',
        'cuello_arqueado_equino',
        'crin_dorsal',
        'cabeza_alargada',
        'hocico_diferenciado',
        'dos_orejas_erguidas',
        'dos_ojos',
        'cascos_equinos',
        'cola_poblada',
      ],
    };
  }

  // 3. Detectar Perros / Lobos / Cánidos (`canine_dog`)
  if (/\b(perro|perros|dog|hound|lobo|wolf|cachorro|puppy|canino|canine|pastor\s+alem[aá]n|husky|mast[ií]n|zorro|fox)\b/i.test(text)) {
    return {
      rawPrompt,
      taxonomy: 'quadruped_animal',
      archetype: 'canine_dog',
      subjectLabel: 'Cánido / Perro Anatómico (Canis lupus)',
      isOrganicCreature: true,
      locomotionMode: 'quadruped_4_limbs',
      symmetry: 'bilateral',
      coatOrSurfacePattern: 'canine_fur_coat',
      proportionsStuds: {
        widthX: 2.8,
        heightY: 5.0,
        lengthZ: 7.8,
      },
      palette: {
        primaryHex: '#9a6b41',
        secondaryHex: '#2d241e',
        accentHex: '#e5d3b3',
        detailHex: '#1f2937',
        eyeHex: '#1e1b18',
        hoofOrTireHex: '#3b2b20',
        muzzleOrTrimHex: '#18181b',
      },
      requiredSemanticFeatures: [
        'torso_volumetrico',
        'cuatro_patas_articuladas',
        'cuello_canino',
        'cabeza_canina',
        'hocico_alargado_con_trufa',
        'dos_orejas_caninas',
        'dos_ojos',
        'garras_o_patas',
        'cola_elevada',
      ],
    };
  }

  // 4. Detectar Dragones / Criaturas Aladas (`winged_dragon`)
  if (/\b(drag[oó]n|dragon|wyvern|drake|guiverno|criatura\s+alada|winged\s+beast|serpiente\s+alada|griffin|grifo)\b/i.test(text)) {
    return {
      rawPrompt,
      taxonomy: 'winged_creature',
      archetype: 'winged_dragon',
      subjectLabel: 'Dragón Alado Mítico',
      isOrganicCreature: true,
      locomotionMode: 'winged_quadruped',
      symmetry: 'bilateral',
      coatOrSurfacePattern: 'reptilian_scales_and_ridges',
      proportionsStuds: {
        widthX: 16.5, // envergadura alar amplia
        heightY: 9.6,
        lengthZ: 15.2,
      },
      palette: {
        primaryHex: '#7f1d1d',
        secondaryHex: '#b91c1c',
        accentHex: '#f59e0b',
        detailHex: '#fde047',
        eyeHex: '#fef08a',
        hoofOrTireHex: '#1c1917',
        muzzleOrTrimHex: '#450a0a',
      },
      requiredSemanticFeatures: [
        'torso_reptiliano',
        'cuatro_patas_con_garras',
        'cuello_serpentino',
        'cabeza_cornuda',
        'mandibula_fauces',
        'dos_alas_membranosas',
        'crestas_dorsales',
        'cola_larga_con_punta',
        'dos_ojos_emisivos',
      ],
    };
  }

  // 5. DetectarOtros Cuadrúpedos (Gato, León, Tigre, Ciervo, Oso, Elefante, Cerdo, Oveja, Cabra, etc.)
  if (
    /\b(gato|cat|le[oó]n|lion|tigre|tiger|pantera|panther|ciervo|venado|deer|stag|oso|bear|cerdo|pig|oveja|sheep|cabra|goat|animal|cuadr[uú]pedo|quadruped|criatura\s+terrestre)\b/i.test(
      text
    )
  ) {
    const isHorned = /\b(ciervo|venado|deer|stag|cabra|goat|carnero|ram)\b/i.test(text);
    return {
      rawPrompt,
      taxonomy: 'quadruped_animal',
      archetype: isHorned ? 'cervine_stag' : 'feline_creature',
      subjectLabel: isHorned ? 'Cérvido / Mamífero Cornudo' : 'Mamífero Cuadrúpedo Estilizado',
      isOrganicCreature: true,
      locomotionMode: 'quadruped_4_limbs',
      symmetry: 'bilateral',
      coatOrSurfacePattern: 'canine_fur_coat',
      proportionsStuds: {
        widthX: 3.2,
        heightY: 6.2,
        lengthZ: 8.8,
      },
      palette: {
        primaryHex: '#a16207',
        secondaryHex: '#422006',
        accentHex: '#fef3c7',
        detailHex: '#d6d3d1',
        eyeHex: '#111827',
        hoofOrTireHex: '#27272a',
        muzzleOrTrimHex: '#292524',
      },
      requiredSemanticFeatures: [
        'torso_volumetrico',
        'cuatro_patas_articuladas',
        'cuello',
        'cabeza',
        'hocico',
        'dos_orejas',
        'dos_ojos',
        'cola',
      ],
    };
  }

  // 6. Detectar Motocicletas / Vehículos de 2 o 4 Ruedas (`motorcycle` / `wheeled_car_or_truck`)
  if (
    /\b(motocicleta|moto|motorcycle|motorbike|chopper|scooter|bicicleta|bike|coche|auto|car|veh[ií]culo|vehicle|camioneta|truck)\b/i.test(
      text
    )
  ) {
    const isFourWheels = /\b(coche|auto|car|camioneta|truck|4x4|todo\s*terreno)\b/i.test(text) && !/\b(moto|motocicleta|motorcycle|bike)\b/i.test(text);
    return {
      rawPrompt,
      taxonomy: 'wheeled_vehicle',
      archetype: isFourWheels ? 'wheeled_car_or_truck' : 'motorcycle',
      subjectLabel: isFourWheels ? 'Vehículo Motorizado de 4 Ruedas' : 'Motocicleta Deportiva / Custom 3D',
      isOrganicCreature: false,
      locomotionMode: isFourWheels ? 'four_wheels' : 'two_wheels_tandem',
      symmetry: 'bilateral',
      coatOrSurfacePattern: 'metallic_chassis_and_tires',
      proportionsStuds: isFourWheels
        ? { widthX: 6.4, heightY: 4.8, lengthZ: 12.6 }
        : { widthX: 3.2, heightY: 4.8, lengthZ: 9.6 },
      palette: {
        primaryHex: '#dc2626', // carenado / tanque rojo metálico
        secondaryHex: '#18181b', // neumáticos caucho y asiento
        accentHex: '#e2e8f0', // cromo horquilla, llantas y escapes
        detailHex: '#334155', // bloque motor acero
        eyeHex: '#38bdf8', // faro delantero neón
        hoofOrTireHex: '#171717',
        muzzleOrTrimHex: '#f59e0b',
      },
      requiredSemanticFeatures: [
        'ruedas_toroidales_con_llanta',
        'chasis_estructural',
        'horquilla_y_manillar',
        'tanque_combustible_carenado',
        'bloque_motor',
        'tubos_de_escape',
        'asiento_ergonomico',
        'faro_delantero_y_trasero',
      ],
    };
  }

  // 7. Detectar Estatuas Humanas / Personas Estilizadas (`human_statue` / `stylized_humanoid`)
  if (
    /\b(estatua|statue|escultura|sculpture|humano|humana|human|persona|person|guerrero|warrior|caballero|knight|mago|mage|personaje|character|avatar|busto|monumento)\b/i.test(
      text
    )
  ) {
    const isStatue = /\b(estatua|statue|escultura|sculpture|m[aá]rmol|marble|piedra|stone|bronce|bronze|monumento|pedestal)\b/i.test(text);
    return {
      rawPrompt,
      taxonomy: 'biped_humanoid_or_statue',
      archetype: isStatue ? 'human_statue' : 'stylized_humanoid',
      subjectLabel: isStatue ? 'Estatua Humana Esculpida sobre Pedestal' : 'Figura Humana Estilizada Articulada',
      isOrganicCreature: true,
      locomotionMode: 'biped_2_legs',
      symmetry: 'bilateral',
      coatOrSurfacePattern: isStatue ? 'sculpted_stone_statue' : 'stylized_composite_surface',
      proportionsStuds: {
        widthX: 4.4,
        heightY: isStatue ? 11.2 : 8.8,
        lengthZ: 4.0,
      },
      palette: isStatue
        ? {
            primaryHex: '#e2e8f0', // mármol / piedra esculpida
            secondaryHex: '#94a3b8', // plinto / pedestal de piedra
            accentHex: '#cbd5e1',
            detailHex: '#64748b',
            eyeHex: '#f8fafc',
            hoofOrTireHex: '#475569',
            muzzleOrTrimHex: '#cbd5e1',
          }
        : {
            primaryHex: '#3b82f6',
            secondaryHex: '#1e293b',
            accentHex: '#f5cba7',
            detailHex: '#f59e0b',
            eyeHex: '#0f172a',
            hoofOrTireHex: '#334155',
            muzzleOrTrimHex: '#e2e8f0',
          },
      requiredSemanticFeatures: [
        ...(isStatue ? ['pedestal_escalonado'] : []),
        'pelvis_cadera',
        'torso_anatomico_pecho',
        'cuello_y_cabeza_esculpida',
        'dos_brazos_articulados_con_manos',
        'dos_piernas_articuladas_con_pies',
      ],
    };
  }

  // 8. Árboles y Vegetación (`fantasy_tree`)
  if (/\b(tree|[aá]rbol|roble|oak|pino|pine|sauce|willow|bons[aá]i|cerezo|sakura|bosque|vegetaci[oó]n)\b/i.test(text)) {
    return {
      rawPrompt,
      taxonomy: 'vegetation_or_tree',
      archetype: 'fantasy_tree',
      subjectLabel: 'Árbol Orgánico con Raíces y Ramificación Recursiva',
      isOrganicCreature: true,
      locomotionMode: 'grounded_static',
      symmetry: 'radial',
      coatOrSurfacePattern: 'organic_bark_and_foliage',
      proportionsStuds: { widthX: 12, heightY: 16, lengthZ: 12 },
      palette: {
        primaryHex: '#5c3d28',
        secondaryHex: '#2d7a46',
        accentHex: '#38bdf8',
        detailHex: '#4a3222',
        eyeHex: '#22d3ee',
        hoofOrTireHex: '#3b2d4a',
        muzzleOrTrimHex: '#a855f7',
      },
      requiredSemanticFeatures: ['raices_superficiales', 'tronco_organico', 'ramas_jerarquicas', 'copa_follaje'],
    };
  }

  // 9. Edificios / Casas Medievales (`medieval_house`)
  if (/\b(casa|house|edificio|building|torre|tower|castillo|castle|templo|temple|caba[ñn]a|taberna|medieval|fortaleza)\b/i.test(text)) {
    return {
      rawPrompt,
      taxonomy: 'architecture_or_building',
      archetype: 'medieval_house',
      subjectLabel: 'Estructura Arquitectónica / Casa Medieval',
      isOrganicCreature: false,
      locomotionMode: 'grounded_static',
      symmetry: 'bilateral',
      coatOrSurfacePattern: 'architectural_masonry_timber',
      proportionsStuds: { widthX: 11, heightY: 15, lengthZ: 11 },
      palette: {
        primaryHex: '#64748b',
        secondaryHex: '#cbd5e1',
        accentHex: '#78350f',
        detailHex: '#b45309',
        eyeHex: '#fef08a',
        hoofOrTireHex: '#334155',
        muzzleOrTrimHex: '#991b1b',
      },
      requiredSemanticFeatures: ['cimiento_piedra', 'muros_fachada', 'puerta_y_ventanas', 'tejado_inclinado'],
    };
  }

  // 10. Objeto Libre Compuesto Universal (`freeform_composite`)
  return {
    rawPrompt,
    taxonomy: 'freeform_composite',
    archetype: 'freeform_synthesized_object',
    subjectLabel: `Objeto 3D Sintetizado (${rawPrompt.slice(0, 36)})`,
    isOrganicCreature: false,
    locomotionMode: 'grounded_static',
    symmetry: 'bilateral',
    coatOrSurfacePattern: 'stylized_composite_surface',
    proportionsStuds: {
      widthX: Number(params.blueprint?.proportions_studs?.width ?? 6.5),
      heightY: Number(params.blueprint?.proportions_studs?.height ?? 6.8),
      lengthZ: Number(params.blueprint?.proportions_studs?.depth ?? 7.2),
    },
    palette: {
      primaryHex: params.blueprint?.materials_and_textures?.primary_hex || '#475569',
      secondaryHex: params.blueprint?.materials_and_textures?.secondary_hex || '#94a3b8',
      accentHex: params.blueprint?.materials_and_textures?.accent_hex || '#38bdf8',
      detailHex: '#f59e0b',
      eyeHex: '#22d3ee',
      hoofOrTireHex: '#1e293b',
      muzzleOrTrimHex: '#e2e8f0',
    },
    requiredSemanticFeatures: ['base_soporte', 'nucleo_volumetrico', 'apendices_estructurales', 'detalles_superficie'],
  };
}

/**
 * ============================================================================
 * ETAPA B: PLANIFICACIÓN DE GEOMETRÍA Y COMPONENTES (`planGeometryAndComponents`)
 * ============================================================================
 */
export function planGeometryAndComponents(
  interpretation: SemanticObjectInterpretation,
  seed: string = 'forge-freeform-2026'
): FreeformGeometryPlan {
  const rng = createDeterministicRng(`${seed}:${interpretation.archetype}:${interpretation.rawPrompt}`);

  if (interpretation.taxonomy === 'quadruped_animal') {
    return planQuadrupedAnimalAnatomy(interpretation, rng);
  }
  if (interpretation.taxonomy === 'winged_creature') {
    return planWingedDragonAnatomy(interpretation, rng);
  }
  if (interpretation.taxonomy === 'wheeled_vehicle') {
    return planWheeledVehicleStructure(interpretation, rng);
  }
  if (interpretation.taxonomy === 'biped_humanoid_or_statue') {
    return planHumanoidOrStatueAnatomy(interpretation, rng);
  }

  return planFreeformCompositeStructure(interpretation, rng);
}

/**
 * Planificador anatómico especializado para mamíferos cuadrúpedos:
 * - Vaca (`bovine_cow`): torso abombado con pecho/brisket, vientre profundo, grupa cuadrada,
 *   cuello robusto, cabeza bovina con hocico ancho rosado, 2 orejas laterales horizontales,
 *   2 cuernos curvos hacia arriba/adelante, 2 ojos, ubre ventral con 4 cuartos, 4 patas
 *   articuladas (muslo/hombro -> rodilla/corvejón -> caña -> pezuña hendida en Y=0), cola
 *   colgante con borla y parches conformales de manchas negras sobre el pelaje blanco.
 * - Caballo (`equine_horse`): cuello alto arqueado, crin dorsal, pecho profundo, patas largas
 *   esbeltas con cascos, orejas erguidas y cola poblada.
 * - Perro / Lobo (`canine_dog`): tórax profundo y abdomen recogido, cuello en 45°, cabeza con
 *   hocico alargado y trufa negra, orejas erguidas, 4 patas ágiles con garras y cola en sable.
 */
function planQuadrupedAnimalAnatomy(
  interp: SemanticObjectInterpretation,
  rng: () => number
): FreeformGeometryPlan {
  const isCow = interp.archetype === 'bovine_cow';
  const isHorse = interp.archetype === 'equine_horse';
  const isDog = interp.archetype === 'canine_dog';
  const isStag = interp.archetype === 'cervine_stag';

  const pal = interp.palette;
  const components: PlannedOrganComponent[] = [];
  const skeletonHierarchy = [
    'Root',
    'Root/Spine_Torso',
    'Root/Spine_Torso/CoatSpots',
    'Root/Spine_Torso/Ventral',
    'Root/Neck_Head',
    'Root/Neck_Head/Cranium',
    'Root/Limb_FrontLeft',
    'Root/Limb_FrontRight',
    'Root/Limb_RearLeft',
    'Root/Limb_RearRight',
    'Root/Tail',
  ];

  // Dimensiones anatómicas base según especie (en Studs, Z+ = adelante/craneal, Z- = atrás/caudal, Y+ = arriba)
  const shoulderHeightY = isCow ? 3.55 : isHorse ? 4.35 : isDog ? 2.65 : 3.4;
  const torsoCenterY = isCow ? 3.55 : isHorse ? 4.25 : isDog ? 2.6 : 3.35;
  const halfTrackX = isCow ? 1.08 : isHorse ? 0.88 : isDog ? 0.68 : 0.82;
  const frontLegZ = isCow ? 2.45 : isHorse ? 2.55 : isDog ? 1.85 : 2.15;
  const rearLegZ = isCow ? -2.55 : isHorse ? -2.65 : isDog ? -1.95 : -2.25;

  // 1. Espina dorsal y Torso Volumétrico (Catmull-Rom de 7 cortes desde la grupa Z- hasta el pecho Z+)
  const torsoSpine: SpineControlPoint[] = isCow
    ? [
        { point: [0, torsoCenterY + 0.12, -3.45], radiusX: 0.65, radiusY: 0.68, dorsalVentralBias: 1.08 }, // Grupa caudal / isquion
        { point: [0, torsoCenterY + 0.16, -2.55], radiusX: 1.48, radiusY: 1.38, dorsalVentralBias: 1.12 }, // Pelvis / cadera ancha bovina
        { point: [0, torsoCenterY - 0.08, -0.85], radiusX: 1.82, radiusY: 1.68, dorsalVentralBias: 0.84 }, // Barriga / rumen profundo
        { point: [0, torsoCenterY - 0.02, 0.95], radiusX: 1.66, radiusY: 1.58, dorsalVentralBias: 0.92 }, // Caja torácica / costillar
        { point: [0, torsoCenterY + 0.22, 2.35], radiusX: 1.44, radiusY: 1.52, dorsalVentralBias: 1.15 }, // Cruz / hombros (withers)
        { point: [0, torsoCenterY - 0.18, 3.18], radiusX: 1.05, radiusY: 1.12, dorsalVentralBias: 0.85 }, // Pecho / brisket anterior
      ]
    : isHorse
      ? [
          { point: [0, torsoCenterY + 0.18, -3.35], radiusX: 0.62, radiusY: 0.65, dorsalVentralBias: 1.05 },
          { point: [0, torsoCenterY + 0.22, -2.45], radiusX: 1.32, radiusY: 1.28, dorsalVentralBias: 1.1 },
          { point: [0, torsoCenterY + 0.04, -0.55], radiusX: 1.38, radiusY: 1.34, dorsalVentralBias: 0.96 },
          { point: [0, torsoCenterY + 0.1, 1.25], radiusX: 1.42, radiusY: 1.48, dorsalVentralBias: 0.94 },
          { point: [0, torsoCenterY + 0.34, 2.45], radiusX: 1.26, radiusY: 1.42, dorsalVentralBias: 1.16 },
          { point: [0, torsoCenterY + 0.05, 3.15], radiusX: 0.88, radiusY: 0.96, dorsalVentralBias: 0.95 },
        ]
      : [
          { point: [0, torsoCenterY + 0.08, -2.45], radiusX: 0.45, radiusY: 0.48, dorsalVentralBias: 1.05 },
          { point: [0, torsoCenterY + 0.12, -1.75], radiusX: 0.88, radiusY: 0.86, dorsalVentralBias: 1.08 },
          { point: [0, torsoCenterY + 0.16, -0.45], radiusX: 0.78, radiusY: 0.74, dorsalVentralBias: 1.15 }, // Abdomen recogido canino
          { point: [0, torsoCenterY + 0.02, 0.95], radiusX: 1.02, radiusY: 1.12, dorsalVentralBias: 0.88 }, // Tórax profundo
          { point: [0, torsoCenterY + 0.18, 1.85], radiusX: 0.94, radiusY: 1.04, dorsalVentralBias: 1.1 },
          { point: [0, torsoCenterY + 0.04, 2.35], radiusX: 0.65, radiusY: 0.72, dorsalVentralBias: 0.95 },
        ];

  components.push({
    id: 'organ_torso_main',
    name: 'TorsoBody_Main',
    semanticRole: 'torso',
    hierarchyPath: 'Root/Spine_Torso',
    kernel: 'spline_lofted_organ',
    position: [0, torsoCenterY, -0.15],
    rotation: [0, 0, 0],
    size: [isCow ? 3.65 : isHorse ? 2.85 : 2.05, isCow ? 3.35 : isHorse ? 2.95 : 2.25, isCow ? 6.65 : isHorse ? 6.5 : 4.8],
    material: 'SmoothPlastic',
    colorHex: pal.primaryHex,
    roughness: 0.78,
    metalness: 0.03,
    canCollide: true,
    spineControlPoints: torsoSpine,
  });

  // 1B. Manchas conformales de pelaje blanco y negro (`CoatSpotPatch_1..6`) siguiendo la curvatura 3D del torso bovino
  if (isCow && interp.coatOrSurfacePattern === 'piebald_black_white_spots') {
    const spotDefinitions: Array<{
      name: string;
      uCenter: number;
      thetaCenter: number;
      uSpan: number;
      thetaSpan: number;
    }> = [
      { name: 'CoatSpotPatch_SaddleLeft', uCenter: 0.46, thetaCenter: Math.PI * 0.22, uSpan: 0.22, thetaSpan: 0.68 },
      { name: 'CoatSpotPatch_FlankRight', uCenter: 0.52, thetaCenter: -Math.PI * 0.34, uSpan: 0.25, thetaSpan: 0.74 },
      { name: 'CoatSpotPatch_RumpLeft', uCenter: 0.18, thetaCenter: Math.PI * 0.38, uSpan: 0.18, thetaSpan: 0.62 },
      { name: 'CoatSpotPatch_ShoulderRight', uCenter: 0.78, thetaCenter: -Math.PI * 0.24, uSpan: 0.19, thetaSpan: 0.64 },
      { name: 'CoatSpotPatch_DorsalCrest', uCenter: 0.66, thetaCenter: 0.08, uSpan: 0.18, thetaSpan: 0.55 },
      { name: 'CoatSpotPatch_BellyLeft', uCenter: 0.34, thetaCenter: Math.PI * 0.62, uSpan: 0.17, thetaSpan: 0.52 },
    ];

    spotDefinitions.forEach((spot, sIdx) => {
      components.push({
        id: `organ_spot_${sIdx + 1}`,
        name: spot.name,
        semanticRole: 'coat_spot_patch',
        hierarchyPath: 'Root/Spine_Torso/CoatSpots',
        kernel: 'conformal_spot_patch',
        position: [0, torsoCenterY, -0.15],
        rotation: [0, 0, 0],
        size: [1.4, 1.4, 1.8],
        material: 'SmoothPlastic',
        colorHex: pal.secondaryHex, // Negro carbón #18181b sobre blanco #f8fafc
        roughness: 0.8,
        metalness: 0.02,
        canCollide: false,
        spineControlPoints: torsoSpine,
        spotPatchParams: {
          uCenter: spot.uCenter,
          thetaCenter: spot.thetaCenter,
          uSpan: spot.uSpan,
          thetaSpan: spot.thetaSpan,
          normalOffset: 0.048,
        },
      });
    });

    // Ubre ventral bovina (`Udder_Ventral`) entre las patas traseras
    components.push({
      id: 'organ_udder_ventral',
      name: 'Udder_Ventral',
      semanticRole: 'udder',
      hierarchyPath: 'Root/Spine_Torso/Ventral',
      kernel: 'spline_lofted_organ',
      position: [0, torsoCenterY - 1.45, -1.75],
      rotation: [0, 0, 0],
      size: [1.15, 0.82, 1.35],
      material: 'SmoothPlastic',
      colorHex: pal.accentHex,
      roughness: 0.72,
      metalness: 0.02,
      canCollide: false,
      spineControlPoints: [
        { point: [0, 0.05, -0.62], radiusX: 0.38, radiusY: 0.28, dorsalVentralBias: 0.8 },
        { point: [0, -0.08, 0.0], radiusX: 0.58, radiusY: 0.44, dorsalVentralBias: 0.72 },
        { point: [0, 0.04, 0.62], radiusX: 0.42, radiusY: 0.3, dorsalVentralBias: 0.8 },
      ],
    });
  }

  // 2. Cuello Muscular (`Neck_Muscular`)
  const neckSpine: SpineControlPoint[] = isCow
    ? [
        { point: [0, torsoCenterY + 0.05, 2.55], radiusX: 0.98, radiusY: 1.18, dorsalVentralBias: 0.88 }, // Base cuello con papada (dewlap)
        { point: [0, torsoCenterY + 0.55, 3.35], radiusX: 0.82, radiusY: 0.98, dorsalVentralBias: 0.92 },
        { point: [0, torsoCenterY + 0.98, 4.05], radiusX: 0.68, radiusY: 0.78, dorsalVentralBias: 1.0 },
      ]
    : isHorse
      ? [
          { point: [0, torsoCenterY + 0.25, 2.45], radiusX: 0.82, radiusY: 1.05, dorsalVentralBias: 1.05 },
          { point: [0, torsoCenterY + 1.35, 3.15], radiusX: 0.66, radiusY: 0.86, dorsalVentralBias: 1.12 },
          { point: [0, torsoCenterY + 2.35, 3.68], radiusX: 0.52, radiusY: 0.65, dorsalVentralBias: 1.05 },
        ]
      : [
          { point: [0, torsoCenterY + 0.22, 1.85], radiusX: 0.64, radiusY: 0.72, dorsalVentralBias: 1.0 },
          { point: [0, torsoCenterY + 0.82, 2.35], radiusX: 0.54, radiusY: 0.58, dorsalVentralBias: 1.02 },
          { point: [0, torsoCenterY + 1.35, 2.75], radiusX: 0.46, radiusY: 0.48, dorsalVentralBias: 1.0 },
        ];

  components.push({
    id: 'organ_neck',
    name: 'Neck_Muscular',
    semanticRole: 'neck',
    hierarchyPath: 'Root/Neck_Head',
    kernel: 'spline_lofted_organ',
    position: [0, torsoCenterY + (isHorse ? 1.3 : 0.52), isDog ? 2.3 : 3.3],
    rotation: [0, 0, 0],
    size: [1.8, isHorse ? 2.6 : 1.9, 2.1],
    material: 'SmoothPlastic',
    colorHex: isCow ? pal.secondaryHex : pal.primaryHex, // Cuello oscuro contrastante en vaca Holstein
    roughness: 0.78,
    metalness: 0.03,
    canCollide: true,
    spineControlPoints: neckSpine,
  });

  // Crin dorsal para el caballo (`Mane_Crest`)
  if (isHorse) {
    components.push({
      id: 'organ_horse_mane',
      name: 'Mane_DorsalCrest',
      semanticRole: 'mane_or_crest',
      hierarchyPath: 'Root/Neck_Head',
      kernel: 'spline_lofted_organ',
      position: [0, torsoCenterY + 1.65, 2.95],
      rotation: [0, 0, 0],
      size: [0.36, 2.3, 1.4],
      material: 'Fabric',
      colorHex: pal.secondaryHex,
      roughness: 0.88,
      metalness: 0.01,
      canCollide: false,
      spineControlPoints: [
        { point: [0, torsoCenterY + 0.75, 2.15], radiusX: 0.16, radiusY: 0.28 },
        { point: [0, torsoCenterY + 1.65, 2.85], radiusX: 0.18, radiusY: 0.34 },
        { point: [0, torsoCenterY + 2.55, 3.55], radiusX: 0.15, radiusY: 0.26 },
      ],
    });
  }

  // 3. Cabeza (`Head_Cranium`) y Hocico Diferenciado (`Snout_Muzzle`)
  const headY = isCow ? torsoCenterY + 1.12 : isHorse ? torsoCenterY + 2.42 : torsoCenterY + 1.48;
  const headZ = isCow ? 4.35 : isHorse ? 4.05 : 3.05;

  const headSpine: SpineControlPoint[] = isCow
    ? [
        { point: [0, headY + 0.32, headZ - 0.55], radiusX: 0.76, radiusY: 0.74, dorsalVentralBias: 1.12 }, // Testuz / frente bovina
        { point: [0, headY + 0.05, headZ + 0.12], radiusX: 0.82, radiusY: 0.76, dorsalVentralBias: 1.04 }, // Órbitas y mejillas
        { point: [0, headY - 0.22, headZ + 0.75], radiusX: 0.64, radiusY: 0.58, dorsalVentralBias: 0.92 }, // Puente nasal hacia hocico
      ]
    : isHorse
      ? [
          { point: [0, headY + 0.28, headZ - 0.45], radiusX: 0.58, radiusY: 0.64, dorsalVentralBias: 1.1 },
          { point: [0, headY - 0.05, headZ + 0.22], radiusX: 0.52, radiusY: 0.56, dorsalVentralBias: 1.0 },
          { point: [0, headY - 0.42, headZ + 0.92], radiusX: 0.38, radiusY: 0.42, dorsalVentralBias: 0.95 },
        ]
      : [
          { point: [0, headY + 0.18, headZ - 0.38], radiusX: 0.56, radiusY: 0.54, dorsalVentralBias: 1.08 },
          { point: [0, headY + 0.04, headZ + 0.12], radiusX: 0.52, radiusY: 0.48, dorsalVentralBias: 1.02 },
          { point: [0, headY - 0.12, headZ + 0.52], radiusX: 0.34, radiusY: 0.32, dorsalVentralBias: 0.95 },
        ];

  components.push({
    id: 'organ_head_cranium',
    name: 'Head_Cranium',
    semanticRole: 'head_cranium',
    hierarchyPath: 'Root/Neck_Head/Cranium',
    kernel: 'spline_lofted_organ',
    position: [0, headY, headZ + 0.1],
    rotation: [0, 0, 0],
    size: [1.6, 1.5, 1.6],
    material: 'SmoothPlastic',
    colorHex: pal.primaryHex,
    roughness: 0.75,
    metalness: 0.03,
    canCollide: true,
    spineControlPoints: headSpine,
  });

  // 3B. Hocico / Morro diferenciado (`Snout_Muzzle`)
  const snoutY = isCow ? headY - 0.36 : isHorse ? headY - 0.62 : headY - 0.18;
  const snoutZ = isCow ? headZ + 1.08 : isHorse ? headZ + 1.25 : headZ + 0.88;
  components.push({
    id: 'organ_snout_muzzle',
    name: 'Snout_Muzzle',
    semanticRole: 'snout_muzzle',
    hierarchyPath: 'Root/Neck_Head/Cranium',
    kernel: 'spline_lofted_organ',
    position: [0, snoutY, snoutZ],
    rotation: [0, 0, 0],
    size: isCow ? [1.22, 0.86, 0.92] : isHorse ? [0.76, 0.72, 0.95] : [0.58, 0.52, 0.88],
    material: 'SmoothPlastic',
    colorHex: isCow ? pal.accentHex : pal.muzzleOrTrimHex, // Morro ancho rosado en la vaca
    roughness: 0.68,
    metalness: 0.04,
    canCollide: true,
    spineControlPoints: isCow
      ? [
          { point: [0, snoutY + 0.08, snoutZ - 0.38], radiusX: 0.58, radiusY: 0.46, dorsalVentralBias: 0.95 },
          { point: [0, snoutY - 0.04, snoutZ + 0.06], radiusX: 0.64, radiusY: 0.48, dorsalVentralBias: 0.92 },
          { point: [0, snoutY - 0.08, snoutZ + 0.42], radiusX: 0.54, radiusY: 0.4, dorsalVentralBias: 0.9 },
        ]
      : [
          { point: [0, snoutY + 0.06, snoutZ - 0.36], radiusX: 0.36, radiusY: 0.34, dorsalVentralBias: 1.0 },
          { point: [0, snoutY - 0.02, snoutZ + 0.05], radiusX: 0.32, radiusY: 0.3, dorsalVentralBias: 0.98 },
          { point: [0, snoutY - 0.05, snoutZ + 0.42], radiusX: 0.25, radiusY: 0.24, dorsalVentralBias: 0.95 },
        ],
  });

  // 3C. Dos Ojos (`Eye_Left`, `Eye_Right`)
  for (const side of [-1, 1] as const) {
    const sideLabel = side < 0 ? 'Left' : 'Right';
    const eyeX = side * (isCow ? 0.68 : isHorse ? 0.48 : 0.38);
    const eyeY = headY + (isCow ? 0.14 : 0.12);
    const eyeZ = headZ + (isCow ? 0.22 : 0.18);
    components.push({
      id: `organ_eye_${sideLabel.toLowerCase()}`,
      name: `Eye_${sideLabel}`,
      semanticRole: 'eye',
      hierarchyPath: 'Root/Neck_Head/Cranium',
      kernel: 'sculpted_icosphere_organ',
      position: [round4(eyeX), round4(eyeY), round4(eyeZ)],
      rotation: [0, 0, 0],
      size: [0.26, 0.26, 0.26],
      material: 'SmoothPlastic',
      colorHex: pal.eyeHex,
      roughness: 0.18,
      metalness: 0.1,
      reflectance: 0.25,
      canCollide: false,
    });
  }

  // 3D. Dos Orejas (`Ear_Left`, `Ear_Right`)
  for (const side of [-1, 1] as const) {
    const sideLabel = side < 0 ? 'Left' : 'Right';
    const earSpine: SpineControlPoint[] = isCow
      ? [
          // Orejas bovinas proyectadas lateralmente en horizontal
          { point: [side * 0.62, headY + 0.24, headZ - 0.22], radiusX: 0.16, radiusY: 0.18 },
          { point: [side * 1.06, headY + 0.2, headZ - 0.16], radiusX: 0.24, radiusY: 0.32 },
          { point: [side * 1.42, headY + 0.14, headZ - 0.12], radiusX: 0.12, radiusY: 0.14 },
        ]
      : [
          // Orejas erguidas equinas / caninas
          { point: [side * 0.38, headY + 0.35, headZ - 0.28], radiusX: 0.16, radiusY: 0.16 },
          { point: [side * 0.48, headY + 0.72, headZ - 0.24], radiusX: 0.18, radiusY: 0.2 },
          { point: [side * 0.54, headY + 1.05, headZ - 0.2], radiusX: 0.08, radiusY: 0.1 },
        ];

    components.push({
      id: `organ_ear_${sideLabel.toLowerCase()}`,
      name: `Ear_${sideLabel}`,
      semanticRole: 'ear',
      hierarchyPath: 'Root/Neck_Head/Cranium',
      kernel: 'spline_lofted_organ',
      position: [side * (isCow ? 1.02 : 0.46), headY + (isCow ? 0.2 : 0.7), headZ - 0.2],
      rotation: [0, 0, 0],
      size: isCow ? [0.85, 0.45, 0.42] : [0.38, 0.75, 0.38],
      material: 'SmoothPlastic',
      colorHex: isCow ? pal.secondaryHex : pal.primaryHex,
      roughness: 0.76,
      metalness: 0.02,
      canCollide: false,
      spineControlPoints: earSpine,
    });
  }

  // 3E. Dos Cuernos Curvos (`Horn_Left`, `Horn_Right`) para vaca/toro o cornamenta para ciervo
  if (isCow || isStag) {
    for (const side of [-1, 1] as const) {
      const sideLabel = side < 0 ? 'Left' : 'Right';
      const hornSpine: SpineControlPoint[] = [
        { point: [side * 0.52, headY + 0.42, headZ - 0.32], radiusX: 0.22, radiusY: 0.22 },
        { point: [side * 0.96, headY + 0.68, headZ - 0.18], radiusX: 0.16, radiusY: 0.16 },
        { point: [side * 1.18, headY + 1.08, headZ + 0.08], radiusX: 0.1, radiusY: 0.1 },
        { point: [side * 1.06, headY + 1.38, headZ + 0.28], radiusX: 0.04, radiusY: 0.04 },
      ];
      components.push({
        id: `organ_horn_${sideLabel.toLowerCase()}`,
        name: `Horn_${sideLabel}`,
        semanticRole: 'horn_or_antler',
        hierarchyPath: 'Root/Neck_Head/Cranium',
        kernel: 'spline_lofted_organ',
        position: [side * 0.92, headY + 0.9, headZ - 0.05],
        rotation: [0, 0, 0],
        size: [0.82, 1.05, 0.68],
        material: 'Marble',
        colorHex: pal.detailHex,
        roughness: 0.45,
        metalness: 0.08,
        canCollide: false,
        spineControlPoints: hornSpine,
      });
    }
  }

  // 4. Cuatro Patas Articuladas Proporcionadas en las 4 esquinas anatómicas (`FrontLeft`, `FrontRight`, `RearLeft`, `RearRight`)
  // Cada extremidad consta de:
  // - Segmento Superior Muscular (`UpperLeg_*`: Hombro/Brazo adelante, Muslo/Femoral atrás)
  // - Articulación Rodilla / Corvejón (`KneeHockJoint_*`)
  // - Caña Inferior Esbelta (`LowerCannonLeg_*`)
  // - Pezuña Hendida / Casco / Garra apoyada en `Y = 0` (`Hoof_*`)
  const limbConfigs: Array<{
    tag: 'FrontLeft' | 'FrontRight' | 'RearLeft' | 'RearRight';
    hierarchy: string;
    sideX: number;
    baseZ: number;
    isRear: boolean;
  }> = [
    { tag: 'FrontLeft', hierarchy: 'Root/Limb_FrontLeft', sideX: -halfTrackX, baseZ: frontLegZ, isRear: false },
    { tag: 'FrontRight', hierarchy: 'Root/Limb_FrontRight', sideX: halfTrackX, baseZ: frontLegZ, isRear: false },
    { tag: 'RearLeft', hierarchy: 'Root/Limb_RearLeft', sideX: -halfTrackX, baseZ: rearLegZ, isRear: true },
    { tag: 'RearRight', hierarchy: 'Root/Limb_RearRight', sideX: halfTrackX, baseZ: rearLegZ, isRear: true },
  ];

  const hoofHeight = isCow ? 0.46 : isHorse ? 0.5 : 0.36;
  const kneeY = round4(shoulderHeightY * 0.46);
  const hipOrShoulderY = round4(shoulderHeightY * 0.94);

  for (const limb of limbConfigs) {
    const jointZ = limb.isRear ? limb.baseZ - 0.28 : limb.baseZ + 0.08; // Corvejón trasero angulado, rodilla delantera recta
    const footZ = limb.baseZ;

    // 4A. Muslo / Hombro Superior (`UpperLeg_*`)
    const upperTopR = limb.isRear ? (isCow ? 0.62 : 0.52) : isCow ? 0.52 : 0.44;
    const upperBotR = isCow ? 0.32 : isHorse ? 0.28 : 0.24;
    components.push({
      id: `organ_upper_leg_${limb.tag.toLowerCase()}`,
      name: `UpperLeg_${limb.tag}`,
      semanticRole: 'limb_upper',
      hierarchyPath: limb.hierarchy,
      kernel: 'spline_lofted_organ',
      position: [limb.sideX, round4((hipOrShoulderY + kneeY) * 0.5), round4((limb.baseZ + jointZ) * 0.5)],
      rotation: [0, 0, 0],
      size: [upperTopR * 2, round4(hipOrShoulderY - kneeY + 0.35), upperTopR * 2.2],
      material: 'SmoothPlastic',
      colorHex: pal.primaryHex,
      roughness: 0.78,
      metalness: 0.03,
      canCollide: true,
      spineControlPoints: [
        { point: [limb.sideX, hipOrShoulderY + 0.18, limb.baseZ], radiusX: upperTopR, radiusY: upperTopR * 1.15 },
        {
          point: [limb.sideX, (hipOrShoulderY + kneeY) * 0.5, (limb.baseZ + jointZ) * 0.5],
          radiusX: (upperTopR + upperBotR) * 0.52,
          radiusY: (upperTopR + upperBotR) * 0.56,
        },
        { point: [limb.sideX, kneeY, jointZ], radiusX: upperBotR, radiusY: upperBotR },
      ],
    });

    // 4B. Articulación de Rodilla / Corvejón (`KneeHockJoint_*`)
    components.push({
      id: `organ_joint_${limb.tag.toLowerCase()}`,
      name: `KneeHockJoint_${limb.tag}`,
      semanticRole: 'limb_joint',
      hierarchyPath: limb.hierarchy,
      kernel: 'sculpted_icosphere_organ',
      position: [limb.sideX, kneeY, jointZ],
      rotation: [0, 0, 0],
      size: [upperBotR * 2.15, upperBotR * 1.9, upperBotR * 2.15],
      material: 'SmoothPlastic',
      colorHex: pal.primaryHex,
      roughness: 0.76,
      metalness: 0.03,
      canCollide: false,
    });

    // 4C. Caña / Pierna Inferior (`LowerCannonLeg_*`)
    const lowerBotR = isCow ? 0.24 : isHorse ? 0.22 : 0.18;
    components.push({
      id: `organ_lower_leg_${limb.tag.toLowerCase()}`,
      name: `LowerCannonLeg_${limb.tag}`,
      semanticRole: 'limb_lower',
      hierarchyPath: limb.hierarchy,
      kernel: 'spline_lofted_organ',
      position: [limb.sideX, round4((kneeY + hoofHeight) * 0.5), round4((jointZ + footZ) * 0.5)],
      rotation: [0, 0, 0],
      size: [upperBotR * 1.8, round4(kneeY - hoofHeight + 0.2), upperBotR * 1.8],
      material: 'SmoothPlastic',
      colorHex: pal.primaryHex,
      roughness: 0.78,
      metalness: 0.03,
      canCollide: true,
      spineControlPoints: [
        { point: [limb.sideX, kneeY, jointZ], radiusX: upperBotR * 0.92, radiusY: upperBotR * 0.92 },
        {
          point: [limb.sideX, (kneeY + hoofHeight) * 0.5, (jointZ + footZ) * 0.5],
          radiusX: lowerBotR * 1.05,
          radiusY: lowerBotR * 1.05,
        },
        { point: [limb.sideX, hoofHeight, footZ], radiusX: lowerBotR, radiusY: lowerBotR * 1.08 },
      ],
    });

    // 4D. Pezuña Hendida / Casco / Garra en `Y = 0` (`Hoof_*`)
    const hoofRadiusX = isCow ? 0.34 : isHorse ? 0.3 : 0.25;
    const hoofRadiusZ = isCow ? 0.42 : isHorse ? 0.36 : 0.32;
    components.push({
      id: `organ_hoof_${limb.tag.toLowerCase()}`,
      name: `Hoof_${limb.tag}`,
      semanticRole: 'hoof_or_paw',
      hierarchyPath: limb.hierarchy,
      kernel: 'spline_lofted_organ',
      position: [limb.sideX, round4(hoofHeight * 0.5), round4(footZ + 0.06)],
      rotation: [0, 0, 0],
      size: [hoofRadiusX * 2, hoofHeight, hoofRadiusZ * 2],
      material: 'Slate',
      colorHex: pal.hoofOrTireHex,
      roughness: 0.85,
      metalness: 0.05,
      canCollide: true,
      spineControlPoints: [
        { point: [limb.sideX, 0.0, footZ + 0.08], radiusX: hoofRadiusX * 1.12, radiusY: hoofRadiusZ * 1.15 },
        { point: [limb.sideX, hoofHeight * 0.55, footZ + 0.04], radiusX: hoofRadiusX * 0.98, radiusY: hoofRadiusZ },
        { point: [limb.sideX, hoofHeight, footZ], radiusX: lowerBotR * 1.05, radiusY: lowerBotR * 1.05 },
      ],
    });
  }

  // 5. Cola (`Tail_Main`) y Borla de la Cola (`Tail_Tuft`)
  const tailSpine: SpineControlPoint[] = isCow
    ? [
        // Cola bovina que cae naturalmente tras la grupa con ligera curvatura final
        { point: [0, torsoCenterY + 0.14, -3.42], radiusX: 0.18, radiusY: 0.18 },
        { point: [0, torsoCenterY - 0.65, -3.72], radiusX: 0.14, radiusY: 0.14 },
        { point: [0, torsoCenterY - 1.55, -3.82], radiusX: 0.11, radiusY: 0.11 },
        { point: [0, torsoCenterY - 2.15, -3.76], radiusX: 0.09, radiusY: 0.09 },
      ]
    : isHorse
      ? [
          { point: [0, torsoCenterY + 0.18, -3.32], radiusX: 0.24, radiusY: 0.24 },
          { point: [0, torsoCenterY - 0.45, -3.85], radiusX: 0.36, radiusY: 0.38 },
          { point: [0, torsoCenterY - 1.45, -4.05], radiusX: 0.32, radiusY: 0.34 },
          { point: [0, torsoCenterY - 2.25, -3.92], radiusX: 0.14, radiusY: 0.16 },
        ]
      : [
          { point: [0, torsoCenterY + 0.12, -2.42], radiusX: 0.18, radiusY: 0.18 },
          { point: [0, torsoCenterY + 0.45, -3.05], radiusX: 0.16, radiusY: 0.16 },
          { point: [0, torsoCenterY + 0.92, -3.55], radiusX: 0.11, radiusY: 0.11 },
        ];

  components.push({
    id: 'organ_tail_main',
    name: 'Tail_Main',
    semanticRole: 'tail',
    hierarchyPath: 'Root/Tail',
    kernel: 'spline_lofted_organ',
    position: [0, torsoCenterY - (isDog ? -0.45 : 0.95), isDog ? -3.0 : -3.72],
    rotation: [0, 0, 0],
    size: [0.55, isDog ? 1.2 : 2.4, 0.95],
    material: isHorse ? 'Fabric' : 'SmoothPlastic',
    colorHex: isHorse ? pal.secondaryHex : pal.primaryHex,
    roughness: 0.82,
    metalness: 0.02,
    canCollide: false,
    spineControlPoints: tailSpine,
  });

  if (isCow) {
    // Borla negra característica al final de la cola bovina (`Tail_SwitchTuft`)
    components.push({
      id: 'organ_tail_tuft',
      name: 'Tail_SwitchTuft',
      semanticRole: 'tail_tuft',
      hierarchyPath: 'Root/Tail',
      kernel: 'spline_lofted_organ',
      position: [0, torsoCenterY - 2.42, -3.75],
      rotation: [0, 0, 0],
      size: [0.46, 0.72, 0.46],
      material: 'Fabric',
      colorHex: pal.secondaryHex,
      roughness: 0.88,
      metalness: 0.01,
      canCollide: false,
      spineControlPoints: [
        { point: [0, torsoCenterY - 2.08, -3.76], radiusX: 0.12, radiusY: 0.12 },
        { point: [0, torsoCenterY - 2.38, -3.75], radiusX: 0.24, radiusY: 0.24 },
        { point: [0, torsoCenterY - 2.72, -3.74], radiusX: 0.06, radiusY: 0.06 },
      ],
    });
  }

  return {
    interpretation: interp,
    skeletonHierarchy,
    components,
    torsoReferenceSpine: torsoSpine,
    torsoWorldCenter: [0, torsoCenterY, -0.15],
  };
}

/**
 * Planificador anatómico para Dragones y Criaturas Aladas (`winged_dragon`):
 * - Torso reptiliano acorazado, cuello serpentino en S, cráneo cornudo con mandíbula y fauces,
 *   2 alas membranosas curvadas (`WingMembrane_Left/Right`), 4 patas musculosas con garras,
 *   crestas dorsales (`DorsalSpine_1..5`) y cola larga con maza/punta caudal.
 */
function planWingedDragonAnatomy(
  interp: SemanticObjectInterpretation,
  _rng: () => number
): FreeformGeometryPlan {
  const pal = interp.palette;
  const torsoY = 3.85;
  const components: PlannedOrganComponent[] = [];
  const skeletonHierarchy = [
    'Root',
    'Root/Spine_Torso',
    'Root/Neck_Head',
    'Root/Wings',
    'Root/Limb_FrontLeft',
    'Root/Limb_FrontRight',
    'Root/Limb_RearLeft',
    'Root/Limb_RearRight',
    'Root/Tail',
  ];

  // 1. Torso Reptiliano
  const torsoSpine: SpineControlPoint[] = [
    { point: [0, torsoY - 0.2, -3.6], radiusX: 0.95, radiusY: 0.92, dorsalVentralBias: 1.05 },
    { point: [0, torsoY + 0.05, -1.8], radiusX: 1.55, radiusY: 1.48, dorsalVentralBias: 1.08 },
    { point: [0, torsoY + 0.25, 0.4], radiusX: 1.85, radiusY: 1.78, dorsalVentralBias: 0.92 },
    { point: [0, torsoY + 0.55, 2.5], radiusX: 1.65, radiusY: 1.72, dorsalVentralBias: 1.12 },
    { point: [0, torsoY + 0.35, 3.6], radiusX: 1.15, radiusY: 1.22, dorsalVentralBias: 0.95 },
  ];
  components.push({
    id: 'dragon_torso',
    name: 'TorsoReptilian_Main',
    semanticRole: 'torso',
    hierarchyPath: 'Root/Spine_Torso',
    kernel: 'spline_lofted_organ',
    position: [0, torsoY, 0],
    rotation: [0, 0, 0],
    size: [3.7, 3.5, 7.2],
    material: 'Slate',
    colorHex: pal.primaryHex,
    roughness: 0.65,
    metalness: 0.15,
    canCollide: true,
    spineControlPoints: torsoSpine,
  });

  // 2. Cuello Serpentino en S y Cabeza Cornuda con Mandíbula
  components.push({
    id: 'dragon_neck',
    name: 'Neck_Serpentine',
    semanticRole: 'neck',
    hierarchyPath: 'Root/Neck_Head',
    kernel: 'spline_lofted_organ',
    position: [0, torsoY + 2.2, 4.4],
    rotation: [0, 0, 0],
    size: [1.9, 3.8, 2.8],
    material: 'Slate',
    colorHex: pal.primaryHex,
    roughness: 0.65,
    metalness: 0.15,
    canCollide: true,
    spineControlPoints: [
      { point: [0, torsoY + 0.5, 3.2], radiusX: 0.98, radiusY: 1.05 },
      { point: [0, torsoY + 1.9, 4.2], radiusX: 0.78, radiusY: 0.84 },
      { point: [0, torsoY + 3.4, 4.8], radiusX: 0.64, radiusY: 0.68 },
      { point: [0, torsoY + 4.3, 5.5], radiusX: 0.56, radiusY: 0.58 },
    ],
  });

  const headY = torsoY + 4.45;
  const headZ = 6.15;
  components.push({
    id: 'dragon_head',
    name: 'Head_DragonSkull',
    semanticRole: 'head_cranium',
    hierarchyPath: 'Root/Neck_Head',
    kernel: 'spline_lofted_organ',
    position: [0, headY, headZ],
    rotation: [0, 0, 0],
    size: [1.65, 1.45, 2.35],
    material: 'Slate',
    colorHex: pal.secondaryHex,
    roughness: 0.58,
    metalness: 0.2,
    canCollide: true,
    spineControlPoints: [
      { point: [0, headY + 0.15, headZ - 0.85], radiusX: 0.78, radiusY: 0.72 },
      { point: [0, headY + 0.05, headZ + 0.15], radiusX: 0.66, radiusY: 0.58 },
      { point: [0, headY - 0.12, headZ + 1.15], radiusX: 0.42, radiusY: 0.38 },
    ],
  });

  components.push({
    id: 'dragon_jaw',
    name: 'Jaw_LowerFangs',
    semanticRole: 'jaw_or_mouth',
    hierarchyPath: 'Root/Neck_Head',
    kernel: 'spline_lofted_organ',
    position: [0, headY - 0.48, headZ + 0.25],
    rotation: [0, 0, 0],
    size: [1.15, 0.55, 1.85],
    material: 'Slate',
    colorHex: pal.muzzleOrTrimHex,
    roughness: 0.62,
    metalness: 0.18,
    canCollide: false,
    spineControlPoints: [
      { point: [0, headY - 0.35, headZ - 0.55], radiusX: 0.56, radiusY: 0.28 },
      { point: [0, headY - 0.52, headZ + 0.35], radiusX: 0.46, radiusY: 0.24 },
      { point: [0, headY - 0.58, headZ + 1.05], radiusX: 0.32, radiusY: 0.18 },
    ],
  });

  // Ojos emisivos y Cuernos traseros del dragón
  for (const side of [-1, 1] as const) {
    const sideLabel = side < 0 ? 'Left' : 'Right';
    components.push({
      id: `dragon_eye_${sideLabel.toLowerCase()}`,
      name: `Eye_${sideLabel}`,
      semanticRole: 'eye',
      hierarchyPath: 'Root/Neck_Head',
      kernel: 'sculpted_icosphere_organ',
      position: [side * 0.56, headY + 0.18, headZ + 0.25],
      rotation: [0, 0, 0],
      size: [0.28, 0.24, 0.32],
      material: 'Neon',
      colorHex: pal.eyeHex,
      roughness: 0.15,
      metalness: 0.05,
      canCollide: false,
    });

    components.push({
      id: `dragon_horn_${sideLabel.toLowerCase()}`,
      name: `Horn_${sideLabel}`,
      semanticRole: 'horn_or_antler',
      hierarchyPath: 'Root/Neck_Head',
      kernel: 'spline_lofted_organ',
      position: [side * 0.78, headY + 0.85, headZ - 1.25],
      rotation: [0, 0, 0],
      size: [0.75, 1.35, 1.65],
      material: 'Marble',
      colorHex: pal.accentHex,
      roughness: 0.4,
      metalness: 0.25,
      canCollide: false,
      spineControlPoints: [
        { point: [side * 0.52, headY + 0.38, headZ - 0.65], radiusX: 0.24, radiusY: 0.24 },
        { point: [side * 0.86, headY + 0.88, headZ - 1.35], radiusX: 0.16, radiusY: 0.16 },
        { point: [side * 1.12, headY + 1.48, headZ - 2.05], radiusX: 0.05, radiusY: 0.05 },
      ],
    });

    // 3. Dos Alas Membranosas Articuladas (`WingMembrane_Left`, `WingMembrane_Right`)
    components.push({
      id: `dragon_wing_${sideLabel.toLowerCase()}`,
      name: `WingMembrane_${sideLabel}`,
      semanticRole: 'wing_membrane',
      hierarchyPath: 'Root/Wings',
      kernel: 'cambered_wing_membrane',
      position: [side * 4.45, torsoY + 2.35, 1.05],
      rotation: [0, 0, 0],
      size: [7.4, 3.8, 4.8],
      material: 'Fabric',
      colorHex: pal.secondaryHex,
      roughness: 0.72,
      metalness: 0.12,
      canCollide: true,
      wingParams: {
        side,
        camberDepth: 0.85,
        fingerCount: 4,
      },
    });
  }

  // 4. Cuatro Patas Reptilianas con Garras apoyadas en `Y = 0`
  const limbCoords: Array<{ tag: string; hierarchy: string; sx: number; bz: number }> = [
    { tag: 'FrontLeft', hierarchy: 'Root/Limb_FrontLeft', sx: -1.35, bz: 2.35 },
    { tag: 'FrontRight', hierarchy: 'Root/Limb_FrontRight', sx: 1.35, bz: 2.35 },
    { tag: 'RearLeft', hierarchy: 'Root/Limb_RearLeft', sx: -1.45, bz: -2.25 },
    { tag: 'RearRight', hierarchy: 'Root/Limb_RearRight', sx: 1.45, bz: -2.25 },
  ];

  for (const limb of limbCoords) {
    components.push({
      id: `dragon_upper_leg_${limb.tag.toLowerCase()}`,
      name: `UpperLeg_${limb.tag}`,
      semanticRole: 'limb_upper',
      hierarchyPath: limb.hierarchy,
      kernel: 'spline_lofted_organ',
      position: [limb.sx, 2.55, limb.bz],
      rotation: [0, 0, 0],
      size: [1.25, 2.2, 1.35],
      material: 'Slate',
      colorHex: pal.primaryHex,
      roughness: 0.68,
      metalness: 0.15,
      canCollide: true,
      spineControlPoints: [
        { point: [limb.sx * 0.92, 3.55, limb.bz], radiusX: 0.64, radiusY: 0.68 },
        { point: [limb.sx * 1.06, 2.5, limb.bz - 0.18], radiusX: 0.48, radiusY: 0.5 },
        { point: [limb.sx, 1.65, limb.bz - 0.25], radiusX: 0.36, radiusY: 0.38 },
      ],
    });

    components.push({
      id: `dragon_lower_leg_${limb.tag.toLowerCase()}`,
      name: `LowerCannonLeg_${limb.tag}`,
      semanticRole: 'limb_lower',
      hierarchyPath: limb.hierarchy,
      kernel: 'spline_lofted_organ',
      position: [limb.sx, 0.95, limb.bz - 0.05],
      rotation: [0, 0, 0],
      size: [0.82, 1.5, 0.88],
      material: 'Slate',
      colorHex: pal.primaryHex,
      roughness: 0.68,
      metalness: 0.15,
      canCollide: true,
      spineControlPoints: [
        { point: [limb.sx, 1.65, limb.bz - 0.25], radiusX: 0.36, radiusY: 0.36 },
        { point: [limb.sx, 0.95, limb.bz - 0.05], radiusX: 0.28, radiusY: 0.28 },
        { point: [limb.sx, 0.38, limb.bz + 0.12], radiusX: 0.32, radiusY: 0.32 },
      ],
    });

    components.push({
      id: `dragon_claw_${limb.tag.toLowerCase()}`,
      name: `ClawedFoot_${limb.tag}`,
      semanticRole: 'hoof_or_paw',
      hierarchyPath: limb.hierarchy,
      kernel: 'spline_lofted_organ',
      position: [limb.sx, 0.22, limb.bz + 0.28],
      rotation: [0, 0, 0],
      size: [0.92, 0.44, 1.15],
      material: 'Slate',
      colorHex: pal.hoofOrTireHex,
      roughness: 0.75,
      metalness: 0.2,
      canCollide: true,
      spineControlPoints: [
        { point: [limb.sx, 0.0, limb.bz + 0.45], radiusX: 0.46, radiusY: 0.52 },
        { point: [limb.sx, 0.22, limb.bz + 0.25], radiusX: 0.42, radiusY: 0.46 },
        { point: [limb.sx, 0.44, limb.bz + 0.08], radiusX: 0.32, radiusY: 0.34 },
      ],
    });
  }

  // 5. Crestas Dorsales (`DorsalSpine_1..4`) y Cola Serpentina Larga (`Tail_DragonWhip`)
  for (let s = 0; s < 4; s++) {
    const zPos = 2.1 - s * 1.45;
    const yPos = torsoY + 1.55 - s * 0.12;
    components.push({
      id: `dragon_spine_${s + 1}`,
      name: `DorsalSpine_${s + 1}`,
      semanticRole: 'dorsal_spine',
      hierarchyPath: 'Root/Spine_Torso',
      kernel: 'spline_lofted_organ',
      position: [0, yPos + 0.45, zPos],
      rotation: [0, 0, 0],
      size: [0.36, 0.95, 0.65],
      material: 'Marble',
      colorHex: pal.accentHex,
      roughness: 0.45,
      metalness: 0.2,
      canCollide: false,
      spineControlPoints: [
        { point: [0, yPos, zPos + 0.15], radiusX: 0.18, radiusY: 0.28 },
        { point: [0, yPos + 0.52, zPos - 0.08], radiusX: 0.12, radiusY: 0.18 },
        { point: [0, yPos + 0.95, zPos - 0.28], radiusX: 0.04, radiusY: 0.05 },
      ],
    });
  }

  components.push({
    id: 'dragon_tail',
    name: 'Tail_DragonWhip',
    semanticRole: 'tail',
    hierarchyPath: 'Root/Tail',
    kernel: 'spline_lofted_organ',
    position: [0, torsoY - 1.2, -6.2],
    rotation: [0, 0, 0],
    size: [1.65, 2.8, 5.6],
    material: 'Slate',
    colorHex: pal.primaryHex,
    roughness: 0.65,
    metalness: 0.15,
    canCollide: true,
    spineControlPoints: [
      { point: [0, torsoY - 0.15, -3.5], radiusX: 0.88, radiusY: 0.85 },
      { point: [0, torsoY - 1.15, -5.4], radiusX: 0.58, radiusY: 0.56 },
      { point: [0, torsoY - 1.95, -7.2], radiusX: 0.36, radiusY: 0.36 },
      { point: [0, torsoY - 1.55, -8.8], radiusX: 0.16, radiusY: 0.18 },
    ],
  });

  return {
    interpretation: interp,
    skeletonHierarchy,
    components,
    torsoReferenceSpine: torsoSpine,
    torsoWorldCenter: [0, torsoY, 0],
  };
}

/**
 * Planificador estructural para Motocicletas y Vehículos con Ruedas (`motorcycle`):
 * - Rueda delantera y trasera toroidales reales (`WheelTire_Front`, `WheelTire_Rear`) apoyadas en `Y = 0`
 * - Llantas metálicas con radios (`WheelRim_Front`, `WheelRim_Rear`)
 * - Chasis tubular/estructural (`ChassisFrame_Main`), Horquilla telescópica delantera (`FrontFork_Assembly`),
 *   Manillar con puños (`Handlebar_Steering`), Tanque de combustible esculpido en gota (`FuelTank_Teardrop`),
 *   Bloque motor V-Twin (`EngineBlock_VTwin`), Tubos de escape cromados (`ExhaustPipe_Left/Right`),
 *   Asiento ergonómico (`SaddleSeat_Contoured`) y Faro delantero/trasero (`Headlight_Front`, `Taillight_Rear`).
 */
function planWheeledVehicleStructure(
  interp: SemanticObjectInterpretation,
  _rng: () => number
): FreeformGeometryPlan {
  const pal = interp.palette;
  const components: PlannedOrganComponent[] = [];
  const skeletonHierarchy = [
    'Root',
    'Root/Wheels_Front',
    'Root/Wheels_Rear',
    'Root/Chassis_Engine',
    'Root/Bodywork_Tank_Seat',
    'Root/Steering_Fork',
    'Root/Lighting_Exhaust',
  ];

  const wheelRadius = 1.55;
  const frontWheelZ = 3.25;
  const rearWheelZ = -3.15;

  // 1. Neumáticos Toroidales Delantero y Trasero + Llantas con Radios
  for (const wSpec of [
    { tag: 'Front', z: frontWheelZ, widthX: 0.72, hierarchy: 'Root/Wheels_Front' },
    { tag: 'Rear', z: rearWheelZ, widthX: 0.96, hierarchy: 'Root/Wheels_Rear' },
  ]) {
    components.push({
      id: `vehicle_tire_${wSpec.tag.toLowerCase()}`,
      name: `WheelTire_${wSpec.tag}`,
      semanticRole: 'wheel_tire',
      hierarchyPath: wSpec.hierarchy,
      kernel: 'toroidal_wheel',
      position: [0, wheelRadius, wSpec.z],
      rotation: [0, 0, 0],
      size: [wSpec.widthX, wheelRadius * 2, wheelRadius * 2],
      material: 'Slate',
      colorHex: pal.hoofOrTireHex,
      roughness: 0.88,
      metalness: 0.06,
      canCollide: true,
      wheelParams: {
        tubeRadiusRatio: 0.28,
        spokeCount: 6,
        isRimOnly: false,
      },
    });

    components.push({
      id: `vehicle_rim_${wSpec.tag.toLowerCase()}`,
      name: `WheelRim_${wSpec.tag}`,
      semanticRole: 'wheel_rim',
      hierarchyPath: wSpec.hierarchy,
      kernel: 'toroidal_wheel',
      position: [0, wheelRadius, wSpec.z],
      rotation: [0, 0, 0],
      size: [wSpec.widthX * 0.82, wheelRadius * 1.38, wheelRadius * 1.38],
      material: 'Metal',
      colorHex: pal.accentHex,
      roughness: 0.22,
      metalness: 0.88,
      reflectance: 0.35,
      canCollide: false,
      wheelParams: {
        tubeRadiusRatio: 0.18,
        spokeCount: 6,
        isRimOnly: true,
      },
    });
  }

  // 2. Chasis Tubular y Basculante Trasero (`ChassisFrame_Main`)
  components.push({
    id: 'vehicle_chassis',
    name: 'ChassisFrame_Main',
    semanticRole: 'chassis_frame',
    hierarchyPath: 'Root/Chassis_Engine',
    kernel: 'spline_lofted_organ',
    position: [0, 2.15, -0.15],
    rotation: [0, 0, 0],
    size: [1.35, 1.55, 5.2],
    material: 'Metal',
    colorHex: pal.detailHex,
    roughness: 0.35,
    metalness: 0.78,
    canCollide: true,
    spineControlPoints: [
      { point: [0, wheelRadius, rearWheelZ], radiusX: 0.52, radiusY: 0.28 },
      { point: [0, 1.85, -1.25], radiusX: 0.66, radiusY: 0.52 },
      { point: [0, 1.65, 0.65], radiusX: 0.68, radiusY: 0.62 },
      { point: [0, 3.15, 2.15], radiusX: 0.44, radiusY: 0.46 },
    ],
  });

  // 3. Bloque Motor V-Twin (`EngineBlock_VTwin`)
  components.push({
    id: 'vehicle_engine',
    name: 'EngineBlock_VTwin',
    semanticRole: 'engine_block',
    hierarchyPath: 'Root/Chassis_Engine',
    kernel: 'beveled_structural_frame',
    position: [0, 1.92, 0.35],
    rotation: [0, 0, 0],
    size: [1.55, 1.48, 1.95],
    material: 'Metal',
    colorHex: pal.detailHex,
    roughness: 0.32,
    metalness: 0.82,
    canCollide: true,
  });

  // 4. Tanque de Combustible en Gota (`FuelTank_Teardrop`)
  components.push({
    id: 'vehicle_tank',
    name: 'FuelTank_Teardrop',
    semanticRole: 'fuel_tank_or_body',
    hierarchyPath: 'Root/Bodywork_Tank_Seat',
    kernel: 'spline_lofted_organ',
    position: [0, 3.22, 0.95],
    rotation: [0, 0, 0],
    size: [1.62, 1.15, 2.35],
    material: 'SmoothPlastic',
    colorHex: pal.primaryHex,
    roughness: 0.18,
    metalness: 0.35,
    reflectance: 0.28,
    canCollide: true,
    spineControlPoints: [
      { point: [0, 2.88, -0.15], radiusX: 0.48, radiusY: 0.36, dorsalVentralBias: 1.15 },
      { point: [0, 3.28, 0.85], radiusX: 0.82, radiusY: 0.58, dorsalVentralBias: 1.22 },
      { point: [0, 3.42, 1.85], radiusX: 0.66, radiusY: 0.52, dorsalVentralBias: 1.15 },
      { point: [0, 3.25, 2.25], radiusX: 0.34, radiusY: 0.28, dorsalVentralBias: 1.05 },
    ],
  });

  // 5. Asiento Contorneado y Colín Trasero (`SaddleSeat_Contoured`)
  components.push({
    id: 'vehicle_seat',
    name: 'SaddleSeat_Contoured',
    semanticRole: 'seat_saddle',
    hierarchyPath: 'Root/Bodywork_Tank_Seat',
    kernel: 'spline_lofted_organ',
    position: [0, 2.95, -1.45],
    rotation: [0, 0, 0],
    size: [1.28, 0.78, 2.65],
    material: 'Fabric',
    colorHex: pal.secondaryHex,
    roughness: 0.78,
    metalness: 0.05,
    canCollide: true,
    spineControlPoints: [
      { point: [0, 3.22, -2.75], radiusX: 0.36, radiusY: 0.26, dorsalVentralBias: 1.1 },
      { point: [0, 2.96, -1.65], radiusX: 0.64, radiusY: 0.38, dorsalVentralBias: 0.85 },
      { point: [0, 2.78, -0.45], radiusX: 0.58, radiusY: 0.34, dorsalVentralBias: 0.88 },
      { point: [0, 2.88, -0.05], radiusX: 0.44, radiusY: 0.28, dorsalVentralBias: 1.0 },
    ],
  });

  // 6. Horquilla Telescópica Delantera (`FrontFork_Left`, `FrontFork_Right`) y Manillar (`Handlebar_Steering`)
  for (const side of [-1, 1] as const) {
    const sideLabel = side < 0 ? 'Left' : 'Right';
    components.push({
      id: `vehicle_fork_${sideLabel.toLowerCase()}`,
      name: `FrontFork_${sideLabel}`,
      semanticRole: 'handlebar_or_fork',
      hierarchyPath: 'Root/Steering_Fork',
      kernel: 'spline_lofted_organ',
      position: [side * 0.44, 2.65, 2.72],
      rotation: [0, 0, 0],
      size: [0.24, 2.45, 1.35],
      material: 'Metal',
      colorHex: pal.accentHex,
      roughness: 0.2,
      metalness: 0.9,
      canCollide: true,
      spineControlPoints: [
        { point: [side * 0.44, wheelRadius, frontWheelZ], radiusX: 0.11, radiusY: 0.11 },
        { point: [side * 0.44, 2.65, 2.72], radiusX: 0.12, radiusY: 0.12 },
        { point: [side * 0.44, 3.78, 2.18], radiusX: 0.11, radiusY: 0.11 },
      ],
    });

    // Tubos de Escape Cromados (`ExhaustPipe_Left`, `ExhaustPipe_Right`)
    components.push({
      id: `vehicle_exhaust_${sideLabel.toLowerCase()}`,
      name: `ExhaustPipe_${sideLabel}`,
      semanticRole: 'exhaust_pipe',
      hierarchyPath: 'Root/Lighting_Exhaust',
      kernel: 'spline_lofted_organ',
      position: [side * 0.76, 1.52, -1.25],
      rotation: [0, 0, 0],
      size: [0.32, 0.65, 3.85],
      material: 'Metal',
      colorHex: pal.accentHex,
      roughness: 0.18,
      metalness: 0.92,
      reflectance: 0.35,
      canCollide: false,
      spineControlPoints: [
        { point: [side * 0.68, 1.75, 0.55], radiusX: 0.12, radiusY: 0.12 },
        { point: [side * 0.78, 1.28, -0.65], radiusX: 0.14, radiusY: 0.14 },
        { point: [side * 0.82, 1.55, -2.85], radiusX: 0.18, radiusY: 0.18 },
      ],
    });
  }

  // Manillar transversal (`Handlebar_Steering`)
  components.push({
    id: 'vehicle_handlebar',
    name: 'Handlebar_Steering',
    semanticRole: 'handlebar_or_fork',
    hierarchyPath: 'Root/Steering_Fork',
    kernel: 'spline_lofted_organ',
    position: [0, 3.98, 2.08],
    rotation: [0, 0, 0],
    size: [2.75, 0.42, 0.65],
    material: 'Metal',
    colorHex: pal.secondaryHex,
    roughness: 0.35,
    metalness: 0.75,
    canCollide: true,
    spineControlPoints: [
      { point: [-1.32, 3.92, 1.88], radiusX: 0.12, radiusY: 0.12 },
      { point: [-0.55, 4.06, 2.18], radiusX: 0.11, radiusY: 0.11 },
      { point: [0.55, 4.06, 2.18], radiusX: 0.11, radiusY: 0.11 },
      { point: [1.32, 3.92, 1.88], radiusX: 0.12, radiusY: 0.12 },
    ],
  });

  // Faro delantero y Luz trasera
  components.push({
    id: 'vehicle_headlight',
    name: 'Headlight_Front',
    semanticRole: 'headlight_or_lamp',
    hierarchyPath: 'Root/Lighting_Exhaust',
    kernel: 'sculpted_icosphere_organ',
    position: [0, 3.45, 2.75],
    rotation: [0, 0, 0],
    size: [0.68, 0.68, 0.52],
    material: 'Neon',
    colorHex: pal.eyeHex,
    roughness: 0.12,
    metalness: 0.1,
    canCollide: false,
  });

  return {
    interpretation: interp,
    skeletonHierarchy,
    components,
  };
}

/**
 * Planificador anatómico para Estatuas Humanas y Figuras Bípedas (`human_statue` / `stylized_humanoid`):
 * - Pedestal de piedra escalonado en `Y = 0` (cuando es estatua), pelvis/cadera, torso anatómico
 *   con cintura y tórax/pecho, cuello, cabeza esculpida, 2 brazos articulados (hombro/brazo,
 *   antebrazo y mano) y 2 piernas articuladas (muslo, pantorrilla y pie).
 */
function planHumanoidOrStatueAnatomy(
  interp: SemanticObjectInterpretation,
  _rng: () => number
): FreeformGeometryPlan {
  const isStatue = interp.archetype === 'human_statue';
  const pal = interp.palette;
  const mat = isStatue ? 'Marble' : 'SmoothPlastic';
  const components: PlannedOrganComponent[] = [];
  const skeletonHierarchy = [
    'Root',
    ...(isStatue ? ['Root/Pedestal'] : []),
    'Root/Pelvis_Torso',
    'Root/Head_Neck',
    'Root/Arm_Left',
    'Root/Arm_Right',
    'Root/Leg_Left',
    'Root/Leg_Right',
  ];

  const baseOffsetY = isStatue ? 1.8 : 0.0;

  // 1. Pedestal Escalonado Clásico en `Y = 0` (si es estatua)
  if (isStatue) {
    components.push({
      id: 'statue_plinth_base',
      name: 'PedestalPlinth_Base',
      semanticRole: 'pedestal_plinth',
      hierarchyPath: 'Root/Pedestal',
      kernel: 'beveled_structural_frame',
      position: [0, 0.45, 0],
      rotation: [0, 0, 0],
      size: [3.8, 0.9, 3.8],
      material: 'Cobblestone',
      colorHex: pal.secondaryHex,
      roughness: 0.72,
      metalness: 0.08,
      canCollide: true,
    });

    components.push({
      id: 'statue_plinth_upper',
      name: 'PedestalColumn_Upper',
      semanticRole: 'pedestal_plinth',
      hierarchyPath: 'Root/Pedestal',
      kernel: 'beveled_structural_frame',
      position: [0, 1.35, 0],
      rotation: [0, 0, 0],
      size: [2.95, 0.9, 2.95],
      material: 'Marble',
      colorHex: pal.secondaryHex,
      roughness: 0.55,
      metalness: 0.1,
      canCollide: true,
    });
  }

  // 2. Dos Piernas Articuladas (`Thigh`, `Calf`, `Foot`)
  for (const side of [-1, 1] as const) {
    const sideLabel = side < 0 ? 'Left' : 'Right';
    const hipX = side * 0.58;
    const strideZ = side < 0 ? 0.18 : -0.14; // postura contrapposto clásica

    // Pie apoyado sobre el pedestal o suelo
    components.push({
      id: `human_foot_${sideLabel.toLowerCase()}`,
      name: `Foot_${sideLabel}`,
      semanticRole: 'hoof_or_paw',
      hierarchyPath: `Root/Leg_${sideLabel}`,
      kernel: 'spline_lofted_organ',
      position: [hipX, baseOffsetY + 0.22, strideZ + 0.22],
      rotation: [0, 0, 0],
      size: [0.54, 0.44, 0.98],
      material: mat,
      colorHex: pal.primaryHex,
      roughness: 0.42,
      metalness: 0.08,
      canCollide: true,
      spineControlPoints: [
        { point: [hipX, baseOffsetY + 0.0, strideZ + 0.35], radiusX: 0.27, radiusY: 0.46 },
        { point: [hipX, baseOffsetY + 0.22, strideZ + 0.18], radiusX: 0.25, radiusY: 0.42 },
        { point: [hipX, baseOffsetY + 0.44, strideZ], radiusX: 0.22, radiusY: 0.24 },
      ],
    });

    // Pantorrilla (`Calf_*`)
    components.push({
      id: `human_calf_${sideLabel.toLowerCase()}`,
      name: `CalfLeg_${sideLabel}`,
      semanticRole: 'limb_lower',
      hierarchyPath: `Root/Leg_${sideLabel}`,
      kernel: 'spline_lofted_organ',
      position: [hipX, baseOffsetY + 1.28, strideZ],
      rotation: [0, 0, 0],
      size: [0.64, 1.75, 0.68],
      material: mat,
      colorHex: pal.primaryHex,
      roughness: 0.42,
      metalness: 0.08,
      canCollide: true,
      spineControlPoints: [
        { point: [hipX, baseOffsetY + 0.42, strideZ], radiusX: 0.21, radiusY: 0.22 },
        { point: [hipX, baseOffsetY + 1.35, strideZ - 0.06], radiusX: 0.32, radiusY: 0.34 },
        { point: [hipX, baseOffsetY + 2.12, strideZ + 0.04], radiusX: 0.28, radiusY: 0.3 },
      ],
    });

    // Muslo (`Thigh_*`)
    components.push({
      id: `human_thigh_${sideLabel.toLowerCase()}`,
      name: `ThighLeg_${sideLabel}`,
      semanticRole: 'limb_upper',
      hierarchyPath: `Root/Leg_${sideLabel}`,
      kernel: 'spline_lofted_organ',
      position: [hipX, baseOffsetY + 2.98, strideZ * 0.5],
      rotation: [0, 0, 0],
      size: [0.82, 1.85, 0.86],
      material: mat,
      colorHex: pal.primaryHex,
      roughness: 0.42,
      metalness: 0.08,
      canCollide: true,
      spineControlPoints: [
        { point: [hipX, baseOffsetY + 2.1, strideZ + 0.04], radiusX: 0.29, radiusY: 0.31 },
        { point: [hipX, baseOffsetY + 2.98, strideZ * 0.5], radiusX: 0.41, radiusY: 0.43 },
        { point: [hipX, baseOffsetY + 3.85, 0], radiusX: 0.44, radiusY: 0.45 },
      ],
    });
  }

  // 3. Pelvis y Torso Anatómico Esculpido (`Torso_SculptedChest`)
  components.push({
    id: 'human_torso',
    name: 'Torso_SculptedChest',
    semanticRole: 'torso',
    hierarchyPath: 'Root/Pelvis_Torso',
    kernel: 'spline_lofted_organ',
    position: [0, baseOffsetY + 5.15, 0],
    rotation: [0, 0, 0],
    size: [2.25, 2.95, 1.35],
    material: mat,
    colorHex: pal.primaryHex,
    roughness: 0.4,
    metalness: 0.08,
    canCollide: true,
    spineControlPoints: [
      { point: [0, baseOffsetY + 3.72, 0], radiusX: 0.88, radiusY: 0.58 }, // Pelvis / cadera
      { point: [0, baseOffsetY + 4.55, 0.02], radiusX: 0.76, radiusY: 0.52 }, // Cintura
      { point: [0, baseOffsetY + 5.65, 0.08], radiusX: 1.12, radiusY: 0.68 }, // Pectorales / espalda alta
      { point: [0, baseOffsetY + 6.45, 0.0], radiusX: 0.92, radiusY: 0.52 }, // Hombros / clavícula
    ],
  });

  // 4. Cuello y Cabeza Humana Esculpida (`Head_SculptedCranium`)
  components.push({
    id: 'human_neck',
    name: 'Neck_Column',
    semanticRole: 'neck',
    hierarchyPath: 'Root/Head_Neck',
    kernel: 'spline_lofted_organ',
    position: [0, baseOffsetY + 6.72, 0.02],
    rotation: [0, 0, 0],
    size: [0.65, 0.68, 0.65],
    material: mat,
    colorHex: pal.primaryHex,
    roughness: 0.4,
    metalness: 0.08,
    canCollide: true,
    spineControlPoints: [
      { point: [0, baseOffsetY + 6.38, 0], radiusX: 0.34, radiusY: 0.34 },
      { point: [0, baseOffsetY + 7.02, 0.04], radiusX: 0.28, radiusY: 0.28 },
    ],
  });

  components.push({
    id: 'human_head',
    name: 'Head_SculptedCranium',
    semanticRole: 'head_cranium',
    hierarchyPath: 'Root/Head_Neck',
    kernel: 'spline_lofted_organ',
    position: [0, baseOffsetY + 7.68, 0.08],
    rotation: [0, 0, 0],
    size: [1.12, 1.42, 1.24],
    material: mat,
    colorHex: isStatue ? pal.primaryHex : pal.accentHex,
    roughness: 0.38,
    metalness: 0.08,
    canCollide: true,
    spineControlPoints: [
      { point: [0, baseOffsetY + 7.0, 0.14], radiusX: 0.36, radiusY: 0.42 }, // Mentón / mandíbula
      { point: [0, baseOffsetY + 7.55, 0.12], radiusX: 0.54, radiusY: 0.62 }, // Pómulos / rostro
      { point: [0, baseOffsetY + 8.15, 0.04], radiusX: 0.56, radiusY: 0.6 }, // Bóveda craneal
      { point: [0, baseOffsetY + 8.38, 0.0], radiusX: 0.32, radiusY: 0.34 }, // Coronilla
    ],
  });

  // 5. Dos Brazos Articulados (`UpperArm`, `Forearm`, `Hand`)
  for (const side of [-1, 1] as const) {
    const sideLabel = side < 0 ? 'Left' : 'Right';
    const shoulderX = side * 1.22;
    const elbowX = side * 1.48;
    const handX = side * 1.36;
    const handY = side < 0 ? baseOffsetY + 4.35 : baseOffsetY + 4.85; // postura expresiva asimétrica natural
    const handZ = side < 0 ? 0.32 : 0.68;

    components.push({
      id: `human_upper_arm_${sideLabel.toLowerCase()}`,
      name: `UpperArm_${sideLabel}`,
      semanticRole: 'arm_upper',
      hierarchyPath: `Root/Arm_${sideLabel}`,
      kernel: 'spline_lofted_organ',
      position: [round4((shoulderX + elbowX) * 0.5), baseOffsetY + 5.75, 0.06],
      rotation: [0, 0, 0],
      size: [0.68, 1.48, 0.68],
      material: mat,
      colorHex: pal.primaryHex,
      roughness: 0.42,
      metalness: 0.08,
      canCollide: true,
      spineControlPoints: [
        { point: [shoulderX, baseOffsetY + 6.32, 0], radiusX: 0.34, radiusY: 0.34 },
        { point: [(shoulderX + elbowX) * 0.5, baseOffsetY + 5.75, 0.05], radiusX: 0.28, radiusY: 0.28 },
        { point: [elbowX, baseOffsetY + 5.15, 0.12], radiusX: 0.24, radiusY: 0.24 },
      ],
    });

    components.push({
      id: `human_forearm_${sideLabel.toLowerCase()}`,
      name: `Forearm_${sideLabel}`,
      semanticRole: 'arm_forearm',
      hierarchyPath: `Root/Arm_${sideLabel}`,
      kernel: 'spline_lofted_organ',
      position: [round4((elbowX + handX) * 0.5), round4((baseOffsetY + 5.15 + handY) * 0.5), round4((0.12 + handZ) * 0.5)],
      rotation: [0, 0, 0],
      size: [0.58, 1.25, 0.72],
      material: mat,
      colorHex: pal.primaryHex,
      roughness: 0.42,
      metalness: 0.08,
      canCollide: true,
      spineControlPoints: [
        { point: [elbowX, baseOffsetY + 5.15, 0.12], radiusX: 0.24, radiusY: 0.24 },
        { point: [handX, handY, handZ], radiusX: 0.18, radiusY: 0.18 },
      ],
    });

    components.push({
      id: `human_hand_${sideLabel.toLowerCase()}`,
      name: `SculptedHand_${sideLabel}`,
      semanticRole: 'hand',
      hierarchyPath: `Root/Arm_${sideLabel}`,
      kernel: 'sculpted_icosphere_organ',
      position: [handX, round4(handY - 0.16), round4(handZ + 0.12)],
      rotation: [0, 0, 0],
      size: [0.36, 0.44, 0.42],
      material: mat,
      colorHex: isStatue ? pal.primaryHex : pal.accentHex,
      roughness: 0.4,
      metalness: 0.08,
      canCollide: false,
    });
  }

  return {
    interpretation: interp,
    skeletonHierarchy,
    components,
  };
}

/**
 * Planificador compuesto universal para cualquier otro objeto libre no catalogado,
 * evitando colapsar en `chest_or_prop`.
 */
function planFreeformCompositeStructure(
  interp: SemanticObjectInterpretation,
  _rng: () => number
): FreeformGeometryPlan {
  const pal = interp.palette;
  const w = interp.proportionsStuds.widthX;
  const h = interp.proportionsStuds.heightY;
  const l = interp.proportionsStuds.lengthZ;

  const components: PlannedOrganComponent[] = [
    {
      id: 'freeform_foundation',
      name: 'FoundationSupport_Base',
      semanticRole: 'pedestal_plinth',
      hierarchyPath: 'Root/Foundation',
      kernel: 'beveled_structural_frame',
      position: [0, round4(h * 0.08), 0],
      rotation: [0, 0, 0],
      size: [round4(w * 0.82), round4(h * 0.16), round4(l * 0.82)],
      material: 'Slate',
      colorHex: pal.secondaryHex,
      roughness: 0.65,
      metalness: 0.25,
      canCollide: true,
    },
    {
      id: 'freeform_core_body',
      name: 'SculptedCore_Body',
      semanticRole: 'torso',
      hierarchyPath: 'Root/CoreBody',
      kernel: 'spline_lofted_organ',
      position: [0, round4(h * 0.52), 0],
      rotation: [0, 0, 0],
      size: [round4(w * 0.76), round4(h * 0.72), round4(l * 0.76)],
      material: 'SmoothPlastic',
      colorHex: pal.primaryHex,
      roughness: 0.48,
      metalness: 0.32,
      canCollide: true,
      spineControlPoints: [
        { point: [0, h * 0.15, -l * 0.28], radiusX: w * 0.34, radiusY: h * 0.22 },
        { point: [0, h * 0.48, 0], radiusX: w * 0.42, radiusY: h * 0.32 },
        { point: [0, h * 0.78, l * 0.22], radiusX: w * 0.28, radiusY: h * 0.24 },
      ],
    },
    {
      id: 'freeform_crest_crown',
      name: 'UpperCrest_Assembly',
      semanticRole: 'head_cranium',
      hierarchyPath: 'Root/UpperAssembly',
      kernel: 'spline_lofted_organ',
      position: [0, round4(h * 0.88), round4(l * 0.15)],
      rotation: [0, 0, 0],
      size: [round4(w * 0.48), round4(h * 0.26), round4(l * 0.48)],
      material: 'Metal',
      colorHex: pal.accentHex,
      roughness: 0.28,
      metalness: 0.75,
      canCollide: true,
      spineControlPoints: [
        { point: [0, h * 0.74, 0], radiusX: w * 0.24, radiusY: w * 0.24 },
        { point: [0, h * 0.96, l * 0.18], radiusX: w * 0.14, radiusY: w * 0.16 },
      ],
    },
  ];

  for (const side of [-1, 1] as const) {
    const sideLabel = side < 0 ? 'Left' : 'Right';
    components.push({
      id: `freeform_wing_arm_${sideLabel.toLowerCase()}`,
      name: `LateralAppendage_${sideLabel}`,
      semanticRole: 'arm_upper',
      hierarchyPath: 'Root/Appendages',
      kernel: 'spline_lofted_organ',
      position: [round4(side * w * 0.44), round4(h * 0.54), 0],
      rotation: [0, 0, 0],
      size: [round4(w * 0.32), round4(h * 0.42), round4(l * 0.38)],
      material: 'Metal',
      colorHex: pal.detailHex,
      roughness: 0.35,
      metalness: 0.65,
      canCollide: true,
      spineControlPoints: [
        { point: [side * w * 0.26, h * 0.48, -l * 0.08], radiusX: w * 0.14, radiusY: h * 0.14 },
        { point: [side * w * 0.52, h * 0.62, l * 0.12], radiusX: w * 0.09, radiusY: h * 0.1 },
      ],
    });
  }

  return {
    interpretation: interp,
    skeletonHierarchy: ['Root', 'Root/Foundation', 'Root/CoreBody', 'Root/UpperAssembly', 'Root/Appendages'],
    components,
  };
}

/**
 * ============================================================================
 * ETAPA C, D & E: GENERACIÓN DE MALLAS 3D REALES, TEXTURAS Y ADAPTACIÓN ROBLOX
 * ============================================================================
 */

function evaluateSpineCurvePoint(
  controlPoints: SpineControlPoint[],
  t: number
): {
  pos: [number, number, number];
  tangent: [number, number, number];
  radiusX: number;
  radiusY: number;
  dorsalVentralBias: number;
} {
  const n = controlPoints.length;
  if (n === 0) {
    return { pos: [0, 0, 0], tangent: [0, 0, 1], radiusX: 0.5, radiusY: 0.5, dorsalVentralBias: 1.0 };
  }
  if (n === 1) {
    const cp = controlPoints[0];
    return {
      pos: [...cp.point],
      tangent: [0, 0, 1],
      radiusX: cp.radiusX,
      radiusY: cp.radiusY,
      dorsalVentralBias: cp.dorsalVentralBias ?? 1.0,
    };
  }

  const scaled = clamp(t, 0, 1) * (n - 1);
  const segIdx = Math.min(n - 2, Math.floor(scaled));
  const localT = scaled - segIdx;

  const p0 = controlPoints[Math.max(0, segIdx - 1)];
  const p1 = controlPoints[segIdx];
  const p2 = controlPoints[segIdx + 1];
  const p3 = controlPoints[Math.min(n - 1, segIdx + 2)];

  // Interpolación Catmull-Rom cúbica suave para la espina 3D
  const t2 = localT * localT;
  const t3 = t2 * localT;

  const catmull = (v0: number, v1: number, v2: number, v3: number): number =>
    0.5 *
    (2 * v1 +
      (-v0 + v2) * localT +
      (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 +
      (-v0 + 3 * v1 - 3 * v2 + v3) * t3);

  const px = catmull(p0.point[0], p1.point[0], p2.point[0], p3.point[0]);
  const py = catmull(p0.point[1], p1.point[1], p2.point[1], p3.point[1]);
  const pz = catmull(p0.point[2], p1.point[2], p2.point[2], p3.point[2]);

  // Derivada tangente
  const dt = 0.02;
  const tNext = clamp(t + dt, 0, 1);
  const tPrev = clamp(t - dt, 0, 1);
  const sNext = tNext * (n - 1);
  const sPrev = tPrev * (n - 1);
  const idxNext = Math.min(n - 2, Math.floor(sNext));
  const idxPrev = Math.min(n - 2, Math.floor(sPrev));
  const uNext = sNext - idxNext;
  const uPrev = sPrev - idxPrev;

  const lerpPt = (a: SpineControlPoint, b: SpineControlPoint, u: number): [number, number, number] => [
    a.point[0] + (b.point[0] - a.point[0]) * u,
    a.point[1] + (b.point[1] - a.point[1]) * u,
    a.point[2] + (b.point[2] - a.point[2]) * u,
  ];
  const ptB = lerpPt(controlPoints[idxNext], controlPoints[idxNext + 1], uNext);
  const ptA = lerpPt(controlPoints[idxPrev], controlPoints[idxPrev + 1], uPrev);

  let tx = ptB[0] - ptA[0];
  let ty = ptB[1] - ptA[1];
  let tz = ptB[2] - ptA[2];
  const tLen = Math.hypot(tx, ty, tz);
  if (tLen > 1e-5) {
    tx /= tLen;
    ty /= tLen;
    tz /= tLen;
  } else {
    tx = 0;
    ty = 1;
    tz = 0;
  }

  // Interpolación coseno suave de radios y sesgo dorsoventral
  const smoothU = (1 - Math.cos(localT * Math.PI)) * 0.5;
  const radiusX = Math.max(0.03, p1.radiusX + (p2.radiusX - p1.radiusX) * smoothU);
  const radiusY = Math.max(0.03, p1.radiusY + (p2.radiusY - p1.radiusY) * smoothU);
  const b1 = p1.dorsalVentralBias ?? 1.0;
  const b2 = p2.dorsalVentralBias ?? 1.0;
  const dorsalVentralBias = b1 + (b2 - b1) * smoothU;

  return {
    pos: [px, py, pz],
    tangent: [tx, ty, tz],
    radiusX,
    radiusY,
    dorsalVentralBias,
  };
}

/**
 * Calcula marco ortonormal estable (Right, Up, Tangent) en cada punto de una curva 3D.
 */
function computeFrenetFrame(tangent: [number, number, number]): {
  right: [number, number, number];
  up: [number, number, number];
} {
  const [tx, ty, tz] = tangent;
  // Elegir vector auxiliar que no sea colineal con la tangente
  const ref: [number, number, number] = Math.abs(ty) < 0.88 ? [0, 1, 0] : [0, 0, 1];
  // right = normalize(cross(ref, tangent))
  let rx = ref[1] * tz - ref[2] * ty;
  let ry = ref[2] * tx - ref[0] * tz;
  let rz = ref[0] * ty - ref[1] * tx;
  const rLen = Math.hypot(rx, ry, rz) || 1;
  rx /= rLen;
  ry /= rLen;
  rz /= rLen;

  // up = normalize(cross(tangent, right))
  let ux = ty * rz - tz * ry;
  let uy = tz * rx - tx * rz;
  let uz = tx * ry - ty * rx;
  const uLen = Math.hypot(ux, uy, uz) || 1;
  ux /= uLen;
  uy /= uLen;
  uz /= uLen;

  return {
    right: [rx, ry, rz],
    up: [ux, uy, uz],
  };
}

function finalizeCenteredManifoldBuffer(
  rawVertices: [number, number, number][],
  rawUvs: [number, number][],
  rawFaces: [number, number, number][]
): {
  buffer: LodMeshBuffer;
  worldCenter: [number, number, number];
  spanSize: [number, number, number];
} {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;

  for (const [vx, vy, vz] of rawVertices) {
    if (vx < minX) minX = vx;
    if (vx > maxX) maxX = vx;
    if (vy < minY) minY = vy;
    if (vy > maxY) maxY = vy;
    if (vz < minZ) minZ = vz;
    if (vz > maxZ) maxZ = vz;
  }

  if (!Number.isFinite(minX)) {
    minX = -0.5;
    maxX = 0.5;
    minY = -0.5;
    maxY = 0.5;
    minZ = -0.5;
    maxZ = 0.5;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const spanX = round4(Math.max(0.18, maxX - minX));
  const spanY = round4(Math.max(0.18, maxY - minY));
  const spanZ = round4(Math.max(0.18, maxZ - minZ));

  const vertices: [number, number, number][] = rawVertices.map(([vx, vy, vz]) => [
    round4(vx - cx),
    round4(vy - cy),
    round4(vz - cz),
  ]);

  const vCount = vertices.length;
  const accumNormals: [number, number, number][] = Array.from({ length: vCount }, () => [0, 0, 0]);
  const validFaces: [number, number, number][] = [];

  for (const [i0, i1, i2] of rawFaces) {
    if (
      i0 === i1 ||
      i1 === i2 ||
      i0 === i2 ||
      i0 < 0 ||
      i1 < 0 ||
      i2 < 0 ||
      i0 >= vCount ||
      i1 >= vCount ||
      i2 >= vCount
    ) {
      continue;
    }
    const v0 = vertices[i0];
    const v1 = vertices[i1];
    const v2 = vertices[i2];
    const ax = v1[0] - v0[0];
    const ay = v1[1] - v0[1];
    const az = v1[2] - v0[2];
    const bx = v2[0] - v0[0];
    const by = v2[1] - v0[1];
    const bz = v2[2] - v0[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const area2 = Math.hypot(nx, ny, nz);
    if (area2 < 1e-7) continue;

    validFaces.push([i0, i1, i2]);
    accumNormals[i0][0] += nx;
    accumNormals[i0][1] += ny;
    accumNormals[i0][2] += nz;
    accumNormals[i1][0] += nx;
    accumNormals[i1][1] += ny;
    accumNormals[i1][2] += nz;
    accumNormals[i2][0] += nx;
    accumNormals[i2][1] += ny;
    accumNormals[i2][2] += nz;
  }

  const normals: [number, number, number][] = accumNormals.map(([nx, ny, nz], idx) => {
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-6) {
      return [round4(nx / len), round4(ny / len), round4(nz / len)];
    }
    const [vx, vy, vz] = vertices[idx];
    const vLen = Math.hypot(vx, vy, vz) || 1;
    return [round4(vx / vLen), round4(vy / vLen), round4(vz / vLen)];
  });

  const uvs: [number, number][] = vertices.map((_, idx) => {
    const uv = rawUvs[idx] || [0.5, 0.5];
    return [round4(clamp(uv[0], 0, 1)), round4(clamp(uv[1], 0, 1))];
  });

  const indices: number[] = [];
  for (const [f0, f1, f2] of validFaces) {
    indices.push(f0, f1, f2);
  }

  return {
    buffer: {
      vertices,
      normals,
      uvs,
      faces: validFaces,
      indices,
    },
    worldCenter: [round4(cx), round4(cy), round4(cz)],
    spanSize: [spanX, spanY, spanZ],
  };
}

function wrapMultiLodResult(
  modelName: string,
  builder: (lodFactor: number) => {
    buffer: LodMeshBuffer;
    worldCenter: [number, number, number];
    spanSize: [number, number, number];
  },
  activeLod: 0 | 1 | 2 = 0
): {
  meshData: SpecializedMeshData;
  worldCenter: [number, number, number];
  spanSize: [number, number, number];
} {
  const res0 = builder(1.0);
  const res1 = builder(0.64);
  const res2 = builder(0.42);
  const baseTris = Math.max(1, res0.buffer.faces.length);

  const lodLevels: [LodLevelDescriptor, LodLevelDescriptor, LodLevelDescriptor] = [
    {
      level: 0,
      ratio: 1.0,
      vertexCount: res0.buffer.vertices.length,
      triangleCount: res0.buffer.faces.length,
      ...res0.buffer,
    },
    {
      level: 1,
      ratio: round4(res1.buffer.faces.length / baseTris),
      vertexCount: res1.buffer.vertices.length,
      triangleCount: res1.buffer.faces.length,
      ...res1.buffer,
    },
    {
      level: 2,
      ratio: round4(res2.buffer.faces.length / baseTris),
      vertexCount: res2.buffer.vertices.length,
      triangleCount: res2.buffer.faces.length,
      ...res2.buffer,
    },
  ];

  const chosen = lodLevels[activeLod] || lodLevels[0];
  return {
    meshData: {
      vertices: chosen.vertices,
      normals: chosen.normals,
      uvs: chosen.uvs,
      faces: chosen.faces,
      indices: chosen.indices,
      objFileName: `${modelName}.obj`,
      meshId: null,
      assetId: null,
      geometrySource: 'EditableMeshBuffers',
      activeLod,
      lodLevels,
    },
    worldCenter: res0.worldCenter,
    spanSize: res0.spanSize,
  };
}

/**
 * Kernel 1: Generador de Órganos Anatómicos por Lofting de Splines 3D (`buildSplineLoftedOrganMesh`).
 * Construye una malla cerrada barriendo secciones transversales moduladas a lo largo de una curva 3D.
 */
export function buildSplineLoftedOrganMesh(options: {
  modelName: string;
  controlPoints: SpineControlPoint[];
  radialSegments: number;
  lengthSegments: number;
  isClovenHoof?: boolean;
  activeLod?: 0 | 1 | 2;
}): {
  meshData: SpecializedMeshData;
  worldCenter: [number, number, number];
  spanSize: [number, number, number];
} {
  const { modelName, controlPoints, radialSegments, lengthSegments, isClovenHoof = false, activeLod = 0 } = options;

  return wrapMultiLodResult(
    modelName,
    (lodFactor) => {
      const rSegs = Math.max(6, Math.round(radialSegments * lodFactor));
      const lSegs = Math.max(4, Math.round(lengthSegments * lodFactor));
      const vertices: [number, number, number][] = [];
      const uvs: [number, number][] = [];
      const faces: [number, number, number][] = [];

      for (let i = 0; i <= lSegs; i++) {
        const u = i / lSegs;
        const evalPt = evaluateSpineCurvePoint(controlPoints, u);
        const { right, up } = computeFrenetFrame(evalPt.tangent);
        // Perfil redondeado en los extremos (domo orgánico suave en u=0 y u=1)
        const endCapFactor =
          u < 0.08 ? Math.sin((u / 0.08) * (Math.PI * 0.5)) * 0.65 + 0.35 : u > 0.92 ? Math.sin(((1 - u) / 0.08) * (Math.PI * 0.5)) * 0.65 + 0.35 : 1.0;

        for (let r = 0; r < rSegs; r++) {
          const v = r / rSegs;
          const theta = v * Math.PI * 2;
          const cosT = Math.cos(theta);
          const sinT = Math.sin(theta);

          // Modulación dorsoventral anatómica (por ejemplo, barriga más ancha abajo o lomo muscular arriba)
          const dvMod = sinT >= 0 ? evalPt.dorsalVentralBias : 2.0 - evalPt.dorsalVentralBias;
          // Hendidura anterior para pezuñas hendidas bovinas (`isClovenHoof`)
          const cleftIndent =
            isClovenHoof && u < 0.65 && Math.abs(cosT) < 0.28 && sinT > 0
              ? 0.74
              : 1.0;

          const localX = cosT * evalPt.radiusX * endCapFactor * clamp(dvMod, 0.72, 1.32) * cleftIndent;
          const localY = sinT * evalPt.radiusY * endCapFactor;

          const wx = evalPt.pos[0] + right[0] * localX + up[0] * localY;
          const wy = evalPt.pos[1] + right[1] * localX + up[1] * localY;
          const wz = evalPt.pos[2] + right[2] * localX + up[2] * localY;

          vertices.push([wx, wy, wz]);
          uvs.push([u, v]);
        }
      }

      for (let i = 0; i < lSegs; i++) {
        const rowA = i * rSegs;
        const rowB = (i + 1) * rSegs;
        for (let r = 0; r < rSegs; r++) {
          const next = (r + 1) % rSegs;
          faces.push([rowA + r, rowB + r, rowB + next]);
          faces.push([rowA + r, rowB + next, rowA + next]);
        }
      }

      // Tapas manifold en ambos extremos de la espina
      const startEval = evaluateSpineCurvePoint(controlPoints, 0);
      const endEval = evaluateSpineCurvePoint(controlPoints, 1);
      const startCenterIdx = vertices.length;
      vertices.push([
        startEval.pos[0] - startEval.tangent[0] * startEval.radiusX * 0.18,
        startEval.pos[1] - startEval.tangent[1] * startEval.radiusY * 0.18,
        startEval.pos[2] - startEval.tangent[2] * startEval.radiusX * 0.18,
      ]);
      uvs.push([0, 0.5]);

      const endCenterIdx = vertices.length;
      vertices.push([
        endEval.pos[0] + endEval.tangent[0] * endEval.radiusX * 0.18,
        endEval.pos[1] + endEval.tangent[1] * endEval.radiusY * 0.18,
        endEval.pos[2] + endEval.tangent[2] * endEval.radiusX * 0.18,
      ]);
      uvs.push([1, 0.5]);

      const lastRow = lSegs * rSegs;
      for (let r = 0; r < rSegs; r++) {
        const next = (r + 1) % rSegs;
        faces.push([startCenterIdx, next, r]);
        faces.push([endCenterIdx, lastRow + r, lastRow + next]);
      }

      return finalizeCenteredManifoldBuffer(vertices, uvs, faces);
    },
    activeLod
  );
}

/**
 * Kernel 2: Parches Conformales 3D sobre la Superficie del Torso (`buildConformalSurfaceSpotMesh`).
 * Crea manchas orgánicas (como las manchas negras de una vaca Holstein) que siguen exactamente
 * la curvatura 3D del torso sin atravesarlo ni flotar lejos de la piel.
 */
export function buildConformalSurfaceSpotMesh(options: {
  modelName: string;
  torsoSpine: SpineControlPoint[];
  uCenter: number;
  thetaCenter: number;
  uSpan: number;
  thetaSpan: number;
  normalOffset: number;
  gridSegs: number;
  activeLod?: 0 | 1 | 2;
}): {
  meshData: SpecializedMeshData;
  worldCenter: [number, number, number];
  spanSize: [number, number, number];
} {
  const { modelName, torsoSpine, uCenter, thetaCenter, uSpan, thetaSpan, normalOffset, gridSegs, activeLod = 0 } =
    options;

  return wrapMultiLodResult(
    modelName,
    (lodFactor) => {
      const segs = Math.max(4, Math.round(gridSegs * lodFactor));
      const vertices: [number, number, number][] = [];
      const uvs: [number, number][] = [];
      const faces: [number, number, number][] = [];

      // Capa exterior e interior delgada para que el parche sea un sólido manifold cerrado compatible con Roblox
      const thickness = 0.032;

      for (let layer = 0; layer < 2; layer++) {
        const layerOffset = layer === 0 ? normalOffset : normalOffset - thickness;
        for (let iu = 0; iu <= segs; iu++) {
          const nu = (iu / segs) * 2 - 1; // [-1, 1]
          for (let iv = 0; iv <= segs; iv++) {
            const nv = (iv / segs) * 2 - 1; // [-1, 1]
            // Contorno lobulado orgánico de mancha bovina
            const angle = Math.atan2(nv, nu);
            const lobeMod = 1.0 + 0.18 * Math.sin(angle * 3 + uCenter * 9) + 0.1 * Math.cos(angle * 5);
            const u = clamp(uCenter + nu * uSpan * 0.5 * lobeMod, 0.08, 0.92);
            const theta = thetaCenter + nv * thetaSpan * 0.5 * lobeMod;

            const evalPt = evaluateSpineCurvePoint(torsoSpine, u);
            const { right, up } = computeFrenetFrame(evalPt.tangent);
            const cosT = Math.cos(theta);
            const sinT = Math.sin(theta);
            const dvMod = sinT >= 0 ? evalPt.dorsalVentralBias : 2.0 - evalPt.dorsalVentralBias;

            const rx = evalPt.radiusX * clamp(dvMod, 0.72, 1.32) + layerOffset;
            const ry = evalPt.radiusY + layerOffset;
            const localX = cosT * rx;
            const localY = sinT * ry;

            const wx = evalPt.pos[0] + right[0] * localX + up[0] * localY;
            const wy = evalPt.pos[1] + right[1] * localX + up[1] * localY;
            const wz = evalPt.pos[2] + right[2] * localX + up[2] * localY;

            vertices.push([wx, wy, wz]);
            uvs.push([iu / segs, iv / segs]);
          }
        }
      }

      const stride = segs + 1;
      const layerSize = stride * stride;

      for (let iu = 0; iu < segs; iu++) {
        for (let iv = 0; iv < segs; iv++) {
          const a = iu * stride + iv;
          const b = (iu + 1) * stride + iv;
          const c = (iu + 1) * stride + (iv + 1);
          const d = iu * stride + (iv + 1);
          // Cara exterior
          faces.push([a, b, c]);
          faces.push([a, c, d]);
          // Cara interior
          const ia = layerSize + a;
          const ib = layerSize + b;
          const ic = layerSize + c;
          const id = layerSize + d;
          faces.push([ia, ic, ib]);
          faces.push([ia, id, ic]);
        }
      }

      return finalizeCenteredManifoldBuffer(vertices, uvs, faces);
    },
    activeLod
  );
}

/**
 * Kernel 3: Rueda Toroidal 3D con Neumático y Radios (`buildToroidalWheelMesh`).
 */
export function buildToroidalWheelMesh(options: {
  modelName: string;
  center: [number, number, number];
  size: [number, number, number];
  tubeRadiusRatio: number;
  radialSegments: number;
  tubularSegments: number;
  activeLod?: 0 | 1 | 2;
}): {
  meshData: SpecializedMeshData;
  worldCenter: [number, number, number];
  spanSize: [number, number, number];
} {
  const { modelName, center, size, tubeRadiusRatio, radialSegments, tubularSegments, activeLod = 0 } = options;

  return wrapMultiLodResult(
    modelName,
    (lodFactor) => {
      const majSegs = Math.max(8, Math.round(radialSegments * lodFactor));
      const minSegs = Math.max(6, Math.round(tubularSegments * lodFactor));
      const outerR = size[1] * 0.5;
      const tubeR = outerR * clamp(tubeRadiusRatio, 0.14, 0.42);
      const majorR = outerR - tubeR;
      const halfWidthX = size[0] * 0.5;

      const vertices: [number, number, number][] = [];
      const uvs: [number, number][] = [];
      const faces: [number, number, number][] = [];

      // Toroide en el plano YZ (eje de rotación en X)
      for (let i = 0; i < majSegs; i++) {
        const u = i / majSegs;
        const theta = u * Math.PI * 2;
        const cosMaj = Math.cos(theta);
        const sinMaj = Math.sin(theta);

        for (let j = 0; j < minSegs; j++) {
          const v = j / minSegs;
          const phi = v * Math.PI * 2;
          const cosMin = Math.cos(phi);
          const sinMin = Math.sin(phi);

          const rDist = majorR + tubeR * cosMin;
          const wx = center[0] + sinMin * halfWidthX;
          const wy = center[1] + sinMaj * rDist;
          const wz = center[2] + cosMaj * rDist;

          vertices.push([wx, wy, wz]);
          uvs.push([u, v]);
        }
      }

      for (let i = 0; i < majSegs; i++) {
        const nextI = (i + 1) % majSegs;
        for (let j = 0; j < minSegs; j++) {
          const nextJ = (j + 1) % minSegs;
          const a = i * minSegs + j;
          const b = nextI * minSegs + j;
          const c = nextI * minSegs + nextJ;
          const d = i * minSegs + nextJ;
          faces.push([a, b, c]);
          faces.push([a, c, d]);
        }
      }

      return finalizeCenteredManifoldBuffer(vertices, uvs, faces);
    },
    activeLod
  );
}

/**
 * Kernel 4: Membrana Alar Curvada Articulada para Dragones y Criaturas Aladas (`buildCamberedWingMembraneMesh`).
 */
export function buildCamberedWingMembraneMesh(options: {
  modelName: string;
  center: [number, number, number];
  size: [number, number, number];
  side: -1 | 1;
  camberDepth: number;
  spanSegments: number;
  chordSegments: number;
  activeLod?: 0 | 1 | 2;
}): {
  meshData: SpecializedMeshData;
  worldCenter: [number, number, number];
  spanSize: [number, number, number];
} {
  const { modelName, center, size, side, camberDepth, spanSegments, chordSegments, activeLod = 0 } = options;

  return wrapMultiLodResult(
    modelName,
    (lodFactor) => {
      const sSegs = Math.max(5, Math.round(spanSegments * lodFactor));
      const cSegs = Math.max(4, Math.round(chordSegments * lodFactor));
      const vertices: [number, number, number][] = [];
      const uvs: [number, number][] = [];
      const faces: [number, number, number][] = [];

      const spanW = size[0];
      const heightH = size[1];
      const chordZ = size[2];

      for (let layer = 0; layer < 2; layer++) {
        const yThick = layer === 0 ? 0.08 : -0.08;
        for (let is = 0; is <= sSegs; is++) {
          const u = is / sSegs; // 0 = hombro junto al torso, 1 = punta del ala
          // Arco del borde de ataque del ala (sube desde el hombro y luego se extiende lateralmente)
          const archY = Math.sin(u * Math.PI * 0.78) * heightH * 0.55 - u * heightH * 0.15;
          const localChord = chordZ * (1.0 - u * 0.52);

          for (let ic = 0; ic <= cSegs; ic++) {
            const v = ic / cSegs; // 0 = borde de ataque delantero, 1 = membrana trasera festoneada
            const camberY = Math.sin(v * Math.PI) * camberDepth * (1 - u * 0.4);
            const scallopZ = v > 0.75 ? Math.sin(u * Math.PI * 3) * 0.35 * v : 0;

            const wx = center[0] - side * spanW * 0.38 + side * u * spanW;
            const wy = center[1] - heightH * 0.2 + archY + camberY + yThick * (1 - v * 0.5);
            const wz = center[2] + chordZ * 0.35 - v * localChord + scallopZ;

            vertices.push([wx, wy, wz]);
            uvs.push([u, v]);
          }
        }
      }

      const stride = cSegs + 1;
      const layerCount = (sSegs + 1) * stride;

      for (let is = 0; is < sSegs; is++) {
        for (let ic = 0; ic < cSegs; ic++) {
          const a = is * stride + ic;
          const b = (is + 1) * stride + ic;
          const c = (is + 1) * stride + (ic + 1);
          const d = is * stride + (ic + 1);
          faces.push([a, b, c]);
          faces.push([a, c, d]);

          const ia = layerCount + a;
          const ib = layerCount + b;
          const ic2 = layerCount + c;
          const id = layerCount + d;
          faces.push([ia, ic2, ib]);
          faces.push([ia, id, ic2]);
        }
      }

      return finalizeCenteredManifoldBuffer(vertices, uvs, faces);
    },
    activeLod
  );
}

/**
 * Kernel 5: Esfera / Órgano Esculpido Subdividido (`buildSculptedOrganMesh`) para ojos, articulaciones y manos.
 */
function buildSculptedOrganMesh(options: {
  modelName: string;
  center: [number, number, number];
  size: [number, number, number];
  rings: number;
  segments: number;
  isStructuralBevel?: boolean;
  activeLod?: 0 | 1 | 2;
}): {
  meshData: SpecializedMeshData;
  worldCenter: [number, number, number];
  spanSize: [number, number, number];
} {
  const { modelName, center, size, rings, segments, isStructuralBevel = false, activeLod = 0 } = options;

  return wrapMultiLodResult(
    modelName,
    (lodFactor) => {
      const rSegs = Math.max(6, Math.round(segments * lodFactor));
      const hRings = Math.max(4, Math.round(rings * lodFactor));
      const vertices: [number, number, number][] = [];
      const uvs: [number, number][] = [];
      const faces: [number, number, number][] = [];

      const rx = size[0] * 0.5;
      const ry = size[1] * 0.5;
      const rz = size[2] * 0.5;

      for (let h = 0; h <= hRings; h++) {
        const v = h / hRings;
        const phi = v * Math.PI;
        const sinPhi = Math.sin(phi);
        const cosPhi = Math.cos(phi);

        for (let r = 0; r < rSegs; r++) {
          const u = r / rSegs;
          const theta = u * Math.PI * 2;
          let ux = Math.cos(theta) * sinPhi;
          let uy = -cosPhi;
          let uz = Math.sin(theta) * sinPhi;

          if (isStructuralBevel) {
            // Superelipsoide biselado para bloques de motor y pedestales de piedra
            const p = 0.42;
            ux = Math.sign(ux) * Math.pow(Math.abs(ux), p);
            uy = Math.sign(uy) * Math.pow(Math.abs(uy), p);
            uz = Math.sign(uz) * Math.pow(Math.abs(uz), p);
          }

          vertices.push([center[0] + ux * rx, center[1] + uy * ry, center[2] + uz * rz]);
          uvs.push([u, v]);
        }
      }

      for (let h = 0; h < hRings; h++) {
        const rowA = h * rSegs;
        const rowB = (h + 1) * rSegs;
        for (let r = 0; r < rSegs; r++) {
          const next = (r + 1) % rSegs;
          faces.push([rowA + r, rowB + r, rowB + next]);
          faces.push([rowA + r, rowB + next, rowA + next]);
        }
      }

      return finalizeCenteredManifoldBuffer(vertices, uvs, faces);
    },
    activeLod
  );
}

/**
 * Ejecuta las Etapas C, D y E sobre un `FreeformGeometryPlan` para producir piezas 3D
 * completas, centradas, asentadas en `Y = 0` y listas para Roblox Studio.
 */
export function generateReal3DMeshesFromPlan(params: {
  modelName: string;
  plan: FreeformGeometryPlan;
  budget: BudgetAllocationProfile;
  collisionFidelity?: 'Hull' | 'Box' | 'PreciseConvexDecomposition';
  activeLod?: 0 | 1 | 2;
}): SpecializedPartSpec[] {
  const { modelName, plan, budget, collisionFidelity = 'Hull', activeLod = 0 } = params;
  const parts: SpecializedPartSpec[] = [];

  const primaryRad = clamp(budget.radialSegmentsPrimary, 8, 22);
  const primaryLen = clamp(budget.heightSegmentsPrimary, 6, 16);
  const secondaryRad = clamp(budget.radialSegmentsSecondary, 6, 16);
  const secondaryLen = clamp(budget.heightSegmentsSecondary, 4, 12);

  plan.components.forEach((comp, idx) => {
    let built: {
      meshData: SpecializedMeshData;
      worldCenter: [number, number, number];
      spanSize: [number, number, number];
    };

    if (comp.kernel === 'spline_lofted_organ' && comp.spineControlPoints && comp.spineControlPoints.length >= 2) {
      const isMajor =
        comp.semanticRole === 'torso' ||
        comp.semanticRole === 'neck' ||
        comp.semanticRole === 'head_cranium' ||
        comp.semanticRole === 'fuel_tank_or_body';
      built = buildSplineLoftedOrganMesh({
        modelName,
        controlPoints: comp.spineControlPoints,
        radialSegments: isMajor ? primaryRad : secondaryRad,
        lengthSegments: isMajor ? primaryLen : secondaryLen,
        isClovenHoof:
          comp.semanticRole === 'hoof_or_paw' && plan.interpretation.archetype === 'bovine_cow',
        activeLod,
      });
    } else if (
      comp.kernel === 'conformal_spot_patch' &&
      comp.spineControlPoints &&
      comp.spotPatchParams
    ) {
      built = buildConformalSurfaceSpotMesh({
        modelName,
        torsoSpine: comp.spineControlPoints,
        uCenter: comp.spotPatchParams.uCenter,
        thetaCenter: comp.spotPatchParams.thetaCenter,
        uSpan: comp.spotPatchParams.uSpan,
        thetaSpan: comp.spotPatchParams.thetaSpan,
        normalOffset: comp.spotPatchParams.normalOffset,
        gridSegs: clamp(Math.round(secondaryLen * 0.9), 4, 9),
        activeLod,
      });
    } else if (comp.kernel === 'toroidal_wheel' && comp.wheelParams) {
      built = buildToroidalWheelMesh({
        modelName,
        center: comp.position,
        size: comp.size,
        tubeRadiusRatio: comp.wheelParams.tubeRadiusRatio,
        radialSegments: Math.max(12, primaryRad),
        tubularSegments: Math.max(8, secondaryRad),
        activeLod,
      });
    } else if (comp.kernel === 'cambered_wing_membrane' && comp.wingParams) {
      built = buildCamberedWingMembraneMesh({
        modelName,
        center: comp.position,
        size: comp.size,
        side: comp.wingParams.side,
        camberDepth: comp.wingParams.camberDepth,
        spanSegments: Math.max(6, primaryLen),
        chordSegments: Math.max(5, secondaryLen),
        activeLod,
      });
    } else {
      built = buildSculptedOrganMesh({
        modelName,
        center: comp.position,
        size: comp.size,
        rings: Math.max(5, secondaryLen),
        segments: Math.max(8, secondaryRad),
        isStructuralBevel: comp.kernel === 'beveled_structural_frame',
        activeLod,
      });
    }

    const pathTokens = comp.hierarchyPath.split('/').filter(Boolean);
    const parentName = pathTokens[pathTokens.length - 1] || 'Root';

    parts.push({
      partId: `part_${idx + 1}_${comp.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      name: comp.name,
      parentId: 'root',
      parentName,
      parentPath: comp.hierarchyPath,
      parentContainerClass: 'Model',
      hierarchyPath: `${comp.hierarchyPath}/${comp.name}`,
      shape: 'MeshPart',
      size: built.spanSize,
      position: built.worldCenter,
      rotation: comp.rotation,
      color: comp.colorHex,
      colorRgb255: hexToRgb255Tuple(comp.colorHex),
      colorSpace: 'rgb8',
      material: comp.material,
      roughness: comp.roughness,
      metalness: comp.metalness,
      reflectance: comp.reflectance ?? 0.04,
      transparency: comp.transparency ?? 0,
      anchored: true,
      canCollide: comp.canCollide,
      collisionFidelity,
      meshId: null,
      assetId: null,
      meshData: built.meshData,
    });
  });

  // Etapa E: Asentar todo el modelo exactamente en Y = 0
  let minY = Infinity;
  for (const p of parts) {
    const py = p.position[1];
    for (const v of p.meshData.vertices) {
      const wy = py + v[1];
      if (wy < minY) minY = wy;
    }
  }
  const shiftY = Number.isFinite(minY) ? -minY : 0;

  return parts.map((p) => ({
    ...p,
    position: [p.position[0], round4(p.position[1] + shiftY), p.position[2]],
  }));
}

/**
 * ============================================================================
 * SECCIÓN 7: BENCHMARK DE IDENTIDAD VISUAL Y SEMÁNTICA 3D (`evaluateSemanticVisualIdentity`)
 * ============================================================================
 * Evalúa la distribución espacial real de los vértices 3D, las proporciones anatómicas/estructurales
 * y los rasgos requeridos por el prompt, en lugar de limitarse a comprobar si una pieza se llama "Legs".
 */
export function evaluateSemanticVisualIdentity(params: {
  prompt: string;
  parts: any[];
  interpretation?: SemanticObjectInterpretation;
}): SemanticVisualIdentityEvaluation {
  const interp = params.interpretation || interpretPromptSemantics({ prompt: params.prompt });
  const parts = Array.isArray(params.parts) ? params.parts : [];

  let totalVertices = 0;
  let totalTriangles = 0;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;

  const worldVerts: Array<{ x: number; y: number; z: number; partName: string; color: string }> = [];
  const uniqueColors = new Set<string>();

  for (const p of parts) {
    const px = Number(p.position?.[0] ?? 0);
    const py = Number(p.position?.[1] ?? 0);
    const pz = Number(p.position?.[2] ?? 0);
    const pName = String(p.name || 'Part');
    const pColor = String(p.color || '#808080').toLowerCase();
    uniqueColors.add(pColor);

    const verts: [number, number, number][] = Array.isArray(p.meshData?.vertices) ? p.meshData.vertices : [];
    const faces: [number, number, number][] = Array.isArray(p.meshData?.faces) ? p.meshData.faces : [];
    totalVertices += verts.length;
    totalTriangles += faces.length;

    for (const v of verts) {
      const wx = px + Number(v[0] ?? 0);
      const wy = py + Number(v[1] ?? 0);
      const wz = pz + Number(v[2] ?? 0);
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
      worldVerts.push({ x: wx, y: wy, z: wz, partName: pName, color: pColor });
    }
  }

  if (!Number.isFinite(minY)) {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 0;
  }

  const widthX = round4(Math.max(0, maxX - minX));
  const heightY = round4(Math.max(0, maxY - minY));
  const lengthZ = round4(Math.max(0, maxZ - minZ));
  const avgVerticesPerPart = parts.length > 0 ? round4(totalVertices / parts.length) : 0;
  const groundedAtYZero = Math.abs(minY) <= 0.08;

  // 1. Verificar apoyo en 4 cuadrantes independientes cerca de Y=0 para cuadrúpedos
  const groundThresholdY = minY + Math.max(0.55, heightY * 0.12);
  let qFrontLeft = 0;
  let qFrontRight = 0;
  let qRearLeft = 0;
  let qRearRight = 0;
  for (const wv of worldVerts) {
    if (wv.y <= groundThresholdY) {
      if (wv.x < -0.15 && wv.z > 0.25) qFrontLeft++;
      if (wv.x > 0.15 && wv.z > 0.25) qFrontRight++;
      if (wv.x < -0.15 && wv.z < -0.25) qRearLeft++;
      if (wv.x > 0.15 && wv.z < -0.25) qRearRight++;
    }
  }

  const requiresFourQuadrants =
    interp.locomotionMode === 'quadruped_4_limbs' || interp.locomotionMode === 'winged_quadruped';
  const hasFourQuadrantGroundSupport = requiresFourQuadrants
    ? qFrontLeft >= 4 && qFrontRight >= 4 && qRearLeft >= 4 && qRearRight >= 4
    : worldVerts.some((wv) => wv.y <= groundThresholdY);

  // 2. Verificar perfil longitudinal cráneo-caudal (Z > X para cuadrúpedos y motocicletas)
  const hasCranialCaudalProfile =
    interp.taxonomy === 'quadruped_animal' || interp.taxonomy === 'wheeled_vehicle'
      ? lengthZ > widthX * 1.15
      : heightY > 1.5 && widthX > 1.2;

  // 3. Verificar simetría bilateral de la nube de vértices respecto a X = 0
  let leftCount = 0;
  let rightCount = 0;
  for (const wv of worldVerts) {
    if (wv.x < -0.05) leftCount++;
    else if (wv.x > 0.05) rightCount++;
  }
  const symRatio =
    Math.max(leftCount, rightCount) > 0
      ? Math.min(leftCount, rightCount) / Math.max(leftCount, rightCount)
      : 1.0;
  const hasBilateralSymmetry = symRatio >= 0.72;

  // 4. Verificar que no es un conjunto de cajas o esferas primitivas simples
  const hasNonPrimitiveOrganicComplexity =
    parts.length >= 8 && avgVerticesPerPart >= 28 && totalTriangles >= 320;

  // 5. Verificar variedad cromática/material (por ejemplo, manchas blancas y negras + hocico rosado en la vaca)
  const hasDistinctColorMaterials = uniqueColors.size >= 2;

  // 6. Evaluar cobertura de rasgos semánticos solicitados
  const allNamesCombined = parts.map((p) => `${p.name} ${p.hierarchyPath || ''}`).join(' ').toLowerCase();
  const satisfiedFeatures: string[] = [];
  const missingFeatures: string[] = [];

  for (const feat of interp.requiredSemanticFeatures) {
    let ok = false;
    if (feat.includes('torso')) {
      ok = /torso|body|chest|core|canopy|trunk|facade|wall/i.test(allNamesCombined);
    } else if (feat.includes('cuatro_patas')) {
      ok =
        hasFourQuadrantGroundSupport &&
        /frontleft/i.test(allNamesCombined) &&
        /frontright/i.test(allNamesCombined) &&
        /rearleft/i.test(allNamesCombined) &&
        /rearright/i.test(allNamesCombined);
    } else if (feat.includes('cuello')) {
      ok = /neck/i.test(allNamesCombined);
    } else if (feat.includes('cabeza')) {
      ok = /head|skull|cranium/i.test(allNamesCombined);
    } else if (feat.includes('hocico') || feat.includes('mandibula')) {
      ok = /snout|muzzle|jaw/i.test(allNamesCombined);
    } else if (feat.includes('orejas')) {
      ok = /ear_left/i.test(allNamesCombined) && /ear_right/i.test(allNamesCombined);
    } else if (feat.includes('cuernos')) {
      ok = /horn_left/i.test(allNamesCombined) && /horn_right/i.test(allNamesCombined);
    } else if (feat.includes('ojos')) {
      ok = /eye_left/i.test(allNamesCombined) && /eye_right/i.test(allNamesCombined);
    } else if (feat.includes('pezunas') || feat.includes('cascos') || feat.includes('garras')) {
      ok = /hoof|claw|paw/i.test(allNamesCombined);
    } else if (feat.includes('cola')) {
      ok = /tail/i.test(allNamesCombined);
    } else if (feat.includes('ubre')) {
      ok = /udder/i.test(allNamesCombined);
    } else if (feat.includes('manchas')) {
      ok = /coatspotpatch/i.test(allNamesCombined) && uniqueColors.size >= 3;
    } else if (feat.includes('alas')) {
      ok = /wingmembrane_left/i.test(allNamesCombined) && /wingmembrane_right/i.test(allNamesCombined);
    } else if (feat.includes('ruedas')) {
      ok = /wheeltire_front/i.test(allNamesCombined) && /wheeltire_rear/i.test(allNamesCombined);
    } else if (feat.includes('brazos')) {
      ok = /upperarm_left/i.test(allNamesCombined) && /upperarm_right/i.test(allNamesCombined);
    } else if (feat.includes('piernas')) {
      ok = /thighleg_left/i.test(allNamesCombined) && /thighleg_right/i.test(allNamesCombined);
    } else {
      ok = parts.length >= 6;
    }

    if (ok) satisfiedFeatures.push(feat);
    else missingFeatures.push(feat);
  }

  const coverageRatio =
    interp.requiredSemanticFeatures.length > 0
      ? round4(satisfiedFeatures.length / interp.requiredSemanticFeatures.length)
      : 1.0;

  let score = 0;
  if (groundedAtYZero) score += 15;
  if (hasFourQuadrantGroundSupport) score += 22;
  if (hasCranialCaudalProfile) score += 15;
  if (hasBilateralSymmetry) score += 13;
  if (hasNonPrimitiveOrganicComplexity) score += 15;
  score += Math.round(coverageRatio * 20);
  const overallScore = clamp(score, 0, 100);

  const passed =
    overallScore >= 82 &&
    groundedAtYZero &&
    hasFourQuadrantGroundSupport &&
    hasNonPrimitiveOrganicComplexity &&
    coverageRatio >= 0.85;

  return {
    passed,
    overallScore,
    taxonomyVerified: interp.taxonomy,
    archetypeVerified: interp.archetype,
    totalParts: parts.length,
    totalVertices,
    totalTriangles,
    avgVerticesPerPart,
    groundedAtYZero,
    minYStuds: round4(minY),
    boundingBoxStuds: {
      widthX,
      heightY,
      lengthZ,
    },
    spatialChecks: {
      hasFourQuadrantGroundSupport,
      hasCranialCaudalProfile,
      hasBilateralSymmetry,
      hasNonPrimitiveOrganicComplexity,
      hasDistinctColorMaterials,
    },
    featureCoverage: {
      requestedFeatures: interp.requiredSemanticFeatures,
      satisfiedFeatures,
      missingFeatures,
      coverageRatio,
    },
    diagnosticSummary: passed
      ? `VALIDADO (${overallScore}/100): ${interp.subjectLabel} con ${parts.length} órganos/sub-mallas, ${totalVertices} vértices, ${totalTriangles} triángulos y ${Math.round(coverageRatio * 100)}% de rasgos semánticos verificados.`
      : `RECHAZADO (${overallScore}/100): Faltan rasgos o coherencia espacial (${missingFeatures.join(', ') || 'estructura incompleta'}).`,
  };
}

/**
 * ============================================================================
 * RENDERIZADOR DETERMINISTA DE CAPTURAS 2D MULTI-ÁNGULO (`renderMultiAngleSvgSnapshots`)
 * ============================================================================
 * Proyecta y sombrea los triángulos 3D reales del modelo desde 4 ángulos de cámara:
 * - `front` (Vista Frontal +Z)
 * - `side` (Perfil Lateral +X mostrando silueta cráneo-caudal completa)
 * - `isometric` (Vista 3/4 Isométrica)
 * - `top` (Vista Superior Dorsal +Y)
 */
export function renderMultiAngleSvgSnapshots(params: {
  modelName: string;
  subjectLabel?: string;
  parts: any[];
}): MultiAngleSnapshots {
  const { modelName, subjectLabel = modelName, parts } = params;

  interface WorldTriangle {
    v0: [number, number, number];
    v1: [number, number, number];
    v2: [number, number, number];
    normal: [number, number, number];
    baseRgb: [number, number, number];
  }

  const worldTris: WorldTriangle[] = [];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;

  for (const p of parts) {
    const px = Number(p.position?.[0] ?? 0);
    const py = Number(p.position?.[1] ?? 0);
    const pz = Number(p.position?.[2] ?? 0);
    const rgb = Array.isArray(p.colorRgb255)
      ? (p.colorRgb255 as [number, number, number])
      : hexToRgb255Tuple(String(p.color || '#cbd5e1'));

    const verts: [number, number, number][] = Array.isArray(p.meshData?.vertices) ? p.meshData.vertices : [];
    const faces: [number, number, number][] = Array.isArray(p.meshData?.faces) ? p.meshData.faces : [];

    // Si hay muchos triángulos, usar LOD1 para mantener el SVG ligero y nítido
    const lod1Faces: [number, number, number][] | undefined = p.meshData?.lodLevels?.[1]?.faces;
    const lod1Verts: [number, number, number][] | undefined = p.meshData?.lodLevels?.[1]?.vertices;
    const activeVerts = faces.length > 220 && lod1Verts && lod1Faces ? lod1Verts : verts;
    const activeFaces = faces.length > 220 && lod1Verts && lod1Faces ? lod1Faces : faces;

    for (const [vx, vy, vz] of activeVerts) {
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

    for (const [i0, i1, i2] of activeFaces) {
      const a = activeVerts[i0];
      const b = activeVerts[i1];
      const c = activeVerts[i2];
      if (!a || !b || !c) continue;
      const v0: [number, number, number] = [px + a[0], py + a[1], pz + a[2]];
      const v1: [number, number, number] = [px + b[0], py + b[1], pz + b[2]];
      const v2: [number, number, number] = [px + c[0], py + c[1], pz + c[2]];

      const ax = v1[0] - v0[0];
      const ay = v1[1] - v0[1];
      const az = v1[2] - v0[2];
      const bx = v2[0] - v0[0];
      const by = v2[1] - v0[1];
      const bz = v2[2] - v0[2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bz;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;

      worldTris.push({ v0, v1, v2, normal: [nx, ny, nz], baseRgb: rgb });
    }
  }

  if (!Number.isFinite(minX)) {
    minX = -4;
    maxX = 4;
    minY = 0;
    maxY = 6;
    minZ = -4;
    maxZ = 4;
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const maxSpan = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 2.0);

  const renderViewSvg = (viewName: string, yawDeg: number, pitchDeg: number): string => {
    const width = 360;
    const height = 260;
    const scale = (Math.min(width, height) * 0.72) / maxSpan;

    const yaw = (yawDeg * Math.PI) / 180;
    const pitch = (pitchDeg * Math.PI) / 180;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);

    const projectPt = (pt: [number, number, number]): { sx: number; sy: number; depth: number } => {
      const dx = pt[0] - cx;
      const dy = pt[1] - cy;
      const dz = pt[2] - cz;

      const rx = dx * cosY - dz * sinY;
      const rz1 = dx * sinY + dz * cosY;
      const ry = dy * cosP - rz1 * sinP;
      const depth = dy * sinP + rz1 * cosP;

      return {
        sx: Math.round((width * 0.5 + rx * scale) * 10) / 10,
        sy: Math.round((height * 0.54 - ry * scale) * 10) / 10,
        depth,
      };
    };

    const lightDir: [number, number, number] = [0.42, 0.78, 0.46];
    const projectedPolys: Array<{ depth: number; pointsAttr: string; fillHex: string }> = [];

    for (const tri of worldTris) {
      const p0 = projectPt(tri.v0);
      const p1 = projectPt(tri.v1);
      const p2 = projectPt(tri.v2);
      const avgDepth = (p0.depth + p1.depth + p2.depth) / 3;

      const dot =
        tri.normal[0] * lightDir[0] + tri.normal[1] * lightDir[1] + tri.normal[2] * lightDir[2];
      const shade = clamp(0.52 + dot * 0.44, 0.24, 1.08);
      const r = clamp(Math.round(tri.baseRgb[0] * shade), 0, 255)
        .toString(16)
        .padStart(2, '0');
      const g = clamp(Math.round(tri.baseRgb[1] * shade), 0, 255)
        .toString(16)
        .padStart(2, '0');
      const b = clamp(Math.round(tri.baseRgb[2] * shade), 0, 255)
        .toString(16)
        .padStart(2, '0');

      projectedPolys.push({
        depth: avgDepth,
        pointsAttr: `${p0.sx},${p0.sy} ${p1.sx},${p1.sy} ${p2.sx},${p2.sy}`,
        fillHex: `#${r}${g}${b}`,
      });
    }

    projectedPolys.sort((a, b) => a.depth - b.depth);

    const groundP0 = projectPt([cx - maxSpan * 0.55, 0, cz - maxSpan * 0.55]);
    const groundP1 = projectPt([cx + maxSpan * 0.55, 0, cz - maxSpan * 0.55]);
    const groundP2 = projectPt([cx + maxSpan * 0.55, 0, cz + maxSpan * 0.55]);
    const groundP3 = projectPt([cx - maxSpan * 0.55, 0, cz + maxSpan * 0.55]);

    const polyNodes = projectedPolys
      .map(
        (poly) =>
          `<polygon points="${poly.pointsAttr}" fill="${poly.fillHex}" stroke="${poly.fillHex}" stroke-width="0.45" stroke-linejoin="round" />`
      )
      .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <defs>
        <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="100%" stop-color="#1e293b"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bgGrad)" rx="10"/>
      <polygon points="${groundP0.sx},${groundP0.sy} ${groundP1.sx},${groundP1.sy} ${groundP2.sx},${groundP2.sy} ${groundP3.sx},${groundP3.sy}" fill="#334155" fill-opacity="0.32" stroke="#475569" stroke-width="0.8"/>
      ${polyNodes}
      <text x="12" y="20" fill="#94a3b8" font-family="monospace" font-size="10" font-weight="bold">${viewName.toUpperCase()} · ${subjectLabel.slice(0, 28)}</text>
      <text x="12" y="${height - 10}" fill="#64748b" font-family="monospace" font-size="9">Y=0 Grounded · ${parts.length} parts · ${worldTris.length} tris</text>
    </svg>`;
  };

  const frontSvg = renderViewSvg('Front (+Z)', 0, 8);
  const sideSvg = renderViewSvg('Side Profile (+X)', 90, 6);
  const isometricSvg = renderViewSvg('3/4 Isometric', 42, 24);
  const topSvg = renderViewSvg('Top Dorsal (+Y)', 0, 88);

  const toDataUri = (svg: string): string =>
    `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;

  return {
    frontSvg,
    sideSvg,
    isometricSvg,
    topSvg,
    frontSvgDataUri: toDataUri(frontSvg),
    sideSvgDataUri: toDataUri(sideSvg),
    isometricSvgDataUri: toDataUri(isometricSvg),
    topSvgDataUri: toDataUri(topSvg),
  };
}
