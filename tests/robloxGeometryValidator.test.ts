import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRobloxGeometry,
  triangulatePolygonFace3D,
  countValidTrianglesInFace,
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


