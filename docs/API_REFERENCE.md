# Referencia Completa de la API (REST & SSE) — Forge AI Studio v2.3.0

Todos los endpoints están disponibles a través del **Gateway Unificado (`http://127.0.0.1:3000`)** y los equivalentes Python en **FastAPI (`http://127.0.0.1:8000`)**.

---

## Autenticación y Cabeceras de Seguridad (Fail-Closed en Producción)

- `Content-Type: application/json`
- `X-Forge-Token: <token>` — Validado en **tiempo constante** (`crypto.timingSafeEqual` / `hmac.compare_digest`) contra `FORGE_SECURITY_TOKEN` / `FORGE_LOCAL_TOKEN` / `FORGE_BRIDGE_SHARED_SECRET`.
- Cuando existe token configurado (u obligatoriamente cuando `NODE_ENV=production`, donde se rechazan secretos vacíos o de ejemplo), **todas las rutas protegidas de `/api/v1/*`** exigen `X-Forge-Token` válido (incluidas lecturas sensibles como `/api/v1/files`, `/api/v1/context` y `/api/v1/bridge/status`, además de escrituras `POST` y `DELETE`).
- En operaciones de handshake/resultado del Puente Local (`forge-bridge`), los payloads incluyen además firma **HMAC-SHA256** (`X-Forge-Signature`) y protección anti-replay por `nonce` + ventana de tiempo.

---

## 1. Arquitectura, Salud y Código Fuente

### `GET /api/v1/health`
Devuelve el estado de conexión con Gemini, los modelos configurados (`pro` y `fast`) y el diagnóstico rápido del proyecto Rojo.

### `GET /api/v1/architecture`
Devuelve el manifiesto de los **7 motores modulares**, el estado de la **Hoja de Ruta (P0–P3)** y las definiciones de los **7 Agentes Especializados**.

### `GET /api/v1/files`
Devuelve un diccionario `{ files: Record<string, string> }` con el código fuente de `main.py`, los 7 motores en `engines/*.py`, el plugin `ForgeAIStudioPlugin.server.luau`, `default.project.json` y la documentación del repositorio.

---

## 2. Motor 3D (`3D Generation Engine`) y `Asset Engine`

### `POST /api/v1/generate-3d` (JSON Síncrono)
### `POST /api/v1/generate-3d-stream` (Server-Sent Events `text/event-stream`)
Genera un modelo 3D multi-parte en Studs o un escenario 3D completo junto con su perfil PBR y su módulo constructor Luau `--!strict`.

**Body JSON:**
```json
{
  "prompt": "Torreta defensiva sci-fi modular con núcleo de plasma y doble cañón",
  "asset_type": "Model3D",
  "category": "Sci-Fi",
  "collision_fidelity": "Hull",
  "target_poly_budget": 3800,
  "reference_image_base64": null,
  "model_tier": "fast",
  "save_to_rojo": true,
  "save_to_library": true
}
```

### `GET /api/v1/assets`
Lista todos los modelos 3D y escenarios guardados en `rojo_workspace/assets_library.json`.

### `POST /api/v1/assets`
Guarda o actualiza un asset 3D en `assets_library.json`.

### `POST /api/v1/assets/rebuild-luau` (P2 · Editor Interactivo de Modelos 3D)
Recibe un objeto `Forge3DAsset` cuyas sub-partes (`parts`) fueron modificadas en el **Editor Interactivo 3D**, recompila automáticamente su código Luau `--!strict`, lo escribe en `ROJO_PROJECT_PATH` (`src/shared/Assets3D/`) y actualiza `assets_library.json`.

**Body JSON:**
```json
{
  "asset": {
    "id": "asset-plasma-turret",
    "name": "PlasmaTurretMK4",
    "collision_fidelity": "Hull",
    "rojo_target_folder": "src/shared/Assets3D",
    "file_name": "PlasmaTurretMK4.luau",
    "parts": [
      {
        "name": "ArmoredBase",
        "shape": "Cylinder",
        "size": [6.0, 1.2, 6.0],
        "position": [0.0, 0.6, 0.0],
        "rotation": [0.0, 0.0, 0.0],
        "color": [30, 41, 59],
        "material": "DiamondPlate",
        "roughness": 0.4,
        "metalness": 0.85,
        "transparency": 0.0,
        "canCollide": true,
        "anchored": true,
        "collisionFidelity": "Hull"
      }
    ]
  },
  "save_to_rojo": true,
  "save_to_library": true
}
```

### `DELETE /api/v1/assets/:id?confirm=true`
Elimina un asset 3D de la biblioteca persistente. Requiere confirmación explícita mediante query `?confirm=true` o cabecera `X-Forge-Confirm-Delete: true` (responde HTTP `400` si no se confirma).

