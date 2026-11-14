import {
  Mountain,
  Box,
  Layers,
  Sliders,
  Sparkles,
  Shield,
  type LucideIcon,
} from 'lucide-react';

export type WizardStep = 1 | 2 | 3 | 4 | 5;

export type ObjectCategory =
  | 'Props'
  | 'Trees & Vegetation'
  | 'Rocks & Nature'
  | 'Buildings & Structures'
  | 'Furniture & Interior'
  | 'Scene Elements'
  | 'Stylized Assets'
  | 'Ambient & Decoration';

export type InputMethod = 'text' | 'image' | 'file3d' | 'heightmap';
export type DetailLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface TreeArchetypePreset {
  id: string;
  label: string;
  subtitle: string;
  prompt: string;
  seed: string;
  height: number;
  width: number;
  trunkThickness: number;
  trunkLean: number;
  trunkCurvature: number;
  rootFlareScale: number;
  branchCount: number;
  branchLength: number;
  branchDistribution: 'tiered' | 'whorled' | 'alternating' | 'canopy_top';
  canopyShape: 'spherical' | 'conical' | 'layered' | 'weeping';
  canopySize: number;
  leafDistribution: 'dense' | 'balanced' | 'sparse' | 'clustered';
  foliageCount: number;
  foliageDensity: number;
  trunkColor: string;
  leafColor: string;
}

export interface WizardCategoryCard {
  id: ObjectCategory;
  title: string;
  desc: string;
  icon: LucideIcon;
  gradient: string;
  activeBorder: string;
}

export const WIZARD_CATEGORY_CARDS: WizardCategoryCard[] = [
  {
    id: 'Trees & Vegetation',
    title: 'Árboles y Plantas',
    desc: 'Robles, pinos, sauces, bonsáis y vegetación 3D',
    icon: Mountain,
    gradient: 'from-emerald-500 to-teal-600',
    activeBorder: 'border-emerald-400 bg-emerald-950/35',
  },
  {
    id: 'Props',
    title: 'Objetos y Props',
    desc: 'Cofres, barriles, armas, cajas y herramientas',
    icon: Box,
    gradient: 'from-amber-500 to-orange-600',
    activeBorder: 'border-amber-400 bg-amber-950/35',
  },
  {
    id: 'Rocks & Nature',
    title: 'Rocas y Cristales',
    desc: 'Peñascos, piedras musgosas y cristales mágicos',
    icon: Mountain,
    gradient: 'from-cyan-500 to-blue-600',
    activeBorder: 'border-cyan-400 bg-cyan-950/35',
  },
  {
    id: 'Buildings & Structures',
    title: 'Edificios y Torres',
    desc: 'Torres medievales, arcos, columnas y muros',
    icon: Layers,
    gradient: 'from-violet-500 to-indigo-600',
    activeBorder: 'border-violet-400 bg-violet-950/35',
  },
  {
    id: 'Furniture & Interior',
    title: 'Muebles e Interior',
    desc: 'Mesas, sillas, tronos y estanterías',
    icon: Box,
    gradient: 'from-rose-500 to-pink-600',
    activeBorder: 'border-rose-400 bg-rose-950/35',
  },
  {
    id: 'Scene Elements',
    title: 'Portales y Altares',
    desc: 'Portales dimensionales, altares y plataformas',
    icon: Sliders,
    gradient: 'from-fuchsia-500 to-purple-600',
    activeBorder: 'border-fuchsia-400 bg-fuchsia-950/35',
  },
  {
    id: 'Stylized Assets',
    title: 'Estilo Low-Poly',
    desc: 'Tótems, obeliscos y arte estilizado limpio',
    icon: Sparkles,
    gradient: 'from-pink-500 to-amber-500',
    activeBorder: 'border-pink-400 bg-pink-950/35',
  },
  {
    id: 'Ambient & Decoration',
    title: 'Luces y Decoración',
    desc: 'Faroles, antorchas, braseros y balizas',
    icon: Shield,
    gradient: 'from-teal-400 to-emerald-600',
    activeBorder: 'border-teal-400 bg-teal-950/35',
  },
];

