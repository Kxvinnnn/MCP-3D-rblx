# Decisiones Técnicas y Arquitectónicas (ADRs) — NIGHTMARE FORGE / Forge AI Studio

Este documento registra las decisiones de diseño más importantes tomadas durante la evolución del motor de generación 3D de NIGHTMARE FORGE, sus alternativas consideradas y las consecuencias técnicas observables en el repositorio.

---

## ADR-001: Pipeline Universal Freeform de 5 Etapas en Lugar de Plantillas Fijas

- **Estado:** Implementado y activo en [`universalFreeform3DEngine.ts`](../src/server/engines/universalFreeform3DEngine.ts).
- **Contexto:** La arquitectura heredada clasificaba todo objeto desconocido dentro de un conjunto cerrado de familias (`SpecializedObjectFamily`) y recurría a un respaldo genérico (`chest_or_prop`). Al solicitar objetos fuera de catálogo (por ejemplo, una vaca, un caballo, un dragón, un ave o una nave espacial), el motor producía una caja con aspecto de cofre sin relación anatómica ni semántica con el prompt.
- **Decisión:** Sustituir el fallback ciego por un flujo universal de 5 etapas (`planObjectSemantics`, `planGeometryAndComponents`, `generateReal3DMeshesFromPlan`, `assembleAndNormalizeModel`, `evaluateSemanticVisualIdentity`) capaz de:
  1. Reconocer arquetipos extensibles y objetos arbitrarios mediante descomposición semántica (partes anatómicas, mecánicas, arquitectónicas o vegetales).
  2. Sintetizar geometría real multi-parte (`Procedural3DPart[]`) con `EditableMesh` embebido cuando el presupuesto poligonal lo permite.
  3. Validar mediante jueces geométricos y semánticos que las partes requeridas y la silueta multi-vista correspondan al objeto pedido.
- **Alternativas descartadas:**
  - *Agregar una plantilla manual por cada nuevo sustantivo* (`vaca`, `perro`, etc.): no escala y perpetúa fallos ante prompts combinados.
- **Consecuencias:** La adición de nuevas familias (`bird_or_avian`, `futuristic_spaceship`, `medieval_castle`, `futuristic_building`, `fantasy_tower`, `sword_or_weapon`) y modificadores cromáticos/morfológicos ES/EN convive con una síntesis genérica estructurada cuando no existe un generador especializado dedicado.

---

## ADR-002: Precedencia Estricta de Parámetros y Provenance Explícito (`manual_ui > preset > prompt_nlp > ai_director > image_reference > default`)

- **Estado:** Implementado en [`procedural3DGenerator.ts`](../src/server/engines/procedural3DGenerator.ts) y expuesto en [`CreateWizardView.tsx`](../src/components/views/CreateWizardView.tsx).
- **Contexto:** Anteriormente, la interfaz enviaba en cada petición un objeto completo con valores iniciales por defecto (`height: 14`, `foliage_color` verde, `seed: "forge-tree-2026"`), y el servidor hacía `{ seed, ...(promptTreeParsed || {}), ...(req.tree_params || {}) }`. Como consecuencia, los defaults estáticos de la UI sobrescribían lo que el usuario pedía por texto natural (por ejemplo, *"árbol azul de 5 studs"* terminaba verde y de 14 studs).
- **Decisión:**
  1. Introducir resolución por capas con fuente trazable (`parameter_provenance: Record<string, { value, source }>`).
  2. Respetar los valores de UI únicamente cuando el campo figura en `manually_edited_fields` (o cuando difiere explícitamente de un valor por defecto conocido sin haber sido extraído por NLP).
  3. Imponer la precedencia exacta: `manual_ui > preset > prompt_nlp > ai_director > image_reference > default`.
  4. Registrar advertencias no fatales en `warnings` cuando un campo es anulado por un nivel de mayor prioridad.
- **Consecuencias:** Un cambio de prompt sin editar controles manuales refleja inmediatamente dimensiones, especie, paleta y estilo textual en el resultado final y muestra en la interfaz qué fuente determinó cada parámetro.

---

## ADR-003: Exclusión de Telemetría Efímera en el Hash Canónico (`ROOT_EXCLUDED_CANONICAL_KEYS`)

- **Estado:** Implementado en [`canonicalHash.ts`](../src/utils/canonicalHash.ts) y [`procedural3DGenerator.ts`](../src/server/engines/procedural3DGenerator.ts).
- **Contexto:** Al añadir métricas de ejecución en tiempo real (`latency_ms` y `execution_report`) al objeto del asset generado, el cálculo determinista de `contentHash` (`computeCanonicalHash`) variaba entre dos ejecuciones idénticas con la misma semilla si diferían en milisegundos de reloj.
- **Decisión:**
  1. Incluir `'latency_ms'` y `'execution_report'` en `ROOT_EXCLUDED_CANONICAL_KEYS` dentro de `canonicalHash.ts` para excluir telemetría efímera de nivel raíz sin ocultar campos anidados con el mismo nombre dentro de métricas o pruebas sintéticas.
  2. Adjuntar `latency_ms` en `procedural3DGenerator.ts` **después** de calcular el `contentHash` determinista del asset.
- **Alternativas descartadas:** Eliminar `latency_ms` del reporte de ejecución o excluir las claves recursivamente en toda profundidad (lo que habría roto pruebas unitarias existentes de hashing profundo en `canonicalHash.test.ts`).
- **Consecuencias:** Dos ejecuciones con semilla explícita y mismos parámetros producen exactamente el mismo `contentHash` y la misma geometría, conservando la observabilidad de latencia real en la UI y en los logs.

