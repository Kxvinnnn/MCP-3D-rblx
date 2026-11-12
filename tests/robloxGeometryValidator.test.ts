import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateRobloxGeometry,
  triangulatePolygonFace3D,
  countValidTrianglesInFace,
  verifyAndBuildEditableMeshStructure,
  EditableMeshConstructionAdapter,
} from '../src/utils/robloxGeometryValidator.ts';
import { Forge3DAsset } from '../src/utils/roblox3DEngine.ts';

function createMockAsset(name = 'GeoTest'): Forge3DAsset {
  return {
    name,
    category: 'Test',
    asset_type: 'Model3D',
    poly_count: 12,
    collision_fidelity: 'Hull',
    rojo_target_folder: 'src/shared/assets/models',
    file_name: `${name}.luau`,
    description: 'Geometry test mock asset',
    pbr_profile: {
      pattern: 'Smooth',
      albedo_hex: '#ffffff',
      emissive_hex: '#000000',
      roughness: 0.5,
      metalness: 0,
      roblox_material: 'Plastic',
    },
    parts: [
      {
        partId: 'p1',
        name: 'NormalPart',
        shape: 'Block',
        size: [2, 2, 2],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        color: [255, 255, 255],
        material: 'Plastic',
        roughness: 0.5,
        metalness: 0,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Box',
        meshData: {
          vertices: [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
          ],
          faces: [[0, 1, 2]],
        },
      },
    ],
    luau_code: '-- test',
  };
}

test('1. validateRobloxGeometry: Asset válido aprueba sin errores', () => {
  const asset = createMockAsset();
  const report = validateRobloxGeometry(asset);

  assert.equal(report.isValid, true);
  assert.equal(report.errors.length, 0);
  assert.equal(report.totalParts, 1);
  assert.equal(report.totalVertices, 3);
  assert.equal(report.totalTriangles, 1);
});

test('2. validateRobloxGeometry: Escala excesiva (>2048 studs) produce error', () => {
  const asset = createMockAsset();
  asset.parts[0].size = [3000, 2, 2];

  const report = validateRobloxGeometry(asset);
  assert.equal(report.isValid, false);
  assert.equal(report.hasScaleLimitsExceeded, true);
  assert.ok(report.errors.some((e) => e.includes('supera el límite máximo')));
});

test('3. validateRobloxGeometry: Coordenadas NaN o no finitas en posición, rotación y rotationMatrix son rechazadas', () => {
  // 3A. Posición NaN
  const assetPos = createMockAsset();
  assetPos.parts[0].position = [NaN, 0, 0];
  const reportPos = validateRobloxGeometry(assetPos);
  assert.equal(reportPos.isValid, false);
  assert.equal(reportPos.hasNonFiniteCoordinates, true);

  // 3B. Rotación Infinity
  const assetRot = createMockAsset();
  assetRot.parts[0].rotation = [0, Infinity, 0];
  const reportRot = validateRobloxGeometry(assetRot);
  assert.equal(reportRot.isValid, false);
  assert.equal(reportRot.hasNonFiniteCoordinates, true);
  assert.ok(reportRot.errors.some((e) => e.includes('Rotación en eje')));

  // 3C. rotationMatrix con NaN o longitud incorrecta
  const assetMat = createMockAsset();
  assetMat.parts[0].rotationMatrix = [1, 0, 0, 0, NaN, 0, 0, 0, 1];
  const reportMat = validateRobloxGeometry(assetMat);
  assert.equal(reportMat.isValid, false);
  assert.equal(reportMat.hasNonFiniteCoordinates, true);
  assert.ok(reportMat.errors.some((e) => e.includes('rotationMatrix')));
});

test('4. validateRobloxGeometry: Índices fuera de rango son detectados', () => {
  const asset = createMockAsset();
  asset.parts[0].meshData!.faces = [[0, 1, 999]]; // Index 999 when only 3 verts exist

  const report = validateRobloxGeometry(asset);
  assert.equal(report.isValid, false);
  assert.equal(report.hasInvalidIndices, true);
  assert.ok(report.errors.some((e) => e.includes('índice inválido')));
});

