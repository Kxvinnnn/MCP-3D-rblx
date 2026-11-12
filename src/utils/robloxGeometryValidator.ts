import { Forge3DAsset, MeshPart3DSpec } from './roblox3DEngine.ts';

type CustomMeshData = NonNullable<MeshPart3DSpec['meshData']>;

export interface RobloxGeometryValidationReport {
  isValid: boolean;
  isEmptyModel: boolean;
  warnings: string[];
  errors: string[];
  totalParts: number;
  totalVertices: number;
  totalTriangles: number;
  hasEditableMeshLimitsExceeded: boolean;
  hasScaleLimitsExceeded: boolean;
  hasInvalidIndices: boolean;
  hasNonFiniteCoordinates: boolean;
  hasMalformedFaces: boolean;
  hasDegenerateFaces: boolean;
  hasIncompleteGeometry: boolean;
}

export interface GeometryValidationOptions {
  /**
   * When false (default for export, save, and Studio sync), an asset with 0 parts is rejected as invalid.
   * When true, an empty asset is flagged with `isEmptyModel: true` and a warning, allowing transient empty containers only when explicitly requested.
   */
  allowEmptyParts?: boolean;
}

const ROBLOX_MIN_PART_SIZE = 0.001; // Modern Roblox studs minimum
const ROBLOX_MAX_PART_SIZE = 2048;  // Roblox studs maximum
const EDITABLE_MESH_MAX_VERTICES = 20000;
const EDITABLE_MESH_MAX_TRIANGLES = 20000;

/**
 * Relative geometric tolerance factor:
 * A triangle is non-degenerate when its area exceeds `maxEdgeLengthSquared * RELATIVE_TRIANGLE_AREA_FACTOR`.
 * Because area scales with L^2, comparing `area` to `L_max^2 * 1e-7` is 100% scale-invariant across
 * micro-scale (0.001 studs) and macro-scale (2048 studs) models.
 */
const RELATIVE_TRIANGLE_AREA_FACTOR = 1e-7;
const MIN_ABSOLUTE_EDGE_LENGTH_SQ = 1e-18;

/**
 * Computes the squared Euclidean distance between two 3D points.
 */
