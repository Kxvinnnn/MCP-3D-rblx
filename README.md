# NIGHTMARE FORGE / Forge AI Studio v2.3.0 — Suite de Creación 3D (`EditableMesh`), Materiales PBR, Luau `--!strict`, ForgeGUI, Local Bridge y Sincronización Rojo para Roblox Studio

**NIGHTMARE FORGE / Forge AI Studio v2.3.0** es una plataforma integral para crear, importar, editar, validar, exportar y sincronizar modelos y assets 3D destinados a **Roblox Studio**, diseñada bajo una arquitectura modular verificada con:
- **3 Motores de Generación 3D integrados**:
  1. **Motor 1 — Generación Procedural Parametrizada con Semillas Reproducibles (`seed`)**: funciona **100% en local/offline sin requerir claves de API de pago**, soportando las **8 categorías oficiales** (`Props`, `Trees & Vegetation`, `Rocks & Nature`, `Buildings & Structures`, `Furniture & Interior`, `Scene Elements`, `Stylized Assets`, `Ambient & Decoration`), el **Generador Parametrizado de Árboles 3D** (23 parámetros configurables + LOD 0/1/2) y el conversor determinista de lenguaje natural a parámetros (`parseNaturalLanguageToTreeParams`).
  2. **Motor 2 — Generación Asistida por IA + Procedural**: utiliza el proveedor IA configurado (`GEMINI_API_KEY` opcional) con fallback automático al Motor 1 Procedural si no hay clave configurada.
  3. **Motor 3 — Importación, Conversión y Ensamblaje (`.OBJ`, `.GLTF`, `.GLB`, `.RBXMX`)**: normaliza escala en Studs, asienta el pivote inferior en `Y = 0` y divide automáticamente mallas mayores de 9,500 triángulos sin pérdida de caras.
- **Sincronización Bidireccional Real con Roblox Studio**:
  `Forge AI Studio -> Forge Cloud Coordinator -> Forge Local Bridge (127.0.0.1:48720) -> ForgeAIStudioPlugin.server.luau -> Roblox Studio Workspace` + `Rojo 7.x (:34872)`.
- **Seguridad Endurecida e Integridad SHA-256**:
  Autenticación de sesiones y resultados con **HMAC-SHA256**, protección anti-replay por `nonce` y ventana temporal, comparación de tokens en tiempo constante (`timingSafeEqual` / `hmac.compare_digest`), persistencia atómica de tareas (`TaskStateStore`) y verificación de recibos geométricos `EditableMesh`.

---

## Tabla de Contenidos

