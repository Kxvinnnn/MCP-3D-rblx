/**
 * Barrel module re-exporting all modularized 3D engine capabilities from `src/utils/3d/*`.
 * Preserves 100% backward compatibility for all consumers and tests while keeping
 * each sub-domain isolated and maintainable.
 */

export * from './3d/types.ts';
export * from './3d/pbrTextures.ts';
export * from './3d/meshGeometry.ts';
export * from './3d/luauExporter.ts';
export * from './3d/formatExporters.ts';
export * from './3d/syncAndHeal.ts';
export * from './3d/assetHelpers.ts';
