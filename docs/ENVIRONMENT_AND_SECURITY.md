# Entorno, Variables de Configuración y Seguridad — NIGHTMARE FORGE

Este documento detalla todas las variables de entorno, mecanismos criptográficos y límites de seguridad implementados en el repositorio. Ningún secreto real ni clave privada debe almacenarse jamás en código fuente, pruebas ni documentación.

---

## 1. Inventario de Variables de Entorno por Runtime

### 1.1 Gateway Unificado y Motores TypeScript (`server.ts`, `.env.example`)

| Variable | Obligatoria | Valor por Defecto | Propósito y Comportamiento |
| :--- | :---: | :--- | :--- |
| `GEMINI_API_KEY` | Opcional | *(Vacío)* | Habilita llamadas reales al API de Google Gemini (`@google/genai`). Sin clave, la generación cae de forma explícita al motor procedural/heurístico local. |
| `APP_URL` / `SHARED_APP_URL` | Opcional | `""` | Orígenes públicos permitidos en la política CORS del servidor Express y puente local. |
| `FORGE_ALLOWED_ORIGINS` | Opcional | `""` | Lista separada por comas de orígenes CORS adicionales permitidos (en conjunto con loopback `127.0.0.1` / `localhost`). |
| `FORGE_SECURITY_TOKEN` | Sí en prod | `""` | Token principal exigido en cabecera `X-Forge-Token` para endpoints `/api/v1/*`. Validado con `crypto.timingSafeEqual`. |
| `FORGE_LOCAL_TOKEN` | Opcional | `""` | Alias de token local compartido cuando no se define `FORGE_SECURITY_TOKEN`. |
| `FORGE_BRIDGE_SHARED_SECRET` | Sí en prod | *(Deriva o vacío)* | Secreto compartido para firmar sobres HMAC-SHA256 entre `CloudBridgeCoordinator` y `forge-bridge`. |
| `NODE_ENV` / `FORGE_ENV` | Recomendada | `development` | Si es `production`, activa modo *fail-closed*: rechaza el arranque si faltan secretos reales o coinciden con `KNOWN_PLACEHOLDER_SECRETS`. |
| `ROJO_PROJECT_PATH` | No | `./rojo_workspace` | Directorio raíz administrado por Rojo sobre el cual opera la whitelist de escritura de archivos. |
| `ROBLOX_OPEN_CLOUD_API_KEY` | Opcional | `""` | Clave API de Roblox Open Cloud para publicar texturas PBR (`Decal`) y recibir `rbxassetid://` reales. |
| `ROBLOX_CREATOR_ID` / `ROBLOX_CREATOR_USER_ID` | Opcional | `""` | Identificador de creador/usuario de Roblox para las publicaciones en Open Cloud. |
| `RATE_LIMIT_PER_MINUTE` | No | `120` | Límite de peticiones por minuto por IP en el servidor principal. |
| `FASTAPI_UPSTREAM_URL` | No | `http://127.0.0.1:8000` | URL del backend Python FastAPI cuando se usa proxy/paridad desde el gateway. |
| `FORGE_EXTERNAL_3D_ENDPOINT` | Opcional | `""` | Endpoint HTTP de un servidor GPU autohospedado (`TRELLIS`, `Hunyuan3D-2.0`, `SF3D`, `TripoSR`). |
| `FORGE_EXTERNAL_3D_MODEL` | No | `trellis` | Modelo preferido enviado al adaptador externo (`trellis`, `hunyuan3d_2`, `stable_fast_3d`, `triposr`). |
| `FORGE_EXTERNAL_3D_TOKEN` | Opcional | `""` | Token Bearer enviado en cabecera `Authorization: Bearer ...` al servidor GPU externo si se configura. |
| `DISABLE_HMR` | No | *(unset)* | Configura HMR/watch de Vite (`vite.config.ts`). |

### 1.2 Puente Local Zero-Inbound (`forge-bridge/.env.example`, `forge-bridge/src/server.ts`)

