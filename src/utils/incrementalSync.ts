import { Forge3DAsset, MeshPart3DSpec } from './roblox3DEngine.ts';
import {
  toCanonicalJsonValue,
  sha256Hex,
  computeGeometryHash,
  computeAppearanceHash,
  computePropertiesHash,
  strictOrdinalCompare,
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
      doubleSided: p.doubleSided,
      pbrMaterial: p.pbrMaterial,
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

  const baseMap = new Map<string, MeshPart3DSpec>();
  for (const bp of baseParts) {
    const id = bp.partId || bp.hierarchyPath || bp.name;
    baseMap.set(id, bp);
  }

  const updatedMap = new Map<string, MeshPart3DSpec>();
  for (const up of updatedParts) {
    const id = up.partId || up.hierarchyPath || up.name;
    updatedMap.set(id, up);
  }

  const added: MeshPart3DSpec[] = [];
  const removed: MeshPart3DSpec[] = [];
  const modified: PartChangeDetail[] = [];
  const unchanged: MeshPart3DSpec[] = [];

  let hasGeometryChanges = false;
  let hasAppearanceChanges = false;
  let hasPropertiesChanges = false;
  let hasHierarchyChanges = false;

  // Detect removed parts
  for (const [id, bp] of baseMap.entries()) {
    if (!updatedMap.has(id)) {
      removed.push(bp);
    }
  }

  // Detect added, modified, unchanged parts
  for (const [id, up] of updatedMap.entries()) {
    const bp = baseMap.get(id);
    if (!bp) {
      added.push(up);
      hasGeometryChanges = true;
      continue;
    }

    const geoChanged = partGeometryHash(bp) !== partGeometryHash(up);
    const appChanged = partAppearanceHash(bp) !== partAppearanceHash(up);
    const propChanged = partPropertiesHash(bp) !== partPropertiesHash(up);
    const hierChanged =
      (bp.hierarchyPath || '') !== (up.hierarchyPath || '') ||
      (bp.parentId || '') !== (up.parentId || '') ||
      (bp.parentName || '') !== (up.parentName || '');

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
  };
}
