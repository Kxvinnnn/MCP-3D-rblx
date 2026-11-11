/**
 * @module worldAndModelEditorEngine
 * @description
 * Unified Barrel Re-Export Module for the Modular Forge AI Server Engines.
 *
 * All implementation has been cleanly modularized into single-responsibility files:
 * - `./generation3DEngine.ts` — 3D Geometry buffers, `.OBJ` parser, >9k splitter, and `--!strict` `EditableMesh` Luau builder.
 * - `./assetEngine.ts`        — `.RBXMX` XML serializer & bidirectional parser, glTF 2.0 binary exporter, `.OBJ`/`.MTL` exporter, and 4-channel PBR Luau binder.
 * - `./worldEngine.ts`        — Biome lighting presets and spatial `Workspace` scene generator.
 * - `./luauEngine.ts`         — Luau script routing (`src/server`, `src/client`, `src/shared`) and `--!strict` rules.
 * - `./uiEngine.ts`           — Responsive `ForgeGUI` (`UDim2.fromScale`) instructions and validators.
 * - `./rojoBridge.ts`         — Path sandboxing (`resolveSafeRojoPath`) and Luau security sanitizer.
 * - `./agentsEngine.ts`       — P3 7-Agent autonomous orchestrator helpers.
 * - `./contextPrunerEngine.ts`— Domain-scoped AI context pruner (~65% less prompt token overhead).
 */

export * from './generation3DEngine.ts';
export * from './assetEngine.ts';
export * from './worldEngine.ts';
export * from './luauEngine.ts';
export * from './uiEngine.ts';
export * from './rojoBridge.ts';
export * from './agentsEngine.ts';
export * from './contextPrunerEngine.ts';
