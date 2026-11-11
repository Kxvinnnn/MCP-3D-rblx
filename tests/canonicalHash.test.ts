import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sha256Hex,
  toCanonicalJsonValue,
  computeCanonicalAssetHash,
  strictOrdinalCompare,
} from '../src/utils/canonicalHash.ts';
import { Forge3DAsset } from '../src/utils/roblox3DEngine.ts';

function createBaseTestAsset(name = 'CanonTestModel'): Forge3DAsset {
  return {
    name,
    category: 'Weapons',
    asset_type: 'Model3D',
    poly_count: 12,
    collision_fidelity: 'Hull',
    rojo_target_folder: 'src/shared/assets/models',
    file_name: `${name}.luau`,
    description: 'Descripción con español, tildes y símbolos: ñoqui, café, 🤖🎮',
    created_at: '2026-11-11T12:00:00Z',
    updated_at: '2026-11-11T12:05:00Z',
    version: 4,
    saved_path: '/app/assets/saved.json',
    pbr_profile: {
      pattern: 'HexPlate',
      albedo_hex: '#06b6d4',
      emissive_hex: '#38bdf8',
      roughness: 0.25,
      metalness: 0.85,
      roblox_material: 'Metal',
    },
    parts: [
      {
        partId: 'part_head',
        name: 'Head',
        shape: 'Block',
        size: [2, 2, 2],
        position: [0, 4, 0],
        rotation: [0, 0, 0],
        color: [255, 200, 150],
        material: 'SmoothPlastic',
        roughness: 0.5,
        metalness: 0,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Box',
        hierarchyPath: 'Workspace/CanonTestModel/Head',
      },
      {
        partId: 'part_torso',
        name: 'Torso',
        shape: 'Block',
        size: [4, 4, 2],
        position: [0, 1, 0],
        rotation: [0, 0, 0],
        color: [50, 100, 200],
        material: 'Metal',
        roughness: 0.2,
        metalness: 0.8,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Box',
        hierarchyPath: 'Workspace/CanonTestModel/Torso',
      },
    ],
    luau_code: '-- canon test\n',
  };
}

test('1. sha256Hex: Vectores oficiales de prueba NIST SHA-256', () => {
  // Vector 1: Cadena vacía
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'Vector oficial NIST para cadena vacía'
  );

  // Vector 2: "abc"
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    'Vector oficial NIST para "abc"'
  );

  // Vector 3: "abcdefghijklmnopqrstuvwxyz"
  assert.equal(
    sha256Hex('abcdefghijklmnopqrstuvwxyz'),
    '71c480df93d6ae2f1efad1447c66c9525e316218cf51fc8d9ed832f2daf18b73',
    'Vector oficial NIST para alfabeto minúsculo'
  );
});

test('2. sha256Hex: UTF-8, caracteres multi-byte, tildes en español, ñ y emojis', () => {
  const spanishStr = 'Modelo de Robótica 3D — Ñoqui & Café 🤖🎮';
  const hash1 = sha256Hex(spanishStr);

  assert.equal(hash1.length, 64, 'El hash SHA-256 debe tener exactamente 64 caracteres hexadecimales');
  assert.match(hash1, /^[0-9a-f]{64}$/, 'El hash SHA-256 debe ser estrictamente hexadecimal en minúsculas');

  // Verificar consistencia entre ejecuciones repetidas
  for (let i = 0; i < 50; i++) {
    assert.equal(sha256Hex(spanishStr), hash1, 'El hash debe ser 100% determinista e idéntico entre ejecuciones');
  }

  // Verificar que cambiar un solo carácter en español altera el hash
  const spanishStrModified = 'Modelo de Robótica 3D — Ñoqui & Café 🤖🎯';
  assert.notEqual(sha256Hex(spanishStrModified), hash1, 'Cambiar un emoji debe alterar el digest SHA-256');

  const spanishAccentModified = 'Modelo de Robótica 3D — Noqui & Café 🤖🎮';
  assert.notEqual(sha256Hex(spanishAccentModified), hash1, 'Remover la tilde o Ñ debe alterar el digest SHA-256');
});

test('3. toCanonicalJsonValue: Ordenación ordinal determinista de partes y desempatador canónico', () => {
  const assetOriginal = createBaseTestAsset();
  const assetReordered = createBaseTestAsset();
  assetReordered.parts = [assetOriginal.parts[1], assetOriginal.parts[0]];

  const hashOriginal = computeCanonicalAssetHash(assetOriginal);
  const hashReordered = computeCanonicalAssetHash(assetReordered);

  assert.equal(
    hashReordered,
    hashOriginal,
    'Reordenar el array de partes debe producir exactamente el mismo hash canónico'
  );

  // Probar desempate cuando partId/hierarchyPath/name son totalmente idénticos
  const duplicatePartsAsset1: Forge3DAsset = {
    ...createBaseTestAsset(),
    parts: [
      {
        name: 'ClonePart',
        shape: 'Block',
        material: 'Plastic',
        roughness: 0.5,
        metalness: 0,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Box',
        color: [255, 0, 0],
        size: [1, 1, 1],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      },
      {
        name: 'ClonePart',
        shape: 'Block',
        material: 'Plastic',
        roughness: 0.5,
        metalness: 0,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Box',
        color: [0, 0, 255], // Diferente color
        size: [1, 1, 1],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      },
    ],
  };

  const duplicatePartsAsset2: Forge3DAsset = {
    ...duplicatePartsAsset1,
    parts: [duplicatePartsAsset1.parts[1], duplicatePartsAsset1.parts[0]],
  };

  const hashDup1 = computeCanonicalAssetHash(duplicatePartsAsset1);
  const hashDup2 = computeCanonicalAssetHash(duplicatePartsAsset2);

  assert.equal(
    hashDup2,
    hashDup1,
    'Piezas con claves idénticas deben desempatarse canónicamente y producir el mismo hash sin importar el orden original'
  );
});

