import { Forge3DAsset, MeshPart3DSpec } from './roblox3DEngine.ts';
import {
  toCanonicalJsonValue,
  sha256Hex,
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
  hasMissingPartIds: boolean;
  warnings: string[];
}

/**
 * Computes a hash for an individual part's geometry.
 */
export function partGeometryHash(p: MeshPart3DSpec): string {
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
export function partAppearanceHash(p: MeshPart3DSpec): string {
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
export function partPropertiesHash(p: MeshPart3DSpec): string {
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
 * Generates and persists deterministic, order-independent `partId`s for parts in an asset
 * before any version comparison or synchronization occurs.
 * If two parts lack `partId` and have identical names, their initial spatial/geometric digest
 * is incorporated into the generated `partId`, and any remaining identical clones receive a
 * canonical sort-order suffix so the generated IDs are persisted on the part objects themselves.
 */
export function ensurePersistentPartIdsForParts(
  parts: MeshPart3DSpec[],
  assetName: string
): MeshPart3DSpec[] {
  if (!Array.isArray(parts) || parts.length === 0) return [];

  const usedIds = new Set<string>();
  for (const p of parts) {
    if (p.partId && typeof p.partId === 'string' && p.partId.trim().length > 0) {
      usedIds.add(p.partId.trim());
    }
  }

  // Canonical sort of indices for parts missing partId so ID assignment is independent of input array order
  const indicesMissingId: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.partId || typeof p.partId !== 'string' || p.partId.trim().length === 0) {
      indicesMissingId.push(i);
    }
  }

  indicesMissingId.sort((idxA, idxB) => {
    const canonA = toCanonicalJsonValue(parts[idxA]);
    const canonB = toCanonicalJsonValue(parts[idxB]);
    return strictOrdinalCompare(canonA, canonB);
  });

  const assignedByOriginalIndex = new Map<number, string>();
  const prefixCounts = new Map<string, number>();

  for (const origIdx of indicesMissingId) {
    const p = parts[origIdx];
    const safeName = (p.name || 'Part').replace(/[^a-zA-Z0-9_]/g, '_') || 'Part';
    const contentDigest = sha256Hex(
      toCanonicalJsonValue({
        name: p.name,
        hierarchyPath: p.hierarchyPath || `Workspace/${assetName}/${p.name}`,
        parentId: p.parentId || '',
        shape: p.shape,
        size: p.size,
        position: p.position,
        rotation: p.rotation,
      })
    ).slice(0, 10);

    const baseCandidate = `pid_${safeName}_${contentDigest}`;
    const count = (prefixCounts.get(baseCandidate) || 0) + 1;
    prefixCounts.set(baseCandidate, count);

    let finalId = count === 1 ? baseCandidate : `${baseCandidate}_${count}`;
    while (usedIds.has(finalId)) {
      finalId = `${finalId}_x`;
    }
    usedIds.add(finalId);
    assignedByOriginalIndex.set(origIdx, finalId);
  }

  return parts.map((p, idx) => {
    const existingId = typeof p.partId === 'string' && p.partId.trim().length > 0 ? p.partId.trim() : '';
    const partId = existingId || assignedByOriginalIndex.get(idx)!;
    return {
      ...p,
      partId,
      hierarchyPath: p.hierarchyPath || `Workspace/${assetName}/${p.name}`,
    };
  });
}

/**
 * Ensures an entire Forge3DAsset has persistent `partId`s assigned to all parts.
 */
export function assignPersistentPartIds(asset: Forge3DAsset): Forge3DAsset {
  return {
    ...asset,
    parts: ensurePersistentPartIdsForParts(asset.parts || [], asset.name),
  };
}

/**
 * Builds an indexed map of parts without ever silently overwriting entries or relying on array occurrence indices.
 * - Throws an explicit error if two parts share the same explicit `partId`.
 * - For a part lacking `partId`, uses an order-independent composite key (`fallback::parentId::hierarchyPath::name`).
 * - If two or more parts lack `partId` and collide on that composite key, throws an explicit error demanding
 *   persistent `partId` assignment prior to diffing (never uses `#occurrence`, which would swap identities upon reordering).
 */
function buildCollisionSafePartMap(
  parts: MeshPart3DSpec[],
  label: string,
  warnings: string[]
): { map: Map<string, MeshPart3DSpec>; hasMissingPartIds: boolean } {
  const map = new Map<string, MeshPart3DSpec>();
  const explicitIds = new Set<string>();
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
      const fallbackKey = `fallback::${p.parentId || ''}::${p.hierarchyPath || ''}::${p.name || 'UnnamedPart'}`;
      if (map.has(fallbackKey)) {
        throw new Error(
          `Colisión de identidad ambigua en ${label}: múltiples piezas sin partId comparten '${fallbackKey}'. Los identificadores persistentes (partId) deben generarse y persistirse antes de comparar versiones.`
        );
      }
      warnings.push(
        `Pieza '${p.name || 'UnnamedPart'}' en ${label} carece de partId explícito; se usó clave jerárquica '${fallbackKey}'.`
      );
      map.set(fallbackKey, p);
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
