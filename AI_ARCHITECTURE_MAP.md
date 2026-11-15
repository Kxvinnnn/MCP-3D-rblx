# AI Architecture Map & Self-Understanding Index (`AI_ARCHITECTURE_MAP.md`)

> **Propósito para IA**: Lee este archivo primero. Resume en una sola página toda la arquitectura modular, contratos de archivos, rutas REST/SSE, integridades de datos e invariantes técnicos de **NIGHTMARE FORGE / Forge AI Studio v2.3.0+** para que no necesites cargar archivos completos en contexto.

---

## 1. Mapa de Motores Modulares de Dominio (Paridad 1:1 y Especialización)

| Dominio | Motor | Módulo TypeScript (`src/server/engines/`) | Módulo Python (`backend/engines/`) | Responsabilidad Única y Exportaciones Clave |
| :--- | :--- | :--- | :--- | :--- |
| **Context Pruner** | `ContextPruner` | `contextPrunerEngine.ts` | `context_pruner.py` | Recorta `project_context.md` según el dominio (`3d`, `pbr`, `luau`, `ui`, `world`, `agents`), ahorrando **~65% de tokens** de contexto por consulta a Gemini. Exporta `buildPrunedDomainContext`, `buildAiSelfUnderstandingManifest`. |
| **1. 3D Procedural & Provenance** | `Procedural 3D Generator` | `procedural3DGenerator.ts` & `generation3DEngine.ts` | `generation_3d_engine.py` | Orquestador central de generación 3D con resolución de precedencia estricta (`manual_ui > preset > prompt_nlp > ai_director > image_reference > default`), trazabilidad por campo (`parameter_provenance`), 7 especies arbóreas y hash determinista excluyendo telemetría efímera de raíz. |
| **2. Universal Freeform 3D** | `Universal Freeform Engine` | `universalFreeform3DEngine.ts` | `generation_3d_engine.py` | Flujo universal de 5 etapas (`planObjectSemantics` → `planGeometryAndComponents` → `generateReal3DMeshesFromPlan` → `assembleAndNormalizeModel` → `evaluateSemanticVisualIdentity`) para objetos arbitrarios (animales, aves, naves, vehículos, espadas, etc.) sin caer en `chest_or_prop`. Renderiza 5 vistas SVG. |
| **3. Specialized Geometry** | `Specialized Geometry Engine` | `specializedGeometryGenerators.ts` | `generation_3d_engine.py` | Generadores de mallas cerradas de alta fidelidad: árboles (7 especies: `oak`, `pine`, `willow`, `bonsai`, `dead`, `fantasy`, `crystalline`), arquitectura diferenciada (`medieval_house`, `medieval_castle`, `futuristic_building`, `fantasy_tower`), rocas, mobiliario y torno con profundidad Z. |
| **4. AI Generation Director** | `AI Director` | `aiGenerationDirector.ts` | `generation_3d_engine.py` | Esquema estructurado JSON para Gemini 2.5 (`gemini-2.5-pro` / `gemini-2.5-flash`), clasificación semántica de familias, telemetría de ejecución (`EngineExecutionReport`) y fallback transparente hacia generador determinista. |
| **5. Image Reference Processor** | `Image Reference Processor` | `imageReferenceProcessor.ts` | `generation_3d_engine.py` | Reconstrucción volumétrica Image-to-3D: decodificación RGBA, extracción de silueta, cálculo de perfil de profundidad relativo `depthProfile16`, puntuación de simetría (`estimatedSymmetryScore`) y correlación volumétrica (`volumetricMatchScore`). |
| **6. Visual Benchmark Suite** | `Visual Benchmark Suite` | `visualBenchmarkSuite.ts` | — | Evaluación continua de 11 dimensiones de calidad visual 3D, comparación cuantitativa de variación paramétrica (`compareModelVariationPair`) y exportación a disco (`docs/benchmarks/`) de reportes y 100 SVGs en 5 ángulos. |
| **7. External 3D GPU Adapter** | `External 3D Model Adapter` | `external3DModelAdapter.ts` | — | Capa de abstracción e integración HTTP para workers GPU open-source externos (TRELLIS, Hunyuan3D-2, TripoSR, InstantMesh, Wonder3D) con grounding automático en `Y=0` y fallback honesto cuando el worker no está disponible. |
| **8. Assets & PBR** | `Asset Engine` | `assetEngine.ts` & `worldAndModelEditorEngine.ts` | `asset_engine.py` | Texturas PBR (`SurfaceAppearance` con Albedo, Roughness, Metalness, Normal), convención canónica `forge-color-v1` de paridad RGB (8-bit vs normalizado `[0..1]`), optimización `EditableMesh` (`<=9,000` tris/parte) y biblioteca atómica con historial de 25 versiones. |
| **9. Luau Code** | `Luau Engine` | `luauEngine.ts` | `luau_engine.py` | Enrutamiento estricto `Server` (`src/server/*.server.luau`), `Client` (`src/client/*.client.luau`), `Module` (`src/shared/*.luau`) con `--!strict`, `task.*` y limpieza `Maid`. |
| **10. ForgeGUI** | `UI Engine` | `uiEngine.ts` | `ui_engine.py` | Generación de `ScreenGui` 100% responsive (`UDim2.fromScale` + `AnchorPoint = Vector2.new(0.5, 0.5)`), `ViewportFrame` 3D y árbol `ui_tree` en vivo. |
| **11. World & Biomes** | `World Engine` | `worldEngine.ts` | `world_engine.py` | Presets de iluminación (`Lighting` + `Atmosphere`) por bioma (`CyberpunkOrbital`, `MedievalForge`, `ArcticResearchBase`) y anclajes espaciales en `Workspace`. |
| **12. Rojo & Bridge Coordinator** | `Bridge Coordinator & Rojo` | `bridgeCoordinatorEngine.ts` & `rojoBridge.ts` | `rojo_bridge.py` & `forge-bridge/` | Handshake y tareas firmadas con HMAC-SHA256 + anti-replay por `nonce`, persistencia atómica `TaskStateStore`, sandboxing de rutas hacia `rojo_workspace/` y manifiesto SHA-256. |
| **13. P3 Multi-Agent** | `Agents Engine` | `agentsEngine.ts` | `agents_engine.py` | Orquestador autónomo de agentes secuenciales (`Architect` → `3D` → `Asset/PBR` → `World` → `Luau` → `UI` → `Rojo`). |

