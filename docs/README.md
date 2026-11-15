# NIGHTMARE FORGE / Forge AI Studio — Documentación Técnica v2.3.0+

**NIGHTMARE FORGE (Forge AI Studio)** es una plataforma híbrida de generación, edición e integración bidireccional de modelos y escenas 3D orientada a **Roblox Studio**, **EditableMesh**, **Luau (`--!strict`)** y **Rojo 7.x**.

---

## Visión General del Sistema

El núcleo actual combina cuatro capacidades coordinadas:

1. **Motor Universal Freeform 3D + Generadores Geométricos Especializados (`src/server/engines/`):**
   - Pipeline de 5 etapas (`universalFreeform3DEngine.ts`) que interpreta prompts en español e inglés, planifica componentes libres arbitrarios, sintetiza geometría parametrizada (`spline_lofted_organ`, `sculpted_icosphere_organ`, torno/extrusion), ensambla jerarquías y evalúa identidad visual semántica.
   - Coexiste con generadores especializados de alta fidelidad (`specializedGeometryGenerators.ts`) para árboles multi-especie (7 especies: `oak`, `pine`, `willow`, `bonsai`, `dead`, `fantasy`, `crystalline`), edificios diferenciados (`medieval_house`, `medieval_castle`, `futuristic_building`, `fantasy_tower`), rocas, mobiliario y reconstrucción desde imagen.
2. **Resolución Trazable y Precedencia Estricta de Parámetros (`procedural3DGenerator.ts`):**
   - Resuelve colisiones entre interfaz, presets, lenguaje natural e IA mediante la jerarquía estricta:
     `manual_ui > preset > prompt_nlp > ai_director > image_reference > default`.
   - Expone `parameter_provenance`, `warnings` y `latency_ms` conservando determinismo completo en `contentHash` (`ROOT_EXCLUDED_CANONICAL_KEYS`).
3. **Reconstrucción Volumétrica Image-to-3D y Benchmark Visual de 11 Dimensiones:**
   - Extracción de silueta multi-banda con perfil de profundidad relativo `depthProfile16`, cálculo de simetría y puntuación volumétrica (`imageReferenceProcessor.ts`).
   - Suite de evaluación automática de 11 dimensiones (`visualBenchmarkSuite.ts`) con renderizado SVG de 5 ángulos (`front`, `side`, `back`, `top`, `isometric`) exportados en [`docs/benchmarks/`](./benchmarks/benchmark_summary.md).
4. **Ecosistema Roblox Studio & Puente Zero-Inbound (`forge-bridge/` + `backend/roblox_plugin/`):**
   - Servidor loopback local (`127.0.0.1:48720`), autenticación HMAC/Bearer, validación de rutas Rojo y plugin Luau (`ForgeAIStudioPlugin.server.luau`) con paridad RGB canónica.

---

## Inicio Rápido

```powershell
# 1. Instalar dependencias de la raíz y de forge-bridge
npm install
npm --prefix forge-bridge install

# 2. Verificar tipos, pruebas e interfaz
npx tsc --noEmit
npm test
npm run build

# 3. Iniciar gateway web + API (puerto 3000) y puente local opcional (127.0.0.1:48720)
npm run dev
npm --prefix forge-bridge start
```

Para detalles completos de configuración de variables de entorno, consulta [INSTALLATION.md](./INSTALLATION.md) y [ENVIRONMENT_AND_SECURITY.md](./ENVIRONMENT_AND_SECURITY.md).

---

## Mapa Rápido de Documentación

- **Índice maestro completo:** [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md)
- **Arquitectura general y diagramas:** [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Motor 3D, especies y algoritmos geométricos:** [GENERATION_ENGINE.md](./GENERATION_ENGINE.md)
- **Modelos IA, Director Gemini y adaptador GPU:** [AI_MODELS.md](./AI_MODELS.md)
- **Pipeline Image-to-3D y perfil volumétrico:** [IMAGE_TO_3D.md](./IMAGE_TO_3D.md)
- **Pruebas, CI y benchmarks visuales:** [TESTING.md](./TESTING.md) y [benchmarks/benchmark_summary.md](./benchmarks/benchmark_summary.md)
- **Estado honesto por subsistema:** [SYSTEM_STATUS.md](./SYSTEM_STATUS.md)
- **Integración con Roblox Studio y Rojo:** [ROBLOX_INTEGRATION.md](./ROBLOX_INTEGRATION.md)
