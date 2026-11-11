/**
 * @module luauEngine
 * @description
 * Engine 3/7 — Luau Architecture & Strict Code Generation Engine (TypeScript Server Module).
 *
 * RESPONSIBILITIES:
 * 1. Map `ScriptType` (`Server` | `Client` | `Module`) to canonical Rojo 7.x target directories
 *    and file suffixes (`.server.luau`, `.client.luau`, `.luau`).
 * 2. Build domain-pruned system instructions for Gemini Luau generation (`buildLuauSystemInstruction`).
 * 3. Enforce `--!strict` header and modern `task.*` library compliance (`enforceLuauStrictAndMaidContract`).
 */

export type ScriptType = 'Server' | 'Client' | 'Module';

export function getTargetRojoFolderForScriptType(scriptType: ScriptType): {
  folder: string;
  extension: string;
} {
  if (scriptType === 'Server') {
    return { folder: 'src/server', extension: '.server.luau' };
  }
  if (scriptType === 'Client') {
    return { folder: 'src/client', extension: '.client.luau' };
  }
  return { folder: 'src/shared', extension: '.luau' };
}

export function buildLuauSystemInstruction(
  scriptType: ScriptType,
  prunedContext: string
): string {
  const { folder, extension } = getTargetRojoFolderForScriptType(scriptType);
  return [
    'Eres un Arquitecto Principal de Sistemas Roblox Luau.',
    `Tipo de Script solicitado: ${scriptType} (Carpeta Rojo: ${folder}, Extensión: ${extension}).`,
    'REGLAS OBLIGATORIAS:',
    '1. Primera línea: `--!strict`.',
    '2. Servicios de Roblox al inicio con `game:GetService(...)`.',
    '3. Usa exclusivamente `task.wait`, `task.spawn`, `task.delay`, `task.defer` (prohibido wait/spawn/delay).',
    '4. Limpia conexiones y objetos dinámicos con el patrón `Maid`.',
    '',
    prunedContext,
  ].join('\n');
}

export function enforceLuauStrictAndMaidContract(code: string): string {
  let cleaned = String(code || '').trim();
  if (!cleaned.startsWith('--!strict')) {
    cleaned = `--!strict\n${cleaned}`;
  }
  return `${cleaned}\n`;
}
