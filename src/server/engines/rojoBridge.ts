/**
 * @module rojoBridge
 * @description
 * Engine 6/7 — Rojo 7.x Bridge, Path Sandboxing & SHA-256 Sync Auditor (TypeScript Server Module).
 *
 * RESPONSIBILITIES:
 * 1. Enforce strict path traversal protection (`resolveSafeRojoPath`) so no file can ever
 *    be written outside `ROJO_PROJECT_PATH`.
 * 2. Enforce allowed file extensions (`.luau`, `.obj`, `.mtl`, `.gltf`, `.rbxmx`, `.png`, `.json`).
 * 3. Sanitize Luau code (`sanitizeStrictLuauCode`) against forbidden patterns (`loadstring`, `getfenv`, `setfenv`).
 */

import path from 'path';
import fs from 'fs';

export const ALLOWED_ROJO_EXTENSIONS = new Set([
  '.luau',
  '.lua',
  '.json',
  '.md',
  '.txt',
  '.obj',
  '.mtl',
  '.gltf',
  '.rbxmx',
  '.png',
]);

export const FORBIDDEN_LUAU_PATTERNS = [
  /\bloadstring\s*\(/i,
  /\bgetfenv\s*\(/i,
  /\bsetfenv\s*\(/i,
];

export function resolveSafeRojoPath(
  runtimeRojoPath: string,
  rojoTargetFolder: string,
  fileName: string
): string {
  const rojoRoot = path.resolve(runtimeRojoPath);
  fs.mkdirSync(rojoRoot, { recursive: true });

  const cleanFolder = (rojoTargetFolder || 'src/shared').replace(/^[/\\]+/, '');
  if (
    cleanFolder.includes('..') ||
    (fileName || '').includes('..') ||
    (fileName || '').includes('\0')
  ) {
    throw new Error("Violación de Seguridad: Se detectó intento de Path Traversal ('..').");
  }

  const cleanFileName = path.basename(fileName || 'Generated.luau');
  const ext = path.extname(cleanFileName).toLowerCase();
  if (!ALLOWED_ROJO_EXTENSIONS.has(ext)) {
    throw new Error(`Violación de Seguridad: Extensión de archivo '${ext}' no permitida.`);
  }

  const targetDir = path.resolve(rojoRoot, cleanFolder);
  if (!targetDir.startsWith(rojoRoot)) {
    throw new Error('Violación de Seguridad: La carpeta destino escapa del proyecto Rojo.');
  }
  fs.mkdirSync(targetDir, { recursive: true });

  const targetFile = path.resolve(targetDir, cleanFileName);
  if (!targetFile.startsWith(rojoRoot)) {
    throw new Error('Violación de Seguridad: El archivo destino escapa del proyecto Rojo.');
  }

  return targetFile;
}

export function sanitizeStrictLuauCode(code: string): string {
  let cleaned = (code || '').trim();
  if (!cleaned.startsWith('--!strict')) {
    cleaned = `--!strict\n${cleaned}`;
  }
  for (const regex of FORBIDDEN_LUAU_PATTERNS) {
    if (regex.test(cleaned)) {
      throw new Error(`Violación de Seguridad: Patrón Luau prohibido detectado (${regex.source}).`);
    }
  }
  return `${cleaned}\n`;
}
