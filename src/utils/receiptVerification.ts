/**
 * @module receiptVerification
 * @description
 * Módulo especializado y desacoplado para la verificación criptográfica y estructural
 * de recibos de Roblox Studio y persistencia en backend.
 *
 * Responsabilidades:
 * 1. `verifyPersistedAssetContent`: Verifica que el modelo guardado en backend preserve identidad,
 *    geometría, jerarquía, normales/UVs y subdivisión legítima de mallas densas.
 * 2. `verifyStudioApplicationReceipt`: Valida los 12 campos obligatorios de confirmación en Roblox Studio,
 *    rechazando IDs contradictorios, ausentes o duplicados.
 * 3. `reconcileReconstructedModelFromStudio`: Compara la reconstrucción en los 9 dominios y clasifica
 *    el resultado entre 'completed', 'partially_applied' y 'failed'.
 */

import { Forge3DAsset, MeshPart3DSpec } from './roblox3DEngine.ts';
import {
  toCanonicalJsonValue,
  computeAppearanceHash,
  computePropertiesHash,
  computeCanonicalAssetHash,
} from './canonicalHash';
import {
  partAppearanceHash,
  partPropertiesHash,
  ensurePersistentPartIdsForParts,
} from './incrementalSync';
import { validateRobloxGeometry } from './robloxGeometryValidator';

const OVERSIZED_SPLIT_VERTEX_THRESHOLD = 9000;
const OVERSIZED_SPLIT_FACE_THRESHOLD = 9500;

/**
 * Strictly verifies that a persisted asset returned by the backend matches the requested asset's
 * identity, appearance, physical properties, transforms, and geometry buffers before accepting it as saved.
 * Also validates any additional parts when oversized mesh splitting (>9000 vertices or >9500 faces) occurred,
 * rejecting any unexplained extra parts or altered properties.
 */
