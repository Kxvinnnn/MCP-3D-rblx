# Arquitectura de Software Modular — Forge AI Studio v2.2 (AI-First Edition)

Este documento describe la arquitectura desacoplada de **Forge AI Studio v2.2**, diseñada con **paridad modular 1:1 entre Python (`backend/engines/`) y TypeScript (`src/server/engines/`)**, más un **Podador de Contexto por Dominio (`ContextPruner`)** que reduce en ~65% el contexto extra enviado a Gemini en cada generación.

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

## 2. Plugin de Roblox Studio v2.1 (`backend/roblox_plugin/ForgeAIStudioPlugin.server.luau`)

- **Reconstrucción `EditableMesh` en Modo Edición (`RunService:IsEdit()`)**:
  - Listener automático `Workspace.ChildAdded` que reconstruye cualquier modelo `.rbxmx` importado en Modo Edición sin necesidad de pulsar Play.
  - Botón explícito **"Reconstruir Mallas EditableMesh (.RBXMX / Workspace)"** con validación de triángulos y liberación de memoria `editableMesh:Destroy()`.
- **Push Incremental Studio → Forge (`/api/v1/assets/studio-push`)**:
  - Sincroniza la selección actual de Roblox Studio de vuelta hacia Forge AI Studio conservando buffers geométricos y mapas PBR.
