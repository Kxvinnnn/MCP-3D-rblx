# Inventario Completo de Módulos — NIGHTMARE FORGE / Forge AI Studio

Este inventario enumera los archivos fuente, motores, puentes, configuraciones, pruebas y documentación presentes en el repositorio tras la evolución de Misión Integral.

---

## 1. Raíz del Repositorio

| Archivo | Rol Principal |
| :--- | :--- |
| `package.json` / `package-lock.json` / `bun.lock` | Dependencias Frontend/Server, scripts (`dev`, `build`, `test`, `start`) y metadatos (`v2.3.0`). |
| `tsconfig.json` | Configuración TypeScript del proyecto raíz (`exclude: ["dist", "forge-bridge"]`). |
| `vite.config.ts` | Configuración del bundler Vite para la interfaz React/Tailwind. |
| `server.ts` | Gateway Express principal, endpoints `/api/v1/*`, proxy FastAPI, gestión de biblioteca 3D y aislamiento en modo test. |
| `index.html` / `metadata.json` | Documento HTML de entrada y metadatos de la aplicación. |
| `.env.example` / `.gitignore` | Plantilla de variables de entorno (sin secretos reales) y exclusiones Git. |
| `AI_ARCHITECTURE_MAP.md` / `README.md` | Mapa arquitectónico inicial y presentación general del repositorio. |
| `.github/workflows/ci.yml` | Pipeline CI en GitHub Actions con 5 jobs de validación. |

---

## 2. Frontend React y Visualización (`src/`)

### Entrada y Contexto
- `src/main.tsx` — Montaje React en el DOM.
- `src/App.tsx` — Enrutado principal entre vistas (`home`, `create`, `edit`, `materials`, `sync`, motores Dev).
- `src/index.css` — Estilos globales y utilidades Tailwind.
- `src/context/ForgeContext.tsx` — Estado global de sesión, proyecto, modelo activo, historial Undo/Redo e idioma/modo.

### Vistas y Componentes UI (`src/components/`)
- `src/components/views/HomeView.tsx` — Dashboard de estado de servicios, biblioteca de assets y acciones rápidas.
- `src/components/views/CreateWizardView.tsx` — Asistente guiado de creación 3D con telemetría en vivo (`provider`, `model_used`, `latency_ms`), badges de `parameter_provenance` y selector de 5 vistas SVG (`front`, `side`, `back`, `top`, `isometric`).
- `src/components/views/wizard/wizardData.ts` — Datos, categorías y presets del asistente.
- `src/components/views/wizard/WizardStep3Params.tsx` — Controles paramétricos detallados y seguimiento de campos editados manualmente.
- `src/components/views/EditView.tsx` — Editor interactivo de jerarquía `MeshPart`, transformaciones y herramientas `EditableMesh`.
- `src/components/views/edit/EditInspectorPanel.tsx` — Panel inspector de propiedades por pieza.
- `src/components/views/MaterialsView.tsx` — Editor de canales PBR (`SurfaceAppearance`).
- `src/components/views/StudioSyncView.tsx` — Panel de sincronización bidireccional Rojo y Puente Local.
- `src/components/common/InteractiveColorWheel.tsx` — Selector cromático circular intuitivo para edición visual de piezas.
- `src/components/common/HelpTooltip.tsx` — Tooltips contextuales para modo Sencillo/Avanzado.
- `src/components/RobloxWorldViewport3D.tsx` / `src/components/RobloxCanvasPreview.tsx` — Visores Three.js y previsualización 3D.
- `src/components/BackendExplorer.tsx`, `ContextEditor.tsx`, `FloatingTerminalLog.tsx`, `InteractiveTutorialModal.tsx`, `LocalBridgeStatusPanel.tsx`, `ModularArchitectureAndAgents.tsx`, `RojoWorkflowGuide.tsx`, `ScriptGenerator.tsx`, `UIGenerator.tsx` — Herramientas de desarrollo e inspección.
- `src/components/engines/3dEngine.ts` — Adaptador de escena/mallas para el visor frontend.