export function computeDistanceSq3D(a: number[], b: number[]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Computes the 3D surface area of a triangle formed by 3 vertices.
 */
export function computeTriangleArea3D(v0: number[], v1: number[], v2: number[]): number {
  if (!v0 || !v1 || !v2 || v0.length < 3 || v1.length < 3 || v2.length < 3) return 0;
  if (
    !Number.isFinite(v0[0]) || !Number.isFinite(v0[1]) || !Number.isFinite(v0[2]) ||
    !Number.isFinite(v1[0]) || !Number.isFinite(v1[1]) || !Number.isFinite(v1[2]) ||
    !Number.isFinite(v2[0]) || !Number.isFinite(v2[1]) || !Number.isFinite(v2[2])
  ) {
    return 0;
  }

  const ax = v1[0] - v0[0];
  const ay = v1[1] - v0[1];
  const az = v1[2] - v0[2];

  const bx = v2[0] - v0[0];
  const by = v2[1] - v0[1];
  const bz = v2[2] - v0[2];

  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;

  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/**
 * Determines whether a 3D triangle is non-degenerate using a scale-relative area threshold
 * proportional to the square of its longest edge (`maxEdgeSq * RELATIVE_TRIANGLE_AREA_FACTOR`).
 */
export function isTriangleNonDegenerate3D(v0: number[], v1: number[], v2: number[]): boolean {
  if (!v0 || !v1 || !v2 || v0.length < 3 || v1.length < 3 || v2.length < 3) return false;
  if (
    !Number.isFinite(v0[0]) || !Number.isFinite(v0[1]) || !Number.isFinite(v0[2]) ||
    !Number.isFinite(v1[0]) || !Number.isFinite(v1[1]) || !Number.isFinite(v1[2]) ||
    !Number.isFinite(v2[0]) || !Number.isFinite(v2[1]) || !Number.isFinite(v2[2])
  ) {
    return false;
  }

  const e01Sq = computeDistanceSq3D(v0, v1);
  const e12Sq = computeDistanceSq3D(v1, v2);
  const e20Sq = computeDistanceSq3D(v2, v0);
  const maxEdgeSq = Math.max(e01Sq, e12Sq, e20Sq);

  if (maxEdgeSq < MIN_ABSOLUTE_EDGE_LENGTH_SQ) {
    return false;
  }

  const area = computeTriangleArea3D(v0, v1, v2);
  const minRelativeArea = maxEdgeSq * RELATIVE_TRIANGLE_AREA_FACTOR;
  return area > minRelativeArea;
}

export interface FaceTriangulationResult {
  valid: boolean;
  triangles: [number, number, number][];
  reason?:
    | 'not_array'
    | 'too_few_vertices'
    | 'invalid_index'
    | 'degenerate_duplicate_vertices'
    | 'degenerate_collinear_or_zero_area'
    | 'self_intersecting_or_non_triangulable';
}

/**
 * Triangulates a 3D polygon face (convex or concave) using Newell normal projection + 2D Ear Clipping,
 * with scale-relative geometric tolerances and 3D triangle non-degeneracy verification.
 * Never uses the naive (N - 2) formula without geometric verification.
 */
export function triangulatePolygonFace3D(face: number[], vertices: number[][]): FaceTriangulationResult {
  if (!Array.isArray(face)) {
    return { valid: false, triangles: [], reason: 'not_array' };
  }

  if (face.length < 3) {
    return { valid: false, triangles: [], reason: 'too_few_vertices' };
  }

  const vLen = Array.isArray(vertices) ? vertices.length : 0;
  const cleaned: number[] = [];

  for (let i = 0; i < face.length; i++) {
    const idx = face[i];
    if (typeof idx !== 'number' || Number.isNaN(idx) || idx < 0 || idx >= vLen || !Number.isInteger(idx)) {
      return { valid: false, triangles: [], reason: 'invalid_index' };
    }
    const v = vertices[idx];
    if (!Array.isArray(v) || v.length < 3 || !Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) {
      return { valid: false, triangles: [], reason: 'invalid_index' };
    }
    if (cleaned.length === 0 || cleaned[cleaned.length - 1] !== idx) {
      cleaned.push(idx);
    }
  }

  // Remove circular duplicate if closing vertex equals opening vertex
  if (cleaned.length > 1 && cleaned[0] === cleaned[cleaned.length - 1]) {
    cleaned.pop();
  }

  // Ensure all vertices in cleaned are distinct (no repeated vertex index inside a simple polygon loop)
  const uniqueSet = new Set(cleaned);
  if (cleaned.length < 3 || uniqueSet.size < 3 || uniqueSet.size !== cleaned.length) {
    return { valid: false, triangles: [], reason: 'degenerate_duplicate_vertices' };
  }

  if (cleaned.length === 3) {
    const v0 = vertices[cleaned[0]];
    const v1 = vertices[cleaned[1]];
    const v2 = vertices[cleaned[2]];
    if (isTriangleNonDegenerate3D(v0, v1, v2)) {
      return {
        valid: true,
        triangles: [[cleaned[0], cleaned[1], cleaned[2]]],
      };
    }
    return { valid: false, triangles: [], reason: 'degenerate_collinear_or_zero_area' };
  }

  // Compute 3D bounding box diagonal squared of the polygon to establish scale-relative tolerances
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < cleaned.length; i++) {
    const v = vertices[cleaned[i]];
    if (v[0] < minX) minX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[2] < minZ) minZ = v[2];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] > maxY) maxY = v[1];
    if (v[2] > maxZ) maxZ = v[2];
  }
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  const bboxDiagSq = dx * dx + dy * dy + dz * dz;

  if (bboxDiagSq < MIN_ABSOLUTE_EDGE_LENGTH_SQ) {
    return { valid: false, triangles: [], reason: 'degenerate_collinear_or_zero_area' };
  }

  // Newell's method for normal of 3D polygon with > 3 vertices
  // Note: |normal| from Newell's method is equal to 2 * polygon_area, which scales with bboxDiagSq (L^2)
  let nx = 0, ny = 0, nz = 0;
  const n = cleaned.length;
  for (let i = 0; i < n; i++) {
    const curr = vertices[cleaned[i]];
    const next = vertices[cleaned[(i + 1) % n]];
    nx += (curr[1] - next[1]) * (curr[2] + next[2]);
    ny += (curr[2] - next[2]) * (curr[0] + next[0]);
    nz += (curr[0] - next[0]) * (curr[1] + next[1]);
  }

  const normLength = Math.sqrt(nx * nx + ny * ny + nz * nz);
  const relativeNormThreshold = bboxDiagSq * RELATIVE_TRIANGLE_AREA_FACTOR;
  if (normLength <= relativeNormThreshold) {
    return { valid: false, triangles: [], reason: 'degenerate_collinear_or_zero_area' };
  }

  // Project onto dominant 2D plane
  const absX = Math.abs(nx);
  const absY = Math.abs(ny);
  const absZ = Math.abs(nz);

  const project2D = (v: number[]): [number, number] => {
    if (absX >= absY && absX >= absZ) return [v[1], v[2]];
    if (absY >= absX && absY >= absZ) return [v[0], v[2]];
    return [v[0], v[1]];
  };

  const poly2D: [number, number][] = cleaned.map((idx) => project2D(vertices[idx]));

  const area2D = (p0: [number, number], p1: [number, number], p2: [number, number]) => {
    return (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
  };

  let signedAreaSum = 0;
  for (let i = 0; i < poly2D.length; i++) {
    const p0 = poly2D[i];
    const p1 = poly2D[(i + 1) % poly2D.length];
    signedAreaSum += p0[0] * p1[1] - p1[0] * p0[1];
  }

  const relative2DAreaThreshold = bboxDiagSq * RELATIVE_TRIANGLE_AREA_FACTOR;
  if (Math.abs(signedAreaSum) <= relative2DAreaThreshold) {
    return { valid: false, triangles: [], reason: 'degenerate_collinear_or_zero_area' };
  }

  const ccw = signedAreaSum > 0;
  const convexityEps = bboxDiagSq * 1e-9;
  const pointInTriEps = bboxDiagSq * 1e-9;

  const isPointInTri2D = (pt: [number, number], a: [number, number], b: [number, number], c: [number, number]) => {
    const cp1 = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]);
    const cp2 = (c[0] - b[0]) * (pt[1] - b[1]) - (c[1] - b[1]) * (pt[0] - b[0]);
    const cp3 = (a[0] - c[0]) * (pt[1] - c[1]) - (a[1] - c[1]) * (pt[0] - c[0]);

    if (ccw) {
      return cp1 >= -pointInTriEps && cp2 >= -pointInTriEps && cp3 >= -pointInTriEps;
    } else {
      return cp1 <= pointInTriEps && cp2 <= pointInTriEps && cp3 <= pointInTriEps;
    }
  };

  const activeIndices = cleaned.map((_, i) => i);
  const triangles: [number, number, number][] = [];
  let guardCounter = activeIndices.length * 3;

  while (activeIndices.length >= 3 && guardCounter > 0) {
    guardCounter--;
    let earFound = false;

    for (let i = 0; i < activeIndices.length; i++) {
      const prevIdx = activeIndices[(i - 1 + activeIndices.length) % activeIndices.length];
      const currIdx = activeIndices[i];
      const nextIdx = activeIndices[(i + 1) % activeIndices.length];

      const pPrev = poly2D[prevIdx];
      const pCurr = poly2D[currIdx];
      const pNext = poly2D[nextIdx];

      const triCross = area2D(pPrev, pCurr, pNext);
      const isConvex = ccw ? triCross > convexityEps : triCross < -convexityEps;

      if (!isConvex) continue;

      let containsOtherPt = false;
      for (let j = 0; j < activeIndices.length; j++) {
        if (
          j === i ||
          j === (i - 1 + activeIndices.length) % activeIndices.length ||
          j === (i + 1) % activeIndices.length
        ) {
          continue;
        }
        const testPt = poly2D[activeIndices[j]];
        if (isPointInTri2D(testPt, pPrev, pCurr, pNext)) {
          containsOtherPt = true;
          break;
        }
      }

      if (!containsOtherPt) {
        const v3d0 = vertices[cleaned[prevIdx]];
        const v3d1 = vertices[cleaned[currIdx]];
        const v3d2 = vertices[cleaned[nextIdx]];
        if (isTriangleNonDegenerate3D(v3d0, v3d1, v3d2)) {
          triangles.push([cleaned[prevIdx], cleaned[currIdx], cleaned[nextIdx]]);
        } else {
          return { valid: false, triangles: [], reason: 'degenerate_collinear_or_zero_area' };
        }
        activeIndices.splice(i, 1);
        earFound = true;
        break;
      }
    }

    if (!earFound) {
      return { valid: false, triangles: [], reason: 'self_intersecting_or_non_triangulable' };
    }
  }

  if (triangles.length === 0) {
    return { valid: false, triangles: [], reason: 'degenerate_collinear_or_zero_area' };
  }

  return { valid: true, triangles };
}

