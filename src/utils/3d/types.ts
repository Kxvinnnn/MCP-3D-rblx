import type * as THREE from 'three';
import type { ForgeColorSpace } from '../colorUtils.ts';
export {
  FORGE_COLOR_CONVENTION_VERSION,
  type ForgeColorSpace,
  resolveColorRgb255,
  resolveRgbTuple,
  normalizeColorRgb255,
} from '../colorUtils.ts';

export interface SubMeshLODData {
  level: 0 | 1 | 2;
  vertexCount: number;
  triangleCount: number;
  vertices: number[][];
  normals: number[][];
  uvs: number[][];
  faces: number[][];
}

export interface SubMeshGeometryData {
  vertices: number[][];
  normals?: number[][];
  uvs?: number[][];
  faces: number[][];
  vertexColors?: number[][];
  objFileName?: string;
  lodLevels?: SubMeshLODData[];
}

export interface PartPBRMaterialSpec {
  pattern?: string;
  albedoHex?: string;
  emissiveHex?: string;
  roughness?: number;
  metalness?: number;
  colorMapAssetId?: string;
  normalMapAssetId?: string;
  roughnessMapAssetId?: string;
  metalnessMapAssetId?: string;
  albedoDataUrl?: string;
  normalDataUrl?: string;
  roughnessDataUrl?: string;
  metalnessDataUrl?: string;
}

export interface MeshPart3DSpec {
  partId?: string;
  name: string;
  parentId?: string;
  parentName?: string;
  hierarchyPath?: string;
  geometrySource?: 'EditableMeshBuffers' | 'PublishedCloudMeshId' | 'StudioExternalUnreadable';
  rotationMatrix?: number[];
  geometryHash?: string;
  materialHash?: string;
  transformHash?: string;
  shape: 'Block' | 'Cylinder' | 'Ball' | 'Wedge' | 'CornerWedge' | 'MeshPart';
  size: number[];
  position: number[];
  rotation: number[];
  color: number[];
  colorSpace?: ForgeColorSpace;
  material: string;
  roughness: number;
  metalness: number;
  transparency: number;
  canCollide: boolean;
  anchored: boolean;
  collisionFidelity: 'Default' | 'Box' | 'Hull' | 'PreciseConvexDecomposition';
  renderFidelity?: 'Automatic' | 'Precise' | 'Performance';
  doubleSided?: boolean;
  castShadow?: boolean;
  reflectance?: number;
  meshId?: string;
  assetId?: string;
  robloxAssetId?: string | null;
  assetUri?: string | null;
  textureId?: string;
  pbrMaterial?: PartPBRMaterialSpec;
  meshData?: SubMeshGeometryData;
  baseMeshData?: SubMeshGeometryData;
}

export interface PBRProfileSpec {
  albedo_hex: string;
  roughness: number;
  metalness: number;
  emissive_hex: string;
  roblox_material: string;
  pattern: string;
  albedo_asset_path?: string;
  normal_asset_path?: string;
  roughness_asset_path?: string;
  metalness_asset_path?: string;
  color_map_asset_id?: string;
  normal_map_asset_id?: string;
  roughness_map_asset_id?: string;
  metalness_map_asset_id?: string;
}

export interface OperationHistoryEntry {
  id: string;
  timestamp: string;
  operationType:
    | 'subdivide'
    | 'smooth'
    | 'decimate'
    | 'recompute_uv_normals'
    | 'smart_split'
    | 'repair_degenerate'
    | 'transform_scale'
    | 'transform_pos_rot'
    | 'material_pbr'
    | 'add_part'
    | 'delete_part'
    | 'ground_y0'
    | 'incremental_sync'
    | 'restore_version';
  partName: string;
  summary: string;
  vertexBefore: number;
  vertexAfter: number;
  triangleBefore: number;
  triangleAfter: number;
  snapshot: Forge3DAsset;
}

