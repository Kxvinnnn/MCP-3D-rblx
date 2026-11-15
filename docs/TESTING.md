# Estrategia de Pruebas, Validación y Benchmarks Visuales — NIGHTMARE FORGE

Este documento describe todas las suites de verificación automatizada, el flujo de integración continua y los resultados observados de la suite de calidad visual 3D.

---

## 1. Comandos de Verificación

| Capa | Comando | Propósito | Resultado Observado Reciente |
| :--- | :--- | :--- | :--- |
| **TypeScript / Tipos** | `node node_modules/typescript/bin/tsc --noEmit` | Verificación estática estricta del proyecto | `0` errores (`exit 0`). |
| **Bundle Frontend** | `node node_modules/vite/bin/vite.js build` | Empaquetado Vite React/Tailwind producción | `1712` módulos transformados en `1.39s` (`exit 0`). |
| **Suite TS + Bridge** | `npm.cmd test` (`tests/*.test.ts forge-bridge/tests/*.test.ts`) | Integración total, hashing, seguridad, RGB, motores 3D y puente | **`96 / 96` pruebas aprobadas**, `0` fallos, `0` saltadas (`~54.8s`). |
| **Puente Local Independiente** | `cd forge-bridge && node --import ./node_modules/tsx/dist/loader.mjs --test tests/bridge.test.ts` | Validación aislada de `forge-bridge` | **`8 / 8` pruebas aprobadas**, `0` fallos (`~6.9s`). |
| **Compilación Python** | `python -m py_compile <archivos_py>` | Validación sintáctica de FastAPI y motores Python | `exit 0` sobre `backend/main.py`, `backend/engines/*.py` y `tests/test_e2e_bidirectional_sync.py`. |
| **Paridad E2E Python ↔ TS** | `python tests/test_e2e_bidirectional_sync.py` | Validación cruzada de hashes, RGB y sincronización | *Observación Windows:* Falla al invocar `["npx", "tsx", ...]` en línea `343` (`WinError 2`, ya que Windows requiere `npx.cmd`/shell; en CI corre sobre `ubuntu-latest`). |

---

## 2. Desglose de Suites Automatizadas (`tests/` y `forge-bridge/tests/`)

1. **`forge-bridge/tests/bridge.test.ts` (8 pruebas):** Rutas seguras sin path traversal, HMAC/Bearer anti-replay, expiración de sesión, persistencia atómica tmp+rename, recuperación ante JSON corrupto y flujo Cloud → Bridge → Rojo → Studio.
2. **`tests/canonicalHash.test.ts`:** Vectores NIST SHA-256, Unicode multi-byte, normalización de `Date`/`Map`/`Set`/`TypedArray`, exclusión en raíz (`ROOT_EXCLUDED_CANONICAL_KEYS`, incluyendo `latency_ms` y `execution_report`) vs preservación anidada, sub-hashes y diff incremental.
3. **`tests/forgeContext.test.ts`:** Estado React `ForgeContext`, recuperación de borradores, resolución de conflictos local/remoto, verificación de contenido persistido y recibos estructurados de Studio.
4. **`tests/hybrid3DEngineReconstruction.test.ts`:** Enrutamiento de modos `procedural`, `ai`, `hybrid` e `image_to_3d`, rechazo `503 AI_PROVIDER_UNAVAILABLE` cuando `strict_ai=true` sin proveedor, y fallback visible en modo no estricto.
5. **`tests/studio3DTransformation.test.ts`:** 6 casos obligatorios (`Horse`, `Cow`, `Fantasy Tree`, `Futuristic Sports Car`, `Medieval House`, `Arbitrary Telescope`), rechazo no manipulable del falso caballo primitivo, 7 variaciones y generación de SVGs de 5 ángulos en `docs/benchmarks/`.
5. **`tests/mainServerSecurity.test.ts`:** CORS restringido, sesión efímera dev solo same-origin, rate limiting y protección de rutas `/api/v1/*`.
6. **`tests/missionEndToEndTreeFlow.test.ts` & `tests/proceduralTreeAndE2EMission.test.ts`:** Generación parametrizable de árboles, validación de geometría cerradas y paquete completo de exportación.
7. **`tests/nightmareForgeE2EAndSecurity.test.ts`:** Validación integral E2E del servidor principal y seguridad de puente.
8. **`tests/rgbColorParity.test.ts`:** Convención canónica `forge-color-v1` y paridad exacta RGB de 8 bits entre exportadores TypeScript, `procedural3DGenerator` y plugin Luau.
9. **`tests/robloxGeometryValidator.test.ts`:** Límites de escala (`<= 2048` studs), detección de `NaN`, Ear Clipping en polígonos cóncavos, rechazo de bowties/caras degeneradas y endurecimiento de llamadas `EditableMesh`.
10. **`tests/sseParser.test.ts`:** Parseo incremental LF, CRLF dividido entre chunks, multilínea y flush final del stream SSE.
11. **`tests/universalFreeformAndCowGeneralization.test.ts` (`SECCIÓN 3` a `SECCIÓN 10`, 10 bloques):**
    - `SECCIÓN 3`: Evaluación honesta de adaptadores open-source 3D.
    - `SECCIÓN 4`: Separación de 5 etapas y prohibición de fallback ciego a `chest_or_prop`.
    - `SECCIÓN 5`: Aceptación obligatoria de vaca adulta anatomía bovina con manchas y 4 patas.
    - `SECCIÓN 6 y 7`: Generalización sin editar código entre 7 prompts distintos.
    - `SECCIÓN 8`: Aislamiento de `@google/genai` respecto a `forge-bridge`.
    - `SECCIÓN 9A..9D`: Precedencia NLP frente a defaults UI, semillas no repetidas, componentes arbitrarios vía `procedural3DGenerator`, y adaptador `.obj` HTTP con grounding `Y=0` y fallback al caer.
    - `SECCIÓN 10`: Validación integral de `parameter_provenance`, Prompt A vs Prompt B, 7 especies arbóreas, **23 objetos obligatorios**, variaciones de vaca ES/EN, determinismo vs auto-seed, métricas de 11 dimensiones, Image-to-3D (`depthProfile16`, `volumetricMatchScore`) y persistencia de artefactos en `docs/benchmarks/`.