/**
 * Counts valid non-degenerate 3D triangles in a face using scale-relative Ear Clipping.
 */
export function countValidTrianglesInFace(face: number[], vertices: number[][]): number {
  const res = triangulatePolygonFace3D(face, vertices);
  return res.valid ? res.triangles.length : 0;
}

/**
 * Validates a mesh buffer structure (`meshData` or `baseMeshData`) with identical rigor:
 * - vertices & faces arrays presence and non-empty checks
 * - finite vertex, normal, and UV coordinates
 * - index bounds validation
 * - 3D Ear Clipping triangulation for polygons with >= 3 vertices
 * - EditableMesh vertex/triangle limit warnings
 */
function validateMeshBufferStructure(
  meshObj: CustomMeshData,
  partLabel: string,
  fieldName: 'meshData' | 'baseMeshData',
  report: RobloxGeometryValidationReport,
  accumulateTotals: boolean
): void {
  const vertices = meshObj.vertices;
  const faces = meshObj.faces;

  if (!Array.isArray(vertices) || !Array.isArray(faces)) {
    report.isValid = false;
    report.hasIncompleteGeometry = true;
    report.errors.push(`${partLabel}: ${fieldName} incompleto (vertices y faces deben ser arrays).`);
    return;
  }

  if (vertices.length < 3 || faces.length === 0) {
    report.isValid = false;
    report.hasIncompleteGeometry = true;
    report.errors.push(
      `${partLabel}: ${fieldName} vacío o insuficiente (${vertices.length} vértices, ${faces.length} caras).`
    );
    return;
  }

  if (accumulateTotals) {
    report.totalVertices += vertices.length;
  }

  if (vertices.length > EDITABLE_MESH_MAX_VERTICES) {
    report.warnings.push(
      `${partLabel} (${fieldName}): El conteo de vértices (${vertices.length}) excede el límite recomendado de EditableMesh (${EDITABLE_MESH_MAX_VERTICES}).`
    );
    report.hasEditableMeshLimitsExceeded = true;
  }

  // Check non-finite vertex coordinates
  let hasBadVertex = false;
  for (let vIdx = 0; vIdx < vertices.length; vIdx++) {
    const v = vertices[vIdx];
    if (
      !Array.isArray(v) ||
      v.length < 3 ||
      typeof v[0] !== 'number' ||
      typeof v[1] !== 'number' ||
      typeof v[2] !== 'number' ||
      !Number.isFinite(v[0]) ||
      !Number.isFinite(v[1]) ||
      !Number.isFinite(v[2])
    ) {
      report.isValid = false;
      report.hasNonFiniteCoordinates = true;
      hasBadVertex = true;
      report.errors.push(`${partLabel} (${fieldName}): Vértice #${vIdx} contiene coordenadas no finitas o incompletas.`);
    }
  }

  // Optional normals validation
  if (meshObj.normals !== undefined) {
    if (!Array.isArray(meshObj.normals)) {
      report.isValid = false;
      report.hasIncompleteGeometry = true;
      report.errors.push(`${partLabel}: ${fieldName}.normals no es un array válido.`);
    } else {
      for (let nIdx = 0; nIdx < meshObj.normals.length; nIdx++) {
        const n = meshObj.normals[nIdx];
        if (!Array.isArray(n) || n.length < 3 || !Number.isFinite(n[0]) || !Number.isFinite(n[1]) || !Number.isFinite(n[2])) {
          report.isValid = false;
          report.hasNonFiniteCoordinates = true;
          report.errors.push(`${partLabel} (${fieldName}): Normal #${nIdx} contiene valores no finitos o incompletos.`);
        }
      }
    }
  }

  // Optional UVs validation
  if (meshObj.uvs !== undefined) {
    if (!Array.isArray(meshObj.uvs)) {
      report.isValid = false;
      report.hasIncompleteGeometry = true;
      report.errors.push(`${partLabel}: ${fieldName}.uvs no es un array válido.`);
    } else {
      for (let uIdx = 0; uIdx < meshObj.uvs.length; uIdx++) {
        const uv = meshObj.uvs[uIdx];
        if (!Array.isArray(uv) || uv.length < 2 || !Number.isFinite(uv[0]) || !Number.isFinite(uv[1])) {
          report.isValid = false;
          report.hasNonFiniteCoordinates = true;
          report.errors.push(`${partLabel} (${fieldName}): UV #${uIdx} contiene valores no finitos o incompletos.`);
        }
      }
    }
  }

  // Check faces and triangulate via scale-relative 3D Ear Clipping
  let partTris = 0;
  for (let fIdx = 0; fIdx < faces.length; fIdx++) {
    const face = faces[fIdx];
    if (!Array.isArray(face)) {
      report.isValid = false;
      report.hasMalformedFaces = true;
      report.errors.push(`${partLabel} (${fieldName}): Cara #${fIdx} mal formada (no es un array de índices).`);
      continue;
    }

    if (face.length < 3) {
      report.isValid = false;
      report.hasMalformedFaces = true;
      report.errors.push(`${partLabel} (${fieldName}): Cara #${fIdx} tiene menos de 3 vértices (${face.length}).`);
      continue;
    }

    let faceHasInvalidIndex = false;
    for (const idx of face) {
      if (typeof idx !== 'number' || Number.isNaN(idx) || idx < 0 || idx >= vertices.length || !Number.isInteger(idx)) {
        report.isValid = false;
        report.hasInvalidIndices = true;
        faceHasInvalidIndex = true;
        report.errors.push(
          `${partLabel} (${fieldName}): Cara #${fIdx} contiene un índice inválido (${idx}) fuera del rango de vértices (0..${vertices.length - 1}).`
        );
      }
    }

    if (faceHasInvalidIndex || hasBadVertex) {
      continue;
    }

    const triResult = triangulatePolygonFace3D(face, vertices);
    if (!triResult.valid) {
      report.isValid = false;
      report.hasDegenerateFaces = true;
      report.errors.push(
        `${partLabel} (${fieldName}): Cara #${fIdx} (${face.length} vértices) es geométricamente degenerada o auto-intersectante (${triResult.reason}).`
      );
    } else {
      partTris += triResult.triangles.length;
    }
  }

  if (accumulateTotals) {
    report.totalTriangles += partTris;
  }

  if (partTris > EDITABLE_MESH_MAX_TRIANGLES) {
    report.warnings.push(
      `${partLabel} (${fieldName}): El conteo de triángulos (${partTris}) excede el límite recomendado de EditableMesh (${EDITABLE_MESH_MAX_TRIANGLES}).`
    );
    report.hasEditableMeshLimitsExceeded = true;
  }
}

