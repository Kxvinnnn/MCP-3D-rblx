# AI Architecture Map & Self-Understanding Index (`AI_ARCHITECTURE_MAP.md`)

> **Propósito para IA**: Lee este archivo primero. Resume en una sola página toda la arquitectura modular, contratos de archivos, rutas REST/SSE, integridades de datos e invariantes técnicos de **NIGHTMARE FORGE / Forge AI Studio v2.3.0** para que no necesites cargar archivos completos en contexto.

---

## 1. Mapa de Módulos de Dominio (Paridad 1:1 Python ↔ TypeScript)

| Dominio | Motor | Módulo TypeScript (`src/server/engines/`) | Módulo Python (`backend/engines/`) | Responsabilidad Única y Exportaciones Clave |
| :--- | :--- | :--- | :--- | :--- |
| **Context Pruner** | `ContextPruner` | `contextPrunerEngine.ts` | `context_pruner.py` | Recorta `project_context.md` según el dominio (`3d`, `pbr`, `luau`, `ui`, `world`, `agents`), ahorrando **~65% de tokens** de contexto por consulta a Gemini. Exporta `buildPrunedDomainContext`, `buildAiSelfUnderstandingManifest`. |
| **1. 3D Procedural & Geometry** | `3D Generation Engine` | `procedural3DGenerator.ts` & `generation3DEngine.ts` | `generation_3d_engine.py` | Motor 1 procedural determinista por `seed` (8 categorías, 14 params de árbol, LOD 0/1/2 cerrados), extracción de buffers reales, partición `>9,000` vértices y generación Luau `--!strict` con `AssetService:CreateEditableMesh()`. |
| **2. Assets & PBR** | `Asset Engine` | `assetEngine.ts` & `worldAndModelEditorEngine.ts` | `asset_engine.py` | Exportador/Parser `.RBXMX`, `.glTF 2.0`, `.OBJ/.MTL`, publicación PBR 4 canales Open Cloud (`local_saved` vs `cloud_published`), escritura atómica (`openSync`+`fsyncSync`+`renameSync`) e historial de 25 versiones. |
| **3. Luau Code** | `Luau Engine` | `luauEngine.ts` | `luau_engine.py` | Enrutamiento estricto `Server` (`src/server/*.server.luau`), `Client` (`src/client/*.client.luau`), `Module` (`src/shared/*.luau`) con `--!strict`, `task.*` y limpieza `Maid`. |
| **4. ForgeGUI** | `UI Engine` | `uiEngine.ts` | `ui_engine.py` | Generación de `ScreenGui` 100% responsive (`UDim2.fromScale` + `AnchorPoint = Vector2.new(0.5, 0.5)`), `ViewportFrame` 3D y árbol `ui_tree` en vivo. |
| **5. World & Biomes** | `World Engine` | `worldEngine.ts` | `world_engine.py` | Presets de iluminación (`Lighting` + `Atmosphere`) por bioma (`CyberpunkOrbital`, `MedievalForge`, `ArcticResearchBase`) y anclajes espaciales en `Workspace`. |
| **6. Rojo & Local Bridge** | `Bridge Coordinator` & `Rojo Bridge` | `bridgeCoordinatorEngine.ts` & `rojoBridge.ts` | `rojo_bridge.py` & `forge-bridge/` | Handshake y tareas firmadas con HMAC-SHA256 + anti-replay por `nonce`, persistencia atómica `TaskStateStore`, sandboxing de rutas y manifiesto SHA-256. |
| **7. P3 Multi-Agent** | `Agents Engine` | `agentsEngine.ts` | `agents_engine.py` | Orquestador autónomo de agentes secuenciales (`Architect` → `3D` → `Asset/PBR` → `World` → `Luau` → `UI` → `Rojo`). |

---

## 2. Sub-Módulos de Integridad de Datos y Validación Geométrica (`src/utils/`)