test('5. validateRobloxGeometry: Triangulación Ear Clipping en polígonos cóncavos y rechazo de caras con < 3 vértices o degeneradas (> 3 vértices)', () => {
  // 5A. Polígono cóncavo de 5 vértices (forma de flecha / L en el plano XY)
  const concaveVertices = [
    [0, 0, 0],
    [4, 0, 0],
    [4, 4, 0],
    [2, 1.5, 0], // Vértice reflejo (entrante/cóncavo)
    [0, 4, 0],
  ];
  const concaveFace = [0, 1, 2, 3, 4];
  const triResult = triangulatePolygonFace3D(concaveFace, concaveVertices);
  assert.equal(triResult.valid, true);
  assert.equal(triResult.triangles.length, 3, 'Polígono cóncavo de 5 vértices debe triangularse en 3 triángulos válidos');
  assert.equal(countValidTrianglesInFace(concaveFace, concaveVertices), 3);

  const assetConcave = createMockAsset();
  assetConcave.parts[0].meshData = {
    vertices: concaveVertices,
    faces: [concaveFace],
  };
  const reportConcave = validateRobloxGeometry(assetConcave);
  assert.equal(reportConcave.isValid, true);
  assert.equal(reportConcave.totalTriangles, 3);

  // 5B. Cara con menos de 3 vértices ([0, 1]) debe reportarse como cara malformada
  const assetShortFace = createMockAsset();
  assetShortFace.parts[0].meshData = {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    faces: [[0, 1]],
  };
  const reportShort = validateRobloxGeometry(assetShortFace);
  assert.equal(reportShort.isValid, false);
  assert.equal(reportShort.hasMalformedFaces, true);
  assert.ok(reportShort.errors.some((e) => e.includes('menos de 3 vértices')));

  // 5C. Polígono degenerado de 4 vértices colineales no debe sumar face.length - 2 (2 triángulos), sino 0 y advertir cara degenerada
  const assetDegenerateQuad = createMockAsset();
  assetDegenerateQuad.parts[0].meshData = {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
      [3, 0, 0],
    ],
    faces: [[0, 1, 2, 3]],
  };
  const reportDegenerateQuad = validateRobloxGeometry(assetDegenerateQuad);
  assert.equal(reportDegenerateQuad.totalTriangles, 0, 'Un quad colineal degenerado debe contar 0 triángulos válidos');
  assert.equal(reportDegenerateQuad.hasDegenerateFaces, true);
  assert.equal(reportDegenerateQuad.isValid, false, 'Una malla donde todas las caras son degeneradas debe ser rechazada');
});

test('6. validateRobloxGeometry: Estructuras geométricas incompletas (vértices sin caras o caras vacías)', () => {
  const assetIncomplete = createMockAsset();
  assetIncomplete.parts[0].meshData = {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    faces: [],
  };
  const report = validateRobloxGeometry(assetIncomplete);
  assert.equal(report.isValid, false);
  assert.equal(report.hasIncompleteGeometry, true);
  assert.ok(report.errors.some((e) => e.includes('meshData vacío o insuficiente')));
});