export interface Forge3DAsset {
  id?: string;
  asset_id?: string;
  forgeAssetId?: string;
  sourceAssetId?: string;
  robloxAssetId?: string | null;
  assetUri?: string | null;
  geometrySource?: 'EditableMeshBuffers' | 'PublishedCloudMeshId' | 'StudioExternalUnreadable';
  geometryHash?: string;
  contentHash?: string;
  name: string;
  category: string;
  asset_type: 'Model3D' | 'Scene3D' | 'PBRMaterial';
  poly_count: number;
  collision_fidelity: 'Default' | 'Box' | 'Hull' | 'PreciseConvexDecomposition';
  rojo_target_folder: string;
  file_name: string;
  obj_file_name?: string;
  obj_saved_path?: string | null;
  description: string;
  pbr_profile: PBRProfileSpec;
  parts: MeshPart3DSpec[];
  luau_code: string;
  saved_path?: string | null;
  created_at?: string;
  updated_at?: string;
  version?: number;
  version_history?: Array<{
    version: number;
    timestamp: string;
    poly_count: number;
    part_count: number;
    luau_code: string;
    parts: MeshPart3DSpec[];
  }>;
  exported_package_files?: Record<string, string | null>;
  verified_package_files?: Record<string, boolean>;
}

export interface PBRTextureSet {
  albedoMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  metalnessMap: THREE.CanvasTexture;
  albedoDataUrl: string;
  normalDataUrl: string;
  roughnessDataUrl: string;
  metalnessDataUrl: string;
  metallicRoughnessDataUrl: string;
}

export interface DegenerateGeometryReport {
  partName: string;
  isClean: boolean;
  nanOrInfCount: number;
  collapsedIndexTriangles: number;
  zeroAreaTriangles: number;
  duplicateTriangles: number;
  orphanedVerticesRemoved: number;
  repairedNormalsCount: number;
  repairedUVsCount: number;
  verticesBefore: number;
  verticesAfter: number;
  trianglesBefore: number;
  trianglesAfter: number;
  summary: string;
}

export interface PartSyncDiffEntry {
  partId?: string;
  partName: string;
  parentName?: string;
  status: 'added_in_studio' | 'removed_in_studio' | 'modified' | 'conflict' | 'unchanged';
  changedFields: Array<'transform' | 'size' | 'material' | 'color' | 'pbr' | 'geometry' | 'hierarchy'>;
  forgeSummary: string;
  studioSummary: string;
  hasConflict: boolean;
}

export interface ModelVersionDiffReport {
  hasChanges: boolean;
  hasConflicts: boolean;
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  conflictCount: number;
  unchangedCount: number;
  entries: PartSyncDiffEntry[];
}

export interface AutomatedValidationCheck {
  id: string;
  category: 'import_export' | 'geometry' | 'pbr_materials' | 'rojo_build';
  title: string;
  passed: boolean;
  autoHealed: boolean;
  details: string;
}

export interface AutomatedValidationSuiteReport {
  overallPassed: boolean;
  score: number;
  totalChecks: number;
  passedChecks: number;
  autoHealedCount: number;
  checks: AutomatedValidationCheck[];
  healedAsset: Forge3DAsset;
  timestamp: string;
}

export const ROBLOX_MATERIAL_ENUM_TOKENS: Record<string, number> = {
  Plastic: 256,
  SmoothPlastic: 272,
  Neon: 288,
  Wood: 512,
  WoodPlanks: 528,
  Marble: 784,
  Slate: 800,
  Concrete: 816,
  Granite: 832,
  Brick: 848,
  Pebble: 864,
  Cobblestone: 880,
  CorrodedMetal: 1040,
  DiamondPlate: 1056,
  Foil: 1072,
  Metal: 1088,
  Grass: 1280,
  Sand: 1296,
  Fabric: 1312,
  Ice: 1536,
  Glass: 1568,
  ForceField: 1584,
};

export const ROBLOX_TOKEN_TO_MATERIAL: Record<number, string> = Object.entries(
  ROBLOX_MATERIAL_ENUM_TOKENS
).reduce((acc, [name, token]) => {
  acc[token] = name;
  return acc;
}, {} as Record<number, string>);

/**
 * Validates whether a candidate string is a real published Roblox asset URI
 * (`rbxassetid://<positive_integer>` or `rbxasset://...`).
 * Never invents fictional hash-based IDs or `rbxassetid://0`.
 */
export function validatePublishedRobloxMeshId(candidate?: string | null): string {
  const raw = String(candidate || '').trim();
  if (!raw || raw.startsWith('rbxassetid://0') || raw === 'None' || raw === 'undefined') {
    return '';
  }
  if (/^rbxassetid:\/\/[1-9]\d*$/.test(raw)) {
    return raw;
  }
  if (/^rbxasset:\/\/.+/.test(raw)) {
    return raw;
  }
  return '';
}
