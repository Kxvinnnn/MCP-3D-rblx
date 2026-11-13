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

export interface ParsedTreeParamsResult {
  isTreePrompt: boolean;
  detectedKeywords: string[];
  params: {
    height?: number;
    width?: number;
    trunkThickness?: number;
    trunkLean?: number;
    trunkCurvature?: number;
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
    'tree|trees|árbol|arbol|árboles|arboles|roble|oak|pino|pine|sauce|willow|ciprés|cipres|cypress|bonsai|sakura|cerezo|palmera|palm|sequoia|bosque|forest'
  );

  // Explicit height in studs/meters (e.g., "22 studs", "altura 18")
  const heightMatch =
    text.match(/(\d+(?:\.\d+)?)\s*studs?\b/i) ||
    text.match(/(?:altura|height)\s*(?:de|=|:)?\s*(\d+(?:\.\d+)?)/i);
  if (heightMatch) {
    const val = Number(heightMatch[1]);
    if (Number.isFinite(val) && val >= 4 && val <= 45) {
      params.height = val;
      keywords.push(`height:${val}`);
    }
  } else if (hasTerm(text, 'gigante|colosal|enorme|giant|massive|sequoia')) {
    params.height = 28;
    params.trunkThickness = 2.6;
    keywords.push('giant');
  } else if (hasTerm(text, 'alto|alta|tall|towering|elevado')) {
    params.height = 22;
    keywords.push('tall');
  } else if (hasTerm(text, 'pequeño|pequeno|chico|bajo|small|tiny|bonsai|enano|sapling')) {
    params.height = 7.5;
    params.trunkThickness = 0.9;
    params.branchCount = 3;
    keywords.push('small');
  }

  // Trunk thickness
  if (
    hasTerm(
      text,
      'tronco\\s+grueso|tronco\\s+ancho|tronco\\s+robusto|thick\\s+trunk|heavy\\s+trunk|stout|ancestral|ancient'
    )
  ) {
    params.trunkThickness = 2.8;
    keywords.push('thick_trunk');
  } else if (hasTerm(text, 'tronco\\s+fino|tronco\\s+delgado|slender|thin\\s+trunk|skinny')) {
    params.trunkThickness = 0.85;
    keywords.push('thin_trunk');
  }

  // Trunk lean / curvature / irregular form
  if (hasTerm(text, 'inclinado|torcido|curvo|irregular|retorcido|gnarled|leaning|curved|twisted|windswept')) {
    params.trunkLean = 12;
    params.trunkCurvature = 0.55;
    params.variation = 0.58;
    params.leafVariation = 0.55;
    keywords.push('curved_irregular');
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
  } else if (hasTerm(text, 'capas|layered|pagoda|bonsai|plateau|escalonad', true)) {
    params.canopyShape = 'layered';
    params.branchDistribution = 'tiered';
    keywords.push('layered');
  } else if (hasTerm(text, 'esféric|esferic|spherical|redond|round|roble|oak', true)) {
    params.canopyShape = 'spherical';
    keywords.push('spherical');
  }

  // Width / Canopy spread
  if (hasTerm(text, 'copa\\s+amplia|copa\\s+ancha|amplio|wide|sprawling|broad\\s+canopy|extended')) {
    params.width = 14;
    params.canopySize = 1.45;
    params.branchLength = params.branchLength ?? 5.8;
    keywords.push('wide_canopy');
  } else if (hasTerm(text, 'copa\\s+estrecha|estrecho|narrow|compacto|compact')) {
    params.width = 6;
    params.canopySize = 0.72;
    keywords.push('narrow_canopy');
  }

  // Foliage density / dry tree
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

  // Detail & style (low-poly vs high detail)
  if (hasTerm(text, 'low[\\s-]?poly|estilizado|stylized|cartoon|minimal|bloques')) {
    params.detailLevel = 'low';
    params.leafMaterial = 'SmoothPlastic';
    params.trunkMaterial = params.trunkMaterial ?? 'SmoothPlastic';
    keywords.push('low_poly');
  } else if (hasTerm(text, 'ultra|hiper|hyper|high[\\s-]?detail|detallado|realista|realistic')) {
    params.detailLevel = 'high';
    keywords.push('high_detail');
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
  } else if (hasTerm(text, 'azul|celeste|hielo|ice|frost|nevad|azure|blue', true)) {
    params.leafColor = '#38bdf8';
    params.trunkColor = '#334155';
    params.leafMaterial = params.leafMaterial ?? 'Ice';
    keywords.push('ice_blue');
  } else if (hasTerm(text, 'fantasía|fantasia|fantasy|mágico|magico|magic|violeta|morado|purple|místico|mistico|mystic|corrupt|void', true)) {
    params.leafColor = params.leafColor ?? '#8b5cf6';
    params.trunkColor = '#3b2d4a';
    params.colorVariation = 0.42;
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
