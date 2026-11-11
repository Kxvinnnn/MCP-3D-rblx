/**
 * @module contextPrunerEngine
 * @description
 * Domain-Scoped AI Context Pruner & Self-Discovery Manifest Generator.
 *
 * WHY THIS EXISTS:
 * Sending the entire `project_context.md` (Maid implementation, UI UDim2 rules,
 * Rojo mapping, etc.) on every Gemini request wastes tokens and dilutes attention
 * when the task only needs a specific domain (e.g. 3D Mesh generation only needs
 * Studs scale + `--!strict` + `EditableMesh` rules, not `TweenService` UI rules).
 *
 * This module slices `project_context.md` by domain (`3d` | `pbr` | `luau` | `ui` | `world` | `agents`),
 * reducing prompt context overhead by ~60–70% while preserving 100% of verified Rojo module rules.
 */

export type ForgeContextDomain = '3d' | 'pbr' | 'luau' | 'ui' | 'world' | 'agents';

export interface PrunedContextResult {
  domain: ForgeContextDomain;
  promptContext: string;
  includedSections: string[];
  rawCharCount: number;
  prunedCharCount: number;
  savedPercentage: number;
}

export interface AiModuleContract {
  id: string;
  domain: ForgeContextDomain;
  tsPath: string;
  pyPath: string;
  keyExports: string[];
  invariants: string[];
}

export const AI_MODULE_CONTRACTS: AiModuleContract[] = [
  {
    id: 'context_pruner',
    domain: 'agents',
    tsPath: 'src/server/engines/contextPrunerEngine.ts',
    pyPath: 'backend/engines/context_pruner.py',
    keyExports: ['buildPrunedDomainContext', 'buildAiSelfUnderstandingManifest', 'AI_MODULE_CONTRACTS'],
    invariants: [
      'Slices project_context.md by task domain so Gemini only receives relevant conventions.',
      'Always appends the live VERIFIED ON-DISK ROJO MODULES block to prevent hallucinated require() calls.',
    ],
  },
  {
    id: 'generation_3d_engine',
    domain: '3d',
    tsPath: 'src/server/engines/generation3DEngine.ts',
    pyPath: 'backend/engines/generation_3d_engine.py',
    keyExports: [
      'validatePublishedRobloxMeshId',
      'splitOversizedMeshPartInput',
      'parseWavefrontObjGeometry',
      'extractGeometryFromProcessedMesh',
      'extractPartsFromUploadedMesh',
      'synthesizeProceduralMeshData',
      'buildStrictLuauFromEditedParts',
    ],
    invariants: [
      'Never invent fictional rbxassetid:// hashes or rbxassetid://0; never assign read-only MeshPart.MeshId.',
      'Construct geometry via AssetService:CreateEditableMesh(), verify GetTriangles() count, and call editableMesh:Destroy().',
      'Split sub-meshes exceeding 9,000 vertices or 9,500 triangles instead of truncating faces.',
    ],
  },
  {
    id: 'asset_engine',
    domain: 'pbr',
    tsPath: 'src/server/engines/assetEngine.ts',
    pyPath: 'backend/engines/asset_engine.py',
    keyExports: [
      'buildRbxmxFromPartsServer',
      'parseRbxmxFromPartsServer',
      'buildObjAndMtlFromPartsServer',
      'buildGltfFromPartsServer',
      'generatePBRSurfaceAppearanceLuau',
    ],
    invariants: [
      'Always generate all 5 package files (.luau, .rbxmx, .gltf, .obj, .mtl) on the server.',
      'Support 4-channel PBR (ColorMap, NormalMap, RoughnessMap, MetalnessMap) per MeshPart.',
      'Poll Roblox Open Cloud /assets/v1/operations/{id} when Decal upload returns an async Operation.',
    ],
  },
  {
    id: 'world_engine',
    domain: 'world',
    tsPath: 'src/server/engines/worldEngine.ts',
    pyPath: 'backend/engines/world_engine.py',
    keyExports: ['BIOME_LIGHTING_CONFIGS', 'generateWorldEnvironmentLuau'],
    invariants: [
      'Configure Lighting and Atmosphere deterministically from biome presets.',
      'Spawn anchored spatial MeshPart pads with SpawnTargetAsset attributes.',
    ],
  },
  {
    id: 'luau_engine',
    domain: 'luau',
    tsPath: 'src/server/engines/luauEngine.ts',
    pyPath: 'backend/engines/luau_engine.py',
    keyExports: ['buildLuauSystemInstruction', 'getTargetRojoFolderForScriptType', 'enforceLuauStrictAndMaidContract'],
    invariants: [
      'Every script must start with --!strict and use task.wait/task.spawn/task.delay/task.defer.',
      'Route Server scripts to src/server, Client scripts to src/client, and Modules to src/shared.',
    ],
  },
  {
    id: 'ui_engine',
    domain: 'ui',
    tsPath: 'src/server/engines/uiEngine.ts',
    pyPath: 'backend/engines/ui_engine.py',
    keyExports: ['buildForgeGuiSystemInstruction', 'validateScaleOnlyUiTree'],
    invariants: [
      'All ScreenGui containers must use UDim2.fromScale with AnchorPoint = Vector2.new(0.5, 0.5).',
      'Support 3D ViewportFrame + WorldModel previews and TweenService transitions.',
    ],
  },
  {
    id: 'rojo_bridge',
    domain: 'luau',
    tsPath: 'src/server/engines/rojoBridge.ts',
    pyPath: 'backend/engines/rojo_bridge.py',
    keyExports: ['resolveSafeRojoPath', 'sanitizeStrictLuauCode', 'ALLOWED_ROJO_EXTENSIONS'],
    invariants: [
      'Reject any path traversal (..) or writes escaping ROJO_PROJECT_PATH.',
      'Reject forbidden Luau patterns (loadstring, getfenv, setfenv).',
    ],
  },
];