---

## 3. Motores de Servidor e IA (`src/server/engines/`)

| Módulo | Responsabilidad |
| :--- | :--- |
| `src/server/engines/procedural3DGenerator.ts` | Orquestador central de síntesis 3D, precedencia estricta de parámetros, `parameter_provenance`, `warnings` y hash determinista. |
| `src/server/engines/universalFreeform3DEngine.ts` | Arquitectura universal de 5 etapas (interpretación semántica, planificación libre, mallas orgánicas/spline/icosphere, ensamblado e identidad visual + 5 vistas SVG). |
| `src/server/engines/specializedGeometryGenerators.ts` | Generadores geométricos especializados por familia (`tree` 7 especies, `building` con 4 subtipos, `rock`, `chair`, `lamp`, `mechanical`, `table`, torno image-to-3D). |
| `src/server/engines/aiGenerationDirector.ts` | Cliente y esquema estructurado para Gemini (`gemini-2.5-pro` / `gemini-2.5-flash`), clasificación de familias, `EngineExecutionReport` y fallback determinista. |
| `src/server/engines/imageReferenceProcessor.ts` | Decodificación PNG/JPG/WebP/SVG, extracción de silueta, perfil volumétrico `depthProfile16`, simetría y puntuación Image-to-3D. |
| `src/server/engines/visualBenchmarkSuite.ts` | Suite de 11 dimensiones de calidad (conectada a `anatomicalQualityValidator.ts`), comparación de pares paramétricos y persistencia de artefactos SVG/JSON/Markdown en `docs/benchmarks/`. |
| `src/server/engines/pbrTextureEngine.ts` | Generador determinista RGBA PNG en Node (`256`/`512`/`1024` px) para mapas `Albedo`, `Normal`, `Roughness`, `Metallic`, `AO`, `Emissive` y `SurfaceAppearance`. |
| `src/server/engines/anatomicalQualityValidator.ts` | Validador real anti-primitivas y anti-flotantes (mide esculpido no-circular, continuidad 3D, apoyo `Y=0`, uso de `SmoothPlastic` y proporciones). |
| `src/server/engines/external3DModelAdapter.ts` | Adaptador HTTP para modelos GPU externos open-source (TRELLIS, Hunyuan3D-2, TripoSR, InstantMesh, Wonder3D), parseo `.obj` y grounding `Y=0`. |
| `src/server/engines/generation3DEngine.ts` | Motor de alto nivel para generación de escenas y assets 3D. |
| `src/server/engines/assetEngine.ts` | Normalización de assets, colores RGB canónicos, materiales Roblox y empaquetado. |
| `src/server/engines/worldEngine.ts` / `worldAndModelEditorEngine.ts` | Edición de mundo, terreno y transformaciones de modelos. |
| `src/server/engines/luauEngine.ts` | Generación y análisis de scripts `--!strict` y patrón Maid. |
| `src/server/engines/uiEngine.ts` | Generación de interfaces ScreenGui / BillboardGui / SurfaceGui. |
| `src/server/engines/agentsEngine.ts` | Orquestación de agentes técnicos y manifiestos. |
| `src/server/engines/architectureManifest.ts` | Definición programática de la arquitectura de motores. |
| `src/server/engines/bridgeCoordinatorEngine.ts` | Coordinador en nube de tareas hacia el puente local `forge-bridge`. |
| `src/server/engines/contextPrunerEngine.ts` | Poda inteligente de contexto del proyecto Roblox. |
| `src/server/engines/rojoBridge.ts` | Integración de lectura/escritura segura hacia `rojo_workspace/`. |

---

## 4. Utilidades Compartidas (`src/utils/` y `src/utils/3d/`)

