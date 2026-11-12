import { Forge3DAsset, MeshPart3DSpec } from './roblox3DEngine.ts';

/**
 * Pure TypeScript SHA-256 implementation (NIST FIPS 180-4).
 * Uses TextEncoder to encode strings into UTF-8 byte arrays first,
 * guaranteeing correct handling of multi-byte characters (Unicode, accents, emojis),
 * surrogate pairs, and exact bit length calculation.
 * Returns a 64-character hexadecimal string.
 */
export function sha256Hex(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  const bitLength = bytes.length * 8;

  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }

  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;

  const isPrime = (n: number) => {
    for (let factor = 2; factor * factor <= n; factor++) {
      if (n % factor === 0) return false;
    }
    return true;
  };

  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (isPrime(candidate)) {
      if (primeCounter < 8) {
        hash[primeCounter] = (Math.pow(candidate, 1 / 2) * 4294967296) | 0;
      }
      k[primeCounter] = (Math.pow(candidate, 1 / 3) * 4294967296) | 0;
      primeCounter++;
    }
  }

  // Calculate required number of 32-bit words (64-byte / 16-word blocks)
  const numWords = Math.ceil((bytes.length + 9) / 64) * 16;
  const words = new Int32Array(numWords);

  // Pack UTF-8 bytes into 32-bit big-endian words
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] |= bytes[i] << ((3 - (i % 4)) * 8);
  }

  // Append 0x80 bit (10000000 in binary)
  words[bytes.length >> 2] |= 0x80 << ((3 - (bytes.length % 4)) * 8);

  // Append 64-bit big-endian length in bits at the end of the block
  words[numWords - 2] = Math.floor(bitLength / 4294967296) | 0; // Upper 32 bits
  words[numWords - 1] = (bitLength & 0xffffffff) | 0;          // Lower 32 bits

  for (let j = 0; j < words.length; j += 16) {
    const w = new Int32Array(64);
    for (let i = 0; i < 16; i++) {
      w[i] = words[j + i];
    }

    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = hash[0], b = hash[1], c = hash[2], d = hash[3];
    let e = hash[4], f = hash[5], g = hash[6], h = hash[7];

    for (let i = 0; i < 64; i++) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[i] + w[i]) | 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }

  let result = '';
  for (let i = 0; i < 8; i++) {
    for (let shift = 24; shift >= 0; shift -= 8) {
      const byteVal = (hash[i] >> shift) & 0xff;
      result += byteVal.toString(16).padStart(2, '0');
    }
  }

  return result;
}

/**
 * Keys explicitly EXCLUDED from canonical content hashing ONLY at the ROOT asset level:
 * - created_at, updated_at: Server response timestamps
 * - version, version_history: Version counters / versioning metadata
 * - exported_package_files, verified_package_files: Download URLs
 * - saved_path, obj_saved_path: Local filesystem paths
 * - Any internal key starting with '_'
 */
const ROOT_EXCLUDED_CANONICAL_KEYS = new Set([
  'created_at',
  'updated_at',
  'version',
  'version_history',
  'exported_package_files',
  'verified_package_files',
  'saved_path',
  'obj_saved_path',
]);

/**
 * Strict UTF-16 code-unit / ordinal string comparator (locale-independent).
 */
export function strictOrdinalCompare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Computes a stable persistent key for an asset to differentiate models with identical names.
 */
export function getAssetIdentityKey(asset: Forge3DAsset | null | undefined): string {
  if (!asset) return '';
  if (asset.id && typeof asset.id === 'string' && asset.id.trim()) return asset.id;
  if ((asset as any).asset_id && typeof (asset as any).asset_id === 'string') return (asset as any).asset_id;
  const targetFolder = asset.rojo_target_folder || '';
  const fileName = asset.file_name || '';
  return `asset_${asset.name}_${targetFolder}_${fileName}`;
}