| Variable | Obligatoria | Valor por Defecto | Propósito |
| :--- | :---: | :--- | :--- |
| `FORGE_CLOUD_URL` | Sí | `http://127.0.0.1:3000` | URL saliente hacia el Gateway Cloud de Forge AI Studio. |
| `FORGE_BRIDGE_SHARED_SECRET` | Sí | *(Sin defecto)* | Secreto compartido para validar sobres HMAC-SHA256 con el coordinador cloud. |
| `FORGE_PLUGIN_LOCAL_TOKEN` | Sí | *(Sin defecto)* | Token obligatorio exigido en `X-Plugin-Token` o `X-Forge-Token` al Plugin de Roblox Studio. |
| `ROJO_PROJECT_PATH` | Sí | `../` | Ruta física local Windows al proyecto Rojo (nunca se envía a la nube). |
| `BRIDGE_HOST` | No | `127.0.0.1` | Vinculación exclusiva a interfaz loopback. |
| `BRIDGE_PORT` | No | `48720` | Puerto local de escucha HTTP del puente. |
| `ROJO_PORT` | No | `34872` | Puerto donde corre `rojo serve`. |
| `BRIDGE_HEARTBEAT_INTERVAL_MS` | No | `2500` | Cadencia de heartbeat hacia el coordinador cloud. |
| `BRIDGE_TASK_TIMEOUT_MS` | No | `30000` | Tiempo máximo de ejecución por tarea en cola. |
| `BRIDGE_MAX_CONCURRENCY` | No | `2` | Número máximo de tareas ejecutándose en paralelo. |
| `BRIDGE_MAX_FILE_SIZE_BYTES` | No | `15728640` (15 MB) | Límite de tamaño de archivo manipulado por el puente. |
| `BRIDGE_MAX_RETRIES` | No | `3` | Reintentos máximos antes de marcar error terminal. |
| `BRIDGE_STATE_FILE_PATH` | No | *(En workspace local)* | Ruta de persistencia atómica de estado de cola (`.forge-bridge-state.json`). |

### 1.3 Backend Python (`backend/.env.example`)

| Variable | Propósito | Valor por Defecto |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Clave del SDK oficial `google-genai` en Python. | *(Vacío)* |
| `ROJO_PROJECT_PATH` | Ruta local administrada para `RojoBridgeEngine`. | `./rojo_workspace` |
| `MODEL_TIER_PRO` | Modelo Gemini de complejidad alta en Python. | `gemini-2.5-pro` |
| `MODEL_TIER_FAST` | Modelo Gemini rápido para UI/iteración. | `gemini-2.5-flash` |
| `HOST` / `PORT` | Host y puerto de escucha Uvicorn/FastAPI. | `127.0.0.1` / `8000` |

---

## 2. Arquitectura de Seguridad y Endurecimiento

1. **Zero-Inbound Loopback Exclusivo (`127.0.0.1`)**: `forge-bridge` enlaza únicamente a `127.0.0.1:48720` y rechaza tráfico proveniente de interfaces no loopback. Las comunicaciones hacia Forge Cloud son salientes (`poll`/WebSocket).
2. **Validación Fail-Closed en Producción**: `validateMainServerSecurityConfig()` (`src/server/engines/bridgeCoordinatorEngine.ts`) y `forge-bridge/src/security.ts` bloquean el arranque cuando `NODE_ENV=production` y los secretos están vacíos o coinciden con tokens placeholder conocidos (`KNOWN_PLACEHOLDER_SECRETS`).
3. **Comparación en Tiempo Constante**: Todos los tokens (`X-Forge-Token`, `X-Plugin-Token`) se verifican con `crypto.timingSafeEqual` en Node/TypeScript y `hmac.compare_digest` en Python para prevenir ataques de temporización.
4. **Sobres Firmados HMAC-SHA256 y Anti-Replay**: Cada mensaje entre Cloud y Bridge incluye `nonce`, marca temporal con ventana máxima permitida y firma `X-Forge-Signature` verificada antes de encolar o aceptar resultados (`submitTaskResult`).
5. **Sandboxing de Rutas y Contención Rojo (`resolveSafeRojoPath`)**: Prohíbe rutas absolutas, `..` de *path traversal* y escrituras fuera de `ROJO_PROJECT_PATH`, permitiendo solo operaciones de la allowlist cerrada (`rojo.*` y `studio.*`).
6. **Confirmación Humana Obligatoria para Eliminaciones en Studio**: El plugin `ForgeAIStudioPlugin.server.luau` jamás elimina instancias existentes de manera silenciosa; las marca en cola `awaiting_studio_confirmation` y exige confirmación explícita en el DockWidget.
7. **Persistencia Atómica Contra Corrupción**: Tanto `assets_library.json` (`src/server/engines/assetEngine.ts`) como el estado del puente (`forge-bridge/src/taskStateStore.ts`) escriben a archivo temporal + `fsync` + `rename` atómico, respaldando `.corrupt.<ts>.bak` si detectan JSON dañado.
8. **Higiene de Datos en Cliente y Logs**: Las credenciales del frontend se ingresan en tiempo de ejecución desde UI (`forgeApiClient` / `localStorage`) sin secretos hardcodeados en código React ni en logs.