test('7. validateRobloxGeometry: Validación equivalente de baseMeshData (índices fuera de rango, coordenadas no finitas y caras degeneradas)', () => {
  // 7A. baseMeshData con índice inválido aunque meshData sea válido
  const assetInvalidBaseIdx = createMockAsset();
  assetInvalidBaseIdx.parts[0].baseMeshData = {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ],
    faces: [[0, 1, 77]],
  };
  const reportBaseIdx = validateRobloxGeometry(assetInvalidBaseIdx);
  assert.equal(reportBaseIdx.isValid, false, 'Un índice inválido en baseMeshData debe invalidar el asset');
  assert.equal(reportBaseIdx.hasInvalidIndices, true);
  assert.ok(reportBaseIdx.errors.some((e) => e.includes('baseMeshData') && e.includes('índice inválido')));

  // 7B. baseMeshData con coordenada NaN
  const assetNaNBase = createMockAsset();
  assetNaNBase.parts[0].baseMeshData = {
    vertices: [
      [0, 0, 0],
      [NaN, 0, 0],
      [0, 1, 0],
    ],
    faces: [[0, 1, 2]],
  };
  const reportNaNBase = validateRobloxGeometry(assetNaNBase);
  assert.equal(reportNaNBase.isValid, false, 'Coordenadas NaN en baseMeshData deben invalidar el asset');
  assert.equal(reportNaNBase.hasNonFiniteCoordinates, true);
  assert.ok(reportNaNBase.errors.some((e) => e.includes('baseMeshData') && e.includes('coordenadas no finitas')));

  // 7C. baseMeshData completamente degenerado (todas las caras colineales)
  const assetDegenerateBase = createMockAsset();
  assetDegenerateBase.parts[0].baseMeshData = {
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ],
    faces: [[0, 1, 2]],
  };
  const reportDegenerateBase = validateRobloxGeometry(assetDegenerateBase);
  assert.equal(reportDegenerateBase.isValid, false, 'baseMeshData sin ningún triángulo válido debe invalidar el asset');
  assert.equal(reportDegenerateBase.hasDegenerateFaces, true);
  assert.ok(reportDegenerateBase.errors.some((e) => e.includes('baseMeshData') && e.includes('degenerada')));
});

test('8. validateRobloxGeometry: Política explícita sobre modelos vacíos (no exportables por defecto vs contenedor vacío opcional)', () => {
  const emptyAsset = createMockAsset('EmptyModel');
  emptyAsset.parts = [];

  // Por defecto un modelo sin piezas NO es exportable ni válido para sincronizar
  const defaultReport = validateRobloxGeometry(emptyAsset);
  assert.equal(defaultReport.isEmptyModel, true);
  assert.equal(defaultReport.isValid, false, 'Un modelo sin piezas debe marcarse como inválido (isValid: false) por defecto');
  assert.ok(defaultReport.errors.some((e) => e.includes('no contiene ninguna pieza')));

  // Sólo si se indica explícitamente allowEmptyParts: true se permite como contenedor lógico
  const containerReport = validateRobloxGeometry(emptyAsset, { allowEmptyParts: true });
  assert.equal(containerReport.isEmptyModel, true);
  assert.equal(containerReport.isValid, true);
  assert.ok(containerReport.warnings.some((w) => w.includes('contenedor vacío')));
});