### `POST /api/v1/assets/compare-datamodel` & `POST /api/v1/assets/studio-push`
Comparan el hash canónico / por piezas entre Studio y Forge, o reciben un push incremental desde el Plugin de Roblox Studio vía Bridge.

### `POST /api/v1/assets/publish-pbr`
Sube mapas PBR hacia Roblox Open Cloud cuando hay `ROBLOX_OPEN_CLOUD_API_KEY` configurada (`cloud_published` con `rbxassetid://` reales), o guarda localmente con estado `local_saved` sin inventar `rbxassetid://` falsos.

---

## 3. `World Engine` (P2 · Constructor de Escenarios e Iluminación)

### `POST /api/v1/world/build-scene`
Genera un módulo Luau `--!strict` que configura `Lighting`, `Atmosphere` y los anclajes espaciales en `Workspace` para una lista de assets 3D según el bioma elegido (`CyberpunkOrbital`, `MedievalForge`, `ArcticResearchBase`).

**Body JSON:**
```json
{
  "scene_name": "OrbitalCommandSector",
  "biome": "CyberpunkOrbital",
  "placed_assets": ["PlasmaTurretMK4", "CryoStasisChamber"],
  "save_to_rojo": true
}
```

---

## 4. `Specialized Agents Engine` (P3 · Orquestador Multi-Agente)

### `POST /api/v1/agents/orchestrate-stream` (SSE `text/event-stream`)
Ejecuta en secuencia los **7 agentes especializados** (`architect_agent` → `modeler_3d_agent` → `asset_pbr_agent` → `world_builder_agent` → `luau_scripter_agent` → `ui_hud_agent` → `rojo_sync_agent`) emitiendo eventos SSE `agent_step` y `done`, y escribiendo todos los archivos resultantes en el proyecto Rojo.

**Body JSON:**
```json
{
  "mission_prompt": "Sistema completo de Torreta Defensiva de Plasma con HUD táctico y escenario orbital",
  "biome": "CyberpunkOrbital",
  "save_to_rojo": true
}
```

---

## 5. `Luau Engine` y `UI Engine`

### `POST /api/v1/generate-script` & `POST /api/v1/generate-script-stream`
Genera scripts Luau `--!strict` (`Server`, `Client`, `Module`) con `task.*` y `Maid`, guardándolos automáticamente en `src/server`, `src/client` o `src/shared`.

### `POST /api/v1/generate-ui` & `POST /api/v1/generate-ui-stream`
Genera módulos `ScreenGui` responsive (`UDim2.fromScale`) con soporte para `ViewportFrame` 3D, `TweenService` y árbol jerárquico `ui_tree`, guardándolos en `src/client/UI`.

---

## 6. `Rojo Bridge` y Auditoría de Contexto

### `GET /api/v1/rojo/status`
Devuelve el estado completo del proyecto Rojo: existencia de `default.project.json`, detección del binario `rojo`, estado del puerto `34872` y conteo de archivos `.luau` sincronizados.

### `POST /api/v1/rojo/configure`
Permite cambiar en caliente `ROJO_PROJECT_PATH` a cualquier carpeta local, crear la estructura de directorios Rojo 7.x e inicializar `default.project.json`.

### `GET /api/v1/rojo/sync-manifest`
Devuelve el manifiesto completo de archivos `.luau` en disco con su tamaño en bytes, ruta en el `DataModel` de Roblox y hash **SHA-256** para verificación desde el plugin de Roblox Studio.

### `GET /api/v1/context` & `POST /api/v1/context`
Lee o actualiza el archivo `backend/project_context.md`.

### `GET /api/v1/context/audit` & `POST /api/v1/context/bootstrap-modules`
Audita físicamente en disco si los módulos referenciados en `project_context.md` (`Maid.luau`, `RemoteProvider.luau`, `GameTypes.luau`) existen dentro de `ROJO_PROJECT_PATH/src/shared/` y permite instalarlos con 1 clic si faltan.

---

## 7. `Forge Local Bridge` & Coordinador Cloud-Local

### `POST /api/v1/bridge/handshake` & `POST /api/v1/bridge/heartbeat`
Establece sesión firmada HMAC-SHA256 con protección anti-replay por `nonce` y reporta el estado consolidado del proyecto Rojo local y Roblox Studio.

### `GET /api/v1/bridge/status`
Devuelve el estado de sesión del puente, estado de Roblox Studio, estado de Rojo y métricas de cola.

### `POST /api/v1/bridge/enqueue` & `POST /api/v1/bridge/task-result`
Encola tareas tipadas para el Puente Local / Plugin (`studio.reconstruct_model`, `studio.apply_modifications`, `studio.get_selection`, `rojo.write_package`, etc.) y procesa resultados firmados con validación HMAC-SHA256.
