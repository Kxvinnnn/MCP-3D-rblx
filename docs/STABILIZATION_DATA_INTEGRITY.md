# Especificación de Estabilización, Integridad de Datos y Arquitectura Modular — NIGHTMARE FORGE / Forge AI Studio v2.3.0

Este documento sirve como la especificación técnica completa y registro de cambios (*changelog*) de las mejoras de **estabilización, integridad de datos, hashing canónico, persistencia atómica y sincronización bidireccional** aplicadas a **Forge AI Studio**.

---

## 1. Resumen de Objetivos Resueltos

| Categoría | Problema Anterior | Solución Integrada | Módulo Principal |
| :--- | :--- | :--- | :--- |
| **Protección de Cambios Pendientes** | `setActiveAsset(null)` o cambiar a otra versión del mismo recurso omitía la verificación de cambios no guardados. | Se implementaron guardias estrictos en `setActiveAsset()` que interceptan cualquier transición a `null` o versión modificada cuando `pendingChanges = true`, solicitando confirmación modal. | `src/context/ForgeContext.tsx` |
| **Triangulación Geométrica 3D** | Mallas de >3 vértices usaban la fórmula simplista `(N - 2)` o umbrales absolutos rígidos. | Se implementó Ear Clipping 3D con proyección normal de Newell en 2D y umbrales relativos a la escala del bounding-box del polígono. | `src/utils/robloxGeometryValidator.ts` |
| **Validación de Geometría Roblox** | No se validaba `baseMeshData`, se permitían recursos vacíos sin fallo ni se detectaban valores `NaN`/`Infinity`. | Se incorporó validación equivalente para `meshData` y `baseMeshData`, rechazo estricto de modelos sin piezas y detección de `hasMalformedFaces`, `hasDegenerateFaces` y `hasNonFiniteCoordinates`. | `src/utils/robloxGeometryValidator.ts` |
| **Recuperación Segura de Borradores** | `recoverDraft()` cargaba borradores locales sin validar si la versión guardada en el servidor cambió previamente. | Se añadió la verificación `baseHash` contra el hash de la versión guardada actual. Si difieren, se activa un estado de conflicto explícito (`activeConflict`). | `src/context/ForgeContext.tsx` |
| **Persistencia de Conflictos** | `resolveConflict('keep_local')` cerraba el conflicto en memoria sin garantizar el envío al servidor. | `resolveConflict('keep_local')` ejecuta la persistencia mediante `/api/v1/assets/rebuild-luau` y solo cierra el conflicto tras verificar la respuesta. | `src/context/ForgeContext.tsx` |
| **Sincronización Incremental** | Piezas sin `partId` colisionaban por nombre, y la eliminación de piezas no activaba banderas de cambio. | `buildCollisionSafePartMap()` evita colisiones asignando claves de jerarquía compuestas, y las piezas eliminadas activan banderas globales de cambio. | `src/utils/incrementalSync.ts` |
| **Verificación de Guardado y Recibos** | `saveAssetToDisk()` y `pushToStudio()` limpiaban `pendingChanges` antes de confirmar ejecución o aceptaban recibos parciales. | `verifyPersistedAssetContent()` y `evaluateStudioReconstructionReceipt()` validan contenido y recibos; `pushToStudio()` mantiene `pendingChanges = true` hasta confirmación real verificada. | `src/context/ForgeContext.tsx` & `src/utils/receiptVerification.ts` |
| **Persistencia Atómica del Bridge y Biblioteca** | Escrituras directas podían corromper JSON ante fallos de disco o reinicios de proceso. | Escritura atómica vía `.tmp` + `fsync` + `rename`, preservación `.corrupt.<ts>.bak` y recuperación de `awaiting_studio_confirmation` tras reinicio OS del Bridge. | `forge-bridge/src/taskStateStore.ts`, `src/server/engines/assetEngine.ts`, `backend/engines/asset_engine.py` |
| **Hashing Canónico SHA-256** | Errores con pares sustitutos UTF-16, emojis y colisiones en `Set`/`Map` con claves mixtas. | Implementación NIST FIPS 180-4 en `sha256Hex` con `TextEncoder` y normalización determinista en `toCanonicalJsonValue`. | `src/utils/canonicalHash.ts` |
| **CI / Workflows** | `npm ci || npm install` permitía instalaciones no deterministas en la canalización de CI. | Se fijó `npm ci` estricto en `.github/workflows/ci.yml` junto a lockfiles sincronizados (`v2.3.0`). | `.github/workflows/ci.yml` |