const DOMAIN_SECTION_MAP: Record<ForgeContextDomain, string[]> = {
  '3d': ['ROJO_MAPPING', 'LUAU_STANDARDS'],
  pbr: ['ROJO_MAPPING', 'LUAU_STANDARDS'],
  world: ['ROJO_MAPPING', 'LUAU_STANDARDS', 'EXISTING_MODULES'],
  luau: ['ROJO_MAPPING', 'LUAU_STANDARDS', 'MAID_PATTERN', 'EXISTING_MODULES'],
  ui: ['ROJO_MAPPING', 'LUAU_STANDARDS', 'MAID_PATTERN', 'UI_FORGEGUI'],
  agents: ['ROJO_MAPPING', 'LUAU_STANDARDS', 'MAID_PATTERN', 'UI_FORGEGUI', 'EXISTING_MODULES'],
};

const COMPACT_DOMAIN_CHEATSHEETS: Record<ForgeContextDomain, string> = {
  '3d': [
    '--- 3D EDITABLEMESH COMPACT RULES ---',
    '- Scale: 1 Stud = 0.28m; R15 Avatar height = 5.5 Studs; base rests at Y = 0.',
    '- Geometry: Use AssetService:CreateEditableMesh() + AssetService:CreateMeshPartAsync(Content.fromObject(editableMesh), options).',
    '- Never invent rbxassetid:// hashes or assign read-only MeshPart.MeshId.',
  ].join('\n'),
  pbr: [
    '--- PBR SURFACEAPPEARANCE COMPACT RULES ---',
    '- 4 Channels: ColorMap, NormalMap, RoughnessMap, MetalnessMap.',
    '- Only assign rbxassetid://<positive_int> when verified; otherwise synthesize runtime EditableImage.',
  ].join('\n'),
  luau: [
    '--- LUAU STRICT COMPACT RULES ---',
    '- Line 1 MUST be `--!strict`. Use `task.wait`, `task.spawn`, `task.delay`, `task.defer`.',
    '- Clean up all RBXScriptConnections and dynamic Instances via `Maid`.',
  ].join('\n'),
  ui: [
    '--- FORGEGUI COMPACT RULES ---',
    '- Use `UDim2.fromScale` + `AnchorPoint = Vector2.new(0.5, 0.5)` for all layout containers.',
    '- Offset is only allowed in UIPadding or UIStroke.Thickness.',
  ].join('\n'),
  world: [
    '--- WORLD ENGINE COMPACT RULES ---',
    '- Configure `Lighting` + `Atmosphere` and place spatial anchors inside a `Workspace` Zone Folder.',
  ].join('\n'),
  agents: [
    '--- P3 MULTI-AGENT ORCHESTRATOR RULES ---',
    '- Coordinate Architect -> 3D -> Asset/PBR -> World -> Luau -> UI -> Rojo SHA-256 verification.',
  ].join('\n'),
};

