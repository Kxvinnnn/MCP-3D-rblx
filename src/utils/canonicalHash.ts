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
 * Strict ordinal code-point string comparator (locale-independent).
 */
export function strictOrdinalCompare(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Recursively converts a JavaScript value into a canonical, deterministic JSON string.
 * Rules:
 * - Object keys are sorted using strict ordinal comparison.
 * - Root-level volatile keys (created_at, updated_at, saved_path, etc.) are excluded ONLY at the root object level.
 * - Internal keys starting with '_' are excluded at all levels.
 * - Non-finite numbers (NaN, Infinity, -Infinity) are normalized to null.
 * - Undefined values in object properties are normalized to null.
 * - Root 'parts' array is sorted deterministically using ordinal primary keys and canonical tie-breaking.
 */
export function toCanonicalJsonValue(
  val: any,
  isRootPartsArray = false,
  isRootObject = false
): string {
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
      // Sort parts array deterministically using ordinal key comparison and canonical tie-breaking
      items = [...val].sort((a, b) => {
        const keyA = `${a?.partId || ''}\0${a?.hierarchyPath || ''}\0${a?.name || ''}`;
        const keyB = `${b?.partId || ''}\0${b?.hierarchyPath || ''}\0${b?.name || ''}`;
        const comp = strictOrdinalCompare(keyA, keyB);
        if (comp !== 0) return comp;
        // Deterministic tie-break using full canonical representation of the part
        const canonA = toCanonicalJsonValue(a, false, false);
        const canonB = toCanonicalJsonValue(b, false, false);
        return strictOrdinalCompare(canonA, canonB);
      });
    }
    return '[' + items.map((item) => toCanonicalJsonValue(item, false, false)).join(',') + ']';
  }

  if (typeof val === 'object') {
    const sortedKeys = Object.keys(val)
      .filter((k) => {
        if (k.startsWith('_')) return false;
        if (isRootObject && ROOT_EXCLUDED_CANONICAL_KEYS.has(k)) return false;
        return true;
      })
      .sort(strictOrdinalCompare);

    const pairs = sortedKeys.map((k) => {
      const isPartsKey = isRootObject && k === 'parts' && Array.isArray(val[k]);
      return JSON.stringify(k) + ':' + toCanonicalJsonValue(val[k], isPartsKey, false);
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
  const canonicalJson = toCanonicalJsonValue(asset, false, true);
  return sha256Hex(canonicalJson);
}