---

## 2. Detalles Técnicos por Módulo

### 2.1 Hashing Canónico SHA-256 (`src/utils/canonicalHash.ts`)

```typescript
// Firma de funciones principales
export function sha256Hex(str: string): string;
export function toCanonicalJsonValue(val: any, isRootPartsArray?: boolean, isRootObject?: boolean, seen?: WeakSet<object>): string;
export function computeCanonicalAssetHash(asset: Forge3DAsset | null): string;
export function computeGeometryHash(asset: Forge3DAsset | null): string;
export function computeAppearanceHash(asset: Forge3DAsset | null): string;
export function computePropertiesHash(asset: Forge3DAsset | null): string;
```

#### Reglas de Normalización Canónica:
1. **UTF-8 Byte Arrays**: Cadenas de texto se convierten a arreglos de bytes UTF-8 vía `TextEncoder`, garantizando que la longitud introducida en el padding de 512 bits sea exacta independientemente de caracteres especiales en español (`ñ`, `tildes`) o emojis (`🤖`, `🎮`).
2. **Exclusión de Metadatos Volátiles**: Las claves `created_at`, `updated_at`, `version`, `version_history`, `exported_package_files`, `verified_package_files`, `saved_path` y `obj_saved_path` se excluyen únicamente en la raíz del recurso, previniendo falsos positivos de modificación tras respuestas de servidor.
3. **Serialización Unívoca de Colecciones**:
   - `Set`: Los elementos se serializan canónicamente y se ordenan de forma lexicográfica estricta con `strictOrdinalCompare`.
   - `Map`: Cuando contiene claves no string, serializa arreglos `[[canonicalKey, canonicalValue], ...]`, preservando el tipo de la clave (impidiendo la colisión entre el entero `1` y el string `"1"`).
   - `ArrayBuffer`: Serializa arreglos de enteros `Uint8Array` con el contenido real de los bytes.

---

### 2.2 Validación Geométrica 3D y Triangulación (`src/utils/robloxGeometryValidator.ts`)

```typescript
export interface RobloxGeometryValidationReport {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  totalParts: number;
  totalVertices: number;
  totalTriangles: number;
  hasEditableMeshLimitsExceeded: boolean;
  hasScaleLimitsExceeded: boolean;
  hasInvalidIndices: boolean;
  hasNonFiniteCoordinates: boolean;
  hasMalformedFaces: boolean;
  hasDegenerateFaces: boolean;
  hasIncompleteGeometry: boolean;
}

export function triangulatePolygonFace3D(face: number[], vertices: number[][]): FaceTriangulationResult;
export function countValidTrianglesInFace(face: number[], vertices: number[][]): number;
export function validateRobloxGeometry(asset: Forge3DAsset | null): RobloxGeometryValidationReport;
```

#### Algoritmo de Triangulación Ear Clipping 3D:
1. **Verificación de Índices y Limpieza**: Filtra vértices duplicados consecutivos y valida que cada índice pertenezca al rango `0 <= index < vertices.length`.
2. **Vector Normal de Newell**: Para polígonos de más de 3 vértices, calcula el vector normal de la superficie 3D con tolerancia relativa a la extensión máxima del polígono.
3. **Proyección 2D**: Identifica el componente dominante de la normal (eje X, Y o Z) y proyecta el polígono sobre ese plano bidimensional.
4. **Corte de Orejas (Ear Clipping)**: Detecta vértices conexos cuyo ángulo sea convexo en el sentido de devanado (`CCW` o `CW`) y cuyos triángulos resultantes no contengan ningún otro vértice del polígono.
5. **Comprobación Geométrica 3D**: Verifica que la superficie 3D del triángulo supere el umbral relativo de escala, descartando caras degeneradas de área nula sin penalizar modelos miniatura válidos.

---

### 2.3 Sincronización Incremental y Prevención de Colisiones (`src/utils/incrementalSync.ts`)

```typescript
export function computeIncrementalDiff(
  baseAsset: Forge3DAsset | null,
  updatedAsset: Forge3DAsset
): IncrementalDiffReport;
```

