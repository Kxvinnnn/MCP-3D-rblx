import type { Forge3DAsset } from './types.ts';

export interface AssetStudDimensions {
  width: number;
  height: number;
  depth: number;
  minY: number;
  maxY: number;
}

/**
 * Computes exact bounding-box dimensions (in Roblox studs) and Y extrema
 * across all vertices or fallback part sizes of a Forge3DAsset.
 */
export function computeAssetStudDimensions(asset: Forge3DAsset): AssetStudDimensions {
  if (!asset.parts || asset.parts.length === 0) {
    return { width: 0, height: 0, depth: 0, minY: 0, maxY: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const part of asset.parts) {
    const [px = 0, py = 0, pz = 0] = part.position || [0, 0, 0];
    const [sx = 2, sy = 2, sz = 2] = part.size || [2, 2, 2];
    const verts = part.meshData?.vertices || [];

    if (verts.length > 0) {
      for (const v of verts) {
        const vx = px + Number(v[0] ?? 0);
        const vy = py + Number(v[1] ?? 0);
        const vz = pz + Number(v[2] ?? 0);
        if (vx < minX) minX = vx;
        if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy;
        if (vy > maxY) maxY = vy;
        if (vz < minZ) minZ = vz;
        if (vz > maxZ) maxZ = vz;
      }
    } else {
      minX = Math.min(minX, px - sx / 2);
      maxX = Math.max(maxX, px + sx / 2);
      minY = Math.min(minY, py - sy / 2);
      maxY = Math.max(maxY, py + sy / 2);
      minZ = Math.min(minZ, pz - sz / 2);
      maxZ = Math.max(maxZ, pz + sz / 2);
    }
  }

  return {
    width: Number(Math.max(0, maxX - minX).toFixed(2)),
    height: Number(Math.max(0, maxY - minY).toFixed(2)),
    depth: Number(Math.max(0, maxZ - minZ).toFixed(2)),
    minY: Number((Number.isFinite(minY) ? minY : 0).toFixed(2)),
    maxY: Number((Number.isFinite(maxY) ? maxY : 0).toFixed(2)),
  };
}

/**
 * Triggers a client-side file download from a text string or Blob and safely
 * revokes the object URL afterwards.
 */
export function triggerBlobDownload(
  content: string | Blob,
  mime: string,
  filename: string
): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
