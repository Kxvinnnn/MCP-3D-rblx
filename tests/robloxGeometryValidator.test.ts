import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRobloxGeometry } from '../src/utils/robloxGeometryValidator.ts';
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

test('3. validateRobloxGeometry: Coordenadas NaN o no finitas son rechazadas', () => {
  const asset = createMockAsset();
  asset.parts[0].position = [NaN, 0, 0];

  const report = validateRobloxGeometry(asset);
  assert.equal(report.isValid, false);
  assert.equal(report.hasNonFiniteCoordinates, true);
  assert.ok(report.errors.some((e) => e.includes('no finita')));
});

test('4. validateRobloxGeometry: Índices fuera de rango son detectados', () => {
  const asset = createMockAsset();
  asset.parts[0].meshData!.faces = [[0, 1, 999]]; // Index 999 when only 3 verts exist

  const report = validateRobloxGeometry(asset);
  assert.equal(report.isValid, false);
  assert.equal(report.hasInvalidIndices, true);
  assert.ok(report.errors.some((e) => e.includes('índice inválido')));
});