| Módulo Utilitario | Responsabilidad | Exportaciones Principales |
| :--- | :--- | :--- |
| `src/utils/canonicalHash.ts` | Hashing canónico SHA-256 (NIST FIPS 180-4) con codificación UTF-8 pura, normalización de Map/Set/ArrayBuffer/Date y sub-hashes independientes (`geometryHash`, `appearanceHash`, `propertiesHash`). | `sha256Hex`, `toCanonicalJsonValue`, `computeCanonicalAssetHash`, `computeGeometryHash`, `computeAppearanceHash`, `computePropertiesHash`, `getAssetIdentityKey`. |
| `src/utils/robloxGeometryValidator.ts` | Triangulación 3D Ear Clipping (Newell Normal + 2D Projection + Ear Clipping con tolerancia relativa a la escala del polígono) y reporte estricto de restricciones Roblox (`meshData` y `baseMeshData`). | `validateRobloxGeometry`, `triangulatePolygonFace3D`, `countValidTrianglesInFace`, `computeTriangleArea3D`. |
| `src/utils/incrementalSync.ts` | Diferenciación incremental quirúrgica de piezas 3D (`added`, `removed`, `modified`, `unchanged`) con detección de duplicados por `partId` y desambiguación jerárquica. | `computeIncrementalDiff`, `buildCollisionSafePartMap`. |
| `src/utils/receiptVerification.ts` | Verificación estricta de recibos de reconstrucción de Roblox Studio (rechaza recibos incompletos o parciales sin hash coincidente). | `evaluateStudioReconstructionReceipt`, `reconcileReconstructedModelFromStudio`. |

---

## 3. Invariantes Innegociables (Reglas Duras del Sistema)

1. **Hash Canónico y Serialización Unívoca**:
   - `computeCanonicalAssetHash()` serializa los objetos ordenando claves lexicográficamente, excluyendo metadatos volátiles de la raíz (`created_at`, `updated_at`, `version`, `saved_path`), pero preservándolos en niveles anidados.
   - `Set` se ordena canónicamente para ignorar orden de inserción; `Map` con claves mixtas preserva tipos exactos para no colisionar `1` con `"1"`.
   - `ArrayBuffer` se convierte mediante `Uint8Array` para serializar bytes reales (no `[]`).
2. **Triangulación Real Ear Clipping para Polígonos > 3 Vértices**:
   - Prohibido usar la fórmula ilícita `(N - 2)` para estimar o contar triángulos.
   - Polígonos de más de 3 vértices (convexos o cóncavos) se proyectan y triangulan usando Ear Clipping en 2D con umbrales relativos a la escala del polígono (área y magnitud de Newell), validando tanto `meshData` como `baseMeshData`.
3. **Control de Cambios Pendientes y Transiciones de Estado (`pendingChanges`)**:
   - Invocaciones a `setActiveAsset(null)` o carga de versiones modificadas del mismo/otro recurso con `pendingChanges = true` se interceptan con `showUnsavedModal = true`.
   - `confirmSwitchDiscard()` restaura el modelo en memoria exactamente al snapshot persistido en `savedAssetSnapshotRef`.
   - `saveAssetToDisk()` verifica el contenido devuelto por el servidor mediante `verifyPersistedAssetContent()` antes de limpiar `pendingChanges`.
   - `pushToStudio()` mantiene `pendingChanges = true` cuando la tarea queda en cola (`queued`) o `awaiting_confirmation`, y sólo limpia cambios tras verificación estricta del recibo (`reconcileStudioTaskReceipt`).
4. **Seguridad Fail-Closed e Identificadores Honestos**:
   - Producción (`NODE_ENV=production`) rechaza secretos vacíos o tokens placeholder conocidos.
   - `EditableMeshBuffers` locales usan `forgeAssetId` + `geometryHash`/`contentHash` y mantienen `robloxAssetId: null` hasta una publicación verificada en Roblox Cloud.
   - Toda geometría editable se reconstruye desde buffers (`vertices`, `normals`, `uvs`, `faces`) mediante `AssetService:CreateEditableMesh()` + `AssetService:CreateMeshPartAsync()`.

---

## 4. Endpoints de Auto-Descubrimiento y Contexto Podado para IA

- `GET /api/v1/ai-manifest`: Devuelve el mapa JSON de módulos, invariantes y perfiles de ahorro de tokens por dominio.
- `GET /api/v1/context/pruned?domain=3d|pbr|luau|ui|world|agents`: Devuelve únicamente las secciones de `project_context.md` necesarias para ese dominio más la lista auditada de módulos Rojo en disco.
