/**
 * @module treePromptParser
 * @description
 * Fase 3 & Fase 10 — Conversor determinista de lenguaje natural (ES/EN) a parámetros
 * estructurados del Generador Procedural de Árboles 3D.
 *
 * Permite transformar prompts como:
 * "Genera un árbol de fantasía con tronco grueso, copa amplia, hojas rojizas y estilo low-poly"
 * en una configuración `TreeProceduralParams` coherente y editable antes o durante la generación.
 */

export type TreeSpeciesType =
  | 'oak'
  | 'pine'
  | 'willow'
  | 'bonsai'
  | 'dead'
  | 'fantasy'
  | 'crystalline';

export type TreeVisualStyleType =
  | 'realistic'
  | 'low_poly'
  | 'cartoon'
  | 'stylized'
  | 'fantasy'
  | 'crystalline';

export interface ParsedTreeParamsResult {
  isTreePrompt: boolean;
  detectedKeywords: string[];
  params: {
    species?: TreeSpeciesType;
    style?: TreeVisualStyleType;
    asymmetricBranches?: boolean;
    crystallineCanopy?: boolean;
    emissiveLeaves?: boolean;
    height?: number;
    width?: number;
    trunkThickness?: number;
    trunkLean?: number;
    trunkCurvature?: number;
    rootFlareScale?: number;
    branchCount?: number;
    branchLength?: number;
    branchDistribution?: 'tiered' | 'whorled' | 'alternating' | 'canopy_top';
    canopyShape?: 'spherical' | 'conical' | 'layered' | 'weeping';
    canopySize?: number;
    leafDistribution?: 'dense' | 'balanced' | 'sparse' | 'clustered';
    foliageCount?: number;
    foliageDensity?: number;
    trunkMaterial?: string;
    leafMaterial?: string;
    trunkColor?: string;
    leafColor?: string;
    variation?: number;
    leafVariation?: number;
    colorVariation?: number;
    detailLevel?: 'low' | 'medium' | 'high' | 'ultra';
    lodLevel?: 0 | 1 | 2;
  };
}

