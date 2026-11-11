/**
 * @module security
 * @description
 * Fase 4 — Seguridad Local, Sandboxing de Rutas Relativas y Sanitización de Código.
 *
 * Reglas innegociables implementadas:
 * 1. La ruta absoluta del proyecto Rojo solo existe localmente en Windows; nunca se expone al exterior.
 * 2. Toda ruta solicitada debe ser relativa a la raíz del proyecto Rojo configurado.
 * 3. Bloqueo estricto de Path Traversal (`..`), bytes nulos (`\0`), rutas absolutas o unidades de disco (`C:\`, `\\`).
 * 4. Validación de extensiones de archivo contra una lista blanca cerrada.
 * 5. Límite estricto de tamaño de archivo (por defecto 15 MB).
 * 6. Sanitización de archivos `.luau` (encabezado `--!strict` y prohibición de `loadstring`, `getfenv`, `setfenv`).
 */

import path from 'path';
import crypto from 'crypto';

export const ALLOWED_FILE_EXTENSIONS = new Set([
  '.luau',
  '.lua',
  '.json',
  '.obj',
  '.mtl',
  '.gltf',
  '.glb',
  '.rbxmx',
  '.md',
  '.png',
  '.txt',
]);

export const ALLOWED_ROJO_PREFIXES = [
  'src/',
  'default.project.json',
  'assets_library.json',
  'project_context.md',
  'README.md',
];

export const FORBIDDEN_LUAU_PATTERNS = [
  /\bloadstring\s*\(/i,
  /\bgetfenv\s*\(/i,
  /\bsetfenv\s*\(/i,
];

export interface ResolvedSafePath {
  absolutePath: string;
  relativePath: string;
  extension: string;
}

/**
 * Resuelve y valida una ruta relativa dentro de la raíz del proyecto Rojo local.
 * Rechaza cualquier intento de Path Traversal, rutas absolutas de Windows/POSIX o extensiones no autorizadas.
 */
export function resolveAndValidateRelativePath(
  projectRootAbs: string,
  requestedRelativePath: string
): ResolvedSafePath {
  if (!requestedRelativePath || typeof requestedRelativePath !== 'string') {
    throw new Error('Seguridad: Se requiere una ruta relativa válida.');
  }

  const raw = requestedRelativePath.trim();
  if (!raw || raw.includes('\0')) {
    throw new Error('Seguridad: Ruta inválida o con caracteres nulos.');
  }

  // Bloquear rutas absolutas de Windows (C:\, D:/, \\server) o POSIX (/etc/...)
  if (/^[a-zA-Z]:[/\\]/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('/')) {
    throw new Error(
      'Seguridad: No se permiten rutas absolutas en peticiones remotas. Utiliza únicamente rutas relativas al proyecto Rojo.'
    );
  }

  const normalizedPosix = raw.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  const segments = normalizedPosix.split('/');
  if (segments.some((seg) => seg === '..' || seg === '.')) {
    throw new Error("Seguridad: Intento de Path Traversal ('..') bloqueado.");
  }

  const isAllowedLocation = ALLOWED_ROJO_PREFIXES.some(
    (prefix) => normalizedPosix === prefix || normalizedPosix.startsWith(prefix)
  );
  if (!isAllowedLocation) {
    throw new Error(
      `Seguridad: La ruta relativa '${normalizedPosix}' fuera del árbol permitido de Rojo ('src/' o 'default.project.json') fue bloqueada.`
    );
  }

  const ext = path.extname(normalizedPosix).toLowerCase();
  if (!ALLOWED_FILE_EXTENSIONS.has(ext)) {
    throw new Error(`Seguridad: La extensión '${ext}' no está permitida.`);
  }

  const rootResolved = path.resolve(projectRootAbs);
  const targetResolved = path.resolve(rootResolved, normalizedPosix);

  const relativeFromRoot = path.relative(rootResolved, targetResolved);
  if (
    relativeFromRoot.startsWith('..') ||
    path.isAbsolute(relativeFromRoot) ||
    !targetResolved.startsWith(rootResolved)
  ) {
    throw new Error('Seguridad: La ruta resuelta escapa de la raíz del proyecto Rojo.');
  }

  return {
    absolutePath: targetResolved,
    relativePath: relativeFromRoot.replace(/\\/g, '/'),
    extension: ext,
  };
}

/**
 * Valida el tamaño de un contenido antes de escribir en disco.
 */
export function enforceFileSizeLimit(content: Buffer | string, maxBytes: number): number {
  const byteLength =
    typeof content === 'string' ? Buffer.byteLength(content, 'utf-8') : content.byteLength;
  if (byteLength > maxBytes) {
    throw new Error(
      `Seguridad: El archivo (${byteLength} bytes) excede el límite máximo permitido (${maxBytes} bytes).`
    );
  }
  return byteLength;
}

/**
 * Sanitiza y valida código Luau antes de guardarlo en Rojo.
 */
export function validateAndSanitizeLuauContent(code: string): string {
  let cleaned = String(code ?? '').trim();
  if (!cleaned.startsWith('--!strict')) {
    cleaned = `--!strict\n${cleaned}`;
  }
  for (const pattern of FORBIDDEN_LUAU_PATTERNS) {
    if (pattern.test(cleaned)) {
      throw new Error(
        `Seguridad: Se detectó una primitiva Luau prohibida (${pattern.source}).`
      );
    }
  }
  return `${cleaned}\n`;
}

/**
 * Calcula el hash FNV-1a 32-bit idéntico al del plugin de Roblox Studio y el backend de Forge.
 */
export function computeFnv1a32Hex(text: string): string {
  const normalized = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function computeSha256Short(content: Buffer | string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

/**
 * Comparación en tiempo constante para tokens de autenticación.
 */
export function verifyTokenConstantTime(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(String(provided || ''), 'utf-8');
  const b = Buffer.from(String(expected), 'utf-8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
