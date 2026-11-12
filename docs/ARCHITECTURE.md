# Arquitectura de Software Modular — Forge AI Studio v2.2 (AI-First & Data Integrity Edition)

Este documento describe la arquitectura desacoplada de **Forge AI Studio v2.2**, diseñada con **paridad modular 1:1 entre Python (`backend/engines/`) y TypeScript (`src/server/engines/`)**, un **Podador de Contexto por Dominio (`ContextPruner`)** y un **Núcleo Unificado de Integridad de Datos, Hashing Canónico SHA-256 y Triangulación Geométrica 3D Real**.

> **Índice Rápido para IA**: Consulta `AI_ARCHITECTURE_MAP.md` en la raíz del proyecto o invoca `GET /api/v1/ai-manifest` para obtener los contratos e invariantes de cada módulo en formato compacto.

---

## 1. Mapa de los 8 Motores Modulares (`backend/engines/` ↔ `src/server/engines/`)

### 1.0 `Context Pruner Engine` (`backend/engines/context_pruner.py` | `src/server/engines/contextPrunerEngine.ts`)
- **Problema que resuelve**: Enviar todo el archivo `project_context.md` en cada llamada al modelo desperdicia tokens y añade ruido de dominios no relacionados.
- **Solución**: Divide `project_context.md` en bloques semánticos (`ROJO_MAPPING`, `LUAU_STANDARDS`, `MAID_PATTERN`, `UI_FORGEGUI`, `EXISTING_MODULES`) e inyecta únicamente los bloques requeridos por el dominio activo (`3d`, `pbr`, `luau`, `ui`, `world`, `agents`), manteniendo siempre la lista verificada de módulos Rojo en disco.

### 1.1 `3D Generation Engine` (`backend/engines/generation_3d_engine.py` | `src/server/engines/generation3DEngine.ts`)
- **Responsabilidades**:
  - Extracción de buffers geométricos reales (`vertices`, `normals`, `uvs`, `faces` 0-based) desde `.OBJ` o sub-mallas procesadas.
  - División inteligente de mallas densas (`>9,000` vértices o `>9,500` caras) en sub-partes contiguas sin descartar ningún triángulo (`splitOversizedMeshPartInput`).
  - Generación de módulos Luau `--!strict` que reconstruyen `MeshPart` reales mediante `AssetService:CreateEditableMesh()`, verifican `#editableMesh:GetTriangles()`, liberan memoria con `editableMesh:Destroy()` y nunca asignan la propiedad de solo lectura `MeshPart.MeshId` ni inventan hashes `rbxassetid://`.

### 1.2 `Asset Engine` (`backend/engines/asset_engine.py` | `src/server/engines/assetEngine.ts`)
- **Responsabilidades**:
  - Serializador y parser bidireccional `.RBXMX` (`buildRbxmxFromPartsServer`, `parseRbxmxFromPartsServer`) que preserva matrices de rotación `CFrame` 3×3, colores, materiales, los 4 canales de `SurfaceAppearance` y los buffers `ForgeMeshGeometryJSON`.
  - Exportador `.glTF 2.0` con buffers binarios embebidos y exportador Wavefront `.OBJ` + `.MTL`.
  - Publicación de los 4 canales PBR (`ColorMap`, `NormalMap`, `RoughnessMap`, `MetalnessMap`) hacia Roblox Open Cloud con **polling asíncrono de `Operation`** (`/assets/v1/operations/{id}`).
  - Biblioteca persistente (`assets_library.json`) con **snapshots completos de hasta 25 versiones** (`parts`, `luau_code`, `pbr_profile`, `collision_fidelity`, `description`).

### 1.3 `Luau Engine` (`backend/engines/luau_engine.py` | `src/server/engines/luauEngine.ts`)
- **Responsabilidades**:
  - Enrutamiento determinista de scripts `Server` (`src/server/*.server.luau`), `Client` (`src/client/*.client.luau`) y `Module` (`src/shared/*.luau`).
  - Cumplimiento estricto de `--!strict`, servicios al inicio con `game:GetService(...)`, librería `task.*` y limpieza de eventos con `Maid`.

