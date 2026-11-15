export interface AnatomicalValidationReport {
  passed: boolean;
  overallScore: number;
  categoryDetected: string;
  sculptingScore: number;
  continuityScore: number;
  groundingScore: number;
  surfaceQualityScore: number;
  silhouetteProportionScore: number;
  floatingPartCount: number;
  smoothPlasticRatio: number;
  hasVertexColorShading: boolean;
  hasRealPbrTextures: boolean;
  defects: string[];
  notes: string[];
}

interface PartLike {
  name?: string;
  position?: [number, number, number];
  size?: [number, number, number];
  material?: string;
  color?: string;
  roughness?: number;
  metalness?: number;
  meshData?: {
    vertices?: [number, number, number][];
    faces?: [number, number, number][];
    vertexColors?: [number, number, number][];
  };
}

function clampScore(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v * 10) / 10));
}

function getPartWorldBox(part: PartLike): {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
} {
  const pos = part.position || [0, 0, 0];
  const verts = part.meshData?.vertices;
  if (verts && verts.length >= 4) {
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (const [vx, vy, vz] of verts) {
      const wx = pos[0] + vx;
      const wy = pos[1] + vy;
      const wz = pos[2] + vz;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
      if (wz < minZ) minZ = wz;
      if (wz > maxZ) maxZ = wz;
    }
    return {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
      center: [(minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5],
    };
  }
  const size = part.size || [1, 1, 1];
  const hx = size[0] * 0.5;
  const hy = size[1] * 0.5;
  const hz = size[2] * 0.5;
  return {
    min: [pos[0] - hx, pos[1] - hy, pos[2] - hz],
    max: [pos[0] + hx, pos[1] + hy, pos[2] + hz],
    center: [pos[0], pos[1], pos[2]],
  };
}

function boxGapDistance(
  a: { min: [number, number, number]; max: [number, number, number] },
  b: { min: [number, number, number]; max: [number, number, number] }
): number {
  const dx = Math.max(0, a.min[0] - b.max[0], b.min[0] - a.max[0]);
  const dy = Math.max(0, a.min[1] - b.max[1], b.min[1] - a.max[1]);
  const dz = Math.max(0, a.min[2] - b.max[2], b.min[2] - a.max[2]);
  return Math.hypot(dx, dy, dz);
}

/**
 * Computes radial sculpting non-uniformity of a mesh: pure boxes/circles/spheres have low sculptural variation,
 * while anatomical spline-lofted organs have smooth curvature + cross-sectional asymmetry.
 */
function measureMeshSculptingRichness(part: PartLike): number {
  const verts = part.meshData?.vertices;
  if (!verts || verts.length < 16) return 15;
  let sumR = 0;
  const radii: number[] = [];
  for (const [vx, vy, vz] of verts) {
    const r = Math.hypot(vx, vy, vz);
    radii.push(r);
    sumR += r;
  }
  const meanR = sumR / radii.length || 1;
  let varSum = 0;
  for (const r of radii) {
    const d = (r - meanR) / meanR;
    varSum += d * d;
  }
  const cv = Math.sqrt(varSum / radii.length);
  // Check dorsal-ventral Y asymmetry (true organic forms are not vertically symmetric like plain cylinders)
  let upperY = 0,
    upperN = 0,
    lowerY = 0,
    lowerN = 0;
  for (const [vx, vy] of verts) {
    if (vy > 0.05) {
      upperY += Math.abs(vx);
      upperN++;
    } else if (vy < -0.05) {
      lowerY += Math.abs(vx);
      lowerN++;
    }
  }
  const dvAsym =
    upperN > 0 && lowerN > 0
      ? Math.abs(upperY / upperN - lowerY / lowerN) / Math.max(0.05, (upperY / upperN + lowerY / lowerN) * 0.5)
      : 0;

  const vertRichness = Math.min(35, (verts.length / 180) * 35);
  const cvScore = Math.min(45, (cv / 0.28) * 45);
  const asymScore = Math.min(20, (dvAsym / 0.08) * 20);
  return clampScore(vertRichness + cvScore + asymScore);
}

/**
 * Validates geometry, connectivity, grounding, material diversity, and anatomical realism
 * without relying on part-count inflation or naming tricks.
 */
export function validateAssetAnatomyAndQuality(asset: {
  prompt?: string;
  objectType?: string;
  parts?: PartLike[];
  pbr_textures?: { catalog?: Record<string, unknown> };
}): AnatomicalValidationReport {
  const parts = Array.isArray(asset.parts) ? asset.parts : [];
  const promptLower = `${asset.prompt || ''} ${asset.objectType || ''}`.toLowerCase();
  const defects: string[] = [];
  const notes: string[] = [];

  if (parts.length === 0) {
    return {
      passed: false,
      overallScore: 0,
      categoryDetected: 'empty',
      sculptingScore: 0,
      continuityScore: 0,
      groundingScore: 0,
      surfaceQualityScore: 0,
      silhouetteProportionScore: 0,
      floatingPartCount: 0,
      smoothPlasticRatio: 1,
      hasVertexColorShading: false,
      hasRealPbrTextures: false,
      defects: ['Asset contains zero parts'],
      notes: [],
    };
  }

  const boxes = parts.map(getPartWorldBox);
  let globalMinX = Infinity,
    globalMinY = Infinity,
    globalMinZ = Infinity,
    globalMaxX = -Infinity,
    globalMaxY = -Infinity,
    globalMaxZ = -Infinity;

  for (const box of boxes) {
    if (box.min[0] < globalMinX) globalMinX = box.min[0];
    if (box.min[1] < globalMinY) globalMinY = box.min[1];
    if (box.min[2] < globalMinZ) globalMinZ = box.min[2];
    if (box.max[0] > globalMaxX) globalMaxX = box.max[0];
    if (box.max[1] > globalMaxY) globalMaxY = box.max[1];
    if (box.max[2] > globalMaxZ) globalMaxZ = box.max[2];
  }

  // 1. Grounding check
  const groundOffset = Math.abs(globalMinY);
  const groundingScore = clampScore(groundOffset <= 0.15 ? 100 : Math.max(15, 100 - groundOffset * 35));
  if (groundOffset > 0.25) {
    defects.push(`Asset not grounded at Y=0 (minY=${globalMinY.toFixed(2)})`);
  }

  // 2. Connectivity / Floating part check (nearest-neighbor gap between 3D bounding boxes)
  let floatingPartCount = 0;
  if (boxes.length > 1) {
    for (let i = 0; i < boxes.length; i++) {
      let minGap = Infinity;
      for (let j = 0; j < boxes.length; j++) {
        if (i === j) continue;
        const g = boxGapDistance(boxes[i], boxes[j]);
        if (g < minGap) minGap = g;
      }
      if (minGap > 0.45) {
        floatingPartCount++;
      }
    }
  }
  const continuityScore = clampScore(
    boxes.length === 1 ? 75 : Math.max(10, 100 - (floatingPartCount / boxes.length) * 140)
  );
  if (floatingPartCount > 0) {
    defects.push(`${floatingPartCount} part(s) have spatial gaps > 0.45 studs from nearest connected part`);
  }

  // 3. Sculpting richness (measure top 3 largest-vertex-count parts)
  const sortedByVerts = [...parts].sort(
    (a, b) => (b.meshData?.vertices?.length || 0) - (a.meshData?.vertices?.length || 0)
  );
  const topMeshes = sortedByVerts.slice(0, Math.min(3, sortedByVerts.length));
  const avgSculpt =
    topMeshes.reduce((acc, p) => acc + measureMeshSculptingRichness(p), 0) / topMeshes.length;
  const sculptingScore = clampScore(avgSculpt);
  if (sculptingScore < 45) {
    defects.push(`Low geometric sculpting richness (${sculptingScore}/100): meshes resemble simple primitives`);
  }

  // 4. Surface material & shading richness (penalize SmoothPlastic dominance!)
  const smoothPlasticCount = parts.filter((p) => (p.material || 'SmoothPlastic') === 'SmoothPlastic').length;
  const smoothPlasticRatio = smoothPlasticCount / parts.length;
  const uniqueMaterials = new Set(parts.map((p) => p.material || 'SmoothPlastic'));
  const uniqueColors = new Set(
    parts.map((p: any) => {
      if (typeof p.colorHex === 'string') return p.colorHex.toLowerCase();
      if (typeof p.color === 'string') return p.color.toLowerCase();
      if (Array.isArray(p.color) && p.color.length >= 3) return p.color.slice(0, 3).join(',');
      return '#888888';
    })
  );
  const hasVertexColorShading = parts.some(
    (p) => Array.isArray(p.meshData?.vertexColors) && p.meshData.vertexColors.length > 0
  );
  const hasRealPbrTextures = Boolean(
    asset.pbr_textures?.catalog && Object.keys(asset.pbr_textures.catalog).length > 0
  );

  let surfaceQualityScore = 30;
  surfaceQualityScore += Math.min(25, (uniqueMaterials.size - 1) * 12 + 8);
  surfaceQualityScore += Math.min(15, (uniqueColors.size - 1) * 5 + 3);
  if (hasVertexColorShading) surfaceQualityScore += 15;
  if (hasRealPbrTextures) surfaceQualityScore += 15;
  surfaceQualityScore -= smoothPlasticRatio * 38;
  surfaceQualityScore = clampScore(surfaceQualityScore);

  if (smoothPlasticRatio > 0.65) {
    defects.push(`Overuse of SmoothPlastic (${Math.round(smoothPlasticRatio * 100)}% of parts)`);
  }

  // 5. Category-aware silhouette & proportion checks
  const spanX = Math.max(0.1, globalMaxX - globalMinX);
  const spanY = Math.max(0.1, globalMaxY - globalMinY);
  const spanZ = Math.max(0.1, globalMaxZ - globalMinZ);
  let categoryDetected = 'freeform_object';
  let silhouetteProportionScore = 78;

  const isQuadruped = /\b(horse|caballo|cow|vaca|toro|dog|perro|wolf|lobo|deer|ciervo|cat|gato)\b/.test(promptLower);
  const isVehicle = /\b(car|coche|auto|supercar|truck|moto|motorcycle|vehicle|vehiculo|sports car)\b/.test(promptLower);
  const isTree = /\b(tree|arbol|árbol|oak|pine|willow|bonsai)\b/.test(promptLower);
  const isBuilding = /\b(house|casa|castle|castillo|tower|torre|cabin|cabaña|building|edificio)\b/.test(promptLower);

  if (isQuadruped) {
    categoryDetected = 'quadruped_animal';
    const elongated = spanZ > spanX * 1.35;
    const groundedQuadrants = new Set<string>();
    for (const box of boxes) {
      if (box.min[1] <= globalMinY + 0.35) {
        const qx = box.center[0] >= 0 ? 'R' : 'L';
        const qz = box.center[2] >= 0 ? 'F' : 'B';
        groundedQuadrants.add(`${qx}${qz}`);
      }
    }
    silhouetteProportionScore = clampScore(
      (elongated ? 40 : 12) + groundedQuadrants.size * 15
    );
    if (groundedQuadrants.size < 4) {
      defects.push(`Quadruped missing 4-corner grounded limb support (${groundedQuadrants.size}/4 quadrants)`);
    }
    if (!elongated) {
      defects.push(`Quadruped torso lacks cranial-caudal elongation (Z=${spanZ.toFixed(2)}, X=${spanX.toFixed(2)})`);
    }
  } else if (isVehicle) {
    categoryDetected = 'wheeled_vehicle';
    const longChassis = spanZ > spanX * 1.4;
    const lowStance = spanY < spanZ * 0.65;
    silhouetteProportionScore = clampScore((longChassis ? 50 : 20) + (lowStance ? 45 : 20));
  } else if (isTree) {
    categoryDetected = 'vegetation_tree';
    const tall = spanY >= spanX * 0.8;
    const hasHighCrown = boxes.some((b) => b.max[1] > globalMinY + spanY * 0.72);
    silhouetteProportionScore = clampScore((tall ? 50 : 25) + (hasHighCrown ? 45 : 20));
  } else if (isBuilding) {
    categoryDetected = 'architecture_building';
    const substantialFootprint = spanX >= 3 && spanZ >= 3;
    silhouetteProportionScore = clampScore(substantialFootprint ? 92 : 62);
  } else {
    silhouetteProportionScore = clampScore(parts.length >= 3 ? 86 : 65);
  }

  const overallScore = clampScore(
    sculptingScore * 0.25 +
      continuityScore * 0.2 +
      groundingScore * 0.15 +
      surfaceQualityScore * 0.25 +
      silhouetteProportionScore * 0.15
  );

  const passed = overallScore >= 68 && floatingPartCount === 0 && groundOffset <= 0.25;
  notes.push(
    `category=${categoryDetected}`,
    `sculpt=${sculptingScore}`,
    `surface=${surfaceQualityScore}`,
    `continuity=${continuityScore}`
  );

  return {
    passed,
    overallScore,
    categoryDetected,
    sculptingScore,
    continuityScore,
    groundingScore,
    surfaceQualityScore,
    silhouetteProportionScore,
    floatingPartCount,
    smoothPlasticRatio: Math.round(smoothPlasticRatio * 1000) / 1000,
    hasVertexColorShading,
    hasRealPbrTextures,
    defects,
    notes,
  };
}