export const TREE_ARCHETYPE_PRESETS: TreeArchetypePreset[] = [
  {
    id: 'fantasy-red',
    label: 'Fantasía Rojizo',
    subtitle: 'Copa carmesí · Low-Poly',
    prompt:
      'Árbol de fantasía estilizado low-poly con copa densa rojiza carmesí, tronco curvado marrón oscuro y raíces visibles en Y=0.',
    seed: 'fantasy-crimson-2026',
    height: 15,
    width: 12,
    trunkThickness: 1.8,
    trunkLean: 3,
    trunkCurvature: 0.25,
    rootFlareScale: 1.35,
    branchCount: 5,
    branchLength: 4.5,
    branchDistribution: 'tiered',
    canopyShape: 'spherical',
    canopySize: 1.15,
    leafDistribution: 'dense',
    foliageCount: 6,
    foliageDensity: 1.25,
    trunkColor: '#5c3a24',
    leafColor: '#c83e37',
  },
  {
    id: 'ancient-oak',
    label: 'Roble Ancestral',
    subtitle: 'Tronco robusto · Frondoso',
    prompt:
      'Árbol roble ancestral para Roblox con tronco robusto texturizado, raíces expuestas en Y=0 y copa frondosa.',
    seed: 'ancient-oak-2026',
    height: 16,
    width: 13,
    trunkThickness: 2.1,
    trunkLean: 0,
    trunkCurvature: 0.15,
    rootFlareScale: 1.4,
    branchCount: 5,
    branchLength: 4.5,
    branchDistribution: 'tiered',
    canopyShape: 'spherical',
    canopySize: 1.2,
    leafDistribution: 'dense',
    foliageCount: 6,
    foliageDensity: 1.15,
    trunkColor: '#6e482b',
    leafColor: '#34843d',
  },
  {
    id: 'alpine-pine',
    label: 'Pino Alpino',
    subtitle: 'Alto y esbelto · Copa cónica',
    prompt:
      'Pino alpino alto con copa cónica escalonada, tronco recto y follaje verde pino oscuro.',
    seed: 'alpine-pine-2026',
    height: 22,
    width: 9,
    trunkThickness: 1.5,
    trunkLean: 0,
    trunkCurvature: 0.05,
    rootFlareScale: 1.15,
    branchCount: 6,
    branchLength: 3.5,
    branchDistribution: 'whorled',
    canopyShape: 'conical',
    canopySize: 1.0,
    leafDistribution: 'balanced',
    foliageCount: 6,
    foliageDensity: 1.1,
    trunkColor: '#543824',
    leafColor: '#266533',
  },
  {
    id: 'mystic-willow',
    label: 'Sauce Místico',
    subtitle: 'Ramas colgantes · Esmeralda',
    prompt:
      'Sauce llorón místico con tronco inclinado, ramas largas colgantes y follaje esmeralda denso.',
    seed: 'mystic-willow-2026',
    height: 14,
    width: 14,
    trunkThickness: 1.9,
    trunkLean: 6,
    trunkCurvature: 0.35,
    rootFlareScale: 1.3,
    branchCount: 6,
    branchLength: 5.5,
    branchDistribution: 'canopy_top',
    canopyShape: 'weeping',
    canopySize: 1.25,
    leafDistribution: 'dense',
    foliageCount: 7,
    foliageDensity: 1.3,
    trunkColor: '#634630',
    leafColor: '#439258',
  },
  {
    id: 'layered-bonsai',
    label: 'Bonsái Estilizado',
    subtitle: 'Capas definidas · Oriental',
    prompt:
      'Árbol bonsái gigante estilizado con tronco sinuoso y copa escalonada en racimos.',
    seed: 'layered-bonsai-2026',
    height: 12,
    width: 11,
    trunkThickness: 1.7,
    trunkLean: 8,
    trunkCurvature: 0.45,
    rootFlareScale: 1.4,
    branchCount: 4,
    branchLength: 4.0,
    branchDistribution: 'alternating',
    canopyShape: 'layered',
    canopySize: 1.05,
    leafDistribution: 'clustered',
    foliageCount: 5,
    foliageDensity: 1.0,
    trunkColor: '#6e482b',
    leafColor: '#3b8c4c',
  },
];

export const CATEGORY_SUGGESTIONS: Record<ObjectCategory, string[]> = {
  Props: [
    'Cofre del tesoro medieval con cerradura mágica brillante',
    'Barril reforzado con aros de hierro forjado y madera envejecida',
    'Cristal de energía en contenedor de titanio con emisores neón',
  ],
  'Trees & Vegetation': [
    'Árbol de fantasía estilizado low-poly con copa densa rojiza carmesí y raíces visibles',
    'Árbol roble ancestral con tronco nudoso y copa esférica frondosa',
    'Pino alpino alto con copa cónica escalonada y corteza rugosa',
    'Sauce llorón místico con ramas colgantes y follaje denso',
  ],
  'Rocks & Nature': [
    'Formación rocosa basáltica facetada con cristales incrustados',
    'Peñasco de granito musgoso asentado para terreno natural',
    'Acantilado modular de piedra caliza estratificada',
  ],
  'Buildings & Structures': [
    'Torre de vigilancia medieval con pilares de piedra y tejado a cuatro aguas',
    'Pabellón modular con columnas clásicas y base de hormigón',
    'Puerta fortificada con arco superior y contrafuertes laterales',
  ],
  'Furniture & Interior': [
    'Mesa de banquete de roble macizo con soportes metálicos',
    'Trono tallado con respaldo alto y reposabrazos ornamentados',
    'Estantería de alquimia con compartimentos modulares',
  ],
  'Scene Elements': [
    'Portal dimensional sobre plataforma octogonal de piedra rúnica',
    'Altar ceremonial con escalinata y núcleo energético central',
    'Plataforma de teletransporte con anillos concéntricos',
  ],
  'Stylized Assets': [
    'Tótem estilizado low-poly con grabados luminosos cian',
    'Santuario de fantasía con geometría facetada limpia',
    'Obelisco flotante estilizado con base escalonada',
  ],
  'Ambient & Decoration': [
    'Farol de hierro forjado sobre pedestal con núcleo cálido',
    'Brasero ceremonial encendido con base de bronce',
    'Baliza ambiental futurista con corona emisiva',
  ],
};

export const POLY_BUDGETS: Record<DetailLevel, { tris: number; label: string; desc: string }> = {
  low: { tris: 1800, label: 'Bajo (~1,800 tris)', desc: 'Ideal para móviles y bosques grandes' },
  medium: { tris: 3800, label: 'Medio (~3,800 tris)', desc: 'Equilibrio recomendado para Roblox' },
  high: { tris: 8500, label: 'Alto (~8,500 tris)', desc: 'Alta definición para primer plano' },
  ultra: { tris: 14000, label: 'Ultra (~14,000 tris)', desc: 'Máximo detalle con auto-división' },
};
