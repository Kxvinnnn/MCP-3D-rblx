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
