import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sha256Hex,
  toCanonicalJsonValue,
  computeCanonicalAssetHash,
  computeGeometryHash,
  computeAppearanceHash,
  computePropertiesHash,
  strictOrdinalCompare,
} from '../src/utils/canonicalHash.ts';
import { computeIncrementalDiff } from '../src/utils/incrementalSync.ts';
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

test('7. sha256Hex: Límites exactos de bloques SHA-256 (55, 56, 63, 64, 65 bytes y multi-bloque) vs crypto', async () => {
  const crypto = await import('crypto');
  const nodeSha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

  const lengths = [0, 1, 54, 55, 56, 57, 63, 64, 65, 127, 128, 129, 500, 1024];

  for (const len of lengths) {
    const testStr = 'A'.repeat(len);
    const expected = nodeSha256(testStr);
    const actual = sha256Hex(testStr);
    assert.equal(
      actual,
      expected,
      `sha256Hex debe coincidir exactamente con NIST/crypto para entrada de longitud ${len} bytes`
    );
  }

  // Caracteres Unicode combinados
  const combinedStr = 'e\u0301 vs \u00e9 (ñ, ü, 🚀🔥)';
  assert.equal(sha256Hex(combinedStr), nodeSha256(combinedStr));
});

test('8. toCanonicalJsonValue: Rechazo estricto de tipos no serializables y referencias circulares (incluyendo Map y Set)', () => {
  // 8A. BigInt debe lanzar TypeError
  assert.throws(
    () => toCanonicalJsonValue({ val: BigInt(12345) }),
    /BigInt values cannot be serialized/
  );

  // 8B. Function debe lanzar TypeError
  assert.throws(
    () => toCanonicalJsonValue({ fn: () => true }),
    /Function values cannot be serialized/
  );

  // 8C. Symbol debe lanzar TypeError
  assert.throws(
    () => toCanonicalJsonValue({ sym: Symbol('forge') }),
    /Symbol values cannot be serialized/
  );

  // 8D. Referencia circular en objeto plano debe lanzar TypeError descriptivo
  const circularObj: any = { name: 'PartA' };
  circularObj.self = circularObj;
  assert.throws(
    () => toCanonicalJsonValue(circularObj),
    /Circular reference detected/
  );

  // 8E. Referencia circular en Map que se contiene a sí mismo
  const circularMap = new Map<string, any>();
  circularMap.set('self', circularMap);
  assert.throws(
    () => toCanonicalJsonValue(circularMap),
    /Circular reference detected/
  );

  // 8F. Referencia circular en Set que se contiene a sí mismo
  const circularSet = new Set<any>();
  circularSet.add(circularSet);
  assert.throws(
    () => toCanonicalJsonValue(circularSet),
    /Circular reference detected/
  );

  // 8G. Invalid Date y RegExp deben lanzar TypeError explícito
  assert.throws(
    () => toCanonicalJsonValue(new Date('invalid-date-string')),
    /Invalid Date cannot be serialized/
  );
  assert.throws(
    () => toCanonicalJsonValue(/regex/),
    /Unsupported object type \(RegExp\)/
  );
});

