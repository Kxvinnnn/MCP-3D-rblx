# AI Architecture Map & Self-Understanding Index (`AI_ARCHITECTURE_MAP.md`)

> **Propósito para IA**: Lee este archivo primero. Resume en una sola página toda la arquitectura modular, contratos de archivos, rutas REST/SSE, integridades de datos e invariantes técnicos de **Forge AI Studio v2.2 (AI-First Edition)** para que no necesites cargar archivos completos en contexto.

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

## 2. Sub-Módulos de Integridad de Datos y Validación Geométrica (`src/utils/`)

| Módulo Utilitario | Responsabilidad | Exportaciones Principales |
| :--- | :--- | :--- |
| `src/utils/canonicalHash.ts` | Hashing canónico SHA-256 (NIST FIPS 180-4) con codificación UTF-8 pura, normalización de Map/Set/ArrayBuffer/Date y sub-hashes independientes (`geometryHash`, `appearanceHash`, `propertiesHash`). | `sha256Hex`, `toCanonicalJsonValue`, `computeCanonicalAssetHash`, `computeGeometryHash`, `computeAppearanceHash`, `computePropertiesHash`, `getAssetIdentityKey`. |
| `src/utils/robloxGeometryValidator.ts` | Triangulación 3D Ear Clipping (Newell Normal + 2D Projection + Ear Clipping) y reporte estricto de restricciones de Roblox DataModel / EditableMesh (escala, coordenadas no finitas, caras malformadas/degeneradas). | `validateRobloxGeometry`, `triangulatePolygonFace3D`, `countValidTrianglesInFace`, `computeTriangleArea3D`. |
| `src/utils/incrementalSync.ts` | Diferenciación incremental quirúrgica de piezas 3D (`added`, `removed`, `modified`, `unchanged`) con prevención de colisiones por partId duplicado y desambiguación jerárquica. | `computeIncrementalDiff`, `buildCollisionSafePartMap`. |

---

## 3. Invariantes Innegociables (Reglas Duras del Sistema)

1. **Hash Canónico y Serialización Unívoca**:
   - `computeCanonicalAssetHash()` serializa los objetos ordenando claves lexicográficamente, excluyendo metadatos volátiles de la raíz (`created_at`, `updated_at`, `version`, `saved_path`), pero preservándolos en niveles anidados.
   - `Set` se ordena canónicamente para ignorar orden de inserción; `Map` con claves mixtas preserva tipos exactos para no colisionar `1` con `"1"`.
   - `ArrayBuffer` se convierte mediante `Uint8Array` para serializar bytes reales (no `[]`).
2. **Triangulación Real Ear Clipping para Polígonos > 3 Vértices**:
   - Prohibido usar la fórmula ilícita `(N - 2)` para estimar o contar triángulos.
   - Polígonos de más de 3 vértices (convexos o cóncavos) se proyectan y triangulan usando Ear Clipping en 2D, verificando en 3D que cada triángulo resultante tenga área de superficie real (`computeTriangleArea3D > 1e-7`).
3. **Control de Cambios Pendientes y Transiciones de Estado (`pendingChanges`)**:
   - Invocaciones a `setActiveAsset(null)` o carga de versiones modificadas del mismo/otro recurso con `pendingChanges = true` se interceptan con `showUnsavedModal = true`.
   - `confirmSwitchDiscard()` restaura el modelo en memoria exactamente al snapshot persistido en `savedAssetSnapshotRef`.
   - `saveAssetToDisk()` verifica el contenido devuelto por el servidor mediante `verifyPersistedAssetContent()` antes de limpiar `pendingChanges`.
   - `pushToStudio()` mantiene `pendingChanges = true` cuando la tarea queda en cola (`queued`) en el puente local, y sólo limpia cambios cuando Roblox Studio confirma ejecución exitosa (`completed`).
4. **Validación de `baseHash` al Recuperar Borradores y Resolución de Conflictos**:
   - `recoverDraft()` verifica `baseHash` contra la versión guardada actual; si difieren, activa `activeConflict` en lugar de sobrescribir.
   - `resolveConflict('keep_local')` persiste y sincroniza la versión local con el backend antes de dar por cerrado el conflicto.
5. **Prohibidos `MeshId` ficticios o asignación directa a `MeshPart.MeshId`**:
   - Toda geometría editable se reconstruye desde buffers (`vertices`, `normals`, `uvs`, `faces`) mediante `AssetService:CreateEditableMesh()` + `AssetService:CreateMeshPartAsync()`.

---

## 4. Endpoints de Auto-Descubrimiento y Contexto Podado para IA

- `GET /api/v1/ai-manifest`: Devuelve el mapa JSON de módulos, invariantes y perfiles de ahorro de tokens por dominio.
- `GET /api/v1/context/pruned?domain=3d|pbr|luau|ui|world|agents`: Devuelve únicamente las secciones de `project_context.md` necesarias para ese dominio más la lista auditada de módulos Rojo en disco.
