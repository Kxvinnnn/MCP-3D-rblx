# Hoja de Ruta Técnica (Roadmap) — NIGHTMARE FORGE

Esta hoja de ruta prioriza evoluciones de arquitectura con impacto directo en calidad visual 3D, interoperabilidad con Roblox Studio y automatización verificable.

---

## Horizonte 1 — Corto Plazo (Estabilización y Paridad Total TS ↔ Python ↔ Studio)

1. **Paridad de Motor Universal en Python (`backend/engines/`)**
   - Llevar el planificador semántico de 5 etapas y el cálculo `depthProfile16` a `backend/engines/generation_3d_engine.py` para evitar divergencia cuando se ejecute únicamente el upstream FastAPI.
2. **Validación E2E Automática con Navegador (`Playwright` / UI)**
   - Incorporar pruebas de humo sobre `CreateWizardView.tsx`, `EditView.tsx` y `InteractiveColorWheel.tsx` verificando renderizado WebGL, carga de las 5 vistas SVG (`front`, `side`, `back`, `top`, `isometric`) e inspección de `parameter_provenance`.
3. **Contratos de Exportación Verificados en CI**
   - Validar estructuralmente los bytes generados de `.glb`, `.obj`, `.rbxmx` y scripts `--!strict` con analizadores sintácticos en cada pull request.

---

## Horizonte 2 — Mediano Plazo (Calidad Geométrica, UV y Workers GPU Externos)

1. **Despliegue de Worker GPU Externo (TRELLIS / Hunyuan3D-2 / TripoSR)**
   - Publicar un microservicio Docker GPU complementario compatible con el contrato HTTP de `src/server/engines/external3DModelAdapter.ts` (`FORGE_EXTERNAL_3D_ENDPOINT`), incluyendo segmentación automática por partes y reducción de polígonos al tope `EditableMesh` (`<= 9,000` tris/parte).
2. **Decimación QEM Preservando Costuras UV y Topología**
   - Implementar simplificación Quadric Error Metrics en `src/utils/3d/meshGeometry.ts` para adaptar modelos densos importados o neurales a múltiples niveles LOD (`LOD0`, `LOD1`, `LOD2`) de Roblox sin triángulos degenerados.
3. **Generación de Atlas PBR Coherentes y Bake de Oclusión Ambiental**
   - Mejorar `src/utils/3d/pbrTextures.ts` con mapas de curvatura/cavidad procedurales exportables junto a `SurfaceAppearance`.

---

## Horizonte 3 — Largo Plazo (Rigging Automático, Escenas Completas y E2E en Studio)

1. **Auto-Rigging con `Motor6D` / `Bone` y Exportación glTF con Skinning**
   - Aprovechar las etiquetas semánticas del plan universal (`Leg_FrontLeft`, `WingFeather`, `Spine`, `Jaw`) para emitir jerarquías articulables listas para animación en Roblox Studio y Blender.
2. **Composición de Escenas Multi-Asset (`Scene3D`) con Terreno y Colisiones**
   - Extender el planificador de escenas para distribuir múltiples modelos (`vegetation`, `architecture`, `props`) respetando pendientes del terreno, exclusión de colisiones AABB y presupuestos agregados de red/instancing.
3. **Arnés de Validación Automatizada con Roblox Studio Open Cloud + CLI Plugin**
   - Automatizar publicación en lugares de prueba mediante Roblox Open Cloud Assets API y verificación de mallas `EditableMesh` en runtime de Studio.