- **Unicidad de `partId`**: Si dos piezas dentro del mismo modelo comparten un `partId` explícito no vacío, `buildCollisionSafePartMap()` lanza una excepción `Error`, obligando a mantener la integridad de identidad.
- **Desambiguación de Piezas sin ID**: Asigna la clave `fallback::parentId::hierarchyPath::name#occurrence` y emite una advertencia.
- **Banderas de Cambio**: Piezas eliminadas (`removed`) o añadidas (`added`) marcan `hasGeometryChanges`, `hasAppearanceChanges`, `hasPropertiesChanges` y `hasHierarchyChanges` como `true`.

---

### 2.4 Estado de Sincronización y Modales en React (`src/context/ForgeContext.tsx`)

#### Flujo de Navegación y Cierre Seguro:
```
[Invocación a setActiveAsset(target)]
       │
       ├── ¿force === true? ───────────────► Aplica activo directamente
       │
       └── ¿pendingChanges === true?
              │
              ├── target === null ─────────► pendingSwitchToNullRef = true
              │                              showUnsavedModal = true
              │
              ├── target con distinta ─────► setPendingSwitchTarget(target)
              │   identidad o contenido      showUnsavedModal = true
              │
              └── target idéntico ─────────► Mantiene estado y cambios
```

#### Flujo de Confirmación al Descartar (`confirmSwitchDiscard`):
- Restaura el modelo en memoria exactamente al snapshot persistido en `savedAssetSnapshotRef.current`.
- Restablece `pendingChanges = false`, vacía el borrador local `forge_active_draft` y ejecuta la transición pendiente (navegación de pestaña o apertura de nuevo recurso).

---

## 3. Cobertura de Pruebas Automatizadas (`v2.3.0`)

El repositorio cuenta con suites completas verificables mediante `npm test`, `npm --prefix forge-bridge test` y `python3 tests/test_e2e_bidirectional_sync.py`:

1. `tests/canonicalHash.test.ts`: Vectores NIST SHA-256, Unicode/emojis, ordenación canónica, exclusión de claves en raíz, sensibilidad de `baseMeshData`, sub-hashes granulares y colisiones `Map`/`Set`.
2. `tests/forgeContext.test.ts`: Ejecución real de React `ForgeProvider`, `undo`/`redo`, `confirmSwitchDiscard`, guardias `setActiveAsset`, verificación `baseHash` en `recoverDraft`, resolución de conflictos y `pushToStudio` con recibos verificados.
3. `tests/robloxGeometryValidator.test.ts`: Triangulación Ear Clipping 3D en polígonos cóncavos, tolerancias relativas, `baseMeshData`, límites de escala, coordenadas no finitas y caras degeneradas.
4. `tests/incrementalSync.test.ts` & `tests/sseParser.test.ts`: Detección de duplicados `partId`, parsing SSE LF/CRLF y fragmentación.
5. `tests/nightmareForgeE2EAndSecurity.test.ts`: Motor 1 Procedural (8 categorías, 14 params árbol, LODs cerrados), fail-closed auth, anti-replay HMAC, confirmación destructiva, PBR `local_saved`, pipeline HTTP completo de reconstrucción y preservación ante fallos de escritura en biblioteca.
6. `forge-bridge/tests/bridge.test.ts`: Cola local persistente, HMAC, anti-replay, manejo de JSON corrupto y **reinicio real OS de proceso hijo (`SIGTERM`)** manteniendo confirmaciones pendientes.
7. `tests/test_e2e_bidirectional_sync.py`: Paridad de hashes FNV32 + sincronización bidireccional Python ↔ Studio y atomicidad de `asset_engine.py`.

---

## 4. Comprobación de Calidad del Código

- **Compilador TypeScript**: `npm run lint` (`tsc --noEmit`) y `npm --prefix forge-bridge run typecheck` — 0 errores.
- **Suite de Pruebas Node.js + Bridge**: `npm test` (61/61 tests pasando) y `npm --prefix forge-bridge test` (8/8 tests pasando).
- **Suite Python E2E**: `python3 tests/test_e2e_bidirectional_sync.py` — pasando.
- **Build de Producción**: `npm --prefix forge-bridge run build` y `npm run build` — exitosos.