export function verifyPersistedAssetContent(
  requested: Forge3DAsset,
  persisted: Forge3DAsset | null | undefined
): { valid: boolean; reason?: string } {
  if (!persisted || typeof persisted !== 'object') {
    return { valid: false, reason: 'El servidor no devolvió un objeto asset válido.' };
  }

  if (persisted.name !== requested.name) {
    return {
      valid: false,
      reason: `El nombre del modelo devuelto ('${persisted.name}') no coincide con el modelo enviado ('${requested.name}').`,
    };
  }

  const reqParts: MeshPart3DSpec[] = Array.isArray(requested.parts) ? requested.parts : [];
  const persParts: MeshPart3DSpec[] = Array.isArray(persisted.parts) ? persisted.parts : [];

  if (
    requested.id &&
    persisted.id &&
    String(requested.id).trim() !== String(persisted.id).trim()
  ) {
    return {
      valid: false,
      reason: `El identificador (id) devuelto por el servidor ('${persisted.id}') no coincide con el enviado ('${requested.id}').`,
    };
  }

  if (
    requested.asset_id &&
    persisted.asset_id &&
    String(requested.asset_id).trim() !== String(persisted.asset_id).trim()
  ) {
    return {
      valid: false,
      reason: `El asset_id devuelto por el servidor ('${persisted.asset_id}') no coincide con el enviado ('${requested.asset_id}').`,
    };
  }

  if (
    requested.asset_type &&
    persisted.asset_type &&
    requested.asset_type !== persisted.asset_type
  ) {
    return {
      valid: false,
      reason: `El tipo de recurso (asset_type='${persisted.asset_type}') devuelto por el servidor no coincide con '${requested.asset_type}'.`,
    };
  }

  if (
    requested.category &&
    persisted.category &&
    requested.category !== persisted.category
  ) {
    return {
      valid: false,
      reason: `La categoría ('${persisted.category}') devuelta por el servidor no coincide con '${requested.category}'.`,
    };
  }

  if (reqParts.length > 0 && persParts.length === 0) {
    return { valid: false, reason: 'El servidor devolvió un modelo inconsistente o sin piezas.' };
  }

  if (persParts.length < reqParts.length) {
    return {
      valid: false,
      reason: `El servidor devolvió menos piezas (${persParts.length}) que las enviadas (${reqParts.length}).`,
    };
  }

  // Validate geometry of the persisted asset returned by the server
  if (reqParts.length > 0) {
    const persistedGeoReport = validateRobloxGeometry(persisted);
    if (!persistedGeoReport.isValid) {
      return {
        valid: false,
        reason: `El modelo devuelto por el servidor contiene geometría inválida: ${persistedGeoReport.errors.join('; ')}`,
      };
    }
  }

  // Verify root PBR profile and collision fidelity
  if (toCanonicalJsonValue(requested.pbr_profile) !== toCanonicalJsonValue(persisted.pbr_profile)) {
    return {
      valid: false,
      reason: 'El perfil PBR raíz (pbr_profile) devuelto por el servidor no coincide con el modelo enviado.',
    };
  }

  if (
    requested.collision_fidelity &&
    persisted.collision_fidelity &&
    requested.collision_fidelity !== persisted.collision_fidelity
  ) {
    return {
      valid: false,
      reason: 'La fidelidad de colisión (collision_fidelity) devuelta por el servidor no coincide con la enviada.',
    };
  }

  // Fast path + comprehensive check when part counts match
  if (persParts.length === reqParts.length) {
    if (computeAppearanceHash(requested) !== computeAppearanceHash(persisted)) {
      return {
        valid: false,
        reason: 'Las propiedades de apariencia o materiales devueltas por el servidor no coinciden con el modelo enviado.',
      };
    }

    if (computePropertiesHash(requested) !== computePropertiesHash(persisted)) {
      return {
        valid: false,
        reason: 'Las propiedades físicas, jerarquía o transformaciones devueltas por el servidor no coinciden con el modelo enviado.',
      };
    }
  }

  // Per-part verification (handles both 1:1 parts and legitimate oversized mesh splits)
  const matchedPersistedIndices = new Set<number>();

  for (let i = 0; i < reqParts.length; i++) {
    const reqPart = reqParts[i];

    // Look for direct 1:1 match in persisted parts
    let directIdx = -1;
    if (reqPart.partId) {
      directIdx = persParts.findIndex((p, idx) => !matchedPersistedIndices.has(idx) && p.partId === reqPart.partId);
    }
    if (directIdx === -1) {
      directIdx = persParts.findIndex((p, idx) => !matchedPersistedIndices.has(idx) && p.name === reqPart.name);
    }

    if (directIdx !== -1) {
      matchedPersistedIndices.add(directIdx);
      const persPart = persParts[directIdx];

      if (
        reqPart.partId &&
        persPart.partId &&
        reqPart.partId.trim() !== persPart.partId.trim()
      ) {
        return {
          valid: false,
          reason: `El partId de la pieza '${reqPart.name}' fue alterado ('${reqPart.partId}' -> '${persPart.partId}').`,
        };
      }

      if (
        reqPart.hierarchyPath &&
        persPart.hierarchyPath &&
        reqPart.hierarchyPath !== persPart.hierarchyPath
      ) {
        return {
          valid: false,
          reason: `La ruta jerárquica (hierarchyPath) de la pieza '${reqPart.name}' fue alterada ('${reqPart.hierarchyPath}' -> '${persPart.hierarchyPath}').`,
        };
      }

      if (
        reqPart.parentId &&
        persPart.parentId &&
        reqPart.parentId !== persPart.parentId
      ) {
        return {
          valid: false,
          reason: `El parentId de la pieza '${reqPart.name}' fue alterado ('${reqPart.parentId}' -> '${persPart.parentId}').`,
        };
      }

      if (
        reqPart.parentName &&
        persPart.parentName &&
        reqPart.parentName !== persPart.parentName
      ) {
        return {
          valid: false,
          reason: `El parentName de la pieza '${reqPart.name}' fue alterado ('${reqPart.parentName}' -> '${persPart.parentName}').`,
        };
      }

      if (partAppearanceHash(reqPart) !== partAppearanceHash(persPart)) {
        return {
          valid: false,
          reason: `La apariencia/material de la pieza '${reqPart.name}' fue alterada por el servidor.`,
        };
      }

      if (partPropertiesHash(reqPart) !== partPropertiesHash(persPart)) {
        return {
          valid: false,
          reason: `Las transformaciones o propiedades físicas de la pieza '${reqPart.name}' fueron alteradas por el servidor.`,
        };
      }

      if (toCanonicalJsonValue(reqPart.size) !== toCanonicalJsonValue(persPart.size)) {
        return {
          valid: false,
          reason: `Las dimensiones (size) de la pieza '${reqPart.name}' devueltas por el servidor no coinciden.`,
        };
      }

      if (reqPart.meshData && Array.isArray(reqPart.meshData.vertices) && reqPart.meshData.vertices.length > 0) {
        if (
          !persPart.meshData ||
          toCanonicalJsonValue(reqPart.meshData.vertices) !== toCanonicalJsonValue(persPart.meshData.vertices) ||
          toCanonicalJsonValue(reqPart.meshData.faces) !== toCanonicalJsonValue(persPart.meshData.faces) ||
          (Array.isArray(reqPart.meshData.normals) &&
            reqPart.meshData.normals.length > 0 &&
            toCanonicalJsonValue(reqPart.meshData.normals) !== toCanonicalJsonValue(persPart.meshData.normals)) ||
          (Array.isArray(reqPart.meshData.uvs) &&
            reqPart.meshData.uvs.length > 0 &&
            toCanonicalJsonValue(reqPart.meshData.uvs) !== toCanonicalJsonValue(persPart.meshData.uvs))
        ) {
          return {
            valid: false,
            reason: `La geometría de malla (meshData) de la pieza '${reqPart.name}' fue alterada o corrompida por el servidor.`,
          };
        }
      }

      if (reqPart.baseMeshData && Array.isArray(reqPart.baseMeshData.vertices) && reqPart.baseMeshData.vertices.length > 0) {
        if (
          !persPart.baseMeshData ||
          toCanonicalJsonValue(reqPart.baseMeshData.vertices) !== toCanonicalJsonValue(persPart.baseMeshData.vertices) ||
          toCanonicalJsonValue(reqPart.baseMeshData.faces) !== toCanonicalJsonValue(persPart.baseMeshData.faces) ||
          (Array.isArray(reqPart.baseMeshData.normals) &&
            reqPart.baseMeshData.normals.length > 0 &&
            toCanonicalJsonValue(reqPart.baseMeshData.normals) !== toCanonicalJsonValue(persPart.baseMeshData.normals)) ||
          (Array.isArray(reqPart.baseMeshData.uvs) &&
            reqPart.baseMeshData.uvs.length > 0 &&
            toCanonicalJsonValue(reqPart.baseMeshData.uvs) !== toCanonicalJsonValue(persPart.baseMeshData.uvs))
        ) {
          return {
            valid: false,
            reason: `La geometría base (baseMeshData) de la pieza '${reqPart.name}' fue alterada o corrompida por el servidor.`,
          };
        }
      }
    } else {
      // Check if reqPart was legitimately split into _Sub1, _Sub2, ...
      const reqVerts = reqPart.meshData?.vertices || [];
      const reqFaces = reqPart.meshData?.faces || [];
      const reqVertCount = reqVerts.length;
      const reqFaceCount = reqFaces.length;
      const isOversizedEligible =
        reqVertCount > OVERSIZED_SPLIT_VERTEX_THRESHOLD || reqFaceCount > OVERSIZED_SPLIT_FACE_THRESHOLD;

      const subIndices: number[] = [];
      const expectedPrefix = `${reqPart.name}_Sub`;
      persParts.forEach((p, idx) => {
        if (!matchedPersistedIndices.has(idx) && typeof p.name === 'string' && p.name.startsWith(expectedPrefix)) {
          subIndices.push(idx);
        }
      });

      if (!isOversizedEligible || subIndices.length < 2) {
        return {
          valid: false,
          reason: `La pieza '${reqPart.name}' no se encontró en el modelo devuelto o fue dividida sin superar los límites de malla densa.`,
        };
      }

      const formatTriCoordSig = (v0: number[], v1: number[], v2: number[]): string => {
        const fPt = (v: number[]) =>
          `${Number(v[0] || 0).toFixed(4)},${Number(v[1] || 0).toFixed(4)},${Number(v[2] || 0).toFixed(4)}`;
        return `${fPt(v0)}|${fPt(v1)}|${fPt(v2)}`;
      };

      const expectedTriSignatures = new Map<string, number>();
      for (const rf of reqFaces) {
        if (Array.isArray(rf) && rf.length >= 3) {
          const v0 = reqVerts[rf[0]];
          const v1 = reqVerts[rf[1]];
          const v2 = reqVerts[rf[2]];
          if (v0 && v1 && v2) {
            const sig = formatTriCoordSig(v0, v1, v2);
            expectedTriSignatures.set(sig, (expectedTriSignatures.get(sig) || 0) + 1);
          }
        }
      }

      let totalSubFaces = 0;
      const seenSubPartIds = new Set<string>();
      const actualTriSignatures = new Map<string, number>();

      for (const sIdx of subIndices) {
        matchedPersistedIndices.add(sIdx);
        const subPart = persParts[sIdx];

        const subPid = typeof subPart.partId === 'string' ? subPart.partId.trim() : '';
        if (!subPid || seenSubPartIds.has(subPid) || (!subPid.includes('_Sub') && !subPart.name.includes('_Sub'))) {
          return {
            valid: false,
            reason: `La sub-pieza '${subPart.name}' carece de un partId trazable y único derivado de '${reqPart.name}'.`,
          };
        }
        seenSubPartIds.add(subPid);

        if (
          partAppearanceHash(reqPart) !== partAppearanceHash(subPart) ||
          partPropertiesHash(reqPart) !== partPropertiesHash(subPart) ||
          toCanonicalJsonValue(reqPart.size) !== toCanonicalJsonValue(subPart.size)
        ) {
          return {
            valid: false,
            reason: `La sub-pieza '${subPart.name}' no conserva las transformaciones, apariencia o propiedades de '${reqPart.name}'.`,
          };
        }

        const subVerts = subPart.meshData?.vertices || [];
        const subFaces = subPart.meshData?.faces || [];
        if (subVerts.length < 3 || subFaces.length < 1) {
          return {
            valid: false,
            reason: `La sub-pieza '${subPart.name}' carece de geometría válida tras la división.`,
          };
        }

        for (let fIdx = 0; fIdx < subFaces.length; fIdx++) {
          const sf = subFaces[fIdx];
          if (!Array.isArray(sf) || sf.length < 3) {
            return {
              valid: false,
              reason: `La sub-pieza '${subPart.name}' contiene una cara mal formada en índice ${fIdx}.`,
            };
          }
          const [i0, i1, i2] = sf;
          if (
            !Number.isInteger(i0) ||
            !Number.isInteger(i1) ||
            !Number.isInteger(i2) ||
            i0 < 0 ||
            i0 >= subVerts.length ||
            i1 < 0 ||
            i1 >= subVerts.length ||
            i2 < 0 ||
            i2 >= subVerts.length ||
            i0 === i1 ||
            i1 === i2 ||
            i0 === i2
          ) {
            return {
              valid: false,
              reason: `La sub-pieza '${subPart.name}' contiene índices locales inválidos o degenerados en cara ${fIdx} (${i0},${i1},${i2} vs ${subVerts.length} vértices).`,
            };
          }
          const sig = formatTriCoordSig(subVerts[i0], subVerts[i1], subVerts[i2]);
          actualTriSignatures.set(sig, (actualTriSignatures.get(sig) || 0) + 1);
        }

        totalSubFaces += subFaces.length;
      }

      if (totalSubFaces !== reqFaceCount) {
        return {
          valid: false,
          reason: `Las sub-piezas de '${reqPart.name}' suman ${totalSubFaces} caras en lugar de las ${reqFaceCount} caras originales.`,
        };
      }

      for (const [sig, expCount] of expectedTriSignatures.entries()) {
        if ((actualTriSignatures.get(sig) || 0) !== expCount) {
          return {
            valid: false,
            reason: `Las caras de las sub-piezas de '${reqPart.name}' presentan pérdida o duplicación geométrica respecto a la malla original.`,
          };
        }
      }
    }
  }

  // Reject if the server returned any unmatched/unexplained extra parts
  if (matchedPersistedIndices.size !== persParts.length) {
    const unmatchedCount = persParts.length - matchedPersistedIndices.size;
    return {
      valid: false,
      reason: `El servidor devolvió ${unmatchedCount} pieza(s) adicional(es) no justificadas que no corresponden al modelo enviado.`,
    };
  }

  return { valid: true };
}

