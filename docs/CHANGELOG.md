# Registro de Cambios (Changelog) — NIGHTMARE FORGE / Forge AI Studio

Todos los hitos verificados del sistema, incluyendo la evolución reciente de **Misión Integral**.

---

## [Transformación Estudio 3D — Rama `feat/3d-studio-transformation`]

### Agregado y Evolucionado
- **Motor PBR Nativo de Servidor (`src/server/engines/pbrTextureEngine.ts`):**
  - Codificador RGBA PNG determinista en Node (`zlib.deflateSync` + CRC32) que genera mapas reales `Albedo`, `Normal`, `Roughness`, `Metallic`, `AO` y `Emissive` en resoluciones `256×256`, `512×512` y `1024×1024` px para 12 patrones de superficie (`organic_fur_coat`, `organic_bark`, `organic_foliage`, `weathered_stone`, `carved_wood`, `brushed_metal`, `carbon_fiber`, `ceramic_hoof_horn`, `glass_visor`, `fabric_cloth`, `fantasy_crystal`, `automotive_clearcoat`) junto con metadatos `SurfaceAppearance`.
- **Esculpido Anatómico No-Circular y `vertexColors` (`src/server/engines/universalFreeform3DEngine.ts`):**
  - Nuevos perfiles transversales esculpidos (`equine_torso`, `equine_neck`, `equine_head`, `organic_ribcage`, `mane_crest`, `aerodynamic_hull`, `blade_keel`) en `buildSplineLoftedOrganMesh` con sombreado orgánico por vértice (`vertexColors`).
  - Eliminación de `SmoothPlastic` en cuadrúpedos (reemplazado por `Fabric`, `Sand`, `Marble`, `Glass`), adición de `Mane_Forelock` en caballos, alerón/barra LED y carrocería `Metal` aerodinámica en deportivos futuristas, y corrección de las coordenadas globales de `Udder_Ventral` en la vaca.
- **Validador Anatómico Real y Benchmark No Manipulable (`src/server/engines/anatomicalQualityValidator.ts`, `src/server/engines/visualBenchmarkSuite.ts`):**
  - `validateAssetAnatomyAndQuality` mide no-circularidad geométrica, continuidad 3D entre piezas (detectando piezas flotantes), apoyo `Y=0`, diversidad material/PBR y proporciones de categoría; `evaluateAssetQualityMetrics` ya no premia conteos inflados de partes ni `SmoothPlastic`.
- **Image-to-3D Multi-Vista con Incertidumbre Honesta (`src/server/engines/imageReferenceProcessor.ts`):**
  - Soporte `reference_images_multi` mediante `analyzeMultiViewReferenceImages` y reporte explícito `uncertaintyReport` (`viewCount`, `hiddenSidesInferred`, `confidence`, `limitationNote`).
- **Visor 3D y Wizard UI (`src/utils/3d/pbrTextures.ts`, `src/components/RobloxWorldViewport3D.tsx`, `src/components/views/CreateWizardView.tsx`):**
  - Eliminado el fallback de caja cian en `pbrTextures.ts` y activado PBR en `Natural`; nuevos selectores `visualStyle` (10 estilos) y `textureResolution` (`256`/`512`/`1024`) más telemetría `texture_source` y `anatomical_validation`.
- **Suite de Verificación (`tests/studio3DTransformation.test.ts`):**
  - Validación de los 6 casos obligatorios (`Horse`, `Cow`, `Fantasy Tree`, `Futuristic Sports Car`, `Medieval House`, `Arbitrary Telescope`), rechazo del falso caballo primitivo, 7 variaciones y capturas SVG de 5 ángulos en `docs/benchmarks/`.

---

## [Misión Integral — Rama `feat/mision-integral-3d-engine-docs`]

### Agregado y Evolucionado
- **Precedencia Estricta y Provenance (`procedural3DGenerator.ts`, `CreateWizardView.tsx`):**
  - Jerarquía determinista `manual_ui > preset > prompt_nlp > ai_director > image_reference > default`.
  - Registro de `parameter_provenance` por campo (`{ value, source }`), `warnings` de resolución y telemetría (`provider`, `model_used`, `provider_status`, `latency_ms`) visible en el asistente de creación.
