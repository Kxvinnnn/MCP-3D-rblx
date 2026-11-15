# Integración con Roblox Studio, EditableMesh y Rojo 7.x — NIGHTMARE FORGE

Esta guía documenta los contratos reales entre los motores de generación 3D de **NIGHTMARE FORGE**, el formato de exportación compatible con Roblox, el servicio **Forge Local Bridge**, **Rojo 7.x** y el plugin nativo `backend/roblox_plugin/ForgeAIStudioPlugin.server.luau`.

---

## 1. Reconstrucción Geométrica `EditableMesh` y Límites de Roblox

Roblox Studio requiere mallas triangulares finitas y seguras para `AssetService:CreateEditableMesh()` y `AssetService:CreateMeshPartAsync()`:
- **Límite por parte**: cada `MeshPart` normalizada mantiene `<= 9,000` vértices y `<= 9,500` caras (el particionador inteligente divide mallas mayores y aplica el tope duro de `20,000` vértices/caras).
- **Sistema de coordenadas**: eje vertical `+Y`, longitud antero-posterior `Z`, simetría bilateral en `X=0`, con apoyo garantizado en `minY = 0` (`groundAndNormalizeParts`).
- **Triangulación y Validación (`src/utils/robloxGeometryValidator.ts`)**: proyección al plano dominante usando normal de Newell y triangulación Ear Clipping real para polígonos de > 3 vértices (rechazando caras degeneradas de área cero, índices fuera de rango y valores no finitos tanto en `meshData` como en `baseMeshData`).
- **Luau `--!strict` (`buildStrictLuauFromEditedParts`)**: todo código Luau generado inicia con `--!strict`, nunca asigna la propiedad de solo lectura `MeshPart.MeshId`, destruye instancias huérfanas si falla una operación y valida `#editableMesh:GetVertices()` y `#editableMesh:GetTriangles()`.

---

## 2. Paridad Canónica de Color RGB (TypeScript ↔ Luau ↔ Python)

Resuelto e integrado con pruebas de paridad (`tests/rgbColorParity.test.ts` y `resolveRgbTupleLuau` en `ForgeAIStudioPlugin.server.luau`):
- Se aceptan entradas `[1,0,0]`, `[0,1,0]`, `[0,0,1]`, `[1,1,1]`, `[0,0,0]`, `[0.5,0.25,0.75]`, `[255,255,255]` y `#RRGGBB`.
- La conversión canónica a RGB de 8 bits `[0..255]` y `Color3.fromRGB(r, g, b)` está alineada entre TypeScript (`src/utils/colorUtils.ts`), Python y Luau, diferenciando valores normalizados `[0..1]` con fracción decimal de tuplas enteras de 8 bits.

---

## 3. Sincronización Bidireccional Zero-Inbound (`forge-bridge` + Rojo 7.x)

1. **Mapeo Rojo (`rojo_workspace/default.project.json`, puerto `34872`)**:
   - `src/server/` → `ServerScriptService.Server`
   - `src/client/` → `StarterPlayer.StarterPlayerScripts.Client`
   - `src/client/UI/` → `StarterGui.Interface`
   - `src/shared/` → `ReplicatedStorage.Shared`
   - `src/shared/Assets3D/` → `ReplicatedStorage.Shared.Assets3D`
2. **Puente Local Loopback (`forge-bridge`, `127.0.0.1:48720`)**:
   - Mantiene comunicación saliente autenticada HMAC-SHA256 contra `CloudBridgeCoordinator`.
   - Expone endpoints locales autenticados con `X-Plugin-Token` / `X-Forge-Token` para el plugin de Studio.
   - Persiste colas y estados de confirmación destructiva mediante escritura atómica (`.tmp` + `fsync` + `rename`).
3. **Plugin de Roblox Studio (`backend/roblox_plugin/ForgeAIStudioPlugin.server.luau`)**:
   - Soporta `studio.reconstruct_model`, `studio.apply_modifications` (actualización incremental preservando scripts/welds), `studio.get_selection` y `studio.serialize_parts`.
   - **Cola de Confirmación Destructiva**: nunca borra piezas en Studio automáticamente; exige clic manual de confirmación en el DockWidget.
   - **Verificación de Recibos (`receiptVerification.ts`)**: calcula 5 hashes FNV-1a 32-bit (`geometryHash`, `materialHash`, `transformHash`, `hierarchyHash`, `combinedHash`) y reconcilia recibos en `ForgeContext.tsx` antes de limpiar `pendingChanges`.

---

## 4. Texturas PBR y Roblox Open Cloud

- Los modelos generan perfiles PBR honestos (`roughness`, `metalness`, mapa estructural `ColorMap`/`NormalMap`/`RoughnessMap`/`MetalnessMap` en datos locales y `SurfaceAppearance` en Luau cuando corresponde).
- Mientras no exista publicación verificada con `ROBLOX_OPEN_CLOUD_API_KEY`, los assets locales mantienen **`robloxAssetId: null`** y `forgeAssetId` + `contentHash` locales sin fabricar jamás `rbxassetid://` ficticios.
- *(Nota de verificación)*: El código del plugin Luau (`--!strict`, handlers, paridad RGB) y el ciclo Bridge ↔ Rojo ↔ Mock Studio se verifican automáticamente en CI y tests locales; la inspección visual interactiva final dentro de Roblox Studio Desktop requiere ejecución manual en Windows.