test('9. toCanonicalJsonValue: Normalización canónica de Date, Map (sin colisión 1 vs "1"), Set (independiente del orden de inserción), ArrayBuffer y TypedArray', () => {
  // 9A. Date normalizado a ISO string
  const dateObj = { time: new Date('2026-11-12T00:00:00.000Z') };
  assert.equal(toCanonicalJsonValue(dateObj), '{"time":"2026-11-12T00:00:00.000Z"}');

  // 9B. Map con claves string normalizado ordenando claves
  const map = new Map<string, any>([
    ['b', 2],
    ['a', 1],
  ]);
  assert.equal(toCanonicalJsonValue(map), '{"a":1,"b":2}');

  // 9C. Map con claves numéricas vs string (1 vs "1") NO debe colisionar ni sobrescribirse
  const mapNumAndStr = new Map<any, any>([
    [1, 'number_key'],
    ['1', 'string_key'],
  ]);
  const mapStrAndNum = new Map<any, any>([
    ['1', 'string_key'],
    [1, 'number_key'],
  ]);
  const serializedMixedMap = toCanonicalJsonValue(mapNumAndStr);
  assert.equal(
    serializedMixedMap,
    toCanonicalJsonValue(mapStrAndNum),
    'Map con claves mixtas debe ser determinista independientemente del orden de inserción'
  );
  assert.ok(
    serializedMixedMap.includes('"number_key"') && serializedMixedMap.includes('"string_key"'),
    'Map con claves 1 y "1" debe preservar ambas entradas sin colisión'
  );

  // 9D. Set normalizado a array ordenado independientemente del orden de inserción
  const setOrderA = new Set(['z', 'a', 'm']);
  const setOrderB = new Set(['m', 'z', 'a']);
  assert.equal(toCanonicalJsonValue(setOrderA), '["a","m","z"]');
  assert.equal(
    toCanonicalJsonValue(setOrderA),
    toCanonicalJsonValue(setOrderB),
    'Dos Sets con los mismos elementos en distinto orden de inserción deben producir el mismo JSON canónico'
  );

  // 9E. ArrayBuffer serializa sus bytes reales (no [])
  const rawBuffer = new Uint8Array([10, 20, 30, 255]).buffer;
  assert.equal(
    toCanonicalJsonValue(rawBuffer),
    '[10,20,30,255]',
    'ArrayBuffer debe serializar sus valores de bytes reales y no un array vacío []'
  );

  // 9F. TypedArray normalizado
  const typedArr = new Float32Array([1.5, 2.5]);
  assert.equal(toCanonicalJsonValue(typedArr), '[1.5,2.5]');

  // 9G. NaN e Infinity normalizados a null
  const nonFinite = { nanVal: NaN, infVal: Infinity, negInfVal: -Infinity };
  assert.equal(toCanonicalJsonValue(nonFinite), '{"infVal":null,"nanVal":null,"negInfVal":null}');
});

test('10. Granular sub-hashes: geometryHash, appearanceHash y propertiesHash diferencian tipos de cambios', () => {
  const asset = createBaseTestAsset();

  const baseGeo = computeGeometryHash(asset);
  const baseApp = computeAppearanceHash(asset);
  const baseProp = computePropertiesHash(asset);

  // Cambio 1: Solo color / apariencia
  const appModified: Forge3DAsset = JSON.parse(JSON.stringify(asset));
  appModified.parts[0].color = [0, 255, 0];
  assert.equal(computeGeometryHash(appModified), baseGeo, 'Cambio de color no debe alterar geometryHash');
  assert.equal(computePropertiesHash(appModified), baseProp, 'Cambio de color no debe alterar propertiesHash');
  assert.notEqual(computeAppearanceHash(appModified), baseApp, 'Cambio de color DEBE alterar appearanceHash');

  // Cambio 2: Solo posición / propiedades físicas
  const propModified: Forge3DAsset = JSON.parse(JSON.stringify(asset));
  propModified.parts[0].position = [10, 20, 30];
  assert.equal(computeGeometryHash(propModified), baseGeo, 'Cambio de posición no debe alterar geometryHash');
  assert.equal(computeAppearanceHash(propModified), baseApp, 'Cambio de posición no debe alterar appearanceHash');
  assert.notEqual(computePropertiesHash(propModified), baseProp, 'Cambio de posición DEBE alterar propertiesHash');

  // Cambio 3: Solo tamaño / geometría
  const geoModified: Forge3DAsset = JSON.parse(JSON.stringify(asset));
  geoModified.parts[0].size = [10, 10, 10];
  assert.notEqual(computeGeometryHash(geoModified), baseGeo, 'Cambio de tamaño DEBE alterar geometryHash');
  assert.equal(computeAppearanceHash(geoModified), baseApp, 'Cambio de tamaño no debe alterar appearanceHash');
  assert.equal(computePropertiesHash(geoModified), baseProp, 'Cambio de tamaño no debe alterar propertiesHash');
});

