# Arquitectura de Software Detallada — Forge AI Studio v2.0

Este documento describe la arquitectura interna de **Forge AI Studio v2.0**, el diseño desacoplado de sus **7 motores de dominio**, el protocolo de sincronización con **Rojo 7.x**, el motor gráfico **3D WebGL (Three.js)** y las capas de seguridad.

---

## 1. Principio Arquitectónico: Orquestador Central + 7 Motores Desacoplados

En lugar de concentrar la lógica de generación de scripts, interfaces, geometría 3D, texturas PBR, mundos y sincronización de archivos en un único archivo monolítico, el sistema divide las responsabilidades en **7 motores especializados**:

### 1.1 `3D Generation Engine` (`backend/engines/generation_3d_engine.py`)
- **Entrada**: Descripción textual o imagen de referencia en Base64, presupuesto máximo de polígonos (`target_poly_budget`) y fidelidad de colisión (`CollisionFidelity`).
- **Proceso**:
  - Utiliza Structured Outputs (`response_schema=Model3DResponse`) con Gemini (`gemini-2.5-flash` o `gemini-2.5-pro`) para descomponer cualquier objeto en **6 a 14 sub-partes geométricas** (`Block`, `Cylinder`, `Ball`, `Wedge`, `CornerWedge`) organizadas en tres escalas visuales:
    1. *Silueta Primaria* (chasis, base, estructura principal).
    2. *Formas Secundarias* (cañones, soportes, alas, columnas).
    3. *Detalles y Acentos* (núcleos de neón, sensores ópticos, antenas).
  - Normaliza las dimensiones en **Roblox Studs** tomando como referencia la altura estándar de un avatar R15 (`5.5 Studs`) y apoya la base del modelo en `Y = 0`.
- **Salida**: Especificación JSON de sub-partes + módulo constructor Luau `--!strict` con método `.Spawn(origin: CFrame?): Model`.

### 1.2 `Asset Engine` (`backend/engines/asset_engine.py`)
- **Responsabilidades**:
  1. **Síntesis Procedural de Mapas PBR (`SurfaceAppearance`)**: Genera mapas de 256×256 / 512×512 sin dependencias externas (Zero-404) para `ColorMap` (Albedo), `NormalMap` (Espacio Tangente RGB) y `RoughnessMap` (Escala de grises).
  2. **Optimización Poligonal y Colisiones**: Evalúa el conteo de triángulos frente al límite estricto de Roblox Studio (**10,000 triángulos por `MeshPart`**), calcula niveles de detalle (**LOD 100%, 75%, 50%, 25%**) y asigna `CollisionFidelity` (`Hull`, `Box`, `PreciseConvexDecomposition`, `Default`).
  3. **Importación Externa (`.GLB`, `.GLTF`, `.OBJ`, `.FBX`)**: Analiza mallas externas en el cliente WebGL, centra el pivote, escala el *bounding box* a Studs y permite re-exportar a Wavefront `.OBJ` limpio para Roblox Studio.
  4. **Biblioteca Persistente (`assets_library.json`)**: Almacena en disco todos los modelos 3D y escenarios para reutilizarlos o editarlos en cualquier sesión.

### 1.3 `Luau Engine` (`backend/engines/luau_engine.py`)
- **Responsabilidades**:
  - Generación de scripts `Server` (`*.server.luau`), `Client` (`*.client.luau`) y `Module` (`*.luau`).
  - Inyección de contexto auditado desde `project_context.md`.
  - Cumplimiento estricto de `--!strict`, servicios al inicio con `game:GetService(...)`, librería `task.*` y limpieza de eventos con `Maid`.

### 1.4 `UI Engine` (`backend/engines/ui_engine.py`)
- **Responsabilidades**:
  - Generación de módulos `ScreenGui` en `src/client/UI` con posicionamiento exclusivamente en escala (`UDim2.fromScale`) y `AnchorPoint = Vector2.new(0.5, 0.5)`.
  - Generación simultánea del árbol jerárquico `ui_tree` para previsualización en vivo y soporte nativo de `ViewportFrame` con `WorldModel` 3D.

