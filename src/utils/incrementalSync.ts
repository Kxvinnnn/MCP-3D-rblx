import { Forge3DAsset, MeshPart3DSpec } from './roblox3DEngine.ts';
import {
  toCanonicalJsonValue,
  sha256Hex,
} from './canonicalHash.ts';

export type PartChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

export interface PartChangeDetail {
  partId: string;
  name: string;
  changeType: PartChangeType;
  geometryChanged: boolean;
  appearanceChanged: boolean;
  propertiesChanged: boolean;
  hierarchyChanged: boolean;
  basePart?: MeshPart3DSpec;
  updatedPart?: MeshPart3DSpec;
}

export interface IncrementalDiffReport {
  assetName: string;
  isEntireModelNew: boolean;
  totalBefore: number;
  totalAfter: number;
  added: MeshPart3DSpec[];
  removed: MeshPart3DSpec[];
  modified: PartChangeDetail[];
  unchanged: MeshPart3DSpec[];
  hasGeometryChanges: boolean;
  hasAppearanceChanges: boolean;
  hasPropertiesChanges: boolean;
  hasHierarchyChanges: boolean;
  hasMissingPartIds: boolean;
  warnings: string[];
}

/**
 * Computes a hash for an individual part's geometry.
 */
function partGeometryHash(p: MeshPart3DSpec): string {
  return sha256Hex(
    toCanonicalJsonValue({
      shape: p.shape,
      size: p.size,
      meshData: p.meshData,
      baseMeshData: p.baseMeshData,
    })
  );
}

/**
 * Computes a hash for an individual part's appearance/material.
 */
function partAppearanceHash(p: MeshPart3DSpec): string {
  return sha256Hex(
    toCanonicalJsonValue({
      color: p.color,
      material: p.material,
      roughness: p.roughness,
      metalness: p.metalness,
      transparency: p.transparency,
      reflectance: p.reflectance,
      doubleSided: p.doubleSided,
      pbrMaterial: p.pbrMaterial,
      textureId: p.textureId,
    })
  );
}

/**
 * Computes a hash for an individual part's physical properties and transforms.
 */
function partPropertiesHash(p: MeshPart3DSpec): string {
  return sha256Hex(
    toCanonicalJsonValue({
      position: p.position,
      rotation: p.rotation,
      rotationMatrix: p.rotationMatrix,
      anchored: p.anchored,
      canCollide: p.canCollide,
      collisionFidelity: p.collisionFidelity,
      renderFidelity: p.renderFidelity,
      castShadow: p.castShadow,
    })
  );
}

/**
 * Builds an indexed map of parts without ever silently overwriting entries.
 * - Throws an explicit error if two parts share the same explicit `partId`.
 * - Disambiguates parts lacking `partId` using hierarchyPath + name + occurrence index.
 */
function buildCollisionSafePartMap(
  parts: MeshPart3DSpec[],
  label: string,
  warnings: string[]
): { map: Map<string, MeshPart3DSpec>; hasMissingPartIds: boolean } {
  const map = new Map<string, MeshPart3DSpec>();
  const explicitIds = new Set<string>();
  const fallbackCounts = new Map<string, number>();
  let hasMissingPartIds = false;

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const explicitId = typeof p.partId === 'string' && p.partId.trim().length > 0 ? p.partId.trim() : '';

    if (explicitId) {
      if (explicitIds.has(explicitId) || map.has(explicitId)) {
        throw new Error(
          `Colisión de identidad en ${label}: El partId explícito '${explicitId}' está duplicado en múltiples piezas.`
        );
      }
      explicitIds.add(explicitId);
      map.set(explicitId, p);
    } else {
      hasMissingPartIds = true;
      const baseFallbackKey = `fallback::${p.parentId || ''}::${p.hierarchyPath || ''}::${p.name || 'UnnamedPart'}`;
      const occurrence = (fallbackCounts.get(baseFallbackKey) || 0) + 1;
      fallbackCounts.set(baseFallbackKey, occurrence);

      const uniqueKey = `${baseFallbackKey}#${occurrence}`;
      if (occurrence > 1) {
        warnings.push(
          `Pieza sin partId estable en ${label} ('${p.name || 'UnnamedPart'}') desambiguada como ocurrencia #${occurrence}.`
        );
      } else {
        warnings.push(
          `Pieza '${p.name || 'UnnamedPart'}' en ${label} carece de partId estable; se usó clave compuesta '${uniqueKey}'.`
        );
      }
      map.set(uniqueKey, p);
    }
  }

  return { map, hasMissingPartIds };
}