test('4. Exclusión de claves: Exclusión en raíz vs preservación en estructuras anidadas', () => {
  const assetBase = createBaseTestAsset();
  const initialHash = computeCanonicalAssetHash(assetBase);

  // 4A. Modificar propiedades excluidas en la RAÍZ (created_at, updated_at, version, saved_path)
  const rootModified: Forge3DAsset = {
    ...assetBase,
    created_at: '2099-01-01T00:00:00Z',
    updated_at: '2099-01-01T00:00:00Z',
    version: 999,
    saved_path: '/path/to/different/saved.json',
  };

  assert.equal(
    computeCanonicalAssetHash(rootModified),
    initialHash,
    'Las claves excluidas en la RAÍZ no deben alterar el hash canónico'
  );

  // 4B. Modificar una propiedad con el nombre 'version' dentro de un objeto ANIDADO (por ejemplo en un spec de pieza)
  const nestedVersionAsset: Forge3DAsset = {
    ...assetBase,
    parts: [
      {
        ...assetBase.parts[0],
        customMeta: {
          version: 2, // 'version' dentro de customMeta (nivel anidado)
        },
      } as any,
      assetBase.parts[1],
    ],
  };

  const nestedVersionAssetAltered: Forge3DAsset = {
    ...assetBase,
    parts: [
      {
        ...assetBase.parts[0],
        customMeta: {
          version: 3, // Cambia de 2 a 3 en nivel anidado
        },
      } as any,
      assetBase.parts[1],
    ],
  };

  assert.notEqual(
    computeCanonicalAssetHash(nestedVersionAssetAltered),
    computeCanonicalAssetHash(nestedVersionAsset),
    'La clave version dentro de un objeto ANIDADO (no raíz) SÍ debe formar parte del hash canónico'
  );
});

test('5. Sensitivity de baseMeshData: Cambios profundos en geometría base alteran el hash canónico', () => {
  const assetWithBaseMesh: Forge3DAsset = {
    ...createBaseTestAsset(),
    parts: [
      {
        ...createBaseTestAsset().parts[0],
        baseMeshData: {
          vertices: [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.5, 1.0, 0.0],
          ],
          faces: [[0, 1, 2]],
          normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
          uvs: [[0, 0], [1, 0], [0.5, 1]],
          objFileName: 'basemesh_v1.obj',
        },
      },
      createBaseTestAsset().parts[1],
    ],
  };

  const originalHash = computeCanonicalAssetHash(assetWithBaseMesh);

  // Modificar únicamente 1 coordenada interna en baseMeshData (manteniendo misma cantidad de vértices y caras)
  const modifiedBaseMesh: Forge3DAsset = JSON.parse(JSON.stringify(assetWithBaseMesh));
  modifiedBaseMesh.parts[0].baseMeshData!.vertices[1][0] = 1.0001; // Desplazamiento de 0.0001 studs

  assert.notEqual(
    computeCanonicalAssetHash(modifiedBaseMesh),
    originalHash,
    'Modificar una coordenada dentro de baseMeshData manteniendo la cantidad de vértices/caras DEBE alterar el hash canónico'
  );
});

test('6. Sensibilidad exhaustiva: PBR, matrices de rotación, transformaciones sub-milimétricas y determinismo', () => {
  const asset = createBaseTestAsset();
  const hashBase = computeCanonicalAssetHash(asset);

  // 6A. Desplazamiento sub-milimétrico (0.0001 vs 0.0002)
  const subMMAsset: Forge3DAsset = JSON.parse(JSON.stringify(asset));
  subMMAsset.parts[0].position = [0.0001, 4, 0];
  assert.notEqual(computeCanonicalAssetHash(subMMAsset), hashBase, 'Desplazamiento de 0.0001 studs debe alterar el hash');

  // 6B. Matriz de rotación
  const rotMatAsset: Forge3DAsset = JSON.parse(JSON.stringify(asset));
  rotMatAsset.parts[0].rotationMatrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  assert.notEqual(computeCanonicalAssetHash(rotMatAsset), hashBase, 'Añadir rotationMatrix debe alterar el hash');

  // 6C. Perfil PBR
  const pbrAsset: Forge3DAsset = JSON.parse(JSON.stringify(asset));
  pbrAsset.pbr_profile.albedo_hex = '#ff0000';
  assert.notEqual(computeCanonicalAssetHash(pbrAsset), hashBase, 'Modificar albedo_hex en PBR debe alterar el hash');

  // 6D. Comparador ordinal estricto
  assert.equal(strictOrdinalCompare('abc', 'abc'), 0);
  assert.equal(strictOrdinalCompare('abc', 'abd'), -1);
  assert.equal(strictOrdinalCompare('abd', 'abc'), 1);
});