test('9. Tolerancias geométricas relativas a la escala: soporte de micro-escalas (0.001 studs) y macro-escalas (2000 studs)', () => {
  // 9A. Micro-escala: polígono válido de 0.001 studs (cuya área al cuadrado es ~1e-12, menor que un umbral absoluto fijo 1e-8)
  const microScale = 0.001;
  const microVertices = [
    [0, 0, 0],
    [microScale, 0, 0],
    [microScale, microScale, 0],
    [0, microScale, 0],
  ];
  const microQuadFace = [0, 1, 2, 3];
  const microTriResult = triangulatePolygonFace3D(microQuadFace, microVertices);
  assert.equal(
    microTriResult.valid,
    true,
    'Un quad bien formado a escala 0.001 studs debe ser válido con tolerancia relativa a la escala'
  );
  assert.equal(microTriResult.triangles.length, 2, 'Quad a micro-escala debe producir 2 triángulos');

  const microAsset = createMockAsset('MicroAsset');
  microAsset.parts[0].size = [0.001, 0.001, 0.001];
  microAsset.parts[0].meshData = {
    vertices: microVertices,
    faces: [microQuadFace],
  };
  const microReport = validateRobloxGeometry(microAsset);
  assert.equal(microReport.isValid, true);
  assert.equal(microReport.totalTriangles, 2);

  // 9B. Macro-escala: polígono válido de 2000 studs y rechazo de polígono degenerado a macro-escala
  const macroScale = 2000;
  const macroVertices = [
    [0, 0, 0],
    [macroScale, 0, 0],
    [macroScale, macroScale, 0],
    [0, macroScale, 0],
  ];
  const macroTriResult = triangulatePolygonFace3D([0, 1, 2, 3], macroVertices);
  assert.equal(macroTriResult.valid, true);
  assert.equal(macroTriResult.triangles.length, 2);

  // Triángulo degenerado a macro-escala (base de 2000 studs con desviación transversal microscópica de 1e-6 studs -> colineal a esa escala)
  const macroCollinearVertices = [
    [0, 0, 0],
    [1000, 1e-6, 0],
    [2000, 0, 0],
  ];
  assert.equal(
    countValidTrianglesInFace([0, 1, 2], macroCollinearVertices),
    0,
    'Un triángulo de 2000 studs de largo con desviación de 1e-6 studs es colineal a su escala y debe rechazarse'
  );
});

test('10. Detección y rechazo estricto de polígonos auto-intersectantes (bowtie simétrico y asimétrico)', () => {
  // 10A. Polígono bowtie (reloj de arena / figura en 8) simétrico en el plano XY:
  // Las aristas (0->1) de (0,0)->(2,2) y (2->3) de (2,0)->(0,2) se cruzan en (1,1)
  const symmetricBowtieVertices = [
    [0, 0, 0],
    [2, 2, 0],
    [2, 0, 0],
    [0, 2, 0],
  ];
  const bowtieTri = triangulatePolygonFace3D([0, 1, 2, 3], symmetricBowtieVertices);
  assert.equal(bowtieTri.valid, false, 'Un polígono bowtie simétrico auto-intersectante debe ser rechazado');
  assert.equal(bowtieTri.triangles.length, 0);
  assert.equal(countValidTrianglesInFace([0, 1, 2, 3], symmetricBowtieVertices), 0);

  // 10B. Polígono auto-intersectante asimétrico de 5 vértices (donde la normal de Newell no se anula pero dos aristas no adyacentes se cruzan)
  const asymmetricSelfIntersectingVertices = [
    [0, 0, 0],
    [4, 0, 0],
    [1, 3, 0],
    [4, 4, 0],
    [0, 1, 0], // La arista (2->3: (1,3)->(4,4)) o (3->4: (4,4)->(0,1)) cruza la arista (1->2: (4,0)->(1,3))
  ];
  const asymTri = triangulatePolygonFace3D([0, 1, 2, 3, 4], asymmetricSelfIntersectingVertices);
  assert.equal(
    asymTri.valid,
    false,
    'Un polígono auto-intersectante asimétrico (con área neta no nula) debe ser rechazado por intersección de aristas'
  );

  // 10C. Integración en validateRobloxGeometry: pieza con cara auto-intersectante debe marcar hasMalformedFaces = true e isValid = false
  const assetSelfIntersecting = createMockAsset('SelfIntersectingAsset');
  assetSelfIntersecting.parts[0].meshData = {
    vertices: asymmetricSelfIntersectingVertices,
    faces: [[0, 1, 2, 3, 4]],
  };
  const report = validateRobloxGeometry(assetSelfIntersecting);
  assert.equal(report.isValid, false, 'validateRobloxGeometry debe invalidar modelos con caras auto-intersectantes');
  assert.equal(report.hasMalformedFaces, true);
});