1. [Arquitectura General del Sistema](#1-arquitectura-general-del-sistema)
2. [Estructura Completa del Repositorio](#2-estructura-completa-del-repositorio)
3. [Los Motores Modulares y Sistema Multiagente](#3-los-motores-modulares-y-sistema-multiagente)
4. [Capacidades 3D, Semillas Reproducibles y Árboles 3D](#4-capacidades-3d-semillas-reproducibles-y-árboles-3d)
5. [Seguridad, Persistencia Atómica e Integridad SHA-256](#5-seguridad-persistencia-atómica-e-integridad-sha-256)
6. [Guía Paso a Paso de Instalación y Ejecución desde Cero en Windows](#6-guía-paso-a-paso-de-instalación-y-ejecución-desde-cero-en-windows)
7. [Caso de Uso Completo: Generar y Sincronizar un Árbol 3D en Roblox Studio](#7-caso-de-uso-completo-generar-y-sincronizar-un-árbol-3d-en-roblox-studio)
8. [Pruebas Automatizadas y CI/CD](#8-pruebas-automatizadas-y-cicd)
9. [Documentación Adicional en `/docs`](#9-documentación-adicional-en-docs)

---

## 1. Arquitectura General del Sistema

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                   NIGHTMARE FORGE / FORGE AI STUDIO v2.3.0                   │
│        Interfaz Principal · React 19 + TypeScript + Three.js WebGL           │
│   (Asistente 3D · Visor/Editor 3D · Materiales PBR · Motores · Biblioteca)   │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ REST JSON + Server-Sent Events (SSE)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│              GATEWAY UNIFICADO (server.ts :3000) & FASTAPI (:8000)           │
│   CloudBridgeCoordinator · Procedural3DGenerator · WorldAndModelEditorEngine │
└──┬───────────────────────────┬───────────────────────────┬───────────────────┘
   │                           │                           │
   │ Envelopes firmados HMAC   │ Escritura segura en disco │ API REST / SSE
   ▼                           ▼                           ▼
┌──────────────────────────┐ ┌───────────────────────────┐ ┌───────────────────┐
│   FORGE LOCAL BRIDGE     │ │   PROYECTO ROJO 7.x       │ │ BIBLIOTECA ASSETS │
│   (127.0.0.1:48720)      │ │   (rojo serve :34872)     │ │ assets_library    │
│ Cola Atómica + Anti-Dup  │ │   default.project.json    │ │ Historial SHA-256 │
└────────────┬─────────────┘ └─────────────┬─────────────┘ └───────────────────┘
             │ Polling HTTP loopback       │ Sincronización Rojo
             ▼                             ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                  ROBLOX STUDIO PLUGIN v2.3.0 + WORKSPACE                     │
│   ForgeAIStudioPlugin.server.luau (AssetService:CreateEditableMesh + Recibo) │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Estructura Completa del Repositorio

```text
/
├── README.md                                  # Guía principal e instalación paso a paso en Windows
├── AI_ARCHITECTURE_MAP.md                     # Mapa arquitectónico y contratos de módulos
├── docs/
│   ├── ARCHITECTURE.md                        # Diseño de motores, seguridad y sincronización
│   ├── API_REFERENCE.md                       # Especificación de endpoints REST y SSE
│   ├── ROBLOX_PLUGIN_AND_ROJO_GUIDE.md        # Manual de Rojo 7.x, Local Bridge y Plugin v2.3.0
│   └── STABILIZATION_DATA_INTEGRITY.md        # Especificación de integridad SHA-256 y recibos
├── forge-bridge/                              # Servicio Local en Windows (127.0.0.1:48720)
│   ├── src/
│   │   ├── server.ts                          # Servidor HTTP loopback exclusivo 127.0.0.1
│   │   ├── cloudClient.ts                     # Cliente saliente autenticado con HMAC-SHA256
│   │   ├── protocol.ts                        # Contrato de mensajes v1.0 y firmas HMAC
│   │   ├── studioQueue.ts                     # Coordinador de tareas, confirmación destructiva y recibos
│   │   ├── taskStateStore.ts                  # Almacén persistente atómico (.tmp + rename)
│   │   ├── rojoHandler.ts                     # Gestor local de archivos Rojo y manifiesto SHA-256
│   │   └── security.ts                        # Sandboxing de rutas relativas y sanitización Luau
│   └── tests/bridge.test.ts                   # Suite de pruebas de integración y persistencia del Bridge
├── backend/                                   # Backend Python 3.11+ (FastAPI Puerto 8000)
│   ├── main.py                                # Orquestador central FastAPI v2.3.0
│   ├── engines/                               # Motores modulares en Python
│   └── roblox_plugin/
│       └── ForgeAIStudioPlugin.server.luau    # Plugin nativo v2.3.0 para Roblox Studio
├── src/                                       # Frontend React 19 + TypeScript + Motores del Gateway
│   ├── server/engines/
│   │   ├── procedural3DGenerator.ts           # Motor 1: Generación Procedural Parametrizada (8 categorías + Árboles 3D)
│   │   ├── bridgeCoordinatorEngine.ts         # Coordinador Cloud con HMAC, anti-replay y sesiones
│   │   ├── generation3DEngine.ts              # Motor de geometría EditableMesh y exportadores
│   │   └── worldAndModelEditorEngine.ts       # Compilador .luau, .rbxmx, .gltf, .obj/.mtl y biblioteca
│   ├── utils/
│   │   ├── canonicalHash.ts                   # Hash SHA-256 canónico por pieza y por categoría
│   │   ├── incrementalSync.ts                 # Motor de diferencias incrementales por partId estable
│   │   ├── receiptVerification.ts             # Evaluador de recibos de reconstrucción del Plugin
│   │   ├── robloxGeometryValidator.ts         # Validador geométrico EditableMesh con tolerancia relativa
│   │   ├── treePromptParser.ts                # Conversor determinista de prompts ES/EN a parámetros de árbol
│   │   └── roblox3DEngine.ts                  # Visor WebGL Three.js (LOD 0/1/2), exportación .luau/.rbxmx/.gltf/.obj
│   └── components/                            # Vistas del Estudio 3D, Asistente, Comparador de Variantes y Rojo
├── tests/                                     # Suites de pruebas automatizadas (Node.js + Python E2E)
└── server.ts                                  # Servidor Principal Express + Vite Middleware (:3000)
```

---

## 3. Los Motores Modulares y Sistema Multiagente

| Módulo | Implementación TS | Implementación Python | Responsabilidad Principal |
| :--- | :--- | :--- | :--- |
| **1. Procedural & 3D Generation Engine** | `src/server/engines/procedural3DGenerator.ts` & `generation3DEngine.ts` | `backend/engines/generation_3d_engine.py` | Generación 3D procedural determinista por semilla (`seed`), generador parametrizado de árboles 3D, Text-to-3D e Image-to-3D. |
| **2. Asset & PBR Engine** | `src/server/engines/assetEngine.ts` | `backend/engines/asset_engine.py` | Mapas PBR (`SurfaceAppearance`), niveles LOD, `CollisionFidelity`, exportación `.luau/.rbxmx/.gltf/.obj` y biblioteca persistente. |
| **3. Luau Engine (`--!strict`)** | `src/server/engines/luauEngine.ts` | `backend/engines/luau_engine.py` | Generación de scripts `Server`, `Client` y `Module` con `--!strict`, `task.*` y patrón `Maid`. |
| **4. UI Engine (`ForgeGUI`)** | `src/server/engines/uiEngine.ts` | `backend/engines/ui_engine.py` | Interfaces `ScreenGui` responsive (`UDim2.fromScale`) y `ViewportFrame` 3D. |
| **5. World Engine** | `src/server/engines/worldEngine.ts` | `backend/engines/world_engine.py` | Escenarios completos, iluminación ambiental (`Lighting` + `Atmosphere`) y ensamblaje espacial. |
| **6. Rojo & Local Bridge Engine** | `src/server/engines/bridgeCoordinatorEngine.ts` & `forge-bridge/` | `backend/engines/rojo_bridge.py` | Comunicación segura Cloud-Local-Plugin, sandboxing de rutas, manifiesto SHA-256 y cola persistente atómica. |
| **7. Sistema Multiagente (8 Roles)** | `src/server/engines/architectureManifest.ts` | `backend/engines/agents_engine.py` | Coordina Agente Coordinador/Diseño, Agente 3D, Agente de Materiales, Agente de Escenario, Agente de Código, Agente de Interfaz, Agente de Roblox y Agente de Validación/Recuperación. |

---

## 4. Capacidades 3D, Semillas Reproducibles y Árboles 3D

1. **8 Categorías Oficiales de Assets 3D**:
   - `Trees & Vegetation` (Árboles y vegetación)
   - `Props` (Objetos y props)
   - `Rocks & Nature` (Rocas y elementos naturales)
   - `Buildings & Structures` (Edificios y estructuras)
   - `Furniture & Interior` (Mobiliario e interiores)
   - `Scene Elements` (Elementos de escenario)
   - `Stylized Assets` (Modelos estilizados)
   - `Ambient & Decoration` (Elementos ambientales y decorativos)
2. **Generador Parametrizado de Árboles 3D (`generateParameterizedTree3DParts`)**:
   - **14 parámetros configurables**: `seed`, `height` (4–45 studs), `trunkThickness` (0.4–6.0 studs), `branchCount` (1–12), `canopyShape` (`spherical`, `conical`, `layered`, `weeping`), `leafDistribution` (`balanced`, `dense`, `clustered`, `sparse`), `trunkMaterial`, `leafMaterial`, `variation`, `trunkColor`, `leafColor`, `lodLevel` (`0`/`1`/`2`), `branchSpread`, `rootFlareScale`.
   - Produce jerarquía completa (`Root/RootFlare`, `Root/MainTrunk`, `Root/Branches/Branch_1..N`, `Root/Canopy/CanopyCrown_Main`, `Root/Canopy/FoliageCluster_1..M`) asentada exactamente en `Y = 0` con mallas cerradas LOD 0/1/2 verificadas sin caras abiertas.
3. **Determinismo por Semilla (`seed`) e Identificadores Honestos**:
   - La misma semilla y los mismos parámetros producen siempre exactamente los mismos buffers de vértices, normales, UVs, caras y el mismo hash canónico SHA-256 (`geometryHash`, `contentHash`, `forgeAssetId`), manteniendo `robloxAssetId: null` hasta una publicación real en Roblox Cloud (y distinguiendo PBR `local_saved` vs `cloud_published`).

---

## 5. Seguridad, Persistencia Atómica e Integridad SHA-256

- **Sin credenciales por defecto en producción**: Los archivos `.env.example` y el plugin de Roblox Studio no activan tokens de ejemplo usables por defecto; `server.ts`, `backend/main.py` y `CloudBridgeCoordinator` rechazan tokens placeholder conocidos si `NODE_ENV=production`.
- **Comparación en tiempo constante**: Validación de tokens y firmas mediante `crypto.timingSafeEqual` (Node.js) y `hmac.compare_digest` (Python).
- **Verificación HMAC-SHA256 + Anti-Replay**: Handshake con validación de ventana temporal (`5 min`), bloqueo de `nonce` repetido y verificación obligatoria de firma HMAC tanto en el despacho de tareas como en `task-result`.
- **Persistencia Atómica (`TaskStateStore`)**: Escritura mediante archivo temporal (`.tmp`) + `fs.renameSync` con preservación de archivos corruptos (`.corrupt.<timestamp>.bak`) sin pérdida silenciosa de confirmaciones destructivas pendientes.

---

## 6. Guía Paso a Paso de Instalación y Ejecución desde Cero en Windows

### 6.1 Requisitos Previos en Windows
1. **Node.js 20 LTS o superior** (`node -v` y `npm -v`).
2. **Python 3.11 o superior** (`python --version`).
3. **Git para Windows** (`git --version`).
4. **Rojo 7.x CLI** (`rojo --version`, opcional pero recomendado para sincronización de scripts en disco).
5. **Roblox Studio** con **HttpService habilitado** (`Game Settings -> Security -> Allow HTTP Requests = ON`) y beta de **`EditableMesh` / `EditableImage`** activa si tu versión de Studio lo requiere.

### 6.2 Paso 1: Abrir el Repositorio e Instalar Dependencias en Windows PowerShell

```powershell
cd C:\Users\dadada\Desktop\MCP-3D-rblx

# 1. Instalar dependencias del proyecto principal (Frontend + Gateway)
npm install

# 2. Instalar dependencias y compilar el Forge Local Bridge
npm --prefix forge-bridge install
npm --prefix forge-bridge run build
```

### 6.3 Paso 2: Generar un Secreto Aleatorio Seguro y Configurar `.env`

En PowerShell, genera un token criptográfico aleatorio de 32 bytes:

```powershell
$SECRET = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
Write-Host "Tu token seguro generado es: $SECRET"
```

1. Copia `.env.example` a `.env` en la raíz (`C:\Users\dadada\Desktop\MCP-3D-rblx\.env`):
   ```ini
   FORGE_SECURITY_TOKEN="<PEGA_AQUI_TU_SECRET>"
   FORGE_LOCAL_TOKEN="<PEGA_AQUI_TU_SECRET>"
   FORGE_BRIDGE_SHARED_SECRET="<PEGA_AQUI_TU_SECRET>"
   ROJO_PROJECT_PATH="./rojo_workspace"
   # Opcional: Solo si deseas usar además el Motor 2 asistido por IA en la nube
   GEMINI_API_KEY=""
   ```
2. Copia `forge-bridge\.env.example` a `forge-bridge\.env`:
   ```ini
   FORGE_CLOUD_URL="http://127.0.0.1:3000"
   FORGE_BRIDGE_SHARED_SECRET="<PEGA_AQUI_TU_SECRET>"
   FORGE_PLUGIN_LOCAL_TOKEN="<PEGA_AQUI_TU_SECRET>"
   ROJO_PROJECT_PATH="../rojo_workspace"
   BRIDGE_HOST="127.0.0.1"
   BRIDGE_PORT="48720"
   ROJO_PORT="34872"
   ```

### 6.4 Paso 3: Instalar el Plugin en Roblox Studio

Copia el archivo del plugin a la carpeta oficial de plugins de Roblox Studio en Windows:

```powershell
Copy-Item -Path ".\backend\roblox_plugin\ForgeAIStudioPlugin.server.luau" `
          -Destination "$env:LOCALAPPDATA\Roblox\Plugins\ForgeAIStudioPlugin.server.luau" -Force
```

### 6.5 Paso 4: Iniciar los Servicios en Windows

Abre **2 terminales PowerShell** en `C:\Users\dadada\Desktop\MCP-3D-rblx`:

- **Terminal 1 — Plataforma Principal (Puerto 3000)**:
  ```powershell
  npm run dev
  ```
  Abre `http://localhost:3000` en tu navegador.

- **Terminal 2 — Forge Local Bridge (Puerto Loopback 127.0.0.1:48720)**:
  ```powershell
  npm --prefix forge-bridge start
  ```
  *(Opcional: Si también deseas ejecutar `rojo serve`, abre una tercera terminal en `rojo_workspace` y ejecuta `rojo serve default.project.json --port 34872`).*

### 6.6 Paso 5: Conectar Roblox Studio
1. Abre un lugar (`Place`) en **Roblox Studio** y habilita **Allow HTTP Requests** en `Home -> Game Settings -> Security`.
2. En la pestaña **Plugins**, abre **Forge AI v2.3.0 -> Forge AI Suite**.
3. En el campo **Security Token** del widget del plugin, pega el mismo `$SECRET` que configuraste en `.env` y pulsa **Guardar / Conectar**.
4. Verifica en la barra superior de `http://localhost:3000` que tanto **Local Bridge** como **Roblox Studio** aparecen en estado **Conectado**.

---

## 7. Caso de Uso Completo: Generar y Sincronizar un Árbol 3D en Roblox Studio

1. En `http://localhost:3000`, entra en **Crear Nuevo Objeto 3D**.
2. En el **Paso 1**, selecciona la categoría **Árboles y Vegetación (`Trees & Vegetation`)** y pulsa **Continuar**.
3. En el **Paso 2**, escribe la descripción o elige una plantilla y pulsa **Continuar**.
4. En el **Paso 3**:
   - Selecciona **Motor 1: Procedural Parametrizado (100% Local / Sin API de pago)**.
   - Define la **Semilla Reproducible** (ej. `oak-tree-2026`).
   - Ajusta **Altura total** (`14`–`24` studs), **Grosor de tronco** (`1.6` studs), **Número de ramas** (`5`), **Forma de copa** (`Esférica`, `Cónica`, `Escalonada` o `Colgante`) y **Distribución de hojas** (`Densa`).
   - Pulsa **Generar Modelo 3D Procedural**.
5. En el **Paso 5**, inspecciona el árbol 3D en el visor interactivo, ábrelo en el **Editor 3D** para validar geometría o exportar `.luau`, `.rbxmx`, `.gltf` o `.obj`, o pulsa directamente **Enviar a Roblox Studio** para que el plugin reconstruya todas sus `MeshPart` (`EditableMesh`) en `Workspace` y devuelva el recibo SHA-256 verificado.

---

## 8. Pruebas Automatizadas y CI/CD

Ejecuta toda la batería de verificación desde la raíz del proyecto:

### 8.1 Matriz Honesta de Clasificación y Estado (`v2.3.0`)

| Capacidad / Subsistema | Clasificación | Evidencia Verificable |
| :--- | :---: | :--- |
| **Motor 1 Procedural 3D (8 categorías + árbol 23 params + NLP + LOD 0/1/2)** | `Implementado y Testeado` | `npm test` (`tests/proceduralTreeAndE2EMission.test.ts` + `tests/nightmareForgeE2EAndSecurity.test.ts`), 7 presets + seed determinista sin API key. |
| **Gateway Express (Fail-Closed, CORS Allowlist explícito, anti-path OS, confirmación destructiva)** | `Implementado y Testeado` | `npm test` (`tests/mainServerSecurity.test.ts`), `X-Forge-Token`, `?confirm=true`, sanitización de rutas locales. |
| **Forge Local Bridge (HMAC + Anti-Replay + Persistencia Atómica OS + CORS Allowlist)** | `Implementado y Testeado` | `npm --prefix forge-bridge test` y `tests/proceduralTreeAndE2EMission.test.ts` (incluyendo reinicio OS con `SIGTERM` y flujo completo 13 pasos). |
| **Visor Three.js, Editor 3D (smooth arreglado, bounds, comparador variantes) y Exportadores (.luau/.rbxmx/.gltf/.obj+.mtl)** | `Implementado y Testeado` | `npm run build`, `npm run lint`, pruebas de exportación en disco y resolución `#RRGGBB`. |
| **Hashing Canónico SHA-256, Validador Ear Clipping & Sync Incremental** | `Implementado y Testeado` | `npm test` y `python3 tests/test_e2e_bidirectional_sync.py`. |
| **Motor 2 IA / PBR Cloud Open Cloud (`GEMINI_API_KEY` / `ROBLOX_OPEN_CLOUD_API_KEY`)** | `Solo con API externa` | Usa fallback procedural local o estado `local_saved` cuando no hay claves configuradas. |
| **Motor 3 Importación compleja y Escenarios Multi-Asset (`Scene3D`)** | `Experimental` | Soporta `.OBJ/.GLTF/.GLB/.RBXMX` y biomas; geometrías externas no uniformes requieren validación previa en Editor 3D. |
| **Ejecución en vivo dentro de Roblox Studio Desktop (`ForgeAIStudioPlugin.server.luau` v2.3.0)** | `Validación manual en Roblox Studio` | Código `--!strict` y límite 20,000 vértices/caras verificado; la reconstrucción visual interactiva dentro de Roblox Studio Desktop en Windows/macOS debe validarse manualmente siguiendo `docs/ROBLOX_PLUGIN_AND_ROJO_GUIDE.md`. |

```powershell
# 1. Verificación estática de tipos TypeScript (Frontend + Gateway + Bridge)
npm run lint
npm --prefix forge-bridge run typecheck

# 2. Suite de pruebas unitarias, seguridad, generador de árboles 3D, persistencia atómica y Bridge
npm test
npm --prefix forge-bridge test

# 3. Suite Python E2E de sincronización bidireccional y paridad de hashes SHA-256
python tests/test_e2e_bidirectional_sync.py

# 4. Compilación de producción (Frontend + Bridge)
npm --prefix forge-bridge run build
npm run build
```

---

## 9. Documentación Adicional en `/docs`

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md): Diseño de los motores, flujo multiagente, seguridad HMAC y persistencia atómica.
- [`docs/API_REFERENCE.md`](./docs/API_REFERENCE.md): Especificación de endpoints HTTP REST y SSE.
- [`docs/ROBLOX_PLUGIN_AND_ROJO_GUIDE.md`](./docs/ROBLOX_PLUGIN_AND_ROJO_GUIDE.md): Guía de instalación y uso del Plugin de Roblox Studio v2.3.0, `Forge Local Bridge` y Rojo 7.x.
- [`docs/STABILIZATION_DATA_INTEGRITY.md`](./docs/STABILIZATION_DATA_INTEGRITY.md): Detalles de integridad SHA-256 canónica, triangulación relativa y recibos de verificación.
- [`docs/USER_GUIDE.md`](./docs/USER_GUIDE.md): Manual paso a paso de uso de la plataforma en modos Sencillo y Avanzado.

