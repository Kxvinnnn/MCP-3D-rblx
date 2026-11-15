# Guía de Desarrollo y Convenciones — NIGHTMARE FORGE

Esta guía define los estándares de ingeniería, reglas de arquitectura y flujo de trabajo de desarrollo para contribuir en **NIGHTMARE FORGE / Forge AI Studio**.

---

## 1. Estándares de Código y Diseño Modular

1. **Paridad y Separación de Motores**:
   - La lógica de dominio reside en `src/server/engines/` (TypeScript) y su contraparte `backend/engines/` (Python) sin mezclar lógica de negocio dentro de los componentes React (`src/components/`).
   - Ningún módulo dentro de `forge-bridge/` puede importar SDKs pesados de IA del servidor como `@google/genai` en tiempo de ejecución; si `aiGenerationDirector.ts` referencia tipos de `@google/genai`, debe usar exclusivamente `import type`.
2. **Hashing Canónico y Determinismo (`src/utils/canonicalHash.ts`)**:
   - Cualquier campo temporal o de telemetría de ejecución agregado en la raíz de respuesta (`created_at`, `updated_at`, `latency_ms`, `execution_report`, `version`, `saved_path`, etc.) debe permanecer en `ROOT_EXCLUDED_CANONICAL_KEYS` para no romper la reproducibilidad de `computeCanonicalAssetHash()` entre dos llamadas con idéntica semilla.
   - Claves anidadas dentro de sub-estructuras sí forman parte del hash canónico.
3. **Resolución y Trazabilidad de Parámetros**:
   - Respetar estrictamente la precedencia `manual_ui > preset > prompt_nlp > ai_director > image_reference > default`.
   - Toda inferencia NLP debe registrar su origen en `parameter_provenance` y jamás dejar que valores UI iniciales sin editar (`14 studs`, verde por defecto, semillas placeholder como `'forge-tree-2026'`) pisen instrucciones explícitas del usuario.
4. **Generalización 3D Sin Plantillas Rígidas**:
   - No añadir respuestas simuladas de fallback hacia `chest_or_prop` para objetos arbitrarios. Nuevas categorías semánticas deben expresarse vía componentes parametrizables (`interpretPromptSemantics` → `planGeometryAndComponents` → kernels en `generateReal3DMeshesFromPlan`).
5. **Regex Unicode en Español/Inglés**:
   - En JavaScript/TypeScript, evitar `\b` inmediatamente antes o después de caracteres acentuados (`á`, `é`, `í`, `ó`, `ú`, `ñ`), ya que `\b` solo evalúa límites ASCII (`[A-Za-z0-9_]`) y falla silenciosamente con palabras como `árbol`, `pájaro` o `automóvil`. Usar delimitadores explícitos `(?:^|[\s,;:.!?¿¡(])...(?=$|[\s,;:.!?¿¡)])`.

---

## 2. Comandos Frecuentes de Desarrollo

```powershell
# TypeScript typecheck (raíz)
node node_modules/typescript/bin/tsc --noEmit

# Vite build de producción
node node_modules/vite/bin/vite.js build

# Suite completa de pruebas (raíz + bridge)
npm.cmd test

# Pruebas aisladas de forge-bridge
Push-Location forge-bridge; node --import ./node_modules/tsx/dist/loader.mjs --test tests/bridge.test.ts; Pop-Location

# Validación Python y compilación bytecode
python -m py_compile backend/main.py backend/engines/*.py tests/test_e2e_bidirectional_sync.py
python tests/test_e2e_bidirectional_sync.py
```

---

## 3. Pipeline de Integración Continua (`.github/workflows/ci.yml`)

La canalización de CI ejecuta 5 jobs obligatorios sobre `main`, `master`, ramas `stabilize/**` y pull requests:
1. **`project-frontend-and-server`**: `npm ci`, `npm run lint` (`tsc --noEmit`), `node --import tsx --test tests/*.test.ts` y `npm run build`.
2. **`forge-bridge`**: `npm --prefix forge-bridge ci`, `typecheck`, `build` y `test`.
3. **`python-backend`**: compilación `py_compile` y pruebas `python tests/test_e2e_bidirectional_sync.py`.
4. **`roblox-plugin-checks`**: verifica cabecera `--!strict`, handlers requeridos (`studio.reconstruct_model`, `studio.apply_modifications`, `runForgePluginSelfVerification`) y contratos de geometría/triangulación/hash.
5. **`integration-e2e`**: combina dependencias raíz + puente y ejecuta `npm test` completo.

---

## 4. Convención de Edición Segura y Preservación

- Antes de modificar `CreateWizardView.tsx` o módulos que envuelven UI, validar con `vite build` que ningún módulo del servidor que use `node:fs` o `crypto` de Node quede importado desde componentes de cliente React.
- No relajar ni desactivar pruebas existentes para hacer pasar un cambio; mantener compatibilidad con contratos heredados (`AncientOakTree` / `CypressMilestoneTree` de 13 partes cuando no se pasa `targetPolyBudget`, y `SteppedStoneFoundation` en arquitectura).