/**
 * Recursively converts a JavaScript value into a canonical, deterministic JSON string.
 * Policy:
 * - Rejects circular references (including inside Map, Set, Array, and plain objects).
 * - Rejects BigInt, Function, Symbol, Invalid Date, RegExp, Error, WeakMap, WeakSet, and custom class instances.
 * - Normalizes Set by sorting canonical element representations so insertion order does not alter the hash.
 * - Normalizes Map preserving key types when non-string keys exist so 1 and "1" never collide.
 * - Normalizes ArrayBuffer via Uint8Array byte representation.
 */
export function toCanonicalJsonValue(
  val: any,
  isRootPartsArray = false,
  isRootObject = false,
  seen: WeakSet<object> = new WeakSet()
): string {
  if (val === null || val === undefined) {
    return 'null';
  }

  const valType = typeof val;

  if (valType === 'bigint') {
    throw new TypeError('BigInt values cannot be serialized in canonical asset hash');
  }

  if (valType === 'function') {
    throw new TypeError('Function values cannot be serialized in canonical asset hash');
  }

  if (valType === 'symbol') {
    throw new TypeError('Symbol values cannot be serialized in canonical asset hash');
  }

  if (valType === 'number') {
    if (!Number.isFinite(val)) {
      return 'null'; // Normalize NaN, Infinity, -Infinity to null
    }
    // Normalize -0 to 0
    return JSON.stringify(Object.is(val, -0) ? 0 : val);
  }

  if (valType === 'boolean') {
    return val ? 'true' : 'false';
  }

  if (valType === 'string') {
    return JSON.stringify(val);
  }

  if (valType === 'object') {
    if (seen.has(val)) {
      throw new TypeError('Circular reference detected in asset structure during canonical serialization');
    }
    seen.add(val);

    try {
      if (val instanceof Date) {
        if (Number.isNaN(val.getTime())) {
          throw new TypeError('Invalid Date cannot be serialized in canonical asset hash');
        }
        return JSON.stringify(val.toISOString());
      }

      if (val instanceof RegExp || val instanceof Error || val instanceof WeakMap || val instanceof WeakSet) {
        throw new TypeError(`Unsupported object type (${val.constructor?.name || 'Object'}) in canonical asset hash`);
      }

      if (val instanceof Map) {
        const entries = Array.from(val.entries());
        const allStringKeys = entries.every(([k]) => typeof k === 'string');
        if (allStringKeys) {
          const sortedEntries = entries
            .map(([k, v]) => [k as string, toCanonicalJsonValue(v, false, false, seen)] as const)
            .sort((a, b) => strictOrdinalCompare(a[0], b[0]));
          return (
            '{' +
            sortedEntries.map(([k, cv]) => JSON.stringify(k) + ':' + cv).join(',') +
            '}'
          );
        } else {
          // Non-string keys present: preserve exact key type so 1 and "1" never collide
          const canonicalPairs = entries
            .map(([k, v]) => [
              toCanonicalJsonValue(k, false, false, seen),
              toCanonicalJsonValue(v, false, false, seen),
            ] as const)
            .sort((a, b) => {
              const cmp = strictOrdinalCompare(a[0], b[0]);
              return cmp !== 0 ? cmp : strictOrdinalCompare(a[1], b[1]);
            });
          return (
            '[' +
            canonicalPairs.map(([ck, cv]) => `[${ck},${cv}]`).join(',') +
            ']'
          );
        }
      }

      if (val instanceof Set) {
        // Canonicalize each element and sort deterministically so Set insertion order never changes the hash
        const canonicalElements = Array.from(val)
          .map((item) => toCanonicalJsonValue(item, false, false, seen))
          .sort(strictOrdinalCompare);
        return '[' + canonicalElements.join(',') + ']';
      }

      if (val instanceof ArrayBuffer) {
        const byteArr = Array.from(new Uint8Array(val));
        return '[' + byteArr.map((b) => String(b)).join(',') + ']';
      }

      if (ArrayBuffer.isView(val)) {
        if (val instanceof DataView) {
          const byteArr = Array.from(new Uint8Array(val.buffer, val.byteOffset, val.byteLength));
          return '[' + byteArr.map((b) => String(b)).join(',') + ']';
        }
        const arr = Array.from(val as any);
        return '[' + arr.map((item) => toCanonicalJsonValue(item, false, false, seen)).join(',') + ']';
      }

      if (Array.isArray(val)) {
        let items = val;
        if (isRootPartsArray) {
          items = [...val].sort((a, b) => {
            const keyA = `${a?.partId || ''}\0${a?.hierarchyPath || ''}\0${a?.name || ''}`;
            const keyB = `${b?.partId || ''}\0${b?.hierarchyPath || ''}\0${b?.name || ''}`;
            const comp = strictOrdinalCompare(keyA, keyB);
            if (comp !== 0) return comp;
            const canonA = toCanonicalJsonValue(a, false, false, seen);
            const canonB = toCanonicalJsonValue(b, false, false, seen);
            return strictOrdinalCompare(canonA, canonB);
          });
        }
        return '[' + items.map((item) => toCanonicalJsonValue(item, false, false, seen)).join(',') + ']';
      }

      // Ensure object is a plain object (Object.prototype or null prototype)
      const proto = Object.getPrototypeOf(val);
      if (proto !== null && proto !== Object.prototype) {
        throw new TypeError(`Unsupported custom class instance (${proto.constructor?.name || 'Unknown'}) in canonical asset hash`);
      }

      const sortedKeys = Object.keys(val)
        .filter((k) => {
          if (k.startsWith('_')) return false;
          if (isRootObject && ROOT_EXCLUDED_CANONICAL_KEYS.has(k)) return false;
          return true;
        })
        .sort(strictOrdinalCompare);

      const pairs = sortedKeys.map((k) => {
        const isPartsKey = isRootObject && k === 'parts' && Array.isArray(val[k]);
        return JSON.stringify(k) + ':' + toCanonicalJsonValue(val[k], isPartsKey, false, seen);
      });

      return '{' + pairs.join(',') + '}';
    } finally {
      seen.delete(val);
    }
  }

  throw new TypeError(`Unsupported value type (${valType}) in canonical asset hash`);
}