### 1.4 `UI Engine` (`backend/engines/ui_engine.py` | `src/server/engines/uiEngine.ts`)
- **Responsabilidades**:
  - Generación de módulos `ScreenGui` en `src/client/UI` con posicionamiento exclusivamente en escala (`UDim2.fromScale`) y `AnchorPoint = Vector2.new(0.5, 0.5)`.
  - Generación simultánea del árbol jerárquico `ui_tree` para previsualización en vivo y soporte nativo de `ViewportFrame` con `WorldModel` 3D.

### 1.5 `World Engine` (`backend/engines/world_engine.py` | `src/server/engines/worldEngine.ts`)
- **Responsabilidades**:
  - Configuración programática del servicio `Lighting` y la instancia `Atmosphere` según biomas predefinidos (`CyberpunkOrbital`, `MedievalForge`, `ArcticResearchBase`).
  - Ensamblaje espacial de múltiples assets de la biblioteca dentro de una carpeta de zona en `Workspace`.

### 1.6 `Rojo Bridge` (`backend/engines/rojo_bridge.py` | `src/server/engines/rojoBridge.ts`)
- **Responsabilidades**:
  - Validación de seguridad de rutas (`resolveSafeRojoPath`) garantizando que ningún archivo pueda escribirse fuera de `ROJO_PROJECT_PATH`.
  - Sanitización de código Luau (`sanitizeStrictLuauCode`) y generación del **Manifiesto de Sincronización SHA-256** (`/api/v1/rojo/sync-manifest`).

### 1.7 `Specialized Agents Engine — P3` (`backend/engines/agents_engine.py` | `src/server/engines/agentsEngine.ts`)
- **Flujo Secuencial de 7 Agentes**:
  1. `ArchitectAgent` → 2. `3DGenerationAgent` → 3. `AssetEngineAgent` → 4. `WorldBuilderAgent` → 5. `LuauScripterAgent` → 6. `UIEngineAgent` → 7. `RojoBridgeAgent`.

---

## 2. Sub-Sistema de Integridad de Datos, Hashing y Sincronización (`src/utils/`)

### 2.1 `Canonical Hash Engine` (`src/utils/canonicalHash.ts`)
- **Hashing SHA-256 (NIST FIPS 180-4)**:
  - Codifica cadenas utilizando `TextEncoder` antes de procesar bloques de 512 bits, calculando la longitud exacta en bits a partir del arreglo de bytes UTF-8 (`bytes.length * 8`). Esto elimina errores en pares sustitutos UTF-16, caracteres acentuados en español y emojis.
- **Normalización JSON Canónica (`toCanonicalJsonValue`)**:
  - Ordena las claves de los objetos lexicográficamente de forma independiente a la localización (`strictOrdinalCompare`).
  - En la raíz del recurso excluye claves volátiles de servidor (`created_at`, `updated_at`, `version`, `saved_path`), pero las preserva dentro de objetos anidados (`customMeta`, etc.).
  - Reordena los elementos de un `Set` tras serializarlos canónicamente, garantizando que el orden de inserción no afecte el digest.
  - Para `Map` con claves mixtas, serializa pares `[canonicalKey, canonicalValue]` de forma que la clave numérica `1` y la cadena `"1"` no colisionen.
  - Representa `ArrayBuffer` mediante arreglos de bytes enteros (`Uint8Array`).
- **Sub-Hashes Granulares**:
  - `computeGeometryHash()`: Cubre únicamente formas, tamaños y mallas de vértices/caras (`meshData`, `baseMeshData`).
  - `computeAppearanceHash()`: Cubre únicamente colores, materiales, transparencias y perfiles PBR.
  - `computePropertiesHash()`: Cubre únicamente posiciones, rotaciones, matrices `CFrame` y banderas físicas (`anchored`, `canCollide`, etc.).