---

## 2. Sub-Módulos de Integridad de Datos y Validación Geométrica (`src/utils/`)

| Módulo Utilitario | Responsabilidad | Exportaciones Principales |
| :--- | :--- | :--- |
| `src/utils/canonicalHash.ts` | Hashing canónico SHA-256 (NIST FIPS 180-4) con codificación UTF-8 pura, normalización de Map/Set/ArrayBuffer/Date, exclusión de claves efímeras de nivel raíz (`ROOT_EXCLUDED_CANONICAL_KEYS`: `latency_ms`, `execution_report`) y sub-hashes independientes. | `sha256Hex`, `toCanonicalJsonValue`, `computeCanonicalAssetHash`, `computeGeometryHash`, `computeAppearanceHash`, `computePropertiesHash`, `getAssetIdentityKey`. |
| `src/utils/colorUtils.ts` | Convención inequívoca `forge-color-v1` para paridad RGB TypeScript ↔ Luau (`0..1` flotante vs `0..255` entero de 8 bits vs hexadecimal `#RRGGBB`). | `normalizeRgb01`, `resolveColorRgb255`, `hexToRgb255`, `rgb255ToHex`, `areRgbColorsEqual`. |
| `src/utils/robloxGeometryValidator.ts` | Triangulación 3D Ear Clipping (Newell Normal + 2D Projection + Ear Clipping con tolerancia relativa a la escala del polígono), detección de `NaN`, bowties auto-intersectantes y reporte estricto de restricciones Roblox (`meshData` y `baseMeshData`). | `validateRobloxGeometry`, `triangulatePolygonFace3D`, `countValidTrianglesInFace`, `computeTriangleArea3D`. |
| `src/utils/incrementalSync.ts` | Diferenciación incremental quirúrgica de piezas 3D (`added`, `removed`, `modified`, `unchanged`) con detección de duplicados por `partId` y desambiguación jerárquica. | `computeIncrementalDiff`, `buildCollisionSafePartMap`. |
| `src/utils/receiptVerification.ts` | Verificación estricta de recibos de reconstrucción de Roblox Studio (rechaza recibos incompletos o parciales sin hash coincidente). | `evaluateStudioReconstructionReceipt`, `reconcileReconstructedModelFromStudio`. |
| `src/utils/treePromptParser.ts` | Conversor determinista bilingüe ES/EN de lenguaje natural a parámetros estructurados del generador de árboles (7 especies, dimensiones en studs, asimetría, estilo cartoon/realista, paleta). | `parseNaturalLanguageToTreeParams`. |

---

## 3. Invariantes Innegociables (Reglas Duras del Sistema)

1. **Precedencia Estricta de Parámetros (`parameter_provenance`)**:
   - `manual_ui > preset > prompt_nlp > ai_director > image_reference > default`.
   - Los valores por defecto de la UI no anulan las intenciones del usuario expresadas en texto natural salvo que el campo esté en `manually_edited_fields`.
2. **Hash Canónico y Determinismo sin Fuga de Telemetría**:
   - Dos peticiones con los mismos parámetros y semilla idéntica producen exactamente la misma geometría y el mismo `contentHash`.
   - `latency_ms` y `execution_report` están excluidos del hash canónico a nivel raíz mediante `ROOT_EXCLUDED_CANONICAL_KEYS`.
3. **Límites Seguros de `EditableMesh` de Roblox**:
   - Toda pieza 3D respeta `<= 9,000` triángulos y `<= 20,000` vértices para partición segura en Roblox Studio.
   - Cero triángulos degenerados (área `< 1e-8` o índices colapsados).
4. **Arquitectura Libre Universal sin Dependencia de Plantillas Rígidas**:
   - Ningún prompt de criatura o animal puede terminar en `chest_or_prop`.
   - Si no existe un generador especializado, el pipeline universal de 5 etapas planifica articulaciones libres y descompone las partes semánticamente.
5. **Seguridad Fail-Closed y Aislamiento de Red**:
   - En entorno de tests (`NODE_ENV === 'test'`), las llamadas externas de red a Gemini se aíslan automáticamente salvo que se configure `FORGE_ALLOW_LIVE_GEMINI_IN_TESTS=true`.
   - `forge-bridge` opera exclusivamente en loopback local `127.0.0.1:48720` con validación estricta de rutas relativas y firmas HMAC.

---

## 4. Endpoints de Auto-Descubrimiento y Contexto Podado para IA

- `GET /api/v1/architecture`: Catálogo completo de motores modulares activos, agentes especializados, estado de hitos de roadmap y contratos de módulos.
- `GET /api/v1/ai-manifest`: Manifiesto de auto-comprensión para agentes con estadísticas de reducción de tokens por dominio.
- `GET /api/v1/context/pruned?domain=3d|pbr|luau|ui|world|agents`: Devuelve únicamente las secciones de `project_context.md` necesarias para ese dominio más la lista auditada de módulos Rojo en disco.