export interface StudioApplicationReceipt {
  operationId: string;
  taskId: string;
  status: 'completed' | 'awaiting_confirmation' | 'partially_applied' | 'failed';
  verified: boolean;
  modelName: string;
  expectedModelHash: string;
  appliedModelHash: string;
  expectedPartCount: number;
  actualPartCount: number;
  addedPartIds: string[];
  updatedPartIds: string[];
  removedPartIds: string[];
  pendingDeletionPartIds: string[];
  failedPartIds: string[];
  verifiedGeometryPartIds: string[];
  warnings: string[];
  errors: string[];
}

/**
 * Strictly validates that a task result from the Bridge/Studio contains all 12 mandatory fields
 * of a cryptographic and structural confirmation receipt proving that Roblox Studio actually
 * reconstructed/applied the expected model (Fase 2):
 * - Mandatory fields (zero fallback defaults):
 *   1. `expectedTaskId`
 *   2. `taskResult.taskId`
 *   3. `result.taskId`
 *   4. `result.operationId`
 *   5. `result.modelName`
 *   6. `result.expectedPartCount`
 *   7. `result.actualPartCount`
 *   8. `result.expectedModelHash`
 *   9. `result.appliedModelHash`
 *  10. `result.verifiedGeometryPartIds`
 *  11. `result.failedPartIds`
 *  12. `result.pendingDeletionPartIds`
 * - Enforces explicit `partId` policy on all `expectedAsset.parts` (rejects missing or duplicate `partId`s).
 * - Rejects missing IDs, contradictory IDs, duplicate IDs, wrong `modelName`, wrong hash, wrong counts,
 *   unverified parts, failed parts, pending deletions, and receipts belonging to another task.
 */