function createMockEditableMeshAdapter(overrides?: {
  onSetFaceNormals?: () => boolean | void;
  onSetFaceUVs?: () => boolean | void;
  onGetVertices?: (addedVertices: Array<string | number>) => Array<string | number>;
  onGetTriangles?: (addedTriangles: Array<string | number>) => Array<string | number>;
  omitGetVertices?: boolean;
  omitGetTriangles?: boolean;
  onCreateMeshPartAsync?: () => void;
  onSetPartAttribute?: (name: string, val: unknown) => void;
}): {
  adapter: EditableMeshConstructionAdapter;
  getStats: () => {
    editableDestroyedCount: number;
    partDestroyedCount: number;
    faceNormalsAssigned: number;
    faceUVsAssigned: number;
  };
} {
  let editableDestroyedCount = 0;
  let partDestroyedCount = 0;
  let faceNormalsAssigned = 0;
  let faceUVsAssigned = 0;

  const adapter: EditableMeshConstructionAdapter = {
    createEditableMesh: () => {
      const vIds: Array<string | number> = [];
      const tIds: Array<string | number> = [];
      let nSeq = 0;
      let uvSeq = 0;

      const handle: any = {
        addVertex: (_x: number, _y: number, _z: number) => {
          const id = `v_${vIds.length + 1}`;
          vIds.push(id);
          return id;
        },
        addNormal: (_nx: number, _ny: number, _nz: number) => {
          nSeq += 1;
          return `n_${nSeq}`;
        },
        addUV: (_u: number, _v: number) => {
          uvSeq += 1;
          return `uv_${uvSeq}`;
        },
        addTriangle: (_v1: string | number, _v2: string | number, _v3: string | number) => {
          const id = `f_${tIds.length + 1}`;
          tIds.push(id);
          return id;
        },
        setFaceNormals: (_fId: string | number, _nIds: [string | number, string | number, string | number]) => {
          if (overrides?.onSetFaceNormals) {
            return overrides.onSetFaceNormals();
          }
          faceNormalsAssigned += 1;
          return true;
        },
        setFaceUVs: (_fId: string | number, _uvIds: [string | number, string | number, string | number]) => {
          if (overrides?.onSetFaceUVs) {
            return overrides.onSetFaceUVs();
          }
          faceUVsAssigned += 1;
          return true;
        },
        destroy: () => {
          editableDestroyedCount += 1;
        },
      };

      if (!overrides?.omitGetVertices) {
        handle.getVertices = () => {
          if (overrides?.onGetVertices) {
            return overrides.onGetVertices(vIds);
          }
          return [...vIds];
        };
      }

      if (!overrides?.omitGetTriangles) {
        handle.getTriangles = () => {
          if (overrides?.onGetTriangles) {
            return overrides.onGetTriangles(tIds);
          }
          return [...tIds];
        };
      }

      return handle;
    },
    createMeshPartAsync: () => {
      if (overrides?.onCreateMeshPartAsync) {
        overrides.onCreateMeshPartAsync();
      }
      return {
        setAttribute: (name: string, val: unknown) => {
          if (overrides?.onSetPartAttribute) {
            overrides.onSetPartAttribute(name, val);
          }
        },
        destroy: () => {
          partDestroyedCount += 1;
        },
      };
    },
  };

  return {
    adapter,
    getStats: () => ({
      editableDestroyedCount,
      partDestroyedCount,
      faceNormalsAssigned,
      faceUVsAssigned,
    }),
  };
}

