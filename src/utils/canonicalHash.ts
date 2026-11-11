import { Forge3DAsset, MeshPart3DSpec, SubMeshGeometryData, PartPBRMaterialSpec, PBRProfileSpec } from './roblox3DEngine.ts';

/**
 * Pure TypeScript SHA-256 implementation (NIST FIPS 180-4).
 * Works identically in Node.js, Web Browsers, Web Workers, and Edge runtimes.
 * Returns a 64-character hexadecimal string.
 */
export function sha256Hex(ascii: string): string {
  function rightRotate(value: number, amount: number): number {
    return (value >>> amount) | (value << (32 - amount));
  }

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i: number, j: number;
  let result = '';

  const words: number[] = [];
  const asciiBitLength = ascii[lengthProperty] * 8;

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
        hash[primeCounter] = (mathPow(candidate, 1 / 2) * maxWord) | 0;
      }
      k[primeCounter] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      primeCounter++;
    }
  }

  let utf8String = '';
  for (let i = 0; i < ascii.length; i++) {
    const charcode = ascii.charCodeAt(i);
    if (charcode < 0x80) utf8String += String.fromCharCode(charcode);
    else if (charcode < 0x800) {
      utf8String += String.fromCharCode(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8String += String.fromCharCode(
        0xe0 | (charcode >> 12),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    } else {
      i++;
      const code = 0x10000 + (((charcode & 0x33f) << 10) | (ascii.charCodeAt(i) & 0x33f));
      utf8String += String.fromCharCode(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }

  for (i = 0; i < utf8String[lengthProperty]; i++) {
    words[i >> 2] |= utf8String.charCodeAt(i) << ((3 - (i % 4)) * 8);
  }

  words[utf8String[lengthProperty] >> 2] |= 0x80 << ((3 - (utf8String[lengthProperty] % 4)) * 8);
  words[(((utf8String[lengthProperty] + 8) >> 6) << 4) + 15] = asciiBitLength;

  for (j = 0; j < words[lengthProperty]; j += 16) {
    const w = words.slice(j, j + 16);
    const oldHash = [...hash];

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];

      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] =
        i < 16
          ? w[i]
          : (w[i - 16] + s0 + w[i - 7] + s1) | 0;

      const a = hash[0], e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        w[i];
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash[7] = hash[6];
      hash[6] = hash[5];
      hash[5] = hash[4];
      hash[4] = (hash[3] + temp1) | 0;
      hash[3] = hash[2];
      hash[2] = hash[1];
      hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j >= 0; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }

  return result;
}

/**
 * Keys explicitly EXCLUDED from canonical content hashing:
 * - created_at, updated_at: Server response timestamps
 * - version, version_history: Version counters / versioning metadata
 * - exported_package_files, verified_package_files: Download URLs
 * - saved_path, obj_saved_path: Local filesystem paths
 * - Any internal key starting with '_'
 */
const EXCLUDED_CANONICAL_KEYS = new Set([
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
 * Recursively converts a JavaScript value into a canonical, deterministic JSON string.
 * Rules:
 * - Keys in objects are sorted alphabetically.
 * - Non-finite numbers (NaN, Infinity, -Infinity) are normalized to null.
 * - Undefined values in object properties are normalized to null.
 * - Arrays preserve element order (except parts array which is sorted by partId/name).
 */
export function toCanonicalJsonValue(val: any, isRootPartsArray = false): string {
  if (val === null || val === undefined) {
    return 'null';
  }

  if (typeof val === 'number') {
    if (!Number.isFinite(val)) {
      return 'null';
    }
    return JSON.stringify(val);
  }

  if (typeof val === 'boolean') {
    return val ? 'true' : 'false';
  }

  if (typeof val === 'string') {
    return JSON.stringify(val);
  }

  if (Array.isArray(val)) {
    let items = val;
    if (isRootPartsArray) {
      // Sort parts array deterministically by partId -> hierarchyPath -> name
      items = [...val].sort((a, b) => {
        const idA = String(a?.partId || a?.hierarchyPath || a?.name || '');
        const idB = String(b?.partId || b?.hierarchyPath || b?.name || '');
        return idA.localeCompare(idB);
      });
    }
    return '[' + items.map((item) => toCanonicalJsonValue(item, false)).join(',') + ']';
  }

  if (typeof val === 'object') {
    const sortedKeys = Object.keys(val)
      .filter((k) => !k.startsWith('_') && !EXCLUDED_CANONICAL_KEYS.has(k))
      .sort();

    const pairs = sortedKeys.map((k) => {
      const isPartsKey = k === 'parts' && Array.isArray(val[k]);
      return JSON.stringify(k) + ':' + toCanonicalJsonValue(val[k], isPartsKey);
    });

    return '{' + pairs.join(',') + '}';
  }

  return 'null';
}

/**
 * Computes a 64-character SHA-256 cryptographic digest of the canonical JSON representation
 * of the 3D asset model.
 */
export function computeCanonicalAssetHash(asset: Forge3DAsset | null): string {
  if (!asset) return '';
  const canonicalJson = toCanonicalJsonValue(asset);
  return sha256Hex(canonicalJson);
}