export function verifyStudioApplicationReceipt(
  taskResult: any,
  expectedTaskId: string | undefined,
  expectedAsset: Forge3DAsset,
  expectedModelHash: string
): {
  valid: boolean;
  status: StudioApplicationReceipt['status'];
  reason?: string;
  receipt?: StudioApplicationReceipt;
} {
  if (!taskResult || typeof taskResult !== 'object') {
    return {
      valid: false,
      status: 'failed',
      reason: 'Respuesta vacía o inválida del puente local.',
    };
  }

  const trimmedExpectedTaskId = typeof expectedTaskId === 'string' ? expectedTaskId.trim() : '';
  if (!trimmedExpectedTaskId) {
    return {
      valid: false,
      status: 'failed',
      reason: 'expectedTaskId es obligatorio para verificar el recibo de Roblox Studio.',
    };
  }

  const envelopeTaskId = typeof taskResult.taskId === 'string' ? taskResult.taskId.trim() : '';
  if (!envelopeTaskId) {
    return {
      valid: false,
      status: 'failed',
      reason: 'El sobre de respuesta del puente carece de taskResult.taskId obligatorio.',
    };
  }

  if (envelopeTaskId !== trimmedExpectedTaskId) {
    return {
      valid: false,
      status: 'failed',
      reason: `Contradicción de taskId: taskResult.taskId ('${envelopeTaskId}') no coincide con expectedTaskId ('${trimmedExpectedTaskId}').`,
    };
  }

  if (!expectedAsset || typeof expectedAsset !== 'object' || typeof expectedAsset.name !== 'string' || !expectedAsset.name.trim()) {
    return {
      valid: false,
      status: 'failed',
      reason: 'El modelo esperado (expectedAsset) carece de identidad o nombre válido.',
    };
  }

  const trimmedExpectedHash = typeof expectedModelHash === 'string' ? expectedModelHash.trim() : '';
  if (!trimmedExpectedHash) {
    return {
      valid: false,
      status: 'failed',
      reason: 'expectedModelHash es obligatorio y no puede ser vacío.',
    };
  }

  // Explicit identity policy on expectedAsset.parts: every part must have a unique, non-empty partId
  const expectedParts = Array.isArray(expectedAsset.parts) ? expectedAsset.parts : [];
  const expectedPartIdSet = new Set<string>();
  for (let i = 0; i < expectedParts.length; i++) {
    const p = expectedParts[i];
    const pid = typeof p?.partId === 'string' ? p.partId.trim() : '';
    if (!pid) {
      return {
        valid: false,
        status: 'failed',
        reason: `Política de identidad violada: La pieza esperada #${i + 1} ('${p?.name || 'SinNombre'}') carece de partId explícito.`,
      };
    }
    if (expectedPartIdSet.has(pid)) {
      return {
        valid: false,
        status: 'failed',
        reason: `Política de identidad violada: partId duplicado ('${pid}') en expectedAsset.parts.`,
      };
    }
    expectedPartIdSet.add(pid);
  }

  if (!taskResult.result || typeof taskResult.result !== 'object' || Array.isArray(taskResult.result)) {
    return {
      valid: false,
      status: 'failed',
      reason:
        taskResult.error ||
        `El puente reportó estado '${String(taskResult.status)}' sin un objeto de recibo estructurado (result ausente).`,
    };
  }

  const resObj = taskResult.result as Record<string, any>;

  const parseStrictIdArray = (
    raw: unknown,
    fieldName: string
  ): { ok: true; values: string[] } | { ok: false; error: string } => {
    if (!Array.isArray(raw)) {
      return {
        ok: false,
        error: `Campo obligatorio '${fieldName}' ausente o no es un array en el recibo de Studio.`,
      };
    }
    const values: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < raw.length; i++) {
      const item = raw[i];
      if (typeof item !== 'string' || item.trim().length === 0) {
        return {
          ok: false,
          error: `Campo '${fieldName}' contiene un identificador vacío o no válido en la posición ${i}.`,
        };
      }
      const trimmed = item.trim();
      if (seen.has(trimmed)) {
        return {
          ok: false,
          error: `Campo '${fieldName}' contiene un identificador duplicado ('${trimmed}').`,
        };
      }
      seen.add(trimmed);
      values.push(trimmed);
    }
    return { ok: true, values };
  };

  // Validate mandatory result.taskId and result.operationId (no fallbacks)
  const receiptTaskId = typeof resObj.taskId === 'string' ? resObj.taskId.trim() : '';
  if (!receiptTaskId) {
    return {
      valid: false,
      status: 'failed',
      reason: 'El recibo de Studio carece del campo obligatorio result.taskId.',
    };
  }
  const receiptOperationId = typeof resObj.operationId === 'string' ? resObj.operationId.trim() : '';
  if (!receiptOperationId) {
    return {
      valid: false,
      status: 'failed',
      reason: 'El recibo de Studio carece del campo obligatorio result.operationId.',
    };
  }
  if (receiptTaskId !== trimmedExpectedTaskId) {
    return {
      valid: false,
      status: 'failed',
      reason: `Contradicción de taskId: result.taskId ('${receiptTaskId}') no coincide con expectedTaskId ('${trimmedExpectedTaskId}').`,
    };
  }
  if (receiptOperationId !== trimmedExpectedTaskId) {
    return {
      valid: false,
      status: 'failed',
      reason: `Contradicción de operationId: result.operationId ('${receiptOperationId}') no coincide con expectedTaskId ('${trimmedExpectedTaskId}').`,
    };
  }
  if (receiptTaskId !== receiptOperationId) {
    return {
      valid: false,
      status: 'failed',
      reason: `Contradicción interna en recibo: result.taskId ('${receiptTaskId}') !== result.operationId ('${receiptOperationId}').`,
    };
  }

  // Validate mandatory modelName (no fallback to expectedAsset.name)
  const receiptModelName = typeof resObj.modelName === 'string' ? resObj.modelName.trim() : '';
  if (!receiptModelName) {
    return {
      valid: false,
      status: 'failed',
      reason: 'El recibo de Studio carece del campo obligatorio modelName.',
    };
  }
  if (receiptModelName !== expectedAsset.name) {
    return {
      valid: false,
      status: 'failed',
      reason: `El modelName del recibo ('${receiptModelName}') no coincide con el modelo enviado ('${expectedAsset.name}').`,
    };
  }

  // Validate mandatory expectedPartCount and actualPartCount (no fallback to expectedAsset.parts.length)
  if (
    typeof resObj.expectedPartCount !== 'number' ||
    !Number.isInteger(resObj.expectedPartCount) ||
    resObj.expectedPartCount < 0
  ) {
    return {
      valid: false,
      status: 'failed',
      reason: 'El recibo de Studio carece de un expectedPartCount entero válido.',
    };
  }
  if (resObj.expectedPartCount !== expectedParts.length) {
    return {
      valid: false,
      status: 'failed',
      reason: `El expectedPartCount del recibo (${resObj.expectedPartCount}) no coincide con las piezas enviadas (${expectedParts.length}).`,
    };
  }

  if (
    typeof resObj.actualPartCount !== 'number' ||
    !Number.isInteger(resObj.actualPartCount) ||
    resObj.actualPartCount < 0
  ) {
    return {
      valid: false,
      status: 'failed',
      reason: 'El recibo de Studio carece de un actualPartCount entero válido.',
    };
  }

  // Validate mandatory expectedModelHash and appliedModelHash (no fallback to expectedModelHash)
  const receiptExpectedHash = typeof resObj.expectedModelHash === 'string' ? resObj.expectedModelHash.trim() : '';
  if (!receiptExpectedHash) {
    return {
      valid: false,
      status: 'failed',
      reason: 'El recibo de Studio carece del campo obligatorio expectedModelHash.',
    };
  }
  if (receiptExpectedHash !== trimmedExpectedHash) {
    return {
      valid: false,
      status: 'failed',
      reason: `El expectedModelHash del recibo ('${receiptExpectedHash.slice(0, 12)}') no coincide con el hash enviado ('${trimmedExpectedHash.slice(0, 12)}').`,
    };
  }

  const receiptAppliedHash = typeof resObj.appliedModelHash === 'string' ? resObj.appliedModelHash.trim() : '';
  if (!receiptAppliedHash) {
    return {
      valid: false,
      status: 'failed',
      reason: 'El recibo de Studio carece del campo obligatorio appliedModelHash.',
    };
  }

  // Validate mandatory verifiedGeometryPartIds, failedPartIds, pendingDeletionPartIds arrays (no fallback to [])
  const verifiedArrCheck = parseStrictIdArray(resObj.verifiedGeometryPartIds, 'verifiedGeometryPartIds');
  if (!verifiedArrCheck.ok) {
    return { valid: false, status: 'failed', reason: verifiedArrCheck.error };
  }
  const failedArrCheck = parseStrictIdArray(resObj.failedPartIds, 'failedPartIds');
  if (!failedArrCheck.ok) {
    return { valid: false, status: 'failed', reason: failedArrCheck.error };
  }
  const pendingDelArrCheck = parseStrictIdArray(resObj.pendingDeletionPartIds, 'pendingDeletionPartIds');
  if (!pendingDelArrCheck.ok) {
    return { valid: false, status: 'failed', reason: pendingDelArrCheck.error };
  }

  const verifiedGeometryPartIds = verifiedArrCheck.values;
  const failedPartIds = failedArrCheck.values;
  const pendingDeletionPartIds = pendingDelArrCheck.values;

  // Reject contradictory IDs appearing across verifiedGeometryPartIds, failedPartIds, or pendingDeletionPartIds
  const verifiedSet = new Set(verifiedGeometryPartIds);
  const pendingDelSet = new Set(pendingDeletionPartIds);

  for (const fid of failedPartIds) {
    if (verifiedSet.has(fid)) {
      return {
        valid: false,
        status: 'failed',
        reason: `Contradicción en recibo: partId '${fid}' figura simultáneamente en verifiedGeometryPartIds y failedPartIds.`,
      };
    }
    if (pendingDelSet.has(fid)) {
      return {
        valid: false,
        status: 'failed',
        reason: `Contradicción en recibo: partId '${fid}' figura simultáneamente en failedPartIds y pendingDeletionPartIds.`,
      };
    }
  }

  for (const pid of pendingDeletionPartIds) {
    if (verifiedSet.has(pid)) {
      return {
        valid: false,
        status: 'failed',
        reason: `Contradicción en recibo: partId '${pid}' figura simultáneamente en verifiedGeometryPartIds y pendingDeletionPartIds.`,
      };
    }
  }

  const toOptionalStrArray = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.map((x) => String(x || '').trim()).filter(Boolean) : [];

  const addedPartIds = toOptionalStrArray(resObj.addedPartIds);
  const updatedPartIds = toOptionalStrArray(resObj.updatedPartIds);
  const removedPartIds = toOptionalStrArray(resObj.removedPartIds);
  const warnings = toOptionalStrArray(resObj.warnings);
  const errors = toOptionalStrArray(resObj.errors);

  const normalizedReceipt: StudioApplicationReceipt = {
    operationId: receiptOperationId,
    taskId: receiptTaskId,
    status: 'failed',
    verified: Boolean(resObj.verified),
    modelName: receiptModelName,
    expectedModelHash: receiptExpectedHash,
    appliedModelHash: receiptAppliedHash,
    expectedPartCount: resObj.expectedPartCount,
    actualPartCount: resObj.actualPartCount,
    addedPartIds,
    updatedPartIds,
    removedPartIds,
    pendingDeletionPartIds,
    failedPartIds,
    verifiedGeometryPartIds,
    warnings,
    errors,
  };

  // Rule A: Pending destructive deletions must NEVER be marked completed or verified=true
  if (
    pendingDeletionPartIds.length > 0 ||
    taskResult.status === 'awaiting_studio_confirmation' ||
    taskResult.status === 'awaiting_confirmation' ||
    resObj.status === 'awaiting_confirmation' ||
    resObj.status === 'awaiting_studio_confirmation' ||
    (typeof resObj.pendingDestructiveConfirmations === 'number' && resObj.pendingDestructiveConfirmations > 0)
  ) {
    if (pendingDeletionPartIds.length === 0) {
      return {
        valid: false,
        status: 'failed',
        reason: 'El recibo indica awaiting_confirmation pero pendingDeletionPartIds está vacío.',
        receipt: normalizedReceipt,
      };
    }
    normalizedReceipt.status = 'awaiting_confirmation';
    normalizedReceipt.verified = false;
    const pendingList = ` (${pendingDeletionPartIds.join(', ')})`;
    return {
      valid: false,
      status: 'awaiting_confirmation',
      reason: `Operación pendiente de confirmación destructiva en Roblox Studio${pendingList}.`,
      receipt: normalizedReceipt,
    };
  }

  // Rule B & C: Failed parts or explicit partial application must NEVER be marked completed
  if (
    failedPartIds.length > 0 ||
    errors.length > 0 ||
    taskResult.status === 'partially_applied' ||
    resObj.status === 'partially_applied'
  ) {
    const anyApplied =
      verifiedGeometryPartIds.length > 0 ||
      addedPartIds.length > 0 ||
      updatedPartIds.length > 0 ||
      taskResult.status === 'partially_applied' ||
      resObj.status === 'partially_applied';
    const derivedStatus: StudioApplicationReceipt['status'] = anyApplied ? 'partially_applied' : 'failed';
    normalizedReceipt.status = derivedStatus;
    normalizedReceipt.verified = false;
    const detail =
      errors.length > 0
        ? errors.join('; ')
        : failedPartIds.length > 0
        ? `Fallaron ${failedPartIds.length} pieza(s): ${failedPartIds.join(', ')}`
        : 'Aplicación parcial reportada por Roblox Studio.';
    return {
      valid: false,
      status: derivedStatus,
      reason: `Aplicación incompleta o con fallos en Roblox Studio: ${detail}`,
      receipt: normalizedReceipt,
    };
  }

  if (taskResult.status !== 'completed') {
    normalizedReceipt.status = 'failed';
    normalizedReceipt.verified = false;
    return {
      valid: false,
      status: 'failed',
      reason: `Estado de tarea no completado (${String(taskResult.status)}).`,
      receipt: normalizedReceipt,
    };
  }

  if (resObj.status !== 'completed' || resObj.verified !== true) {
    normalizedReceipt.status = 'failed';
    normalizedReceipt.verified = false;
    return {
      valid: false,
      status: 'failed',
      reason: resObj.error || 'El plugin de Roblox Studio reportó un fallo de verificación o estado no completado.',
      receipt: normalizedReceipt,
    };
  }

  // Verify applied part count matches expected
  if (resObj.actualPartCount !== expectedParts.length) {
    const derivedStatus: StudioApplicationReceipt['status'] =
      resObj.actualPartCount > 0 ? 'partially_applied' : 'failed';
    normalizedReceipt.status = derivedStatus;
    normalizedReceipt.verified = false;
    return {
      valid: false,
      status: derivedStatus,
      reason: `Roblox Studio aplicó ${resObj.actualPartCount} pieza(s), pero el modelo enviado contiene ${expectedParts.length} pieza(s).`,
      receipt: normalizedReceipt,
    };
  }

  // Verify per-part verifiedGeometryPartIds against every expected partId
  if (verifiedGeometryPartIds.length !== expectedParts.length) {
    const derivedStatus: StudioApplicationReceipt['status'] =
      verifiedGeometryPartIds.length > 0 ? 'partially_applied' : 'failed';
    normalizedReceipt.status = derivedStatus;
    normalizedReceipt.verified = false;
    return {
      valid: false,
      status: derivedStatus,
      reason: `Solo ${verifiedGeometryPartIds.length} de ${expectedParts.length} pieza(s) tienen geometría EditableMesh verificada en Studio.`,
      receipt: normalizedReceipt,
    };
  }

  for (const p of expectedParts) {
    const pid = p.partId!.trim();
    if (!verifiedSet.has(pid)) {
      normalizedReceipt.status = 'partially_applied';
      normalizedReceipt.verified = false;
      return {
        valid: false,
        status: 'partially_applied',
        reason: `La pieza '${p.name}' (${pid}) no figura en verifiedGeometryPartIds del recibo de Studio.`,
        receipt: normalizedReceipt,
      };
    }
  }

  // Verify appliedModelHash matches expectedModelHash
  if (receiptAppliedHash !== trimmedExpectedHash) {
    normalizedReceipt.status = 'failed';
    normalizedReceipt.verified = false;
    return {
      valid: false,
      status: 'failed',
      reason: `El hash del modelo aplicado en Studio (${receiptAppliedHash.slice(0, 8)}) no coincide con el hash enviado (${trimmedExpectedHash.slice(0, 8)}).`,
      receipt: normalizedReceipt,
    };
  }

  normalizedReceipt.status = 'completed';
  normalizedReceipt.verified = true;
  return { valid: true, status: 'completed', receipt: normalizedReceipt };
}

