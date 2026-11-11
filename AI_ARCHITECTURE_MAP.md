# AI Architecture Map & Self-Understanding Index (`AI_ARCHITECTURE_MAP.md`)

> **Propósito para IA**: Lee este archivo primero. Resume en una sola página toda la arquitectura modular, contratos de archivos, rutas REST/SSE e invariantes técnicos de **Forge AI Studio v2.2** para que no necesites cargar archivos completos en contexto.

---

## 1. Mapa de Módulos de Dominio (Paridad 1:1 Python ↔ TypeScript)

| Dominio | Motor | Módulo TypeScript (`src/server/engines/`) | Módulo Python (`backend/engines/`) | Responsabilidad Única y Exportaciones Clave |
| :--- | :--- | :--- | :--- | :--- |
| **Context Pruner** | `ContextPruner` | `contextPrunerEngine.ts` | `context_pruner.py` | Recorta `project_context.md` según el dominio (`3d`, `pbr`, `luau`, `ui`, `world`, `agents`), ahorrando **~65% de tokens** de contexto por consulta a Gemini. Exporta `buildPrunedDomainContext`, `buildAiSelfUnderstandingManifest`. |
| **1. 3D Geometry** | `3D Generation Engine` | `generation3DEngine.ts` | `generation_3d_engine.py` | Extracción de buffers reales (vértices, normales, UVs, caras), partición automática `>9,000` vértices (`splitOversizedMeshPartInput`) y generación Luau `--!strict` con `AssetService:CreateEditableMesh()` (`buildStrictLuauFromEditedParts`). |
| **2. Assets & PBR** | `Asset Engine` | `assetEngine.ts` | `asset_engine.py` | Exportador/Parser `.RBXMX` (`buildRbxmxFromPartsServer`, `parseRbxmxFromPartsServer`), exportador binario `.glTF 2.0`, `.OBJ/.MTL`, publicación PBR de 4 canales en Roblox Open Cloud con polling asíncrono de `Operation` e historial de 25 versiones. |
| **3. Luau Code** | `Luau Engine` | `luauEngine.ts` | `luau_engine.py` | Enrutamiento estricto `Server` (`src/server/*.server.luau`), `Client` (`src/client/*.client.luau`), `Module` (`src/shared/*.luau`) con `--!strict`, `task.*` y limpieza `Maid`. |
| **4. ForgeGUI** | `UI Engine` | `uiEngine.ts` | `ui_engine.py` | Generación de `ScreenGui` 100% responsive (`UDim2.fromScale` + `AnchorPoint = Vector2.new(0.5, 0.5)`), `ViewportFrame` 3D y árbol `ui_tree` en vivo. |
| **5. World & Biomes** | `World Engine` | `worldEngine.ts` | `world_engine.py` | Presets de iluminación (`Lighting` + `Atmosphere`) por bioma (`CyberpunkOrbital`, `MedievalForge`, `ArcticResearchBase`) y anclajes espaciales en `Workspace`. |
| **6. Rojo 7.x Sync** | `Rojo Bridge` | `rojoBridge.ts` | `rojo_bridge.py` | Sandboxing anti-Path Traversal (`resolveSafeRojoPath`), sanitizador Luau (`sanitizeStrictLuauCode`) y manifiesto SHA-256 (`/api/v1/rojo/sync-manifest`). |
| **7. P3 Multi-Agent** | `Agents Engine` | `agentsEngine.ts` | `agents_engine.py` | Orquestador autónomo de 7 agentes secuenciales (`Architect` → `3D` → `Asset/PBR` → `World` → `Luau` → `UI` → `Rojo`). |

---

## 2. Invariantes Innegociables (Reglas Duras del Sistema)

1. **Prohibidos `MeshId` ficticios o asignación directa a `MeshPart.MeshId`**:
   - `MeshPart.MeshId` es de solo lectura en Roblox Studio.
   - Nunca generar hashes falsos `rbxassetid://123456...` ni `rbxassetid://0`.
   - Toda geometría editable se reconstruye desde buffers (`vertices`, `normals`, `uvs`, `faces`) mediante `AssetService:CreateEditableMesh()` + `AssetService:CreateMeshPartAsync(Content.fromObject(editableMesh), options)`.
2. **Validación y limpieza de `EditableMesh`**:
   - Verificar siempre `if not editableMesh then error(...) end`.
   - Comprobar que `addedTriCount == expectedTriCount` y `#editableMesh:GetTriangles() >= expectedTriCount`.
   - Liberar siempre memoria con `pcall(function() editableMesh:Destroy() end)` tras crear el `MeshPart`.
   - Nunca marcar `ForgeReconstructionVerified = true` si se generó una pieza contenedora vacía de respaldo.
3. **Reconstrucción `.RBXMX` en Modo Edición**:
   - `backend/roblox_plugin/ForgeAIStudioPlugin.server.luau` reconstruye modelos `.rbxmx` en **Modo Edición (`RunService:IsEdit()`)** tanto automáticamente al detectar `Workspace.ChildAdded` como mediante el botón explícito del plugin.
4. **Paquete 3D Completo de 5 Archivos Generado en Servidor**:
   - `POST /api/v1/assets/export-roblox-package` sintetiza en el servidor los 5 archivos (`.luau`, `.rbxmx`, `.gltf`, `.obj`, `.mtl`) a partir de `parts` aunque el cliente solo envíe el array de piezas.
5. **Sincronización Bidireccional Real (`.RBXMX` ↔ Forge)**:
   - `POST /api/v1/assets/pull-from-rojo` parsea el XML `.rbxmx` completo (`parseRbxmxFromPartsServer` / `parse_rbxmx_to_parts`) recuperando `CFrame` (posición + rotación Euler desde matriz 3×3), materiales, los 4 canales de `SurfaceAppearance` y `ForgeMeshGeometryJSON`.

---

## 3. Endpoints de Auto-Descubrimiento y Contexto Podado para IA

- `GET /api/v1/ai-manifest`: Devuelve el mapa JSON de módulos, invariantes y perfiles de ahorro de tokens por dominio.
- `GET /api/v1/context/pruned?domain=3d|pbr|luau|ui|world|agents`: Devuelve únicamente las secciones de `project_context.md` necesarias para ese dominio más la lista auditada de módulos Rojo en disco.