- `src/utils/treePromptParser.ts` — Extracción NLP bilingüe (ES/EN) de especies arbóreas (7 especies), dimensiones, simetría, estilo y colores.
- `src/utils/canonicalHash.ts` — Hashing FNV-1a/canónico estable excluyendo telemetría efímera de raíz (`ROOT_EXCLUDED_CANONICAL_KEYS`).
- `src/utils/colorUtils.ts` — Normalización y paridad RGB canónica (`0..1` ↔ `0..255`).
- `src/utils/robloxGeometryValidator.ts` — Validación `EditableMesh` (límites poligonales, 0 triángulos degenerados, índices válidos).
- `src/utils/roblox3DEngine.ts` — Utilidades de transformación y escena para Roblox Studio.
- `src/utils/forgeApiClient.ts` / `sseParser.ts` — Cliente HTTP/SSE para generación progresiva en UI.
- `src/utils/incrementalSync.ts` / `receiptVerification.ts` — Verificación de recibos y sincronización incremental Rojo.
- `src/utils/3d/meshGeometry.ts` — Operaciones geométricas (subdivisión, auto-reparación, cálculos de volumen).
- `src/utils/3d/formatExporters.ts` / `luauExporter.ts` / `assetHelpers.ts` — Exportadores a `.obj`, `.gltf`/`.glb`, `.rbxmx` y Luau `--!strict`.
- `src/utils/3d/pbrTextures.ts` / `syncAndHeal.ts` — Texturas PBR procedurales y curación automática de partes.

---

## 5. Backend Python y Plugin de Roblox (`backend/`)

- `backend/main.py`, `backend/requirements.txt`, `backend/.env.example`, `backend/project_context.md`
- `backend/engines/`: `__init__.py`, `agents_engine.py`, `asset_engine.py`, `context_pruner.py`, `generation_3d_engine.py`, `luau_engine.py`, `rojo_bridge.py`, `ui_engine.py`, `world_engine.py`
- `backend/roblox_plugin/ForgeAIStudioPlugin.server.luau` — Plugin oficial v2.3.0 para Roblox Studio (polling Zero-Inbound + `EditableMesh` + paridad RGB).

---

## 6. Puente Local (`forge-bridge/`) y Workspace Rojo (`rojo_workspace/`)

- `forge-bridge/package.json`, `tsconfig.json`, `.env.example`, `bridge.config.example.json`, `README.md`
- `forge-bridge/src/`: `server.ts`, `cloudClient.ts`, `protocol.ts`, `rojoHandler.ts`, `security.ts`, `studioQueue.ts`, `taskStateStore.ts`
- `forge-bridge/scripts/`: `start-bridge.ps1`, `stop-bridge.ps1`
- `forge-bridge/tests/bridge.test.ts` — Suite de pruebas del puente local.
- `rojo_workspace/`: `default.project.json`, `assets_library.json`, `src/shared/Network/RemoteProvider.luau`, `src/shared/Types/GameTypes.luau`, `src/shared/Utils/Maid.luau`.

---

## 7. Pruebas (`tests/`) y Activos Públicos (`public/`)

- **Tests TypeScript (`tests/`):** `canonicalHash.test.ts`, `forgeContext.test.ts`, `hybrid3DEngineReconstruction.test.ts`, `mainServerSecurity.test.ts`, `missionEndToEndTreeFlow.test.ts`, `nightmareForgeE2EAndSecurity.test.ts`, `proceduralTreeAndE2EMission.test.ts`, `rgbColorParity.test.ts`, `robloxGeometryValidator.test.ts`, `sseParser.test.ts`, `studio3DTransformation.test.ts`, `universalFreeformAndCowGeneralization.test.ts`.
- **Tests Python (`tests/`):** `test_e2e_bidirectional_sync.py`.
- **Benchmarks públicos heredados (`public/assets/benchmarks/`):** SVGs estáticos previos de vaca y generalización de 7 prompts; **Artefactos actuales (`docs/benchmarks/`):** `benchmark_report.json`, `benchmark_summary.md` y 100 SVGs de 5 vistas en `docs/benchmarks/views/`.
