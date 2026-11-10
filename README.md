# Forge AI Studio v2.0 — Suite de Creación 3D, Materiales PBR, Luau `--!strict`, ForgeGUI y Sincronización Rojo para Roblox Studio

**Forge AI Studio v2.0** es una plataforma integral de ingeniería asistida por IA para **Roblox Studio**, diseñada bajo una arquitectura modular de **7 motores independientes** que comparten un backend central en **Python (FastAPI)** con el SDK oficial **`google-genai`**, un visor y editor **3D WebGL (Three.js)** que emula `ViewportFrame` + `WorldModel`, sincronización automática en disco con **Rojo 7.x** verificada mediante hashes **SHA-256**, y un **Plugin nativo para Roblox Studio (`ForgeAIStudioPlugin.server.luau`)**.

---

## Tabla de Contenidos

1. [Arquitectura General del Sistema](#1-arquitectura-general-del-sistema)
2. [Estructura Completa del Repositorio](#2-estructura-completa-del-repositorio)
3. [Los 7 Motores Modulares Independientes](#3-los-7-motores-modulares-independientes)
4. [Capacidades de Creación 3D, Materiales PBR y Visor WebGL](#4-capacidades-de-creaci%C3%B3n-3d-materiales-pbr-y-visor-webgl)
5. [Hoja de Ruta (P0 a P3) — Estado de Implementación](#5-hoja-de-ruta-p0-a-p3--estado-de-implementaci%C3%B3n)
6. [Estándares Obligatorios de Código Luau](#6-est%C3%A1ndares-obligatorios-de-c%C3%B3digo-luau)
7. [Seguridad, Sandboxing y Auditoría Física de Módulos](#7-seguridad-sandboxing-y-auditor%C3%ADa-f%C3%ADsica-de-m%C3%B3dulos)
8. [Guía de Instalación y Ejecución Local](#8-gu%C3%ADa-de-instalaci%C3%B3n-y-ejecuci%C3%B3n-local)
9. [Documentación Adicional en `/docs`](#9-documentaci%C3%B3n-adicional-en-docs)

---

## 1. Arquitectura General del Sistema

El proyecto separa estrictamente la interfaz de usuario, el orquestador central y los motores de dominio para evitar monolitos difíciles de mantener:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                              FORGE AI STUDIO                                 │
│        Interfaz Principal · React 19 + TypeScript + Three.js WebGL           │
│   (3D Studio & Editor · Motores & Agentes · Luau Engine · UI Engine · Rojo)  │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ REST JSON + Server-Sent Events (SSE)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     BACKEND CENTRAL · FastAPI (main.py)                      │
│               & Unified Gateway Bridge (server.ts Puerto 3000/8000)          │
│     Gestión de IA (google-genai), Seguridad, Proyectos, Tareas y Archivos    │
└──┬───────────┬────────────┬──────────┬───────────┬───────────┬────────────┬──┘
   │           │            │          │           │           │            │
   ▼           ▼            ▼          ▼           ▼           ▼            ▼
┌──────┐   ┌───────┐   ┌────────┐  ┌───────┐  ┌────────┐  ┌─────────┐  ┌─────────┐
│  3D  │   │ Asset │   │  Luau  │  │  UI   │  │ World  │  │  Rojo   │  │ Agents  │
│Gen.  │   │Engine │   │ Engine │  │Engine │  │ Engine │  │ Bridge  │  │ Engine  │
│Engine│   │ (PBR) │   │Strict  │  │Screen │  │Scenes  │  │Sync SHA │  │  (P3)   │
└──────┘   └───────┘   └────────┘  └───────┘  └────────┘  └────┬────┘  └─────────┘
                                                               │
                                         Escritura Segura (.luau / default.project.json)
                                                               │
                                                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                    ROBLOX STUDIO PLUGIN v2.0 + ROJO 7.x                      │
│           ForgeAIStudioPlugin.server.luau (HttpService + Selection)          │
│       Inserción 3D en Workspace, Edición, Optimización y Sincronización      │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Estructura Completa del Repositorio

```text
/
├── README.md                                  # Documentación principal del repositorio
├── docs/
│   ├── ARCHITECTURE.md                        # Diseño profundo de los 7 motores y seguridad
│   ├── API_REFERENCE.md                       # Especificación completa de endpoints REST y SSE
│   └── ROBLOX_PLUGIN_AND_ROJO_GUIDE.md        # Manual de Rojo 7.x y del Plugin de Roblox Studio
├── backend/                                   # Backend Principal en Python 3.11+ (FastAPI)
│   ├── main.py                                # Orquestador central FastAPI (Puerto 8000)
│   ├── requirements.txt                       # Dependencias Python (fastapi, google-genai, pydantic)
│   ├── .env.example                           # Plantilla de variables de entorno del backend
│   ├── project_context.md                     # Contexto local inyectado y auditado antes de cada prompt
│   ├── engines/                               # Los 7 Motores Modulares en Python
│   │   ├── __init__.py
│   │   ├── generation_3d_engine.py            # Motor de Generación 3D (Texto e Imagen a Modelo 3D)
│   │   ├── asset_engine.py                    # Motor de Assets (PBR, LOD, Colisiones y Biblioteca)
│   │   ├── luau_engine.py                     # Motor Luau (--!strict, task.*, Maid lifecycle)
│   │   ├── ui_engine.py                       # Motor UI (ScreenGui, ViewportFrame, TweenService)
│   │   ├── world_engine.py                    # Motor de Escenarios (Lighting, Atmosphere, Biomas)
│   │   ├── rojo_bridge.py                     # Puente Rojo (Sandboxing, SHA-256, Auditoría de Módulos)
│   │   └── agents_engine.py                   # Motor de Agentes Especializados (P3 End-to-End)
│   └── roblox_plugin/
│       └── ForgeAIStudioPlugin.server.luau    # Plugin nativo v2.0 para Roblox Studio
├── rojo_workspace/                            # Proyecto Rojo 7.x preconfigurado y sincronizado en disco
│   ├── default.project.json                   # Mapeo oficial al DataModel de Roblox Studio (Puerto 34872)
│   ├── assets_library.json                    # Base de datos persistente de modelos y escenarios 3D
│   └── src/
│       ├── server/                            # -> ServerScriptService.Server (*.server.luau)
│       ├── client/                            # -> StarterPlayer.StarterPlayerScripts.Client (*.client.luau)
│       │   └── UI/                            # -> StarterGui.Interface (*.luau)
│       └── shared/                            # -> ReplicatedStorage.Shared (*.luau)
│           ├── Assets3D/                      # Constructores Luau de modelos 3D generados
│           ├── Utils/Maid.luau                # Módulo Maid verificado físicamente en disco
│           ├── Network/RemoteProvider.luau    # Proveedor tipado de RemoteEvents / RemoteFunctions
│           └── Types/GameTypes.luau           # Definiciones de tipos estáticos compartidos
├── src/                                       # Interfaz Principal Web (React 19 + TypeScript + Three.js)
│   ├── App.tsx                                # Navegación principal de 3 zonas
│   ├── utils/
│   │   └── roblox3DEngine.ts                  # Motor WebGL: constructor 3D, PBR procedural, 2D->Heightmap, .OBJ exporter
│   ├── server/engines/                        # Espejo TypeScript de los motores para el Gateway Unificado
│   │   ├── architectureManifest.ts            # Definición de motores, hoja de ruta P0-P3 y agentes
│   │   └── worldAndModelEditorEngine.ts       # Compilador Luau para el Editor 3D y World Engine
│   └── components/
│       ├── Forge3DStudio.tsx                  # Estudio 3D + Editor Interactivo de Piezas (P2) + PBR + Biblioteca
│       ├── RobloxWorldViewport3D.tsx          # Visor 3D WebGL real (Three.js Timer, PCFShadowMap, GLB/OBJ/FBX, LOD)
│       ├── ModularArchitectureAndAgents.tsx   # Panel de 7 Motores, Agentes Especializados (P3), World Engine y Roadmap
│       ├── ScriptGenerator.tsx                # Interfaz del Luau Engine (Server / Client / Module)
│       ├── UIGenerator.tsx                    # Interfaz del UI Engine (ForgeGUI)
│       ├── RobloxCanvasPreview.tsx            # Previsualizador dual: ScreenGui 2D + ViewportFrame 3D (WorldModel)
│       ├── RojoWorkflowGuide.tsx              # Configurador de ruta Rojo, manifiesto SHA-256 y panel de seguridad
│       ├── ContextEditor.tsx                  # Editor de project_context.md con auditoría física de módulos
│       ├── BackendExplorer.tsx                # Explorador y descargador de todos los archivos del backend y docs
│       └── FloatingTerminalLog.tsx            # Consola flotante en tiempo real para streams SSE y escritura Rojo
└── server.ts                                  # Gateway Unificado y Proxy hacia FastAPI
```

---

## 3. Los 7 Motores Modulares Independientes

| Motor | Módulo Python | Módulo TypeScript | Responsabilidad Principal |
| :--- | :--- | :--- | :--- |
| **1. 3D Generation Engine** | `backend/engines/generation_3d_engine.py` | `src/utils/roblox3DEngine.ts` | Generación de modelos 3D compuestos en **Studs** desde texto o imagen de referencia y conversión de imágenes 2D a mallas de relieve 3D. |
| **2. Asset Engine** | `backend/engines/asset_engine.py` | `src/server/engines/worldAndModelEditorEngine.ts` | Síntesis de texturas PBR (`SurfaceAppearance`), optimización de polígonos (LOD 100%/75%/50%/25%), `CollisionFidelity`, importación `.GLB/.GLTF/.OBJ/.FBX` y biblioteca `assets_library.json`. |
| **3. Luau Engine** | `backend/engines/luau_engine.py` | `server.ts` (`/api/v1/generate-script*`) | Generación de arquitectura y scripts `Server`, `Client` y `Module` con `--!strict`, librería `task.*` y patrón `Maid`. |
| **4. UI Engine** | `backend/engines/ui_engine.py` | `server.ts` (`/api/v1/generate-ui*`) | Creación de interfaces `ScreenGui` responsive (`UDim2.fromScale`), `ViewportFrame` 3D y animaciones con `TweenService`. |
| **5. World Engine** | `backend/engines/world_engine.py` | `src/server/engines/worldAndModelEditorEngine.ts` | Generación de escenarios completos, configuración de biomas lumínicos (`Lighting` + `Atmosphere`) y anclajes espaciales en `Workspace`. |
| **6. Rojo Bridge** | `backend/engines/rojo_bridge.py` | `server.ts` (`/api/v1/rojo/*`) | Sandboxing de rutas (`resolve_safe_project_path`), detección/creación de `default.project.json`, manifiesto de sincronización **SHA-256** y auditoría de módulos en disco. |
| **7. Specialized Agents (P3)** | `backend/engines/agents_engine.py` | `src/server/engines/architectureManifest.ts` | Orquestador autónomo de **7 agentes especializados** que construye y sincroniza un sistema completo (Modelo 3D + PBR + Escenario + Script Server + HUD + Rojo) en un solo flujo. |

---

## 4. Capacidades de Creación 3D, Materiales PBR y Visor WebGL

1. **Texto a Modelo 3D (`Text-to-3D`)**: Descompone cualquier prompt en 6 a 14 sub-partes articuladas (`Block`, `Cylinder`, `Ball`, `Wedge`, `CornerWedge`) con proporciones reales en **Studs** y pivote apoyado en `Y = 0`.
2. **Imagen de Referencia a Modelo 3D (`Image-to-3D IA`)**: Analiza bocetos o *concept art* mediante Gemini Vision para reconstruir volúmenes, colores y materiales Roblox.
3. **Conversión 2D a Geometría 3D en Relieve (`Heightmap Extrusion`)**: Transforma los píxeles de una imagen 2D en una malla 3D desplazada según su luminancia con resolución configurable (`24x24` a `80x80`) y altura en Studs.
4. **Importador `.GLB`, `.GLTF`, `.OBJ` y `.FBX`**: Carga modelos externos directamente en el visor WebGL, normaliza su escala a Studs y audita si superan el límite estricto de Roblox Studio (**10,000 triángulos por `MeshPart`**).
5. **Editor Interactivo de Modelos 3D (P2)**: Permite añadir o eliminar sub-partes y modificar en tiempo real su primitiva, material Roblox, tamaño `(X, Y, Z)` en Studs, posición `(X, Y, Z)`, color y valores PBR (`Roughness` / `Metalness`), recompilando al instante el módulo Luau `--!strict`.
6. **Generador Procedural de Mapas PBR (`SurfaceAppearance`)**: Sintetiza en canvas mapas descargables de **Albedo (`ColorMap.png`)**, **Mapa de Normales (`NormalMap.png`)** y **Rugosidad (`RoughnessMap.png`)**.
7. **Simulador de LOD y `CollisionFidelity`**: Dock inferior colapsable en el visor 3D para probar niveles de detalle (**100%, 75%, 50%, 25%**), visualizar envolventes de colisión (`Hull`, `Box`, `PreciseConvexDecomposition`, `Default`), activar vista explotada (*Exploded View*) y comparar tamaño con un maniquí **Roblox R15 (5.5 Studs)**.
8. **Exportación Directa a `.OBJ` y `.luau`**: Descarga cualquier modelo generado o editado como malla Wavefront `.OBJ` lista para el *Asset Manager* de Roblox Studio o como script constructor `.luau`.

---

## 5. Hoja de Ruta (P0 a P3) — Estado de Implementación

| Prioridad | Desarrollo | Resultado | Motor Responsable | Estado |
| :---: | :--- | :--- | :--- | :---: |
| **P0** | Unificar los backends | Arquitectura estable (FastAPI + Gateway Unificado) | Central + Rojo Bridge | ✅ Completado |
| **P0** | Corregir seguridad y rutas | Escritura segura (Anti-Path Traversal + `X-Forge-Token`) | Rojo Bridge | ✅ Completado |
| **P0** | Integración real con Rojo | Detección de `default.project.json`, puerto `34872` y manifiesto SHA-256 | Rojo Bridge | ✅ Completado |
| **P1** | Motor de generación 3D | Crear modelos 3D desde texto e imagen en Studs | 3D Generation Engine | ✅ Completado |
| **P1** | Importador GLB/GLTF/OBJ/FBX | Llevar modelos externos a Roblox validando `<10k` triángulos | Asset Engine | ✅ Completado |
| **P1** | Generador de texturas PBR | Mapas Albedo, Normal y Roughness para `SurfaceAppearance` | Asset Engine | ✅ Completado |
| **P1** | Visor 3D real WebGL | Inspeccionar modelos con `THREE.Timer`, `PCFShadowMap` y raycasting | 3D Generation Engine | ✅ Completado |
| **P2** | Editor interactivo de modelos | Modificar sub-partes, tamaño, posición y materiales en vivo | Asset Engine | ✅ Completado |
| **P2** | Generador de escenarios | Construir mapas con biomas de iluminación (`Lighting` + `Atmosphere`) | World Engine | ✅ Completado |
| **P2** | Biblioteca de assets | Guardar, filtrar, editar y reutilizar creaciones (`assets_library.json`) | Asset Engine | ✅ Completado |
| **P3** | Agentes especializados | Automatizar todo el flujo (Modelo 3D + PBR + Mundo + Script + UI + Rojo) | Specialized Agents Engine | ✅ Completado |

---

## 6. Estándares Obligatorios de Código Luau

Todo script generado por cualquiera de los motores (`Luau Engine`, `UI Engine`, `3D Generation Engine`, `World Engine`, `Agents Engine`) cumple estas reglas innegociables:

1. **Tipado Estático Estricto**: Todo archivo comienza obligatoriamente con `--!strict`.
2. **Librería `task` Moderna**: Uso exclusivo de `task.wait`, `task.spawn`, `task.delay` y `task.defer` (prohibido `wait()`, `spawn()`, `delay()`).
3. **Gestión de Memoria con `Maid`**: Toda conexión `RBXScriptConnection`, tween o instancia dinámica se registra en un objeto `Maid` para evitar fugas de memoria.
4. **Obtención Explícita de Servicios**: Todos los servicios se declaran al inicio del archivo mediante `game:GetService("...")`.
5. **Escalado Responsive en UI**: Los contenedores principales usan `UDim2.fromScale` y `AnchorPoint = Vector2.new(0.5, 0.5)`, estilizados con `UICorner`, `UIStroke`, `UIGradient` y `UIAspectRatioConstraint`.

---

## 7. Seguridad, Sandboxing y Auditoría Física de Módulos

- **Anti-Path Traversal (`resolve_safe_project_path`)**: Ningún endpoint puede escribir fuera del directorio configurado en `ROJO_PROJECT_PATH` ni en carpetas no autorizadas.
- **Sanitización de Código Luau**: Se bloquea cualquier script que contenga funciones inseguras como `loadstring()`, `getfenv()` o `setfenv()`.
- **Protección de Endpoints Mutables (`X-Forge-Token`)**: Soporte de token local configurable para autorizar escrituras en disco.
- **Rate Limiting y Límite de Payload**: Límite de ventana deslizante por IP y tope de 15 MB para imágenes de referencia.
- **Auditoría Física de Módulos (`/api/v1/context/audit`)**: Antes de permitir que Gemini haga `require()` de módulos listados en `project_context.md` (`Maid.luau`, `RemoteProvider.luau`, `GameTypes.luau`), el backend comprueba su existencia física en disco dentro de `rojo_workspace/src/shared/` e incluye un instalador de 1 clic (`/api/v1/context/bootstrap-modules`).

---

## 8. Guía de Instalación y Ejecución Local

### A. Ejecutar el Backend Python (FastAPI) en el Puerto 8000

```bash
cd backend
python -m venv venv
# En Linux/macOS:
source venv/bin/activate
# En Windows:
.\venv\Scripts\activate

pip install -r requirements.txt
cp .env.example .env
# Edita .env y coloca tu GEMINI_API_KEY y ROJO_PROJECT_PATH

uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### B. Ejecutar la Interfaz Web y el Gateway Unificado en el Puerto 3000

```bash
npm install
npm run dev
```

### C. Iniciar el Servidor de Sincronización Rojo 7.x

```bash
cd rojo_workspace
rojo serve default.project.json --port 34872
```

---

## 9. Documentación Adicional en `/docs`

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md): Detalle profundo del diseño de los 7 motores, flujo multi-agente P3 y modelo de seguridad.
- [`docs/API_REFERENCE.md`](./docs/API_REFERENCE.md): Documentación completa de todos los endpoints HTTP REST y SSE con esquemas JSON.
- [`docs/ROBLOX_PLUGIN_AND_ROJO_GUIDE.md`](./docs/ROBLOX_PLUGIN_AND_ROJO_GUIDE.md): Guía de instalación y uso del Plugin de Roblox Studio v2.0 y configuración de Rojo.