- **Árboles Multi-Especie e Intérprete Bilingüe (`treePromptParser.ts`, `aiGenerationDirector.ts`, `specializedGeometryGenerators.ts`):**
  - Soporte explícito para las 7 especies (`oak`, `pine`, `willow`, `bonsai`, `dead`, `fantasy`, `crystalline`), altura mínima reducida a `2.5` studs para prompts pequeños (`Prompt A`), escalado proporcional de copa/grosor y diferenciación visual/material completa entre estilos extremos (`Prompt A` vs `Prompt B`).
- **Motor Universal Freeform y Generalización de Objetos (`universalFreeform3DEngine.ts`, `specializedGeometryGenerators.ts`):**
  - Arquetipos y subtipos dedicados para aves (`bird_or_avian`), naves espaciales (`futuristic_spaceship`), armas (`sword_or_weapon`), automóviles 4 ruedas, variaciones bovinas ES/EN (tamaño, pelaje y cuernos) y 4 subtipos arquitectónicos (`medieval_house`, `medieval_castle`, `futuristic_building`, `fantasy_tower`).
  - Corrección de precedencia semántica para prompts mixtos (por ejemplo, *"torre fantástica de mago"* clasifica como `fantasy_tower` en lugar de humanoide; *"espada"* separa `soporte_guarda` de `base_soporte`) y normalización Unicode en palabras acentuadas (`árbol`, `vegetación`, `bonsái`).
- **Pipeline Image-to-3D Volumétrico (`imageReferenceProcessor.ts`, `specializedGeometryGenerators.ts`):**
  - Extracción de perfil de profundidad relativa `depthProfile16`, puntuación de simetría (`estimatedSymmetryScore`), confianza volumétrica (`volumetricConfidence`), ajuste de torno Z en `buildLatheSilhouetteMesh` y métrica de comparación `volumetricMatchScore` / `depthProfileModel16`.
- **Benchmarks de 11 Dimensiones y 5 Cámaras (`visualBenchmarkSuite.ts`, `CreateWizardView.tsx`):**
  - Vista trasera adicional (`backSvg` — 5 ángulos totales: `front`, `side`, `back`, `top`, `isometric`).
  - Evaluación de 11 dimensiones de calidad y exportador en disco `persistVisualBenchmarkArtifacts` hacia `docs/benchmarks/` (`benchmark_report.json`, `benchmark_summary.md` y 100 SVGs).
- **Determinismo e Aislamiento de Entorno de Pruebas (`canonicalHash.ts`, `server.ts`, `universalFreeformAndCowGeneralization.test.ts`):**
  - Inclusión de `latency_ms` y `execution_report` en `ROOT_EXCLUDED_CANONICAL_KEYS` y cálculo de `contentHash` antes de adjuntar telemetría efímera en raíz.
  - Aislamiento automático de llamadas externas a Gemini cuando `options.nodeEnv === 'test'` (salvo opt-in explícito con `FORGE_ALLOW_LIVE_GEMINI_IN_TESTS=true`) y limpieza de sockets keep-alive con `closeAllConnections()` en pruebas HTTP.
  - Ampliación de `tests/universalFreeformAndCowGeneralization.test.ts` con `SECCIÓN 10` validando los 23 objetos obligatorios y exportación de benchmarks.
- **Documentación Técnica Completa (`docs/`):**
  - Creación y actualización de los 16 documentos técnicos en español en `docs/` cubriendo arquitectura con diagramas Mermaid, modelos de IA, Image-to-3D, integración Roblox, ADRs, testing, inventario y estado honesto de subsistemas.

---

## [v2.3.0 — Estabilización, Paridad RGB e Identidad Persistente]

- **Paridad RGB Canónica (`forge-color-v1`):** Resolución consistente `[0..1]` vs `[0..255]` compartida entre TypeScript (`colorUtils.ts`, `assetEngine.ts`) y Luau (`ForgeAIStudioPlugin.server.luau`), cubierta por `tests/rgbColorParity.test.ts`.
- **Puente Local Zero-Inbound y Persistencia Atómica (`forge-bridge/`):** Comunicación loopback `127.0.0.1:48720`, firmas HMAC, anti-replay, confirmaciones destructivas diferidas y escritura atómica tmp+rename.
- **Validación `EditableMesh` e Identidad Incremental (`robloxGeometryValidator.ts`, `canonicalHash.ts`):** Detección de caras degeneradas, autointersacciones bowtie, límites de vértices/triángulos y hashing FNV-1a/SHA-256 determinista por sub-pieza.
- **Editor Cromático Simplificado (`InteractiveColorWheel.tsx`):** Rueda de paleta circular fluida e intuitiva por pieza en `EditView`.