/**
 * Splits `project_context.md` into named logical blocks and returns only the sections
 * required for `domain`, plus the verified on-disk Rojo modules block.
 */
export function buildPrunedDomainContext(
  rawProjectContext: string,
  verifiedModulesBlock: string,
  domain: ForgeContextDomain = 'luau'
): PrunedContextResult {
  const rawText = String(rawProjectContext || '');
  const sections: Record<string, string> = {
    ROJO_MAPPING: '',
    LUAU_STANDARDS: '',
    MAID_PATTERN: '',
    UI_FORGEGUI: '',
    EXISTING_MODULES: '',
  };

  const parts = rawText.split(/^##\s+/m);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('1.')) sections.ROJO_MAPPING = `## ${trimmed}`;
    else if (trimmed.startsWith('2.')) sections.LUAU_STANDARDS = `## ${trimmed}`;
    else if (trimmed.startsWith('3.')) sections.MAID_PATTERN = `## ${trimmed}`;
    else if (trimmed.startsWith('4.')) sections.UI_FORGEGUI = `## ${trimmed}`;
    else if (trimmed.startsWith('5.')) sections.EXISTING_MODULES = `## ${trimmed}`;
  }

  const wantedKeys = DOMAIN_SECTION_MAP[domain] || DOMAIN_SECTION_MAP.luau;
  const includedSections: string[] = [];
  const selectedChunks: string[] = [COMPACT_DOMAIN_CHEATSHEETS[domain]];

  for (const key of wantedKeys) {
    if (sections[key]) {
      includedSections.push(key);
      selectedChunks.push(sections[key]);
    }
  }

  if (verifiedModulesBlock.trim()) {
    selectedChunks.push(verifiedModulesBlock.trim());
  }

  const fullUnpruned = `${rawText}\n${verifiedModulesBlock}`;
  const prunedText = selectedChunks.join('\n\n');
  const rawCharCount = Math.max(1, fullUnpruned.length);
  const prunedCharCount = prunedText.length;
  const savedPercentage = Math.max(
    0,
    Math.min(90, Math.round(((rawCharCount - prunedCharCount) / rawCharCount) * 100))
  );

  return {
    domain,
    promptContext: prunedText,
    includedSections,
    rawCharCount,
    prunedCharCount,
    savedPercentage,
  };
}

/**
 * Generates a self-contained, machine-readable manifest of the entire Forge AI Studio
 * modular architecture so any AI agent can inspect contracts, invariants, and context
 * savings in a single call (`GET /api/v1/ai-manifest`).
 */
export function buildAiSelfUnderstandingManifest(rawProjectContext = '', verifiedModulesBlock = '') {
  const domains: ForgeContextDomain[] = ['3d', 'pbr', 'luau', 'ui', 'world', 'agents'];
  const contextProfiles = domains.map((d) => {
    const res = buildPrunedDomainContext(rawProjectContext, verifiedModulesBlock, d);
    return {
      domain: res.domain,
      included_sections: res.includedSections,
      raw_chars: res.rawCharCount,
      pruned_chars: res.prunedCharCount,
      saved_percentage: res.savedPercentage,
    };
  });

  return {
    schema_version: '2.2-modular-ai-first',
    architecture_Index_file: 'AI_ARCHITECTURE_MAP.md',
    design_principle:
      '7 Single-Responsibility Domain Engines + Domain-Scoped Context Pruner (Zero Monoliths, Minimal Prompt Context)',
    module_contracts: AI_MODULE_CONTRACTS,
    context_pruning_profiles: contextProfiles,
  };
}