function hasTerm(text: string, alternation: string, allowSuffix = false): boolean {
  const tail = allowSuffix ? '' : '(?![\\p{L}\\p{N}_])';
  const rx = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternation})${tail}`, 'iu');
  return rx.test(text);
}

export function parseNaturalLanguageToTreeParams(prompt: string): ParsedTreeParamsResult {
  const raw = String(prompt || '').trim();
  const text = raw.toLowerCase();
  const keywords: string[] = [];
  const params: ParsedTreeParamsResult['params'] = {};

  const isTreePrompt = hasTerm(
    text,
    'tree|trees|árbol|arbol|árboles|arboles|roble|oak|pino|pine|sauce|willow|ciprés|cipres|cypress|bonsai|bonsái|sakura|cerezo|palmera|palm|sequoia|bosque|forest'
  );

  // Explicit height in studs/meters (e.g., "5 studs", "35 studs", "altura 18")
  const heightMatch =
    text.match(/(\d+(?:\.\d+)?)\s*studs?\b/i) ||
    text.match(/(?:altura|height)\s*(?:de|=|:)?\s*(\d+(?:\.\d+)?)/i);
  if (heightMatch) {
    const val = Number(heightMatch[1]);
    if (Number.isFinite(val) && val >= 2.5 && val <= 45) {
      params.height = val;
      keywords.push(`height:${val}`);
      if (val <= 7) {
        params.width = Math.round(Math.max(2.4, val * 0.85) * 10) / 10;
        params.trunkThickness = params.trunkThickness ?? 0.85;
        params.branchCount = 3;
      } else if (val >= 24) {
        params.width = Math.round(val * 0.72 * 10) / 10;
        params.trunkThickness = params.trunkThickness ?? Math.round(Math.min(5.2, val * 0.11) * 10) / 10;
        params.branchCount = 6;
      }
    }
  } else if (hasTerm(text, 'gigante|colosal|enorme|giant|massive|sequoia')) {
    params.height = 28;
    params.width = 20;
    params.trunkThickness = 2.8;
    params.branchCount = 6;
    keywords.push('giant');
  } else if (hasTerm(text, 'alto|alta|tall|towering|elevado')) {
    params.height = 22;
    params.width = 14;
    keywords.push('tall');
  } else if (hasTerm(text, 'pequeño|pequeno|chico|bajo|small|tiny|bonsai|bonsái|enano|sapling')) {
    params.height = 6.5;
    params.width = 5.5;
    params.trunkThickness = 0.85;
    params.branchCount = 3;
    keywords.push('small');
  }

  // Size modifiers when combined with explicit height (e.g., "gigante de 35 studs", "pequeño de 5 studs")
  if (params.height !== undefined) {
    if (hasTerm(text, 'pequeño|pequeno|chico|small|tiny|enano|mini') && params.height <= 8) {
      params.width = params.width ?? Math.round(Math.max(2.4, params.height * 0.85) * 10) / 10;
      params.branchCount = params.branchCount ?? 3;
      keywords.push('small');
    } else if (hasTerm(text, 'gigante|colosal|enorme|giant|massive') && params.height >= 20) {
      params.width = params.width ?? Math.round(params.height * 0.72 * 10) / 10;
      params.branchCount = params.branchCount ?? 6;
      keywords.push('giant');
    }
  }

  // Trunk thickness
  if (
    hasTerm(
      text,
      'tronco\\s+grueso|tronco\\s+ancho|tronco\\s+robusto|tronco\\s+masivo|thick\\s+trunk|heavy\\s+trunk|stout|ancestral|ancient'
    )
  ) {
    params.trunkThickness = params.height && params.height >= 24 ? 3.8 : 2.8;
    keywords.push('thick_trunk');
  } else if (hasTerm(text, 'tronco\\s+fino|tronco\\s+delgado|slender|thin\\s+trunk|skinny')) {
    params.trunkThickness = params.height && params.height <= 7 ? 0.65 : 0.85;
    keywords.push('thin_trunk');
  }

  // Trunk lean / curvature / irregular / twisted form
  if (hasTerm(text, 'ligeramente\\s+curvad|poco\\s+curv|slightly\\s+curved|gently\\s+curved', true)) {
    params.trunkLean = 7;
    params.trunkCurvature = 0.38;
    params.variation = Math.max(params.variation ?? 0.35, 0.38);
    keywords.push('slightly_curved_trunk');
  } else if (
    hasTerm(
      text,
      'inclinado|torcido|curvo|curvad|irregular|retorcido|sinuos|gnarled|leaning|curved|twisted|windswept',
      true
    ) ||
    /tronco\s+[^.,;]*\b(retorcido|torcido|curvo|sinuoso|twisted)\b/i.test(text)
  ) {
    params.trunkLean = 14;
    params.trunkCurvature = 0.65;
    params.variation = 0.62;
    params.leafVariation = 0.55;
    keywords.push('curved_irregular');
  }

  // Visible / flared roots
  if (
    hasTerm(
      text,
      'ra[ií]ces\\s+visibles|ra[ií]ces\\s+expuestas|ra[ií]ces|visible\\s+roots|exposed\\s+roots|root\\s+flare|buttress\\s+roots',
      true
    )
  ) {
    params.rootFlareScale = 1.5;
    keywords.push('visible_roots');
  }

  // Asymmetric branches modifier
  if (
    hasTerm(text, 'asim[eé]tric', true) ||
    /ramas\s+[^.,;]*asim[eé]tric|asymmetric(?:al)?\s+branches/i.test(text)
  ) {
    params.asymmetricBranches = true;
    params.variation = Math.max(params.variation ?? 0.45, 0.72);
    params.branchCount = Math.max(params.branchCount ?? 5, 5);
    keywords.push('asymmetric_branches');
  }

  // Natural branches / branch distribution
  if (
    hasTerm(
      text,
      'ramas\\s+distribuidas\\s+de\\s+manera\\s+natural|ramas\\s+naturales|ramas\\s+distribuidas|natural\\s+branches',
      true
    )
  ) {
    params.branchDistribution = params.branchDistribution ?? 'tiered';
    params.branchCount = params.branchCount ?? 5;
    params.variation = Math.max(params.variation ?? 0.35, 0.4);
    keywords.push('natural_branches');
  }

  // Tree species classification (7 distinct archetypes)
  if (hasTerm(text, 'seco|dry|muerto|dead|sin\\s+hojas|leafless|pelado|marchito|withered|barren')) {
    params.species = 'dead';
    keywords.push('species:dead');
  } else if (hasTerm(text, 'bons[aá]i')) {
    params.species = 'bonsai';
    params.height = params.height ?? 5.5;
    params.width = params.width ?? 6.5;
    params.trunkCurvature = Math.max(params.trunkCurvature ?? 0, 0.6);
    params.trunkLean = params.trunkLean ?? 11;
    keywords.push('species:bonsai');
  } else if (hasTerm(text, 'pino|pine|abeto|spruce|fir|con[ií]fera')) {
    params.species = 'pine';
    keywords.push('species:pine');
  } else if (hasTerm(text, 'sauce|willow|llor[oó]n|weeping')) {
    params.species = 'willow';
    keywords.push('species:willow');
  } else if (hasTerm(text, 'cristalin|cristal|crystalline|crystal|prism[aá]tic|diamante', true)) {
    params.species = hasTerm(text, 'fantas[ií]a|fantasy|m[aá]gic|magic', true) ? 'fantasy' : 'crystalline';
    params.crystallineCanopy = true;
    keywords.push(`species:${params.species}`, 'crystalline_canopy');
  } else if (hasTerm(text, 'fantas[ií]a|fantasy|m[aá]gic|magic|bioluminisc|arcan|encantado', true)) {
    params.species = 'fantasy';
    keywords.push('species:fantasy');
  } else if (hasTerm(text, 'roble|oak')) {
    params.species = 'oak';
    keywords.push('species:oak');
  }

  // Canopy shape
  if (hasTerm(text, 'pino|pine|cónico|conico|conical|ciprés|cipres|cypress|spruce|abeto|evergreen')) {
    params.canopyShape = 'conical';
    params.branchDistribution = 'whorled';
    keywords.push('conical');
  } else if (hasTerm(text, 'sauce|llorón|lloron|weeping|willow|caído')) {
    params.canopyShape = 'weeping';
    params.branchLength = 5.5;
    keywords.push('weeping');
  } else if (hasTerm(text, 'capas|layered|pagoda|bonsai|bonsái|plateau|escalonad', true)) {
    params.canopyShape = 'layered';
    params.branchDistribution = 'tiered';
    keywords.push('layered');
  } else if (hasTerm(text, 'esféric|esferic|spherical|redond|round|roble|oak', true)) {
    params.canopyShape = 'spherical';
    keywords.push('spherical');
  }

  // Width / Canopy spread
  if (hasTerm(text, 'copa\\s+amplia|copa\\s+ancha|amplio|wide|sprawling|broad\\s+canopy|extended')) {
    params.width = params.width && params.width > 14 ? params.width : 14;
    params.canopySize = 1.45;
    params.branchLength = params.branchLength ?? 5.8;
    keywords.push('wide_canopy');
  } else if (hasTerm(text, 'copa\\s+estrecha|estrecho|narrow|compacto|compact')) {
    params.width = 6;
    params.canopySize = 0.72;
    keywords.push('narrow_canopy');
  }

  // Foliage density / dry tree / varied leaf cluster sizes
  if (hasTerm(text, 'seco|dry|muerto|dead|sin\\s+hojas|leafless|pelado|invierno\\s+seco')) {
    params.leafDistribution = 'sparse';
    params.foliageCount = 0;
    params.foliageDensity = 0.3;
    params.canopySize = 0.42;
    params.branchCount = params.branchCount ?? 7;
    params.trunkMaterial = 'WoodPlanks';
    keywords.push('dry_tree');
  } else if (hasTerm(text, 'frondoso|denso|exuberante|lush|dense|bushy|abundant')) {
    params.leafDistribution = 'dense';
    params.foliageDensity = 1.45;
    params.foliageCount = 8;
    params.canopySize = Math.max(params.canopySize ?? 1.2, 1.25);
    keywords.push('lush_foliage');
  } else if (hasTerm(text, 'disperso|sparse|escaso|pocas\\s+hojas|raleza')) {
    params.leafDistribution = 'sparse';
    params.foliageDensity = 0.65;
    params.foliageCount = 2;
    keywords.push('sparse_foliage');
  }

  if (
    /variaci[oó]n(?:\s+de)?\s+tama[ñn]o|tama[ñn]os?\s+variados|agrupaciones?\s+de\s+hojas|leaf\s+cluster\s+variation|varied\s+cluster\s+size/i.test(
      text
    )
  ) {
    params.leafVariation = Math.max(params.leafVariation ?? 0, 0.68);
    params.variation = Math.max(params.variation ?? 0.35, 0.42);
    params.foliageCount = params.foliageCount ?? 6;
    params.leafDistribution = params.leafDistribution ?? 'clustered';
    keywords.push('varied_clusters');
  }

  // Detail & visual style (cartoon vs low-poly vs crystalline vs fantasy vs realistic)
  if (hasTerm(text, 'cartoon|caricatura|toon')) {
    params.style = 'cartoon';
    params.detailLevel = 'low';
    params.leafMaterial = 'SmoothPlastic';
    params.trunkMaterial = params.trunkMaterial ?? 'SmoothPlastic';
    keywords.push('style:cartoon', 'low_poly');
  } else if (hasTerm(text, 'low[\\s-]?poly|minimal|bloques')) {
    params.style = 'low_poly';
    params.detailLevel = 'low';
    params.leafMaterial = 'SmoothPlastic';
    params.trunkMaterial = params.trunkMaterial ?? 'SmoothPlastic';
    keywords.push('style:low_poly', 'low_poly');
  } else if (hasTerm(text, 'estilizado|stylized')) {
    params.style = 'stylized';
    params.detailLevel = 'low';
    params.leafMaterial = 'SmoothPlastic';
    params.trunkMaterial = params.trunkMaterial ?? 'SmoothPlastic';
    keywords.push('style:stylized', 'low_poly');
  } else if (hasTerm(text, 'ultra|hiper|hyper|high[\\s-]?detail|detallado|realista|realistic')) {
    params.style = 'realistic';
    params.detailLevel = 'high';
    keywords.push('style:realistic', 'high_detail');
  }

  // Crystalline canopy / Emissive leaves modifiers
  if (hasTerm(text, 'luminos|brillant|glowing|bioluminisc|ne[oó]n|fluorescent', true)) {
    params.emissiveLeaves = true;
    keywords.push('emissive_leaves');
  }
  if (hasTerm(text, 'cristalin|cristal|crystalline|crystal|prism[aá]tic', true)) {
    params.crystallineCanopy = true;
    params.style = params.style ?? 'crystalline';
    params.leafMaterial = 'Ice';
    keywords.push('crystalline_canopy');
  } else if (params.emissiveLeaves) {
    params.leafMaterial = 'Neon';
  }

  // Color & fantasy traits
  if (hasTerm(text, 'rojiz|rojas|rojo|carmesí|carmesi|crimson|red|otoño|autumn|escarlata', true)) {
    params.leafColor = '#b91c1c';
    params.colorVariation = 0.35;
    keywords.push('red_foliage');
  } else if (hasTerm(text, 'sakura|cerezo|rosad|rosa|pink|blossom', true)) {
    params.leafColor = '#f472b6';
    params.trunkColor = '#4a3531';
    params.colorVariation = 0.3;
    keywords.push('sakura_pink');
  } else if (hasTerm(text, 'dorad|amarill|gold|golden|yellow', true)) {
    params.leafColor = '#d97706';
    params.colorVariation = 0.35;
    keywords.push('golden_foliage');
  } else if (hasTerm(text, 'naranja|orange|calabaza')) {
    params.leafColor = '#ea580c';
    params.colorVariation = 0.32;
    keywords.push('orange_foliage');
  } else if (hasTerm(text, 'celeste|hielo|ice|frost|nevad|azure|glacial', true)) {
    params.leafColor = '#38bdf8';
    params.trunkColor = '#334155';
    params.leafMaterial = params.leafMaterial ?? 'Ice';
    keywords.push('ice_blue');
  } else if (hasTerm(text, 'azul|azules|blue|zafiro|sapphire|marino|cobalto|cobalt', true)) {
    params.leafColor = '#2563eb';
    params.colorVariation = 0.3;
    keywords.push('blue_foliage');
  } else if (hasTerm(text, 'turquesa|cyan|cian|teal|agua', true)) {
    params.leafColor = '#06b6d4';
    params.colorVariation = 0.28;
    keywords.push('cyan_foliage');
  } else if (hasTerm(text, 'verde|green|esmeralda|emerald', true)) {
    params.leafColor = '#16a34a';
    params.colorVariation = 0.28;
    keywords.push('green_foliage');
  } else if (hasTerm(text, 'blanco|white|nieve|snow|albino', true)) {
    params.leafColor = '#f1f5f9';
    params.trunkColor = '#64748b';
    params.colorVariation = 0.2;
    keywords.push('white_foliage');
  } else if (hasTerm(text, 'negro|black|oscuro|dark|sombra|shadow|ebony', true)) {
    params.leafColor = '#1e293b';
    params.trunkColor = '#18181b';
    params.colorVariation = 0.22;
    keywords.push('dark_foliage');
  } else if (hasTerm(text, 'fantasía|fantasia|fantasy|mágico|magico|magic|violeta|morado|purple|místico|mistico|mystic|corrupt|void', true)) {
    params.leafColor = params.leafColor ?? '#8b5cf6';
    params.trunkColor = '#3b2d4a';
    params.colorVariation = 0.42;
    params.style = params.style ?? 'fantasy';
    keywords.push('fantasy_palette');
  }

  if (hasTerm(text, 'fantasía|fantasia|fantasy|mágico|magico|magic|estilizado|stylized') && !params.variation) {
    params.variation = 0.38;
    params.colorVariation = params.colorVariation ?? 0.35;
  }

  return {
    isTreePrompt,
    detectedKeywords: keywords,
    params,
  };
}