/**
 * Validates a 3D asset model against Roblox DataModel and EditableMesh constraints.
 * Validates both `meshData` and `baseMeshData` with identical rigor, and rejects empty models
 * (`parts.length === 0`) for export/persistence/sync unless `options.allowEmptyParts` is explicitly true.
 */
export function validateRobloxGeometry(
  asset: Forge3DAsset | null,
  options?: GeometryValidationOptions
): RobloxGeometryValidationReport {
  const report: RobloxGeometryValidationReport = {
    isValid: true,
    isEmptyModel: false,
    warnings: [],
    errors: [],
    totalParts: 0,
    totalVertices: 0,
    totalTriangles: 0,
    hasEditableMeshLimitsExceeded: false,
    hasScaleLimitsExceeded: false,
    hasInvalidIndices: false,
    hasNonFiniteCoordinates: false,
    hasMalformedFaces: false,
    hasDegenerateFaces: false,
    hasIncompleteGeometry: false,
  };

  if (!asset || typeof asset !== 'object') {
    report.isValid = false;
    report.errors.push('No hay ningún recurso de modelo 3D proporcionado.');
    return report;
  }

  if (!Array.isArray(asset.parts)) {
    report.isValid = false;
    report.hasIncompleteGeometry = true;
    report.errors.push('La estructura de piezas (asset.parts) no es un array válido.');
    return report;
  }

  const parts = asset.parts;
  report.totalParts = parts.length;

  if (parts.length === 0) {
    report.isEmptyModel = true;
    if (options?.allowEmptyParts) {
      report.warnings.push('El recurso 3D no contiene ninguna pieza (contenedor vacío en edición).');
    } else {
      report.isValid = false;
      report.hasIncompleteGeometry = true;
      report.errors.push('El modelo 3D no contiene ninguna pieza (parts vacío): no es un recurso exportable ni sincronizable.');
    }
    return report;
  }

  for (let pIdx = 0; pIdx < parts.length; pIdx++) {
    const part = parts[pIdx];
    if (!part || typeof part !== 'object') {
      report.isValid = false;
      report.hasIncompleteGeometry = true;
      report.errors.push(`Pieza #${pIdx + 1}: Estructura de pieza nula o inválida.`);
      continue;
    }

    const partLabel = `Pieza #${pIdx + 1} (${part.name || 'SinNombre'})`;

    // 1. Check size / scale limits
    if (!Array.isArray(part.size) || part.size.length < 3) {
      report.isValid = false;
      report.hasIncompleteGeometry = true;
      report.errors.push(`${partLabel}: Propiedad size ausente o incompleta (requiere [x, y, z]).`);
    } else {
      for (let axis = 0; axis < 3; axis++) {
        const val = part.size[axis];
        if (typeof val !== 'number' || !Number.isFinite(val)) {
          report.isValid = false;
          report.hasNonFiniteCoordinates = true;
          report.errors.push(`${partLabel}: La dimensión en el eje ${axis} no es un número finito (${val}).`);
        } else if (val <= 0) {
          report.isValid = false;
          report.hasScaleLimitsExceeded = true;
          report.errors.push(`${partLabel}: La dimensión en el eje ${axis} debe ser positiva (${val}).`);
        } else if (val < ROBLOX_MIN_PART_SIZE) {
          report.warnings.push(
            `${partLabel}: El tamaño (${val} studs) está por debajo del mínimo recomendado de Roblox (${ROBLOX_MIN_PART_SIZE} studs).`
          );
          report.hasScaleLimitsExceeded = true;
        } else if (val > ROBLOX_MAX_PART_SIZE) {
          report.isValid = false;
          report.hasScaleLimitsExceeded = true;
          report.errors.push(
            `${partLabel}: El tamaño (${val} studs) supera el límite máximo de Roblox (${ROBLOX_MAX_PART_SIZE} studs).`
          );
        }
      }
    }

    // 2. Check position non-finite values
    if (!Array.isArray(part.position) || part.position.length < 3) {
      report.isValid = false;
      report.hasIncompleteGeometry = true;
      report.errors.push(`${partLabel}: Propiedad position ausente o incompleta (requiere [x, y, z]).`);
    } else {
      for (let axis = 0; axis < 3; axis++) {
        const posVal = part.position[axis];
        if (typeof posVal !== 'number' || !Number.isFinite(posVal)) {
          report.isValid = false;
          report.hasNonFiniteCoordinates = true;
          report.errors.push(`${partLabel}: Posición en eje ${axis} contiene coordenada no finita (${posVal}).`);
        }
      }
    }

    // 3. Check rotation & rotationMatrix non-finite values
    if (part.rotation !== undefined) {
      if (!Array.isArray(part.rotation) || part.rotation.length < 3) {
        report.isValid = false;
        report.hasIncompleteGeometry = true;
        report.errors.push(`${partLabel}: Propiedad rotation mal formada (requiere [rx, ry, rz]).`);
      } else {
        for (let axis = 0; axis < 3; axis++) {
          const rotVal = part.rotation[axis];
          if (typeof rotVal !== 'number' || !Number.isFinite(rotVal)) {
            report.isValid = false;
            report.hasNonFiniteCoordinates = true;
            report.errors.push(`${partLabel}: Rotación en eje ${axis} contiene un valor no finito (${rotVal}).`);
          }
        }
      }
    }

    if (part.rotationMatrix !== undefined) {
      if (!Array.isArray(part.rotationMatrix) || part.rotationMatrix.length !== 9) {
        report.isValid = false;
        report.hasIncompleteGeometry = true;
        report.errors.push(`${partLabel}: rotationMatrix debe contener exactamente 9 elementos numéricos.`);
      } else {
        for (let mIdx = 0; mIdx < 9; mIdx++) {
          const mVal = part.rotationMatrix[mIdx];
          if (typeof mVal !== 'number' || !Number.isFinite(mVal)) {
            report.isValid = false;
            report.hasNonFiniteCoordinates = true;
            report.errors.push(`${partLabel}: rotationMatrix[${mIdx}] contiene un valor no finito (${mVal}).`);
          }
        }
      }
    }

    // 4. Validate meshData and baseMeshData with identical rigor
    const hasMeshData = part.meshData !== undefined && part.meshData !== null;
    const hasBaseMeshData = part.baseMeshData !== undefined && part.baseMeshData !== null;

    if (hasMeshData) {
      validateMeshBufferStructure(part.meshData!, partLabel, 'meshData', report, true);
    }

    if (hasBaseMeshData) {
      // Accumulate totals from baseMeshData only if meshData was not present
      validateMeshBufferStructure(part.baseMeshData!, partLabel, 'baseMeshData', report, !hasMeshData);
    }

    if (!hasMeshData && !hasBaseMeshData) {
      // Primitive estimation
      report.totalVertices += 8;
      report.totalTriangles += 12;
    }
  }

  return report;
}
