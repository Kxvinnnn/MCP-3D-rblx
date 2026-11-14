import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStrictLuauFromEditedParts,
  resolveRgbTupleLuau,
  synthesizeProceduralMeshData,
} from '../src/server/engines/generation3DEngine.ts';

test('Fase 3 — Conversión exacta de colores RGB normalizados, 8-bit y hexadecimales', () => {
  assert.deepEqual(resolveRgbTupleLuau([1, 0, 0]), [255, 0, 0]);
  assert.deepEqual(resolveRgbTupleLuau([0, 1, 0]), [0, 255, 0]);
  assert.deepEqual(resolveRgbTupleLuau([0, 0, 1]), [0, 0, 255]);
  assert.deepEqual(resolveRgbTupleLuau([255, 0, 0]), [255, 0, 0]);
  assert.deepEqual(resolveRgbTupleLuau([0, 255, 0]), [0, 255, 0]);
  assert.deepEqual(resolveRgbTupleLuau([0, 0, 255]), [0, 0, 255]);
  assert.deepEqual(resolveRgbTupleLuau([0.5, 0.25, 0.75]), [128, 64, 191]);
  assert.deepEqual(resolveRgbTupleLuau('#FF0000'), [255, 0, 0]);
  assert.deepEqual(resolveRgbTupleLuau('#00FF00'), [0, 255, 0]);
  assert.deepEqual(resolveRgbTupleLuau('#0000FF'), [0, 0, 255]);
  assert.deepEqual(resolveRgbTupleLuau('#FFFFFF'), [255, 255, 255]);
  assert.deepEqual(resolveRgbTupleLuau('#000000'), [0, 0, 0]);
  assert.deepEqual(resolveRgbTupleLuau('#F00'), [255, 0, 0]);
  assert.deepEqual(resolveRgbTupleLuau({ r: 0.5, g: 0.25, b: 0.75 }), [128, 64, 191]);
  assert.deepEqual(resolveRgbTupleLuau([0, 0, 0]), [0, 0, 0]);
  assert.deepEqual(resolveRgbTupleLuau([255, 255, 255]), [255, 255, 255]);
});

test('Fase 3 — buildStrictLuauFromEditedParts emite Color3.fromRGB correcto para colores normalizados y hex', () => {
  const md = synthesizeProceduralMeshData('MeshPart', [2, 2, 2]);
  const luau = buildStrictLuauFromEditedParts('ColorTestModel', [
    { name: 'NormalizedRed', shape: 'MeshPart', size: [2, 2, 2], position: [0, 1, 0], rotation: [0, 0, 0], color: [1, 0, 0], material: 'Metal', roughness: 0.35, metalness: 0.6, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull', meshData: md },
    { name: 'FloatMix', shape: 'MeshPart', size: [2, 2, 2], position: [2, 1, 0], rotation: [0, 0, 0], color: [0.5, 0.25, 0.75], material: 'Metal', roughness: 0.35, metalness: 0.6, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull', meshData: md },
    { name: 'HexGreen', shape: 'MeshPart', size: [2, 2, 2], position: [4, 1, 0], rotation: [0, 0, 0], color: '#00FF00' as any, material: 'Metal', roughness: 0.35, metalness: 0.6, transparency: 0, canCollide: true, anchored: true, collisionFidelity: 'Hull', meshData: md },
  ]);

  assert.match(luau, /Color3\.fromRGB\(255,\s*0,\s*0\)/);
  assert.match(luau, /Color3\.fromRGB\(128,\s*64,\s*191\)/);
  assert.match(luau, /Color3\.fromRGB\(0,\s*255,\s*0\)/);
});