/**
 * Compares two versions of an asset and determines surgical part-level changes:
 * added, removed, modified (with granular geometry/appearance/properties/hierarchy flags),
 * and unchanged parts.
 */
export function computeIncrementalDiff(
  baseAsset: Forge3DAsset | null,
  updatedAsset: Forge3DAsset
): IncrementalDiffReport {
  const baseParts = Array.isArray(baseAsset?.parts) ? baseAsset!.parts : [];
  const updatedParts = Array.isArray(updatedAsset.parts) ? updatedAsset.parts : [];
  const warnings: string[] = [];

  const baseResult = buildCollisionSafePartMap(baseParts, 'baseAsset', warnings);
  const updatedResult = buildCollisionSafePartMap(updatedParts, 'updatedAsset', warnings);

  const baseMap = baseResult.map;
  const updatedMap = updatedResult.map;
  const hasMissingPartIds = baseResult.hasMissingPartIds || updatedResult.hasMissingPartIds;

  const added: MeshPart3DSpec[] = [];
  const removed: MeshPart3DSpec[] = [];
  const modified: PartChangeDetail[] = [];
  const unchanged: MeshPart3DSpec[] = [];

  let hasGeometryChanges = false;
  let hasAppearanceChanges = false;
  let hasPropertiesChanges = false;
  let hasHierarchyChanges = false;

  // Detect root PBR profile changes
  if (baseAsset) {
    const basePbrHash = sha256Hex(toCanonicalJsonValue(baseAsset.pbr_profile));
    const updatedPbrHash = sha256Hex(toCanonicalJsonValue(updatedAsset.pbr_profile));
    if (basePbrHash !== updatedPbrHash) {
      hasAppearanceChanges = true;
    }
  }

  // Detect removed parts: removing a part affects geometry, appearance, properties, and hierarchy
  for (const [id, bp] of baseMap.entries()) {
    if (!updatedMap.has(id)) {
      removed.push(bp);
      hasGeometryChanges = true;
      hasAppearanceChanges = true;
      hasPropertiesChanges = true;
      hasHierarchyChanges = true;
    }
  }

  // Detect added, modified, unchanged parts
  for (const [id, up] of updatedMap.entries()) {
    const bp = baseMap.get(id);
    if (!bp) {
      added.push(up);
      hasGeometryChanges = true;
      hasAppearanceChanges = true;
      hasPropertiesChanges = true;
      hasHierarchyChanges = true;
      continue;
    }

    const geoChanged = partGeometryHash(bp) !== partGeometryHash(up);
    const appChanged = partAppearanceHash(bp) !== partAppearanceHash(up);
    const propChanged = partPropertiesHash(bp) !== partPropertiesHash(up);
    const hierChanged =
      (bp.hierarchyPath || '') !== (up.hierarchyPath || '') ||
      (bp.parentId || '') !== (up.parentId || '') ||
      (bp.parentName || '') !== (up.parentName || '') ||
      (bp.name || '') !== (up.name || '');

    if (geoChanged || appChanged || propChanged || hierChanged) {
      if (geoChanged) hasGeometryChanges = true;
      if (appChanged) hasAppearanceChanges = true;
      if (propChanged) hasPropertiesChanges = true;
      if (hierChanged) hasHierarchyChanges = true;

      modified.push({
        partId: up.partId || id,
        name: up.name,
        changeType: 'modified',
        geometryChanged: geoChanged,
        appearanceChanged: appChanged,
        propertiesChanged: propChanged,
        hierarchyChanged: hierChanged,
        basePart: bp,
        updatedPart: up,
      });
    } else {
      unchanged.push(up);
    }
  }

  return {
    assetName: updatedAsset.name,
    isEntireModelNew: !baseAsset || baseParts.length === 0,
    totalBefore: baseParts.length,
    totalAfter: updatedParts.length,
    added,
    removed,
    modified,
    unchanged,
    hasGeometryChanges,
    hasAppearanceChanges,
    hasPropertiesChanges,
    hasHierarchyChanges,
    hasMissingPartIds,
    warnings,
  };
}