---

## 3. Pipeline de Integración Continua (`.github/workflows/ci.yml`)

El flujo de GitHub Actions define **5 jobs** independientes:
1. `project-frontend-and-server`: `npx tsc --noEmit`, `npm run build` y suites de root (`tests/`).
2. `forge-bridge`: instalación aislada en `forge-bridge/`, compilación TypeScript y `forge-bridge/tests/bridge.test.ts`.
3. `python-backend`: `py_compile`, compilación de backend Python y ejecución de `tests/test_e2e_bidirectional_sync.py` en Linux (`ubuntu-latest`).
4. `roblox-plugin-checks`: comprobaciones estructurales sobre `ForgeAIStudioPlugin.server.luau` y contrato RGB.
5. `integration-e2e`: verificación conjunta de flujo completo.

---

## 4. Benchmarks Visuales de 11 Dimensiones (`docs/benchmarks/`)

La suite [`visualBenchmarkSuite.ts`](../src/server/engines/visualBenchmarkSuite.ts) (`forge-visual-benchmark-v3`) evalúa **11 dimensiones** (`Visual ID`, `Prompt Fid`, `Proportions`, `Silhouette`, `Component Completeness`, `Geometry Quality`, `Material PBR`, `Color Harmony`, `Texture UV`, `Mesh Manifold`, `Roblox Compatibility`) y persiste resultados en [`docs/benchmarks/benchmark_summary.md`](./benchmarks/benchmark_summary.md):

- **Suite canónica:** `8/8` casos aprobados (puntajes globales de **90.4** a **96.3**).
- **Suite de generalización universal:** `8/8` geométricos y `8/8` identidad semántica (puntajes globales de **90.3** a **96.3**).
- **Renders SVG exportados:** `100` vistas en `docs/benchmarks/views/` (`front`, `side`, `back`, `top`, `isometric` por cada modelo).
- **Pares de variación paramétrica:**
  - *Árbol Prompt A (5 studs, rojo, cartoon)* vs *Prompt B (35 studs, azul luminoso, cristalino)*: `distinctnessScore=100/100`, `heightDelta=29.29 studs`, `partCountDelta=16`, `overlapPaleta=0`.
  - *Vaca pequeña blanca/negra* vs *Vaca grande marrón/cuernos largos*: `distinctnessScore=87/100`, `heightDelta=5.27 studs`, `overlapPaleta=0.5`.
