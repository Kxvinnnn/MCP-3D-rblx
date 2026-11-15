# Índice Maestro de Documentación — NIGHTMARE FORGE

Índice completo de toda la documentación técnica generada, guías de referencia del repositorio y reportes de benchmarks visuales.

---

## 1. Documentación Técnica Principal (`docs/`)

| Documento | Descripción | Enlace |
| :--- | :--- | :--- |
| **README / Visión General** | Punto de entrada ejecutivo, capacidades nucleares e inicio rápido | [README.md](./README.md) |
| **Índice de Documentación** | Catálogo completo de guías y artefactos del repositorio | [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md) |
| **Arquitectura del Sistema** | Diagramas Mermaid de componentes, flujo end-to-end y límites de confianza | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| **Motor de Generación 3D** | Pipeline universal de 5 etapas, generadores especializados y precedencia de parámetros | [GENERATION_ENGINE.md](./GENERATION_ENGINE.md) |
| **Modelos de IA y Adaptador GPU** | Director Gemini (`gemini-2.5-pro`/`flash`), fallback determinista y modelos GPU externos | [AI_MODELS.md](./AI_MODELS.md) |
| **Pipeline Image-to-3D** | Decodificación de imágenes, `depthProfile16`, simetría y reconstrucción torno | [IMAGE_TO_3D.md](./IMAGE_TO_3D.md) |
| **Integración con Roblox Studio** | Puente Zero-Inbound, plugin Luau `--!strict`, EditableMesh, Rojo 7.x y paridad RGB | [ROBLOX_INTEGRATION.md](./ROBLOX_INTEGRATION.md) |
| **Instalación y Puesta en Marcha** | Requisitos Node/Python/Rojo, dependencias y scripts de arranque | [INSTALLATION.md](./INSTALLATION.md) |
| **Entorno y Seguridad** | Tokens, CORS, `forge-bridge` loopback, rutas seguras y manejo de credenciales | [ENVIRONMENT_AND_SECURITY.md](./ENVIRONMENT_AND_SECURITY.md) |
| **Guía de Desarrollo** | Convenciones de código, flujo en ramas y reglas de compatibilidad | [DEVELOPMENT.md](./DEVELOPMENT.md) |
| **Pruebas y Benchmarks** | Suites TS/Bridge/Python, CI de 5 jobs y métricas de calidad 3D | [TESTING.md](./TESTING.md) |
| **Decisiones Técnicas (ADRs)** | Registro de decisiones arquitectónicas y trade-offs verificados | [TECHNICAL_DECISIONS.md](./TECHNICAL_DECISIONS.md) |
| **Estado Real de Subsistemas** | Auditoría técnica estricta utilizando la taxonomía oficial de 7 estados | [SYSTEM_STATUS.md](./SYSTEM_STATUS.md) |
| **Inventario de Módulos** | Listado completo archivo por archivo de frontend, backend, puente y tests | [MODULE_INVENTORY.md](./MODULE_INVENTORY.md) |
| **Hoja de Ruta (Roadmap)** | Evoluciones planificadas a corto, mediano y largo plazo | [ROADMAP.md](./ROADMAP.md) |
| **Registro de Cambios (Changelog)** | Historial cronológico hasta `v2.3.0+` y evolución Misión Integral | [CHANGELOG.md](./CHANGELOG.md) |

---

## 2. Guías Preexistentes y Artefactos Complementarios

- [API_REFERENCE.md](./API_REFERENCE.md) — Especificación de endpoints HTTP y esquemas JSON.
- [ROBLOX_PLUGIN_AND_ROJO_GUIDE.md](./ROBLOX_PLUGIN_AND_ROJO_GUIDE.md) — Instalación detallada del plugin en Roblox Studio y flujo Rojo.
- [STABILIZATION_DATA_INTEGRITY.md](./STABILIZATION_DATA_INTEGRITY.md) — Políticas de integridad geométrica, hashes y persistencia atómica.
- [USER_GUIDE.md](./USER_GUIDE.md) — Manual de usuario final para los modos Sencillo y Avanzado.
- [AI_ARCHITECTURE_MAP.md](../AI_ARCHITECTURE_MAP.md) — Mapa arquitectónico general en la raíz del proyecto.
- [CI Workflow (.github/workflows/ci.yml)](../.github/workflows/ci.yml) — Definición de integración continua.

---

## 3. Artefactos de Benchmark Visual (`docs/benchmarks/`)

- [benchmark_summary.md](./benchmarks/benchmark_summary.md) — Tabla resumen de las 11 dimensiones sobre la suite canónica (8 casos) y generalización universal (8 casos), más comparación paramétrica de variaciones.
- [benchmark_report.json](./benchmarks/benchmark_report.json) — Datos estructurados JSON completos del último run de benchmark.
- [views/](./benchmarks/views/) — 100 renders SVG multi-ángulo (`front`, `side`, `back`, `top`, `isometric`) generados automáticamente durante `SECCIÓN 10`.