/**
 * Computes a 64-character SHA-256 cryptographic digest of the canonical JSON representation
 * of the 3D asset model.
 */
export function computeCanonicalAssetHash(asset: Forge3DAsset | null): string {
  if (!asset) return '';
  const canonicalJson = toCanonicalJsonValue(asset, false, true);
  return sha256Hex(canonicalJson);
}

/**
 * Computes a granular hash of ONLY the 3D geometry and topology of an asset.
 */
export function computeGeometryHash(asset: Forge3DAsset | null): string {
  if (!asset) return '';
  const geoSpec = (asset.parts || []).map((p) => ({
    partId: p.partId,
    shape: p.shape,
    size: p.size,
    meshData: p.meshData,
    baseMeshData: p.baseMeshData,
  }));
  return sha256Hex(toCanonicalJsonValue(geoSpec, true, false));
}

/**
 * Computes a granular hash of ONLY materials, colors, textures and PBR profiles.
 */
export function computeAppearanceHash(asset: Forge3DAsset | null): string {
  if (!asset) return '';
  const appSpec = {
    pbr_profile: asset.pbr_profile,
    parts: (asset.parts || []).map((p) => ({
      partId: p.partId,
      color: p.color,
      material: p.material,
      roughness: p.roughness,
      metalness: p.metalness,
      transparency: p.transparency,
      doubleSided: p.doubleSided,
      pbrMaterial: p.pbrMaterial,
    })),
  };
  return sha256Hex(toCanonicalJsonValue(appSpec, false, true));
}

/**
 * Computes a granular hash of ONLY physical properties and 3D space transforms.
 */
export function computePropertiesHash(asset: Forge3DAsset | null): string {
  if (!asset) return '';
  const propSpec = (asset.parts || []).map((p) => ({
    partId: p.partId,
    position: p.position,
    rotation: p.rotation,
    rotationMatrix: p.rotationMatrix,
    anchored: p.anchored,
    canCollide: p.canCollide,
    collisionFidelity: p.collisionFidelity,
    renderFidelity: p.renderFidelity,
    castShadow: p.castShadow,
  }));
  return sha256Hex(toCanonicalJsonValue(propSpec, true, false));
}
