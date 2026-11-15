# Integración con Modelos de IA y Motores 3D Externos — NIGHTMARE FORGE

Este documento detalla el papel real de los modelos de lenguaje/visión (Gemini) y la investigación, integración y estado honesto de modelos generativos 3D open-source dentro de **NIGHTMARE FORGE**.

---

## 1. Google Gemini AI (`aiGenerationDirector.ts` y `backend/main.py`)

- **SDK oficial utilizado**: `@google/genai` en TypeScript y `google-genai>=1.0.0` en Python (no se utiliza el SDK heredado `google-generativeai`).
- **Aislamiento de compilación (`forge-bridge`)**: `src/server/engines/aiGenerationDirector.ts` utiliza exclusivamente `import type { GoogleGenAI } from '@google/genai'` para evitar dependencias runtime innecesarias fuera del servidor principal (verificado por prueba automática `SECCIÓN 8`).
- **Tiers de modelos en Python (`backend/main.py`)**:
  - `MODEL_TIER_PRO`: `gemini-2.5-pro` (sistemas complejos, arquitectura, lógica multi-parte).
  - `MODEL_TIER_FAST`: `gemini-2.5-flash` (UI, iteraciones rápidas).
- **Rol en Generación 3D**:
  1. **Modo `procedural`**: Nunca invoca APIs externas; utiliza `parseNaturalLanguageToTreeParams` + `buildBaselineDirectorBlueprint` + motores geométricos locales.
  2. **Modo `ai_assisted` / `hybrid`**: Invoca `requestGeminiDirectorBlueprint()` pasando una instancia de `GoogleGenAI` y contexto podado (`contextPrunerEngine.ts`). Cuando Gemini produce `arbitrary_components` (>= 2 nodos con kernel, posición, tamaño, material, color y puntos spline opcionales), el motor universal los materializa directamente vía `planArbitraryAiComponentGraph()`.
  3. **Fallback Automático Transparente**: Si `GEMINI_API_KEY` no está configurada, si la cuota se agota o si el proveedor falla, `execution_report` registra explícitamente `provider_status: 'fallback' | 'mock_or_local'`, `fallback_triggered: true`, `fallback_reason` y conserva determinismo de semilla local.

---

## 2. Evaluación Técnica de Modelos 3D Open-Source (`external3DModelAdapter.ts`)

`EXTERNAL_3D_MODELS_COMPARISON_MATRIX` documenta cinco familias de reconstrucción/generación 3D open-source evaluadas por su compatibilidad con Roblox `EditableMesh`:

| Modelo | Organización | Licencia | Texto-a-3D | Imagen-a-3D | VRAM Mín. | Calidad Geom./Tex. | Notas Roblox `EditableMesh` |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Hunyuan3D-2.0** (`hunyuan3d_2`) | Tencent | Community License | Nativo | Nativo alta fidelidad | 16 GB | 9.4 / 9.3 | Mallas densas (50k–200k caras); exige decimación/partición a `<= 9,500` tris por `MeshPart`. |
| **TRELLIS** (`trellis`) | Microsoft Research | MIT | Nativo | Nativo alta fidelidad | 16 GB | 9.5 / 9.1 | Exporta mallas GLB texturizadas desde representación SLAT preservando cavidades y extremidades. |
| **Stable Fast 3D / SF3D** (`stable_fast_3d`) | Stability AI | Community License | Vía Image Bridge | Nativo rápido (~0.8s) | 6 GB | 8.4 / 8.8 | Inferencia sub-segundo con UVs nativos y mapas PBR (`Albedo/Roughness/Metalness/Normal`). |
| **TripoSR** (`triposr`) | Tripo AI / Stability AI | MIT | Vía Image Bridge | Nativo rápido (~0.5s) | 4 GB | 8.1 / 7.9 | Pesos ligeros (~1.5 GB); menor nitidez en detalles finos y requiere grounding en `Y=0`. |
| **Shap-E / OpenLRM** (`openlrm_shape`) | OpenAI / OpenLRM | MIT / Apache-2.0 | Difusión nativa | Limitado | 6 GB | 6.5 / 6.2 | SDF implícito con artefactos en extremidades delgadas; superado por TRELLIS/Hunyuan3D-2.0. |

---

## 3. Adaptador HTTP Real (`External3DModelAdapter`)

Implementado en `src/server/engines/external3DModelAdapter.ts`:
- Se activa únicamente cuando `FORGE_EXTERNAL_3D_ENDPOINT` apunta a un microservicio HTTP GPU accesible (`POST` con `prompt`, `model`, `image_base64`, `Authorization: Bearer ...` si existe `FORGE_EXTERNAL_3D_TOKEN`).
- Soporta respuestas `.obj` (`obj_text`) y mallas procesadas convirtiéndolas en partes normalizadas con grounding en `Y=0` y reporte de `executed_mode: 'external_3d_model'`.
- **Compromiso de honestidad**: Nunca simula que se ejecutó un modelo neuronal externo cuando no hay endpoint configurado; si no está disponible o cae la conexión (validado con servidor HTTP simulado real en `SECCIÓN 9D`), informa `fallback_triggered: true` y genera un modelo geométrico local completo.

---

## 4. Capacidades Verificadas Hoy vs Externas

| Capacidad | Estado Real |
| :--- | :--- |
| Orquestación local/híbrida TS + Fallback seguro sin API Key | Implementado y probado en suite automatizada |
| Director Gemini (`requestGeminiDirectorBlueprint`) con contexto podado | Implementado; llamadas reales al API remoto dependen de `GEMINI_API_KEY` y conectividad externa |
| Adaptador `External3DModelAdapter` con `.obj` Wavefront y fallback | Implementado y probado localmente con servidor HTTP mock real (`SECCIÓN 9D`) |
| Inferencia local en CPU de `Hunyuan3D-2.0` / `TRELLIS` / `SF3D` sin GPU CUDA | **No posible sin GPU dedicada autohospedada** (`FORGE_EXTERNAL_3D_ENDPOINT`) |