### 1.5 `World Engine` (`backend/engines/world_engine.py`)
- **Responsabilidades**:
  - Configuración programática del servicio `Lighting` y la instancia `Atmosphere` según biomas predefinidos (`CyberpunkOrbital`, `MedievalForge`, `ArcticResearchBase`).
  - Ensamblaje espacial de múltiples assets de la biblioteca dentro de una carpeta de zona en `Workspace`.

### 1.6 `Rojo Bridge` (`backend/engines/rojo_bridge.py`)
- **Responsabilidades**:
  - Validación de seguridad de rutas (`resolve_safe_project_path`) garantizando que ningún archivo pueda escribirse fuera de `ROJO_PROJECT_PATH`.
  - Detección y generación automática de `default.project.json`.
  - Sondeo TCP del servidor `rojo serve` en el puerto `34872` y detección del binario `rojo` en el sistema.
  - Generación del **Manifiesto de Sincronización SHA-256** (`/api/v1/rojo/sync-manifest`) para verificar que cada archivo `.luau` escrito en disco coincide byte a byte con lo esperado por Roblox Studio.

### 1.7 `Specialized Agents Engine — P3` (`backend/engines/agents_engine.py`)
- **Flujo Secuencial de 7 Agentes**:
  1. `ArchitectAgent`: Audita los módulos físicos en `src/shared/` (`Maid`, `RemoteProvider`, `GameTypes`) y define el nombre y contrato del sistema.
  2. `3DGenerationAgent`: Construye la geometría 3D compuesta y escribe `src/shared/Assets3D/<Sistema>Model.luau`.
  3. `AssetEngineAgent`: Calcula el perfil PBR `SurfaceAppearance`, valida `<10,000` triángulos y registra el modelo en `assets_library.json`.
  4. `WorldBuilderAgent`: Genera el entorno lumínico y anclajes espaciales en `src/shared/<Sistema>World.luau`.
  5. `LuauScripterAgent`: Escribe el controlador de servidor `--!strict` con `Maid` en `src/server/<Sistema>Controller.server.luau`.
  6. `UIEngineAgent`: Crea el HUD táctico `ScreenGui` con `UDim2.fromScale` y `TweenService` en `src/client/UI/<Sistema>HUD.luau`.
  7. `RojoBridgeAgent`: Verifica y firma con SHA-256 todos los archivos escritos en el proyecto Rojo.

---

## 2. Arquitectura del Visor 3D WebGL (`RobloxWorldViewport3D.tsx`)

El visor 3D no es una simulación HTML 2D: es un motor **Three.js WebGL** completo diseñado siguiendo las mejores prácticas de rendimiento y fidelidad visual:

- **Temporización Moderna (`THREE.Timer`)**: Usa `new THREE.Timer()` conectado al `document` (`timer.connect(document)`) para evitar saltos de delta cuando la pestaña pierde foco y se libera con `timer.dispose()` al desmontar.
- **Sombras y Tone Mapping**: Configura `ACESFilmicToneMapping`, `SRGBColorSpace` y sombras `THREE.PCFShadowMap` con `normalBias` ajustado para evitar *shadow acne*.
- **Iluminación de Estudio en 3 Puntos + IBL**:
  - `RoomEnvironment` procesado con `PMREMGenerator` para reflejos metálicos realistas.
  - `HemisphereLight` cielo/suelo + `DirectionalLight` principal cálida + `DirectionalLight` de contraluz (*Rim Light*) cian + `FogExp2` atmosférica.
- **Bucle de Renderizado Bajo Demanda (*On-Demand Coalesced Loop*)**:
  - Solo renderiza cuando hay cambios en `OrbitControls`, transiciones amortiguadas de cámara (`THREE.MathUtils.damp`), cambios en el slider de *Exploded View* o edición de piezas 3D, ahorrando GPU y CPU.
  - Detecta automáticamente renderizadores WebGL por software (`SwiftShader` / `llvmpipe`) y aplica sincronización `gl.fenceSync` para evitar bloqueos del hilo principal.
