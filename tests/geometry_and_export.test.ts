import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateProceduralTree,
  type TreePreset,
} from '../src/server/engines/treeGenerator.ts';
import {
  parseWavefrontObjGeometry,
  synthesizeProceduralMeshData,
  type SubMeshGeometryInput,
} from '../src/server/engines/generation3DEngine.ts';
import {
  buildGltfFromPartsServer,
  buildObjAndMtlFromPartsServer,
  buildRbxmxFromPartsServer,
  parseRbxmxFromPartsServer,
} from '../src/server/engines/assetEngine.ts';

function validateGeometryIntegrity(mesh: SubMeshGeometryInput, label: string) {
  assert.ok(mesh.vertices.length >= 4, `${label}: debe tener al menos 4 vértices`);
  assert.ok(mesh.faces.length >= 2, `${label}: debe tener al menos 2 triángulos`);
  assert.ok(mesh.vertices.length <= 9000, `${label}: excede límite de 9000 vértices EditableMesh`);
  assert.ok(mesh.faces.length <= 9500, `${label}: excede límite de 9500 triángulos EditableMesh`);

  for (const v of mesh.vertices) {
    assert.equal(v.length, 3);
    assert.ok(v.every((n) => Number.isFinite(n)), `${label}: vértice con NaN/Infinity`);
  }
  for (const n of mesh.normals) {
    assert.equal(n.length, 3);
    assert.ok(n.every((x) => Number.isFinite(x)), `${label}: normal con NaN/Infinity`);
    const len = Math.hypot(n[0], n[1], n[2]);
    assert.ok(len > 0.9 && len < 1.1, `${label}: normal no unitaria (${len})`);
  }
  for (const uv of mesh.uvs) {
    assert.equal(uv.length, 2);
    assert.ok(uv.every((x) => Number.isFinite(x)), `${label}: UV con NaN/Infinity`);
  }

  let invertedCount = 0;
  for (const [i0, i1, i2] of mesh.faces) {
    assert.ok(i0 >= 0 && i0 < mesh.vertices.length, `${label}: índice fuera de rango`);
    assert.ok(i1 >= 0 && i1 < mesh.vertices.length, `${label}: índice fuera de rango`);
    assert.ok(i2 >= 0 && i2 < mesh.vertices.length, `${label}: índice fuera de rango`);
    assert.ok(i0 !== i1 && i1 !== i2 && i0 !== i2, `${label}: triángulo con índices repetidos`);

    const a = mesh.vertices[i0];
    const b = mesh.vertices[i1];
    const c = mesh.vertices[i2];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const area2 = Math.hypot(nx, ny, nz);
    assert.ok(area2 > 1e-6, `${label}: triángulo degenerado (área ~ 0)`);

    // Verificar orientación contra normal de vértice
    const vn = mesh.normals[i0];
    const dot = nx * vn[0] + ny * vn[1] + nz * vn[2];
    if (dot < 0) invertedCount++;
  }
  assert.equal(invertedCount, 0, `${label}: detectadas ${invertedCount} caras invertidas`);
}

test('Fase 4.1 — Cilindro procedural tiene normales y caras orientadas hacia afuera (sin caras invertidas)', () => {
  const cyl = synthesizeProceduralMeshData('Cylinder', [4, 8, 4]);
  validateGeometryIntegrity(cyl, 'Cylinder');
});

test('Fase 4.2 — Generador de árboles: presets A-F, LOD 0/1/2, reproducibilidad por seed y pivote Y=0', () => {
  const presets: TreePreset[] = ['simple', 'leafy', 'fantasy', 'weeping', 'low', 'high'];
  for (const preset of presets) {
    const tree = generateProceduralTree(`Tree_${preset}`, { preset, seed: 4242 });
    assert.ok(tree.parts.length >= 3, `${preset}: árbol debe tener múltiples partes`);
    assert.ok(Math.abs(tree.stats.minY) < 0.01, `${preset}: pivote base debe estar en Y=0 (obtenido ${tree.stats.minY})`);
    assert.ok(tree.stats.maxY >= 8 && tree.stats.maxY <= 40, `${preset}: escala coherente con Roblox`);
    for (const part of tree.parts) {
      validateGeometryIntegrity(part.meshData, `${preset}/${part.name}`);
    }
  }

  // Reproducibilidad exacta con misma seed
  const t1 = generateProceduralTree('ReproTree', { preset: 'fantasy', seed: 9999 });
  const t2 = generateProceduralTree('ReproTree', { preset: 'fantasy', seed: 9999 });
  assert.deepEqual(t1.stats, t2.stats);
  assert.deepEqual(t1.parts[0].meshData.vertices, t2.parts[0].meshData.vertices);

  // Diferencias correctas entre LOD 0, 1 y 2
  const lod0 = generateProceduralTree('LodTree', { preset: 'leafy', seed: 123, lod: 0 });
  const lod1 = generateProceduralTree('LodTree', { preset: 'leafy', seed: 123, lod: 1 });
  const lod2 = generateProceduralTree('LodTree', { preset: 'leafy', seed: 123, lod: 2 });
  assert.ok(lod0.stats.totalTriangles > lod1.stats.totalTriangles, 'LOD 0 debe tener más triángulos que LOD 1');
  assert.ok(lod1.stats.totalTriangles > lod2.stats.totalTriangles, 'LOD 1 debe tener más triángulos que LOD 2');
});

test('Fase 5 — Exportación OBJ, GLTF y RBXMX conserva geometría, colores, materiales y nombres al reimportar', () => {
  const tree = generateProceduralTree('ExportFantasyTree', { preset: 'fantasy', seed: 777, lod: 1 });

  // OBJ + MTL
  const { obj: objContent, mtl: mtlContent } = buildObjAndMtlFromPartsServer(tree.name, tree.parts as any);
  assert.ok(objContent.includes('v ') && objContent.includes('f '), 'OBJ debe contener vértices y caras');
  assert.ok(mtlContent.includes('newmtl '), 'MTL debe contener materiales');
  const parsedObj = parseWavefrontObjGeometry(objContent);
  assert.ok(parsedObj.vertices.length > 0, 'OBJ reimportado debe tener vértices');
  assert.equal(parsedObj.faces.length, tree.stats.totalTriangles);

  // GLTF 2.0
  const gltfStr = buildGltfFromPartsServer(tree.name, tree.parts as any);
  const gltf = JSON.parse(gltfStr);
  assert.equal(gltf.asset.version, '2.0');
  assert.equal(gltf.nodes.length, tree.parts.length);
  assert.equal(gltf.meshes.length, tree.parts.length);

  // RBXMX export + reimportación bidireccional
  const rbxmx = buildRbxmxFromPartsServer(tree.name, tree.parts as any);
  const reimported = parseRbxmxFromPartsServer(rbxmx, tree.name);
  assert.equal(reimported.parts.length, tree.parts.length);
  assert.equal(reimported.parts[0].name, tree.parts[0].name);
  assert.deepEqual(reimported.parts[0].color, tree.parts[0].color);
  assert.equal(reimported.parts[0].meshData?.vertices.length, tree.parts[0].meshData.vertices.length);
  assert.equal(reimported.parts[0].meshData?.faces.length, tree.parts[0].meshData.faces.length);
});