### 2.2 `Roblox Geometry Validator` (`src/utils/robloxGeometryValidator.ts`)
- **Triangulación 3D Real Ear Clipping (`triangulatePolygonFace3D`)**:
  - Calcula la normal del polígono 3D mediante la fórmula de Newell.
  - Proyecta los vértices sobre el plano dominante 2D (XY, XZ o YZ).
  - Recorta "orejas" (ears) convexas verificando que ningún otro vértice se encuentre dentro del triángulo.
  - Comprueba en 3D que cada triángulo generado posea una superficie no nula (`computeTriangleArea3D > 1e-7`).
- **Validación de Límites y Restricciones de Roblox Studio**:
  - Limites de escala por pieza (`0.001` a `2048` studs).
  - Verificación de coordenadas finitas (rechazo de `NaN` o `Infinity` en posición, rotación o `rotationMatrix`).
  - Detección de caras malformadas (`< 3` vértices), índices fuera de límites de vértices y caras degeneradas/colineales.

### 2.3 `Incremental Sync Engine` (`src/utils/incrementalSync.ts`)
- **Prevenición de Colisiones de Identidad (`buildCollisionSafePartMap`)**:
  - Exige unicidad en `partId` explícitos; si se detectan duplicados, interrumpe la sincronización con un error claro.
  - Para piezas sin `partId`, genera una clave jerárquica unívoca (`fallback::parentId::hierarchyPath::name#occurrence`) y registra advertencias sin sobrescribir elementos.
- **Clasificación Quirúrgica de Cambios (`computeIncrementalDiff`)**:
  - Clasifica las piezas en `added`, `removed`, `modified` y `unchanged`.
  - Las piezas eliminadas (`removed`) o añadidas (`added`) activan automáticamente los flags globales de cambio de geometría, apariencia, propiedades y jerarquía.

---

## 3. Máquina de Estados del Contexto React (`src/context/ForgeContext.tsx`)

### 3.1 Transiciones Protegidas de `setActiveAsset()`
- **Cierre o Cambio de Recurso con Cambios Pendientes**:
  - Invocaciones a `setActiveAsset(null)` o a otro recurso cuando `pendingChanges = true` no destruyen el estado activo.
  - Se activa `showUnsavedModal = true` y se registra la intención en `pendingSwitchToNullRef` o `pendingSwitchTarget`.
  - `confirmSwitchDiscard()` restaura el recurso activo exactamente al snapshot persistido original (`savedAssetSnapshotRef`).

### 3.2 Detección de Conflictos al Recuperar Borradores (`recoverDraft`)
- Compara `baseHash` del borrador contra el hash de la versión guardada actual.
- Si el modelo guardado cambió en la sesión o biblioteca desde que se guardó el borrador, se activa `activeConflict` (`localAsset` vs `remoteAsset`) solicitando resolución al usuario.

### 3.3 Verificación de Persistencia y Sincronización en `pushToStudio()`
- `saveAssetToDisk()` valida el modelo devuelto por el servidor mediante `verifyPersistedAssetContent()` antes de borrar `pendingChanges`.
- `pushToStudio()` realiza una validación geométrica previa (`validateRobloxGeometry`); si la tarea queda en cola (`queued`) en el puente local, no limpia `pendingChanges`. Únicamente actualiza la línea base cuando Roblox Studio confirma la ejecución completa (`completed`).

---

## 4. Plugin de Roblox Studio v2.2 (`backend/roblox_plugin/ForgeAIStudioPlugin.server.luau`)

- **Reconstrucción `EditableMesh` en Modo Edición (`RunService:IsEdit()`)**:
  - Listener automático `Workspace.ChildAdded` que reconstruye cualquier modelo `.rbxmx` importado en Modo Edición sin necesidad de pulsar Play.
  - Botón explícito **"Reconstruir Mallas EditableMesh (.RBXMX / Workspace)"** con validación de triángulos y liberación de memoria `editableMesh:Destroy()`.
- **Push Incremental Studio → Forge (`/api/v1/assets/studio-push`)**:
  - Sincroniza la selección actual de Roblox Studio de vuelta hacia Forge AI Studio conservando buffers geométricos y mapas PBR.