test('11. computeIncrementalDiff: Detección quirúrgica de piezas añadidas, eliminadas, modificadas, banderas globales y colisiones de ID', () => {
  const asset = createBaseTestAsset();

  // Caso 11A: Eliminar únicamente 1 pieza sin modificar las demás debe activar las banderas globales de cambio
  const onlyRemovedAsset: Forge3DAsset = {
    ...asset,
    parts: [asset.parts[0]], // Se elimina part_torso
  };
  const removeDiff = computeIncrementalDiff(asset, onlyRemovedAsset);
  assert.equal(removeDiff.removed.length, 1);
  assert.equal(removeDiff.removed[0].partId, 'part_torso');
  assert.equal(removeDiff.hasGeometryChanges, true, 'Eliminar una pieza debe activar hasGeometryChanges');
  assert.equal(removeDiff.hasAppearanceChanges, true, 'Eliminar una pieza debe activar hasAppearanceChanges');
  assert.equal(removeDiff.hasPropertiesChanges, true, 'Eliminar una pieza debe activar hasPropertiesChanges');
  assert.equal(removeDiff.hasHierarchyChanges, true, 'Eliminar una pieza debe activar hasHierarchyChanges');

  // Caso 11B: Modificar 1 pieza, eliminar 1 y añadir 1
  const updated: Forge3DAsset = {
    ...asset,
    parts: [
      {
        ...asset.parts[0],
        color: [0, 0, 0], // Modified Head
      },
      // Torso removed
      {
        partId: 'part_arm_new',
        name: 'RightArm',
        shape: 'Block',
        size: [1, 3, 1],
        position: [3, 2, 0],
        rotation: [0, 0, 0],
        color: [255, 200, 150],
        material: 'SmoothPlastic',
        roughness: 0.5,
        metalness: 0,
        transparency: 0,
        canCollide: true,
        anchored: true,
        collisionFidelity: 'Box',
      },
    ],
  };

  const diff = computeIncrementalDiff(asset, updated);

  assert.equal(diff.added.length, 1, 'Debe detectar 1 pieza añadida');
  assert.equal(diff.added[0].partId, 'part_arm_new');

  assert.equal(diff.removed.length, 1, 'Debe detectar 1 pieza eliminada');
  assert.equal(diff.removed[0].partId, 'part_torso');

  assert.equal(diff.modified.length, 1, 'Debe detectar 1 pieza modificada');
  assert.equal(diff.modified[0].partId, 'part_head');
  assert.equal(diff.modified[0].appearanceChanged, true);
  assert.equal(diff.modified[0].geometryChanged, false);

  // Caso 11C: Piezas sin partId con el mismo nombre no se sobrescriben silenciosamente y emiten advertencia
  const noIdAssetA: Forge3DAsset = {
    ...asset,
    parts: [
      { ...asset.parts[0], partId: undefined, name: 'DuplicateBolt', position: [0, 0, 0] },
      { ...asset.parts[1], partId: undefined, name: 'DuplicateBolt', position: [5, 0, 0] },
    ],
  };
  const noIdAssetB: Forge3DAsset = {
    ...asset,
    parts: [
      { ...asset.parts[0], partId: undefined, name: 'DuplicateBolt', position: [0, 0, 0] },
      { ...asset.parts[1], partId: undefined, name: 'DuplicateBolt', position: [10, 0, 0] }, // Segunda pieza movida
    ],
  };
  const noIdDiff = computeIncrementalDiff(noIdAssetA, noIdAssetB);
  assert.equal(noIdDiff.hasMissingPartIds, true, 'Debe señalar que faltan partIds explícitos');
  assert.ok(noIdDiff.warnings.length > 0, 'Debe registrar advertencias por piezas sin partId');
  assert.equal(noIdDiff.unchanged.length, 1, 'La primera pieza homónima sin cambios no debe perderse');
  assert.equal(noIdDiff.modified.length, 1, 'La segunda pieza homónima modificada debe detectarse individualmente');

  // Caso 11D: IDs explícitos duplicados deben lanzar un error claro en vez de sobrescribir en el Map
  const dupExplicitIdAsset: Forge3DAsset = {
    ...asset,
    parts: [
      { ...asset.parts[0], partId: 'same_explicit_id' },
      { ...asset.parts[1], partId: 'same_explicit_id' },
    ],
  };
  assert.throws(
    () => computeIncrementalDiff(asset, dupExplicitIdAsset),
    /Colisión de identidad/
  );
});
