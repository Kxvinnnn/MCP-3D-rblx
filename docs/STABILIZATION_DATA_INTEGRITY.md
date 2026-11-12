# Especificación de Estabilización, Integridad de Datos y Arquitectura Modular — Forge AI Studio v2.2

Este documento sirve como la especificación técnica completa y registro de cambios (*changelog*) de las mejoras de **estabilización, integridad de datos, hashing canónico y sincronización bidireccional** aplicadas a **Forge AI Studio**.

---

## 1. Resumen de Objetivos Resueltos

| Categoría | Problema Anterior | Solución Integrada | Módulo Principal |
| :--- | :--- | :--- | :--- |
| **Protección de Cambios Pendientes** | `setActiveAsset(null)` o cambiar a otra versión del mismo recurso omitía la verificación de cambios no guardados. | Se implementaron guardias estrictos en `setActiveAsset()` que interceptan cualquier transición a `null` o versión modificada cuando `pendingChanges = true`, solicitando confirmación modal. | `src/context/ForgeContext.tsx` |
| **Triangulación Geométrica 3D** | Mallas de >3 vértices usaban la fórmula simplista `(N - 2)` sin verificar convexidad, concavidad ni validez de áreas. | Se implementó Ear Clipping 3D con proyección normal de Newell en 2D y verificación de área 3D real (`computeTriangleArea3D > 1e-7`). | `src/utils/robloxGeometryValidator.ts` |
| **Validación de Geometría Roblox** | No se detectaban caras malformadas (`< 3` vértices), polígonos degenerados, ni valores `NaN`/`Infinity` en matrices de rotación. | Se incorporó el reporte unificado `RobloxGeometryValidationReport` con banderas `hasMalformedFaces`, `hasDegenerateFaces`, `hasIncompleteGeometry` y `hasNonFiniteCoordinates`. | `src/utils/robloxGeometryValidator.ts` |
| **Recuperación Segura de Borradores** | `recoverDraft()` cargaba borradores locales sin validar si la versión guardada en el servidor cambió previamente. | Se añadió la verificación `baseHash` contra el hash de la versión guardada actual. Si difieren, se activa un estado de conflicto explícito (`activeConflict`). | `src/context/ForgeContext.tsx` |
| **Persistencia de Conflictos** | `resolveConflict('keep_local')` cerraba el conflicto en memoria sin garantizar el envío al servidor. | `resolveConflict('keep_local')` ejecuta la persistencia mediante `/api/v1/assets/rebuild-luau` y solo cierra el conflicto tras verificar la respuesta. | `src/context/ForgeContext.tsx` |
| **Sincronización Incremental** | Piezas sin `partId` colisionaban por nombre, y la eliminación de piezas no activaba banderas de cambio. | `buildCollisionSafePartMap()` evita colisiones asignando claves de jerarquía compuestas, y las piezas eliminadas activan banderas globales de cambio. | `src/utils/incrementalSync.ts` |
| **Verificación de Guardado y Sincronización** | `saveAssetToDisk()` y `pushToStudio()` limpiaban `pendingChanges` antes de confirmar que el servidor/Studio completaron la operación. | `verifyPersistedAssetContent()` valida el contenido devuelto. `pushToStudio()` mantiene `pendingChanges = true` mientras la solicitud esté en cola en el puente. | `src/context/ForgeContext.tsx` |
| **Hashing Canónico SHA-256** | Errores con pares sustitutos UTF-16, emojis y colisiones en `Set`/`Map` con claves mixtas. | Implementación NIST FIPS 180-4 en `sha256Hex` con `TextEncoder` y normalización determinista en `toCanonicalJsonValue`. | `src/utils/canonicalHash.ts` |
| **CI / Workflows** | `npm ci || npm install` permitía instalaciones no deterministas en la canalización de CI. | Se fijó la instalación estricta con `npm ci` en `.github/workflows/ci.yml`. | `.github/workflows/ci.yml` |

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
2. **Vector Normal de Newell**: Para polígonos de más de 3 vértices, calcula el vector normal de la superficie 3D. Si la magnitud es menor a `1e-8`, rechaza la cara como colineal o degenerada.
3. **Proyección 2D**: Identifica el componente dominante de la normal (eje X, Y o Z) y proyecta el polígono sobre ese plano bidimensional.
4. **Corte de Orejas (Ear Clipping)**: Detecta vértices conexos cuyo ángulo sea convexo en el sentido de devanado (`CCW` o `CW`) y cuyos triángulos resultantes no contengan ningún otro vértice del polígono.
5. **Comprobación Geométrica 3D**: Verifica que la superficie 3D del triángulo (`computeTriangleArea3D`) sea mayor a `1e-7`, descartando caras degeneradas de área nula.

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

## 3. Cobertura de Pruebas Automatizadas

Se dispone de 36 pruebas unitarias e integrales que se ejecutan mediante `npm test`:

1. `tests/canonicalHash.test.ts`: 11 pruebas (vectores NIST SHA-256, Unicode/emojis, ordenación canónica, exclusión de claves en raíz, sensibilidad de `baseMeshData`, sub-hashes granulares, tipos no serializables y colisiones `Map`/`Set`).
2. `tests/forgeContext.test.ts`: 8 pruebas (ejecución real de React `ForgeProvider`, `undo`/`redo`, `confirmSwitchDiscard`, guardias `setActiveAsset`, verificación `baseHash` en `recoverDraft`, resolución de conflictos y `pushToStudio` en cola).
3. `tests/robloxGeometryValidator.test.ts`: 6 pruebas (triangulación Ear Clipping 3D en polígonos cóncavos, límites de escala, coordenadas no finitas, caras malformadas y caras degeneradas).
4. `tests/sseParser.test.ts`: 7 pruebas (parsing SSE con terminadores LF/CRLF y fragmentación).

---

## 4. Comprobación de Calidad del Código

- **Compilador TypeScript**: `npx tsc --noEmit` — 0 errores.
- **Suite de Pruebas Node.js**: `npm test` — 36/36 tests pasados.
- **Build de Producción**: `npm run build` — Exitoso.