test('11. Fase 1 & 6 — Endurecimiento de EditableMesh: índices decimales/negativos/fuera de rango, normales, UVs, fallos de SetFaceNormals/SetFaceUVs, readback GetVertices/GetTriangles y limpieza garantizada', () => {
  const validSpecBase = {
    name: 'HardenedMeshPart',
    partId: 'part_hardened_01',
    collisionFidelity: 'Hull' as const,
    meshData: {
      vertices: [
        [0, 0, 0],
        [2, 0, 0],
        [0, 2, 0],
      ],
      faces: [[0, 1, 2]],
      normals: [
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    },
  };

  // 11.1 Construcción exitosa completa con normales, UVs y readback verificado
  {
    const { adapter, getStats } = createMockEditableMeshAdapter();
    const res = verifyAndBuildEditableMeshStructure(validSpecBase, adapter);
    assert.equal(res.verified, true);
    assert.equal(res.readbackStatus, 'verified');
    assert.equal(res.normalsStatus, 'verified');
    assert.equal(res.uvsStatus, 'verified');
    assert.equal(res.editableMeshDestroyed, true, 'EditableMesh temporal debe destruirse tras CreateMeshPartAsync');
    assert.equal(res.orphanMeshPartDestroyed, false);
    assert.equal(getStats().editableDestroyedCount, 1);
    assert.equal(getStats().faceNormalsAssigned, 1);
    assert.equal(getStats().faceUVsAssigned, 1);
  }

  // 11.2 Índices decimales (sin truncar con Math.floor) deben ser rechazados
  {
    const { adapter, getStats } = createMockEditableMeshAdapter();
    const res = verifyAndBuildEditableMeshStructure(
      {
        ...validSpecBase,
        meshData: {
          ...validSpecBase.meshData,
          faces: [[0, 1.5, 2]],
        },
      },
      adapter
    );
    assert.equal(res.verified, false, 'Índice decimal 1.5 debe rechazarse, jamás truncarse con Math.floor');
    assert.equal(res.stageFailed, 'face_index_validation');
    assert.equal(res.editableMeshDestroyed, true);
    assert.equal(getStats().editableDestroyedCount, 1);
  }

  // 11.3 Índices negativos deben ser rechazados
  {
    const { adapter, getStats } = createMockEditableMeshAdapter();
    const res = verifyAndBuildEditableMeshStructure(
      {
        ...validSpecBase,
        meshData: {
          ...validSpecBase.meshData,
          faces: [[0, -1, 2]],
        },
      },
      adapter
    );
    assert.equal(res.verified, false);
    assert.equal(res.stageFailed, 'face_index_validation');
    assert.equal(res.editableMeshDestroyed, true);
    assert.equal(getStats().editableDestroyedCount, 1);
  }

  // 11.4 Índices fuera de rango deben ser rechazados
  {
    const { adapter, getStats } = createMockEditableMeshAdapter();
    const res = verifyAndBuildEditableMeshStructure(
      {
        ...validSpecBase,
        meshData: {
          ...validSpecBase.meshData,
          faces: [[0, 1, 99]],
        },
      },
      adapter
    );
    assert.equal(res.verified, false);
    assert.equal(res.stageFailed, 'face_index_validation');
    assert.equal(res.editableMeshDestroyed, true);
    assert.equal(getStats().editableDestroyedCount, 1);
  }

  // 11.5 Normales inválidas (magnitud cero, NaN o conteo incompleto) deben rechazarse, diferenciadas de normales ausentes
  {
    const { adapter: adapterAbsent } = createMockEditableMeshAdapter();
    const resAbsent = verifyAndBuildEditableMeshStructure(
      {
        ...validSpecBase,
        meshData: {
          vertices: validSpecBase.meshData.vertices,
          faces: validSpecBase.meshData.faces,
          // normals y uvs ausentes
        },
      },
      adapterAbsent
    );
    assert.equal(resAbsent.verified, true);
    assert.equal(resAbsent.normalsStatus, 'absent');
    assert.equal(resAbsent.uvsStatus, 'absent');

    const { adapter: adapterZeroNorm, getStats } = createMockEditableMeshAdapter();
    const resZeroNorm = verifyAndBuildEditableMeshStructure(
      {
        ...validSpecBase,
        meshData: {
          ...validSpecBase.meshData,
          normals: [
            [0, 0, 0], // Magnitud cero -> inválida
            [0, 0, 1],
            [0, 0, 1],
          ],
        },
      },
      adapterZeroNorm
    );
    assert.equal(resZeroNorm.verified, false);
    assert.equal(resZeroNorm.stageFailed, 'normal_validation');
    assert.equal(resZeroNorm.normalsStatus, 'invalid');
    assert.equal(getStats().editableDestroyedCount, 1);
  }

  // 11.6 UVs inválidas (conteo incompleto o valores no finitos) deben rechazarse
  {
    const { adapter, getStats } = createMockEditableMeshAdapter();
    const resBadUv = verifyAndBuildEditableMeshStructure(
      {
        ...validSpecBase,
        meshData: {
          ...validSpecBase.meshData,
          uvs: [
            [0, 0],
            [NaN, 1],
            [0, 1],
          ],
        },
      },
      adapter
    );
    assert.equal(resBadUv.verified, false);
    assert.equal(resBadUv.stageFailed, 'uv_validation');
    assert.equal(resBadUv.uvsStatus, 'invalid');
    assert.equal(getStats().editableDestroyedCount, 1);
  }

  // 11.7 Fallo en SetFaceNormals NO debe tragarse silenciosamente: debe fallar la pieza y destruir EditableMesh
  {
    const { adapter, getStats } = createMockEditableMeshAdapter({
      onSetFaceNormals: () => {
        throw new Error('Roblox EditableMesh:SetFaceNormals internal error');
      },
    });
    const res = verifyAndBuildEditableMeshStructure(validSpecBase, adapter);
    assert.equal(res.verified, false);
    assert.equal(res.stageFailed, 'set_face_normals');
    assert.equal(res.normalsStatus, 'assignment_failed');
    assert.equal(res.editableMeshDestroyed, true);
    assert.equal(getStats().editableDestroyedCount, 1);
  }

  // 11.8 Fallo en SetFaceUVs NO debe tragarse silenciosamente: debe fallar la pieza y destruir EditableMesh
  {
    const { adapter, getStats } = createMockEditableMeshAdapter({
      onSetFaceUVs: () => {
        throw new Error('Roblox EditableMesh:SetFaceUVs internal error');
      },
    });
    const res = verifyAndBuildEditableMeshStructure(validSpecBase, adapter);
    assert.equal(res.verified, false);
    assert.equal(res.stageFailed, 'set_face_uvs');
    assert.equal(res.uvsStatus, 'assignment_failed');
    assert.equal(res.editableMeshDestroyed, true);
    assert.equal(getStats().editableDestroyedCount, 1);
  }

  // 11.9 Fallo en GetVertices (error de lectura vs conteo distinto) nunca marca la pieza como verificada
  {
    const { adapter: adapterErr, getStats: statsErr } = createMockEditableMeshAdapter({
      onGetVertices: () => {
        throw new Error('GetVertices failed');
      },
    });
    const resErr = verifyAndBuildEditableMeshStructure(validSpecBase, adapterErr);
    assert.equal(resErr.verified, false);
    assert.equal(resErr.stageFailed, 'readback_vertices');
    assert.equal(resErr.readbackStatus, 'vertex_read_error');
    assert.equal(statsErr().editableDestroyedCount, 1);

    const { adapter: adapterMismatch, getStats: statsMismatch } = createMockEditableMeshAdapter({
      onGetVertices: (vIds) => vIds.slice(0, 2), // 2 en lugar de 3
    });
    const resMismatch = verifyAndBuildEditableMeshStructure(validSpecBase, adapterMismatch);
    assert.equal(resMismatch.verified, false);
    assert.equal(resMismatch.stageFailed, 'readback_vertices');
    assert.equal(resMismatch.readbackStatus, 'vertex_count_mismatch');
    assert.equal(statsMismatch().editableDestroyedCount, 1);
  }

  // 11.10 Fallo en GetTriangles (error de lectura vs conteo distinto) nunca marca la pieza como verificada
  {
    const { adapter: adapterErr, getStats: statsErr } = createMockEditableMeshAdapter({
      onGetTriangles: () => {
        throw new Error('GetTriangles failed');
      },
    });
    const resErr = verifyAndBuildEditableMeshStructure(validSpecBase, adapterErr);
    assert.equal(resErr.verified, false);
    assert.equal(resErr.stageFailed, 'readback_triangles');
    assert.equal(resErr.readbackStatus, 'triangle_read_error');
    assert.equal(statsErr().editableDestroyedCount, 1);

    const { adapter: adapterMismatch, getStats: statsMismatch } = createMockEditableMeshAdapter({
      onGetTriangles: () => [], // 0 en lugar de 1
    });
    const resMismatch = verifyAndBuildEditableMeshStructure(validSpecBase, adapterMismatch);
    assert.equal(resMismatch.verified, false);
    assert.equal(resMismatch.stageFailed, 'readback_triangles');
    assert.equal(resMismatch.readbackStatus, 'triangle_count_mismatch');
    assert.equal(statsMismatch().editableDestroyedCount, 1);
  }

  // 11.11 Fallo post-CreateMeshPartAsync (al asignar atributos): debe destruir tanto EditableMesh como el MeshPart huérfano
  {
    const { adapter, getStats } = createMockEditableMeshAdapter({
      onSetPartAttribute: () => {
        throw new Error('Attribute write failure on MeshPart');
      },
    });
    const res = verifyAndBuildEditableMeshStructure(validSpecBase, adapter);
    assert.equal(res.verified, false);
    assert.equal(res.stageFailed, 'part_attributes');
    assert.equal(res.editableMeshDestroyed, true);
    assert.equal(res.orphanMeshPartDestroyed, true);
    assert.equal(res.meshPart, null);
    assert.equal(getStats().editableDestroyedCount, 1);
    assert.equal(getStats().partDestroyedCount, 1, 'El MeshPart parcialmente creado debe destruirse para no quedar huérfano');
  }
});

test('12. Fase 1 & 3 — Verificación estructural del código Luau del plugin (ForgeAIStudioPlugin.server.luau)', () => {
  const luauPath = path.resolve(process.cwd(), 'backend/roblox_plugin/ForgeAIStudioPlugin.server.luau');
  const luauSource = fs.readFileSync(luauPath, 'utf-8');

  // 1. No debe truncar índices de cara con math.floor(tonumber(f[1]))
  assert.equal(
    luauSource.includes('math.floor(tonumber(f[1])'),
    false,
    'ForgeAIStudioPlugin.server.luau no debe truncar índices de triángulos con math.floor'
  );
  assert.ok(
    luauSource.includes('(r1 % 1 ~= 0) or (r2 % 1 ~= 0) or (r3 % 1 ~= 0)'),
    'Debe verificar explícitamente que los índices de cara sean enteros finitos (r % 1 == 0)'
  );

  // 2. Debe inspeccionar el resultado de SetFaceNormals y SetFaceUVs
  assert.ok(
    luauSource.includes('local okNorm, normErr = pcall(function()') &&
      luauSource.includes('if not okNorm then'),
    'Debe inspeccionar el resultado de SetFaceNormals y lanzar error si falla'
  );
  assert.ok(
    luauSource.includes('local okUv, uvErr = pcall(function()') &&
      luauSource.includes('if not okUv then'),
    'Debe inspeccionar el resultado de SetFaceUVs y lanzar error si falla'
  );

  // 3. Debe exigir GetVertices y GetTriangles en el readback obligatorio y destruir createdPartInstance ante error
  assert.ok(
    luauSource.includes('EditableMesh:GetVertices() no está disponible') &&
      luauSource.includes('EditableMesh:GetTriangles() no está disponible'),
    'Debe exigir lectura posterior obligatoria GetVertices() y GetTriangles()'
  );
  assert.ok(
    luauSource.includes('if createdPartInstance then') &&
      luauSource.includes('createdPartInstance:Destroy()'),
    'Debe destruir cualquier MeshPart parcialmente creado si ocurre un error posterior'
  );
});




