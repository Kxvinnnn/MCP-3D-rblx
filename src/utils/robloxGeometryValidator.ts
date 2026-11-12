import { Forge3DAsset, MeshPart3DSpec } from './roblox3DEngine.ts';

export interface RobloxGeometryValidationReport {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  totalParts: number;
  totalVertices: number;
  totalTriangles: number;
  hasEditableMeshLimitsExceeded: boolean;
  hasScaleLimitsExceeded: boolean;
  hasInvalidIndices: boolean;
  hasNonFiniteCoordinates: boolean;
}

const ROBLOX_MIN_PART_SIZE = 0.001; // Modern Roblox studs minimum
const ROBLOX_MAX_PART_SIZE = 2048;  // Roblox studs maximum
const EDITABLE_MESH_MAX_VERTICES = 20000;
const EDITABLE_MESH_MAX_TRIANGLES = 20000;

/**
 * Computes 3D surface area of a triangle.
 */
function triangleArea3D(v0: number[], v1: number[], v2: number[]): number {
  if (!v0 || !v1 || !v2 || v0.length < 3 || v1.length < 3 || v2.length < 3) return 0;
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
 * Validates a 3D asset model against Roblox DataModel and EditableMesh constraints.
 */
export function validateRobloxGeometry(asset: Forge3DAsset | null): RobloxGeometryValidationReport {
  const report: RobloxGeometryValidationReport = {
    isValid: true,
    warnings: [],
    errors: [],
    totalParts: 0,
    totalVertices: 0,
    totalTriangles: 0,
    hasEditableMeshLimitsExceeded: false,
    hasScaleLimitsExceeded: false,
    hasInvalidIndices: false,
    hasNonFiniteCoordinates: false,
  };

  if (!asset) {
    report.isValid = false;
    report.errors.push('No hay ningún recurso de modelo 3D proporcionado.');
    return report;
  }

  const parts = Array.isArray(asset.parts) ? asset.parts : [];
  report.totalParts = parts.length;

  if (parts.length === 0) {
    report.warnings.push('El recurso 3D no contiene ninguna pieza (parts list vacía).');
  }

  for (let pIdx = 0; pIdx < parts.length; pIdx++) {
    const part = parts[pIdx];
    const partLabel = `Pieza #${pIdx + 1} (${part.name || 'SinNombre'})`;

    // 1. Check size / scale limits
    if (part.size && Array.isArray(part.size)) {
      for (let axis = 0; axis < 3; axis++) {
        const val = part.size[axis];
        if (typeof val !== 'number' || !Number.isFinite(val)) {
          report.isValid = false;
          report.hasNonFiniteCoordinates = true;
          report.errors.push(`${partLabel}: La dimensión en el eje ${axis} no es un número finito (${val}).`);
        } else if (val < ROBLOX_MIN_PART_SIZE) {
          report.warnings.push(`${partLabel}: El tamaño (${val} studs) está por debajo del mínimo recomendado de Roblox (${ROBLOX_MIN_PART_SIZE} studs).`);
          report.hasScaleLimitsExceeded = true;
        } else if (val > ROBLOX_MAX_PART_SIZE) {
          report.isValid = false;
          report.hasScaleLimitsExceeded = true;
          report.errors.push(`${partLabel}: El tamaño (${val} studs) supera el límite máximo de Roblox (${ROBLOX_MAX_PART_SIZE} studs).`);
        }
      }
    }

    // 2. Check position & rotation non-finite values
    if (part.position) {
      for (const posVal of part.position) {
        if (typeof posVal !== 'number' || !Number.isFinite(posVal)) {
          report.isValid = false;
          report.hasNonFiniteCoordinates = true;
          report.errors.push(`${partLabel}: Posición contiene coordenada no finita (${posVal}).`);
        }
      }
    }

    // 3. Mesh Data validation (if custom mesh)
    if (part.meshData) {
      const vertices = part.meshData.vertices || [];
      const faces = part.meshData.faces || [];

      report.totalVertices += vertices.length;

      if (vertices.length > EDITABLE_MESH_MAX_VERTICES) {
        report.warnings.push(`${partLabel}: El conteo de vértices (${vertices.length}) excede el límite recomendado de EditableMesh (${EDITABLE_MESH_MAX_VERTICES}).`);
        report.hasEditableMeshLimitsExceeded = true;
      }

      // Check non-finite vertex coordinates
      for (let vIdx = 0; vIdx < vertices.length; vIdx++) {
        const v = vertices[vIdx];
        if (!Array.isArray(v) || v.length < 3 || !Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) {
          report.isValid = false;
          report.hasNonFiniteCoordinates = true;
          report.errors.push(`${partLabel}: Vértice #${vIdx} contiene coordenadas no finitas o incompletas.`);
        }
      }

      // Check faces and indices
      if (Array.isArray(faces)) {
        let partTris = 0;
        for (let fIdx = 0; fIdx < faces.length; fIdx++) {
          const face = faces[fIdx];
          if (Array.isArray(face)) {
            // Polygon face
            for (const idx of face) {
              if (typeof idx !== 'number' || idx < 0 || idx >= vertices.length || !Number.isInteger(idx)) {
                report.isValid = false;
                report.hasInvalidIndices = true;
                report.errors.push(`${partLabel}: Cara #${fIdx} contiene un índice inválido (${idx}) fuera del rango de vértices (0..${vertices.length - 1}).`);
              }
            }

            if (face.length === 3) {
              const v0 = vertices[face[0]];
              const v1 = vertices[face[1]];
              const v2 = vertices[face[2]];
              if (v0 && v1 && v2 && triangleArea3D(v0, v1, v2) > 1e-7) {
                partTris++;
              }
            } else if (face.length > 3) {
              partTris += Math.max(0, face.length - 2);
            }
          }
        }

        report.totalTriangles += partTris;

        if (partTris > EDITABLE_MESH_MAX_TRIANGLES) {
          report.warnings.push(`${partLabel}: El conteo de triángulos (${partTris}) excede el límite recomendado de EditableMesh (${EDITABLE_MESH_MAX_TRIANGLES}).`);
          report.hasEditableMeshLimitsExceeded = true;
        }
      }
    } else {
      // Primitive estimation
      report.totalVertices += 8;
      report.totalTriangles += 12;
    }
  }

  return report;
}