---

## ADR-004: Límites y Particionado Automático para `EditableMesh` de Roblox (≤ 9,000 Triángulos / Parte)

- **Estado:** Implementado en [`specializedGeometryGenerators.ts`](../src/server/engines/specializedGeometryGenerators.ts), [`robloxGeometryValidator.ts`](../src/utils/robloxGeometryValidator.ts) y [`assetEngine.ts`](../src/server/engines/assetEngine.ts).
- **Contexto:** La API de `EditableMesh` en Roblox Studio y su sincronización mediante el plugin de Luau presentan restricciones de tamaño por malla individual y son sensibles a triángulos degenerados o índices fuera de rango.
- **Decisión:**
  1. Mantener las mallas procedimentales dentro de un tope seguro de `<= 9,000` triángulos y `<= 20,000` vértices por pieza individual.
  2. Evitar triángulos de área cero al construir tornos (`buildLatheSilhouetteMesh`), cápsulas e inflados simétricos.
  3. Validar cada asset generado mediante `validateProcedural3DGeometry(parts)` en la suite de pruebas antes de considerarlo apto para exportación.
- **Consecuencias:** Permite combinar mallas orgánicas ricas (vacas, dragones, copas asimétricas, espadas) con exportación confiable a `.obj`, `.gltf`/`.glb`, `.rbxmx` y Luau nativo.

---

## ADR-005: Normalización Unicode en Expresiones Regulares Semánticas (Español / Inglés)

- **Estado:** Implementado en [`universalFreeform3DEngine.ts`](../src/server/engines/universalFreeform3DEngine.ts) y [`treePromptParser.ts`](../src/utils/treePromptParser.ts).
- **Contexto:** En JavaScript, `\b` solo reconoce límites entre caracteres ASCII `[A-Za-z0-9_]` y no letras acentuadas como `á`, `é`, `í`, `ó`, `ú`, `ñ`. Un patrón como `/\bárbol\b/` fallaba silenciosamente sobre prompts en español.
- **Decisión:** Reemplazar `\b` por límites Unicode explícitos o coincidencias normalizadas sin acentos (`NFD` + strip diacríticos) al analizar keywords en español (`árbol`, `vegetación`, `bonsái`, `pequeña`, `marrón`, `espada`, etc.), y distinguir prefijos ambiguos como `base_soporte` frente a `soporte_guarda` de espada.
- **Consecuencias:** Detección bilingüe consistente entre prompts en español e inglés sin regresiones de falsos positivos entre categorías.

---

## ADR-006: Seguridad Zero-Inbound en la Arquitectura de Sincronización con Roblox Studio

- **Estado:** Implementado en [`forge-bridge/`](../forge-bridge/src/server.ts) y [`backend/roblox_plugin/ForgeAIStudioPlugin.server.luau`](../backend/roblox_plugin/ForgeAIStudioPlugin.server.luau).
- **Contexto:** Un servidor Node/Express o Python local no debe abrir puertos expuestos innecesariamente a internet ni permitir ejecución arbitraria remota de código hacia Roblox Studio.
- **Decisión:**
  1. Limitar `forge-bridge` a escucha en `127.0.0.1` (`loopback` local) con autenticación Bearer/HMAC opcional y lista blanca de raíces Rojo/fs (`security.ts`).
  2. Hacer que el plugin de Luau actúe únicamente como cliente que consulta tareas mediante polling hacia `127.0.0.1` (patrón *Zero-Inbound*), nunca aceptando conexiones entrantes en Studio.
- **Consecuencias:** Superficie de ataque mínima en la máquina del desarrollador manteniendo sincronización bidireccional con Studio y Rojo.

---

## ADR-007: Reconstrucción Volumétrica Image-to-3D Basada en `depthProfile16` sin Alucinar GPUs Externas

- **Estado:** Implementado en [`imageReferenceProcessor.ts`](../src/server/engines/imageReferenceProcessor.ts), [`specializedGeometryGenerators.ts`](../src/server/engines/specializedGeometryGenerators.ts) y [`external3DModelAdapter.ts`](../src/server/engines/external3DModelAdapter.ts).
- **Contexto:** El proyecto necesita transformar imágenes PNG/JPG/WebP/SVG en modelos 3D coherentes en entornos CPU locales sin GPU dedicada, pero manteniendo la puerta abierta a modelos generativos pesados externos (TRELLIS, Hunyuan3D-2, TripoSR, InstantMesh, Wonder3D).
- **Decisión:**
  1. Extraer en Node/TypeScript un mapa de silueta multi-banda enriquecido con perfil de profundidad relativo `depthProfile16` (16 bandas verticales calculadas por sombreado y relieve), `estimatedSymmetryScore` y `volumetricConfidence`.
  2. Pasar `depthProfile` al generador de malla tipo torno/relieve `buildLatheSilhouetteMesh` en `generateReferenceImage3DAssetParts`, evitando discos planos sin volumen Z.
  3. Mantener `external3DModelAdapter.ts` como capa de abstracción honesta: cuando no hay endpoint GPU remoto configurado (`EXTERNAL_3D_*_ENDPOINT` vacío), reportar explícitamente `provider_status: 'fallback'` y ejecutar el motor híbrido local sin simular inferencia externa.
- **Consecuencias:** Coherencia transparente en UI y logs (`provider`, `model_used`, `provider_status`) tanto en modo offline/CPU como cuando se conecte un worker GPU externo en el futuro.