export interface StudioModelReconstructionComparison {
  valid: boolean;
  status: 'completed' | 'partially_applied' | 'failed';
  verified: boolean;
  reconstructedAsset: Forge3DAsset | null;
  verifiedPartIds: string[];
  failedPartIds: string[];
  discrepancies: string[];
  domainComparison: {
    identityMatches: boolean;
    geometryMatches: boolean;
    normalsMatch: boolean;
    uvsMatch: boolean;
    materialsMatch: boolean;
    transformsMatch: boolean;
    hierarchyMatches: boolean;
    propertiesMatch: boolean;
    hashMatches: boolean;
  };
}

/**
 * Fase 5 — Consumes the output of `studio.reconstruct_model`, reconstructs the Forge3DAsset,
 * and strictly compares the reconstructed Studio model against the original Forge model across
 * all 9 domains: identity, geometry, normals, UVs, materials, transforms, hierarchy, properties, and hash.
 * Differentiates complete (`completed`), partial (`partially_applied`), and failed (`failed`) reconstruction.
 */
export function reconcileReconstructedModelFromStudio(
  originalAsset: Forge3DAsset,
  studioReconstructionResponse: any
): StudioModelReconstructionComparison {
  const emptyDomains = {
    identityMatches: false,
    geometryMatches: false,
    normalsMatch: false,
    uvsMatch: false,
    materialsMatch: false,
    transformsMatch: false,
    hierarchyMatches: false,
    propertiesMatch: false,
    hashMatches: false,
  };

  if (!originalAsset || typeof originalAsset !== 'object' || !Array.isArray(originalAsset.parts) || originalAsset.parts.length === 0) {
    return {
      valid: false,
      status: 'failed',
      verified: false,
      reconstructedAsset: null,
      verifiedPartIds: [],
      failedPartIds: [],
      discrepancies: ['El modelo original proporcionado para comparar es inválido o no tiene piezas.'],
      domainComparison: emptyDomains,
    };
  }

  const resObj =
    studioReconstructionResponse &&
    typeof studioReconstructionResponse === 'object' &&
    studioReconstructionResponse.result &&
    typeof studioReconstructionResponse.result === 'object'
      ? studioReconstructionResponse.result
      : studioReconstructionResponse;

  if (!resObj || typeof resObj !== 'object') {
    return {
      valid: false,
      status: 'failed',
      verified: false,
      reconstructedAsset: null,
      verifiedPartIds: [],
      failedPartIds: [],
      discrepancies: ['La respuesta de studio.reconstruct_model está vacía o es inválida.'],
      domainComparison: emptyDomains,
    };
  }

  const stabilizedOriginalParts = ensurePersistentPartIdsForParts(originalAsset.parts, originalAsset.name);
  const stabilizedOriginal: Forge3DAsset = {
    ...originalAsset,
    parts: stabilizedOriginalParts,
  };
  const expectedModelHash = computeCanonicalAssetHash(stabilizedOriginal);

  const rawParts: MeshPart3DSpec[] = Array.isArray(resObj.parts) ? resObj.parts : [];
  const reportedVerifiedIds: string[] = Array.isArray(resObj.verifiedGeometryPartIds)
    ? resObj.verifiedGeometryPartIds.map((x: any) => String(x || '').trim()).filter(Boolean)
    : [];
  const reportedFailedIds: string[] = Array.isArray(resObj.failedPartIds)
    ? resObj.failedPartIds.map((x: any) => String(x || '').trim()).filter(Boolean)
    : [];
  const reportedErrors: string[] = Array.isArray(resObj.errors)
    ? resObj.errors.map((x: any) => String(x || '').trim()).filter(Boolean)
    : [];

  const discrepancies: string[] = [...reportedErrors];
  const verifiedPartIds: string[] = [];
  const failedPartIdsSet = new Set<string>(reportedFailedIds);

  if (rawParts.length === 0) {
    for (const origPart of stabilizedOriginalParts) {
      if (origPart.partId) failedPartIdsSet.add(origPart.partId);
    }
    if (discrepancies.length === 0) {
      discrepancies.push('studio.reconstruct_model no devolvió ninguna pieza reconstruida.');
    }
    return {
      valid: false,
      status: 'failed',
      verified: false,
      reconstructedAsset: null,
      verifiedPartIds: [],
      failedPartIds: Array.from(failedPartIdsSet),
      discrepancies,
      domainComparison: emptyDomains,
    };
  }

  let identityMatches = true;
  let geometryMatches = true;
  let normalsMatch = true;
  let uvsMatch = true;
  let materialsMatch = true;
  let transformsMatch = true;
  let hierarchyMatches = true;
  let propertiesMatch = true;

  const reconstructedModelName = typeof resObj.modelName === 'string' ? resObj.modelName.trim() : '';
  if (!reconstructedModelName || reconstructedModelName !== stabilizedOriginal.name) {
    identityMatches = false;
    discrepancies.push(
      `Identidad del modelo difiere: esperado '${stabilizedOriginal.name}', recibido '${reconstructedModelName || 'ausente'}'.`
    );
  }

  const reportedVerifiedSet = new Set<string>(reportedVerifiedIds);
  const reconPartsById = new Map<string, MeshPart3DSpec>();
  for (const rp of rawParts) {
    const pid = typeof rp?.partId === 'string' ? rp.partId.trim() : '';
    if (!pid || reconPartsById.has(pid)) {
      identityMatches = false;
      discrepancies.push(`Pieza reconstruida '${rp?.name || 'SinNombre'}' tiene partId ausente o duplicado ('${pid}').`);
    } else {
      reconPartsById.set(pid, rp);
    }
  }

  if (rawParts.length !== stabilizedOriginalParts.length) {
    identityMatches = false;
    discrepancies.push(
      `Conteo de piezas reconstruidas (${rawParts.length}) difiere del original (${stabilizedOriginalParts.length}).`
    );
  }

  for (const origPart of stabilizedOriginalParts) {
    const pid = origPart.partId!;
    const reconPart = reconPartsById.get(pid);
    if (!reconPart) {
      identityMatches = false;
      geometryMatches = false;
      failedPartIdsSet.add(pid);
      discrepancies.push(`Pieza original '${origPart.name}' (${pid}) no fue encontrada en el modelo reconstruido.`);
      continue;
    }

    let partOk = !failedPartIdsSet.has(pid);
    if (reportedVerifiedIds.length > 0 && !reportedVerifiedSet.has(pid)) {
      partOk = false;
      failedPartIdsSet.add(pid);
      discrepancies.push(`Pieza '${origPart.name}' (${pid}) no figura como verificada en verifiedGeometryPartIds.`);
    }

    // 1. Identity (partId & name)
    if (reconPart.name !== origPart.name || reconPart.partId !== origPart.partId) {
      identityMatches = false;
      partOk = false;
      discrepancies.push(`Identidad de pieza '${origPart.name}' (${pid}) alterada en reconstrucción.`);
    }

    // 2. Geometry (vertices & faces)
    const origVerts = origPart.meshData?.vertices || [];
    const origFaces = origPart.meshData?.faces || [];
    const reconVerts = reconPart.meshData?.vertices || [];
    const reconFaces = reconPart.meshData?.faces || [];
    if (
      toCanonicalJsonValue(origVerts) !== toCanonicalJsonValue(reconVerts) ||
      toCanonicalJsonValue(origFaces) !== toCanonicalJsonValue(reconFaces)
    ) {
      geometryMatches = false;
      partOk = false;
      discrepancies.push(`Geometría (vertices/faces) de pieza '${origPart.name}' (${pid}) no coincide tras reconstrucción.`);
    }

    // 3. Normals
    const origNormals = origPart.meshData?.normals;
    const reconNormals = reconPart.meshData?.normals;
    if (Array.isArray(origNormals) && origNormals.length > 0) {
      if (!Array.isArray(reconNormals) || toCanonicalJsonValue(origNormals) !== toCanonicalJsonValue(reconNormals)) {
        normalsMatch = false;
        partOk = false;
        discrepancies.push(`Normales de pieza '${origPart.name}' (${pid}) perdidas o alteradas tras reconstrucción.`);
      }
    }

    // 4. UVs
    const origUvs = origPart.meshData?.uvs;
    const reconUvs = reconPart.meshData?.uvs;
    if (Array.isArray(origUvs) && origUvs.length > 0) {
      if (!Array.isArray(reconUvs) || toCanonicalJsonValue(origUvs) !== toCanonicalJsonValue(reconUvs)) {
        uvsMatch = false;
        partOk = false;
        discrepancies.push(`Coordenadas UV de pieza '${origPart.name}' (${pid}) perdidas o alteradas tras reconstrucción.`);
      }
    }

    // 5. Materials & PBR
    if (partAppearanceHash(origPart) !== partAppearanceHash(reconPart)) {
      materialsMatch = false;
      partOk = false;
      discrepancies.push(`Materiales o apariencia PBR de pieza '${origPart.name}' (${pid}) difieren tras reconstrucción.`);
    }

    // 6. Transforms (size, position, rotation, rotationMatrix)
    if (
      toCanonicalJsonValue(origPart.size) !== toCanonicalJsonValue(reconPart.size) ||
      toCanonicalJsonValue(origPart.position) !== toCanonicalJsonValue(reconPart.position) ||
      toCanonicalJsonValue(origPart.rotation) !== toCanonicalJsonValue(reconPart.rotation) ||
      (origPart.rotationMatrix &&
        reconPart.rotationMatrix &&
        toCanonicalJsonValue(origPart.rotationMatrix) !== toCanonicalJsonValue(reconPart.rotationMatrix))
    ) {
      transformsMatch = false;
      partOk = false;
      discrepancies.push(`Transformaciones (size/position/rotation) de pieza '${origPart.name}' (${pid}) difieren.`);
    }

    // 7. Hierarchy
    if (
      (origPart.hierarchyPath || `Root/${origPart.name}`) !== (reconPart.hierarchyPath || `Root/${reconPart.name}`) ||
      (origPart.parentName || 'Root') !== (reconPart.parentName || 'Root') ||
      (origPart.parentId || 'fnode_Root') !== (reconPart.parentId || 'fnode_Root')
    ) {
      hierarchyMatches = false;
      partOk = false;
      discrepancies.push(`Jerarquía de pieza '${origPart.name}' (${pid}) difiere tras reconstrucción.`);
    }

    // 8. Physical properties
    if (
      Boolean(origPart.anchored ?? true) !== Boolean(reconPart.anchored ?? true) ||
      Boolean(origPart.canCollide ?? true) !== Boolean(reconPart.canCollide ?? true) ||
      (origPart.collisionFidelity || 'Hull') !== (reconPart.collisionFidelity || 'Hull')
    ) {
      propertiesMatch = false;
      partOk = false;
      discrepancies.push(`Propiedades físicas (anchored/canCollide/collisionFidelity) de pieza '${origPart.name}' (${pid}) difieren.`);
    }

    if (partOk) {
      verifiedPartIds.push(pid);
    } else {
      failedPartIdsSet.add(pid);
    }
  }

  const reconstructedAsset: Forge3DAsset = {
    ...stabilizedOriginal,
    name: reconstructedModelName || stabilizedOriginal.name,
    parts: rawParts,
  };

  const geoReport = validateRobloxGeometry(reconstructedAsset);
  if (!geoReport.isValid) {
    geometryMatches = false;
    for (const err of geoReport.errors) {
      discrepancies.push(err);
    }
  }

  const reconstructedCanonicalHash = computeCanonicalAssetHash(reconstructedAsset);
  const reportedAppliedHash = typeof resObj.appliedModelHash === 'string' ? resObj.appliedModelHash.trim() : '';
  const hashMatches =
    reconstructedCanonicalHash === expectedModelHash &&
    (reportedAppliedHash === '' ||
      reportedAppliedHash === expectedModelHash ||
      reportedAppliedHash.startsWith('studio_readback_'));

  if (!hashMatches) {
    discrepancies.push(
      `El hash canónico del modelo reconstruido (${reconstructedCanonicalHash.slice(0, 8)}) difiere del original (${expectedModelHash.slice(0, 8)}).`
    );
  }

  const allDomainsMatch =
    identityMatches &&
    geometryMatches &&
    normalsMatch &&
    uvsMatch &&
    materialsMatch &&
    transformsMatch &&
    hierarchyMatches &&
    propertiesMatch &&
    hashMatches &&
    failedPartIdsSet.size === 0 &&
    verifiedPartIds.length === stabilizedOriginalParts.length;

  const anyPartOrDomainReconstructed =
    verifiedPartIds.length > 0 || (reconPartsById.size > 0 && (identityMatches || geometryMatches));

  const status: StudioModelReconstructionComparison['status'] = allDomainsMatch
    ? 'completed'
    : anyPartOrDomainReconstructed
    ? 'partially_applied'
    : 'failed';

  return {
    valid: allDomainsMatch,
    status,
    verified: allDomainsMatch,
    reconstructedAsset,
    verifiedPartIds,
    failedPartIds: Array.from(failedPartIdsSet),
    discrepancies,
    domainComparison: {
      identityMatches,
      geometryMatches,
      normalsMatch,
      uvsMatch,
      materialsMatch,
      transformsMatch,
      hierarchyMatches,
      propertiesMatch,
      hashMatches,
    },
  };
}
