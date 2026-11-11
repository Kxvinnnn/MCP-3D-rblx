/**
 * @module uiEngine
 * @description
 * Engine 4/7 — ForgeGUI Responsive UI & 3D ViewportFrame Engine (TypeScript Server Module).
 *
 * RESPONSIBILITIES:
 * 1. Build domain-pruned system instructions for responsive `ScreenGui` generation
 *    (`UDim2.fromScale` + `AnchorPoint = Vector2.new(0.5, 0.5)` + `TweenService`).
 * 2. Validate and normalize hierarchical `ui_tree` nodes for the live interactive canvas preview.
 */

export function buildForgeGuiSystemInstruction(prunedContext: string): string {
  return [
    'Eres un Especialista Senior en Interfaces Roblox (ForgeGUI Engine).',
    'REGLAS OBLIGATORIAS:',
    '1. El código Luau debe iniciar con `--!strict` y guardarse en `src/client/UI`.',
    '2. Todos los contenedores principales deben usar `UDim2.fromScale` y `AnchorPoint = Vector2.new(0.5, 0.5)`.',
    '3. Incluye transiciones con `TweenService` y limpieza de eventos `MouseEnter`/`MouseLeave` con `Maid`.',
    '4. Genera simultáneamente el árbol JSON `ui_tree` para previsualización interactiva.',
    '',
    prunedContext,
  ].join('\n');
}

export function validateScaleOnlyUiTree(node: Record<string, any> | null | undefined): boolean {
  if (!node || typeof node !== 'object') return false;
  return typeof node.name === 'string' && typeof node.class_name === 'string';
}
